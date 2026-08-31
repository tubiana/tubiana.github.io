#!/usr/bin/env python3
"""
prepare_data.py — preprocessing pipeline for orf1viewer.

Scans a directory of AlphaFold2 prediction folders and produces the static,
web-optimised payload consumed by the SPA (public/data/manifest.json.gz +
per-model artifacts).

Layout expected in --source (default: models_ORF1_files)
--------------------------------------------------------
    <MODELID>/predictions/<MODELID>_unrelaxed_rank_001_alphafold2_*_model_<N>_seed_000.pdb[.gz]
    <MODELID>/predictions/<MODELID>_scores_rank_001_alphafold2_*_model_<N>_seed_000.json[.gz]
    <MODELID>/accentuated_PAE.png
    dataset_*.csv      (domain borders: column "border_<Domain>" = "(start-end)")
    ORF1_MSA.aln       (Clustal alignment, optional)

Output
------
    public/data/manifest.json.gz  (+ manifest.json plain copy)
    public/data/pdb-bb/<id>.pdb.gz        backbone-only (N,CA,C,O,OXT) — loaded by Mol*
    public/data/pdb-full/<id>.pdb.gz      full-atom     — download button
    public/data/pae/<id>.png|webp         PAE matrix, 8-bit single channel, LUT-indexed, LOSSLESS
    public/data/plddt/<id>.bin.gz         uint8 pLDDT per residue (0..100)
    public/data/paeimg/<id>.webp          accentuated_PAE.png resized
    public/data/scores/<id>.json.gz       original scores JSON (archive preset only)
    public/data/msa.aln.gz + msa.json     Clustal alignment + index

The PAE matrix is stored as a single-channel 8-bit image: pixel value = index
into a quantisation look-up table (see --preset / --lut). Lossless PNG (or WebP)
decodes bit-exactly, so the browser recovers Ångström values with the LUT baked
into the manifest.

Examples
--------
    python3 scripts/prepare_data.py                          # "pages" preset
    python3 scripts/prepare_data.py --preset lean --limit 50
    python3 scripts/prepare_data.py --preset archive         # Zenodo / HF bundle
    python3 scripts/prepare_data.py --selfcheck 8            # decode-round-trip check
    python3 scripts/prepare_data.py --dry-run
"""
from __future__ import annotations

import argparse
import csv
import glob
import gzip
import io
import json
import os
import re
import sys
import time
from collections import OrderedDict
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass, field

try:
    import numpy as np
except ImportError:  # pragma: no cover
    sys.exit("numpy is required:  pip install numpy")

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required:  pip install pillow")

# --------------------------------------------------------------------------
# constants
# --------------------------------------------------------------------------
SCHEMA_VERSION = 1

# Domain colours ported from color_per_domain.py (PyMOL tv_* palette).
# NB: the original PyMOL script has no colour for HVR (it only had the
# "WHAAAAAT": magenta placeholder); HVR therefore gets magenta here so that all
# six annotated domains are visible in the viewer.
DOMAIN_COLORS: "OrderedDict[str, str]" = OrderedDict(
    [
        ("MetY", "#2f6fdb"),         # tv_blue
        ("FABD-like", "#e8c33d"),    # tv_yellow
        ("HVR", "#c04ec2"),          # magenta (added)
        ("domX", "#d8452f"),         # tv_red
        ("Hel", "#ec8a2a"),          # tv_orange
        ("RdRp", "#2f9e5f"),         # tv_green
    ]
)

# PAE quantisation luts: each entry = (low_included, high_excluded, step Å)
PAE_LUTS = {
    "lean": [(0.0, 12.0, 1.0), (12.0, 20.0, 2.0), (20.0, 33.0, 4.0)],
    "balanced": [(0.0, 8.0, 0.5), (8.0, 16.0, 1.0), (16.0, 33.0, 2.0)],
    "hifi": [(0.0, 33.0, 0.5)],
    "maxi": [(0.0, 33.0, 0.25)],
}
LUT_MAX_ERR = {"lean": 2.0, "balanced": 1.5, "hifi": 0.25, "maxi": 0.125}

PRESETS = {
    "lean":    dict(lut="lean",     codec="png",  img_px=900,  img_q=70, pdb=("bb",),         scores_json=False),
    "pages":   dict(lut="balanced", codec="png",  img_px=1100, img_q=72, pdb=("bb", "full"),  scores_json=False),
    "hifi":    dict(lut="hifi",     codec="png",  img_px=1400, img_q=75, pdb=("bb", "full"),  scores_json=False),
    "archive": dict(lut="hifi",     codec="webp", img_px=1600, img_q=78, pdb=("bb", "full"),  scores_json=True),
}
DEFAULT_PRESET = "pages"

# Measured on this dataset (hepcivirus ORF1, ~1700 residues): KB per model.
MEASURED_KB_PER_MODEL = {
    ("lean", "png"): 405, ("lean", "webp"): 350,
    ("balanced", "png"): 540, ("balanced", "webp"): 475,
    ("hifi", "png"): 960, ("hifi", "webp"): 850,
    ("maxi", "png"): 1300, ("maxi", "webp"): 1145,
}

BB_ATOMS = {"N", "CA", "C", "O", "OXT"}
THREE_TO_ONE = {
    "ALA": "A", "ARG": "R", "ASN": "N", "ASP": "D", "CYS": "C", "GLN": "Q",
    "GLU": "E", "GLY": "G", "HIS": "H", "ILE": "I", "LEU": "L", "LYS": "K",
    "MET": "M", "PHE": "F", "PRO": "P", "SER": "S", "THR": "T", "TRP": "W",
    "TYR": "Y", "VAL": "V", "MSE": "M",
}


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------
def build_lut(spec) -> "np.ndarray":
    bins: list[float] = []
    for lo, hi, step in spec:
        x = lo
        while x < hi - 1e-9:
            bins.append(round(x + step / 2.0, 4))
            x += step
    arr = np.asarray(bins, dtype=np.float32)
    if arr.size > 255:
        raise SystemExit(f"lut too large ({arr.size} levels > 255)")
    return arr


def lut_edges(lut: "np.ndarray") -> "np.ndarray":
    """Boundaries between consecutive lut levels (for searchsorted)."""
    return (lut[:-1] + lut[1:]) / 2.0


def quantize(values: "np.ndarray", lut: "np.ndarray", edges: "np.ndarray") -> "np.ndarray":
    idx = np.searchsorted(edges, values.reshape(-1))
    np.clip(idx, 0, len(lut) - 1, out=idx)
    return idx.astype(np.uint8).reshape(values.shape)


def human(n: float) -> str:
    for unit, div in (("GB", 1e9), ("MB", 1e6), ("KB", 1e3)):
        if abs(n) >= div:
            return f"{n / div:.2f} {unit}"
    return f"{n:.0f} B"


def read_bytes_any(path: str) -> bytes:
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rb") as fh:  # type: ignore[operator]
        return fh.read()


def write_atomic(path: str, data: bytes, compress: bool = False, level: int = 9) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    if compress:
        with gzip.open(tmp, "wb", compresslevel=level) as fh:
            fh.write(data)
    else:
        with open(tmp, "wb") as fh:
            fh.write(data)
    os.replace(tmp, path)


def parse_size(s: str) -> float:
    m = re.fullmatch(r"\s*([0-9.]+)\s*([kmgt]?)(i?)b?\s*", s.lower())
    if not m:
        raise SystemExit(f"--budget: cannot parse '{s}' (use e.g. 900MB or 1GB)")
    mult = {"": 1.0, "k": 1e3, "m": 1e6, "g": 1e9, "t": 1e12}[m.group(2)]
    if m.group(3) == "i":
        mult = {"": 1.0, "k": 1024.0, "m": 1024.0 ** 2, "g": 1024.0 ** 3, "t": 1024.0 ** 4}[m.group(2)]
    return float(m.group(1)) * mult


def fnmatch_to_re(pat: str) -> str:
    out = []
    for ch in pat:
        if ch == "*":
            out.append(".*")
        elif ch == "?":
            out.append(".")
        else:
            out.append(re.escape(ch))
    return "^" + "".join(out) + "$"


# --------------------------------------------------------------------------
# discovery
# --------------------------------------------------------------------------
@dataclass
class ModelFiles:
    id: str
    dir: str
    pdb: str
    scores: str
    image: str
    accession: str = ""
    host: str = ""
    seq_len_csv: int = 0
    domains: list = field(default_factory=list)
    meta: dict = field(default_factory=dict)
    msa_name: str = ""


DIR_RE = re.compile(r"^(?P<acc>.+?)-(?P<host>[A-Za-z][A-Za-z0-9_]*)-(?P<len>\d+)$")


def discover(source: str) -> tuple[list[ModelFiles], list[str]]:
    found: list[ModelFiles] = []
    problems: list[str] = []
    for name in sorted(os.listdir(source)):
        d = os.path.join(source, name)
        if not os.path.isdir(d) or name.startswith("."):
            continue
        pred = os.path.join(d, "predictions")
        if not os.path.isdir(pred):
            problems.append(f"{name}: no predictions/ directory")
            continue
        pdbs = [p for p in sorted(glob.glob(os.path.join(pred, "*unrelaxed_rank_*model_*seed_*.pdb*")))
                if not p.endswith(".tmp")]
        jsons = [p for p in sorted(glob.glob(os.path.join(pred, "*scores_rank_*model_*seed_*.json*")))
                 if not p.endswith(".tmp")]
        best = [p for p in pdbs if "rank_001" in os.path.basename(p)] or pdbs
        bestj = [p for p in jsons if "rank_001" in os.path.basename(p)] or jsons
        if not best:
            problems.append(f"{name}: no unrelaxed PDB found")
            continue
        if not bestj:
            problems.append(f"{name}: no scores JSON found")
            continue
        if len(bestj) > 1:
            problems.append(f"{name}: {len(bestj)} score files, using {os.path.basename(bestj[0])}")
        imgs = sorted(glob.glob(os.path.join(d, "*ccentuated*PAE*.png"))) or sorted(
            glob.glob(os.path.join(d, "*.png"))
        )
        m = DIR_RE.match(name)
        found.append(
            ModelFiles(
                id=name,
                dir=d,
                pdb=best[0],
                scores=bestj[0],
                image=imgs[0] if imgs else "",
                accession=m.group("acc") if m else name.split("-")[0],
                host=(m.group("host") if m else ""),
                seq_len_csv=int(m.group("len")) if m else 0,
            )
        )
    return found, problems


def parse_domain_csv(source: str, explicit: str | None):
    """-> ({accession: [domain,...]}, csv_path, {accession: metadata})"""
    path = explicit
    if not path:
        cands = sorted(glob.glob(os.path.join(source, "*.csv")))
        ann = [c for c in cands if re.search(r"reviewed|dataset|domain", os.path.basename(c), re.I)]
        pool = ann or cands
        # the curated CSV is re-uploaded under a new name ("..._renumbered"); name order
        # cannot tell which is current ("_111724" sorts before "_renumbered"), so the most
        # recently written file wins. Pass --csv to be explicit.
        path = max(pool, key=os.path.getmtime) if pool else ""
    if not path or not os.path.exists(path):
        return {}, "", {}
    with open(path, newline="", encoding="utf-8-sig") as fh:
        head = fh.readline()
        delim = ";" if ";" in head else ","
    with open(path, newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh, delimiter=delim))
    if not rows:
        return {}, path, {}
    idkey = next((k for k in rows[0] if k and k.strip().lower() in ("genbank", "uniprot", "accession", "id")), None)
    if not idkey:
        return {}, path, {}
    domains: dict[str, list[dict]] = {}
    meta: dict[str, dict] = {}
    for r in rows:
        acc = (r.get(idkey) or "").strip()
        if not acc:
            continue
        doms = []
        for col, val in r.items():
            if not col or not col.startswith("border") or not val:
                continue
            name = col.split("_", 1)[1].strip() if "_" in col else col[6:].strip()
            mm = re.search(r"(\d+)\s*[-–]\s*(\d+)", str(val))
            if not mm:
                continue
            s, e = int(mm.group(1)), int(mm.group(2))
            if e < s:
                s, e = e, s
            doms.append({"name": name, "start": s, "end": e, "color": DOMAIN_COLORS.get(name, "#8b93a7")})
        doms.sort(key=lambda d: d["start"])
        domains[acc] = doms
        meta[acc] = {
            k: (v.strip() if isinstance(v, str) else v)
            for k, v in r.items()
            if k and not k.startswith("border") and k.strip() != "genbank"
        }
    return domains, path, meta


def scan_msa(path: str) -> dict:
    """Cheap structural scan of a Clustal .aln (names + ungapped lengths)."""
    names: dict[str, int] = {}
    blocks = 0
    cols = 0
    cur_block_cols = 0
    with open(path, "r", errors="replace") as fh:
        for line in fh:
            if line.startswith("CLUSTAL"):
                continue
            if not line.strip():
                if cur_block_cols:
                    blocks += 1
                    cols += cur_block_cols
                    cur_block_cols = 0
                continue
            mm = re.match(r"^(\S{1,30})\s+([A-Za-z*?.\-]+)\s*$", line)
            if not mm:
                continue
            name, res = mm.group(1), mm.group(2)
            cur_block_cols = max(cur_block_cols, len(res))
            names[name] = names.get(name, 0) + sum(1 for c in res if c not in "-.")
    if cur_block_cols:
        blocks += 1
        cols += cur_block_cols
    return {"names": names, "blocks": blocks, "columns": cols, "blockWidth": 60}


# --------------------------------------------------------------------------
# per-model processing
# --------------------------------------------------------------------------
@dataclass
class Cfg:
    source: str
    out: str
    lut_name: str
    lut: "np.ndarray"
    edges: "np.ndarray"
    codec: str
    img_px: int
    img_q: int
    pdb_variants: tuple
    scores_json: bool
    force: bool
    checkpoints: int


def pdb_residues(text: str) -> tuple["np.ndarray", list[str]]:
    """per-residue pLDDT (max over atoms) + one-letter sequence."""
    plddt: list[float] = []
    seq: list[str] = []
    seen: dict[tuple, int] = {}
    for line in text.split("\n"):
        if not line.startswith(("ATOM", "HETATM")):
            continue
        try:
            key = (line[21], int(line[22:26]), line[26])
            resn = line[17:20].strip()
            b = float(line[60:66])
        except (ValueError, IndexError):
            continue
        i = seen.get(key)
        if i is not None:
            if b > plddt[i]:
                plddt[i] = b
            continue
        seen[key] = len(plddt)
        plddt.append(b)
        seq.append(THREE_TO_ONE.get(resn, "X"))
    return np.asarray(plddt, dtype=np.float32), seq


def encode_image(img_path: str, px: int, quality: int) -> bytes | None:
    if not img_path or not os.path.exists(img_path):
        return None
    im = Image.open(img_path)
    im.thumbnail((px, px), Image.LANCZOS)
    im = im.convert("RGBA") if im.mode in ("RGBA", "LA", "P") else im.convert("RGB")
    buf = io.BytesIO()
    try:
        im.save(buf, "WEBP", quality=quality, method=6)
    except Exception:
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def process_model(m: ModelFiles, cfg: Cfg) -> dict:
    ids = m.id
    paths = {
        "bb": os.path.join(cfg.out, "pdb-bb", f"{ids}.pdb.gz"),
        "full": os.path.join(cfg.out, "pdb-full", f"{ids}.pdb.gz"),
        "pae": os.path.join(cfg.out, "pae", f"{ids}.{cfg.codec}"),
        "plddt": os.path.join(cfg.out, "plddt", f"{ids}.bin.gz"),
        "img": os.path.join(cfg.out, "paeimg", f"{ids}.webp"),
        "scores": os.path.join(cfg.out, "scores", f"{ids}.json.gz"),
    }

    raw_pdb = read_bytes_any(m.pdb)
    pdb_text = raw_pdb.decode("utf-8", "replace")
    plddt_pdb, seq = pdb_residues(pdb_text)
    n_res = len(seq)

    scores = json.loads(read_bytes_any(m.scores))
    pae = np.asarray(scores["pae"], dtype=np.float32)
    plddt_js = np.asarray(scores.get("plddt", []), dtype=np.float32)
    prof = plddt_js if plddt_js.size == n_res else plddt_pdb[: plddt_js.size if plddt_js.size else n_res]
    if prof.size != n_res:
        prof = plddt_pdb
    ptm = scores.get("ptm")
    max_pae = scores.get("max_pae", float(np.max(pae)) if pae.size else 0.0)

    built: list[str] = []
    if cfg.force or not os.path.exists(paths["pae"]):
        q = quantize(pae, cfg.lut, cfg.edges)
        buf = io.BytesIO()
        img = Image.fromarray(q, mode="L")
        if cfg.codec == "webp":
            img.save(buf, "WEBP", lossless=True, method=6)
        else:
            img.save(buf, "PNG", optimize=True, compress_level=9)
        write_atomic(paths["pae"], buf.getvalue())
        built.append("pae")
    if cfg.force or not os.path.exists(paths["plddt"]):
        p8 = np.clip(np.round(prof), 0, 255).astype(np.uint8)
        write_atomic(paths["plddt"], p8.tobytes(), compress=True, level=6)
        built.append("plddt")
    if "full" in cfg.pdb_variants and (cfg.force or not os.path.exists(paths["full"])):
        write_atomic(paths["full"], raw_pdb, compress=True, level=9)
        built.append("pdb-full")
    if "bb" in cfg.pdb_variants and (cfg.force or not os.path.exists(paths["bb"])):
        bb = "\n".join(
            l for l in pdb_text.split("\n") if not l.startswith("ATOM") or l[12:16].strip() in BB_ATOMS
        )
        write_atomic(paths["bb"], (bb + "\n").encode(), compress=True, level=9)
        built.append("pdb-bb")
    if cfg.scores_json and (cfg.force or not os.path.exists(paths["scores"])):
        raw_scores = read_bytes_any(m.scores)
        blob = raw_scores if raw_scores[:2] == b"\x1f\x8b" else gzip.compress(raw_scores, 9)
        write_atomic(paths["scores"], blob)
        built.append("scores")
    if cfg.img_px and (cfg.force or not os.path.exists(paths["img"])):
        blob = encode_image(m.image, cfg.img_px, cfg.img_q)
        if blob is not None:
            write_atomic(paths["img"], blob)
            built.append("paeimg")

    # integrity checkpoints: (i, j, original PAE in Å) the browser can re-check
    checkpoints = []
    if cfg.checkpoints and pae.size:
        rng = np.random.default_rng(abs(hash(ids)) % (2**32))
        for _ in range(cfg.checkpoints):
            i = int(rng.integers(0, pae.shape[0]))
            j = int(rng.integers(0, pae.shape[1]))
            checkpoints.append([i, j, round(float(pae[i, j]), 2)])
    # exact decoded value at those checkpoints (what the browser should recover)
    decoded = []
    if checkpoints:
        q = quantize(pae, cfg.lut, cfg.edges)
        decoded = [round(float(cfg.lut[int(q[i, j])]), 3) for i, j, _ in checkpoints]

    dom_stats = []
    for d in m.domains:
        s, e = max(1, d["start"]), min(n_res, d["end"])
        if e < s or pae.ndim != 2:
            continue
        dom_stats.append(
            {
                "name": d["name"], "start": s, "end": e,
                "meanPae": round(float(pae[s - 1:e, s - 1:e].mean()), 2),
                "meanPlddt": round(float(prof[s - 1:e].mean()), 1) if prof.size else None,
            }
        )

    return {
        "id": ids,
        "name": ids,
        "accession": m.accession,
        "length": int(n_res),
        "csvLength": m.seq_len_csv,
        "meanPlddt": round(float(prof.mean()), 2) if prof.size else None,
        "pctPlddtLt50": round(float((prof < 50).mean() * 100.0), 2) if prof.size else None,
        "pTM": round(float(ptm), 4) if isinstance(ptm, (int, float)) else None,
        "maxPae": round(float(max_pae), 2),
        "meanPae": round(float(pae.mean()), 2) if pae.size else None,
        "host": m.host,
        "meta": m.meta,
        "domains": m.domains,
        "domainStats": dom_stats,
        # keys requested in the spec:
        "pdbPath": ("pdb-bb/%s.pdb.gz" % ids) if "bb" in cfg.pdb_variants else ("pdb-full/%s.pdb.gz" % ids),
        "scoresPath": ("scores/%s.json.gz" % ids) if cfg.scores_json else None,
        "accentuatedPaePath": ("paeimg/%s.webp" % ids) if (cfg.img_px and m.image) else None,
        # additional plumbing:
        "pdbFullPath": ("pdb-full/%s.pdb.gz" % ids) if "full" in cfg.pdb_variants else None,
        "pdbSourcePath": os.path.relpath(m.pdb, cfg.source).replace(os.sep, "/"),
        "paePath": "pae/%s.%s" % (ids, cfg.codec),
        "paeFormat": cfg.codec,
        "paeW": int(pae.shape[1]) if pae.ndim == 2 else 0,
        "paeH": int(pae.shape[0]) if pae.ndim == 2 else 0,
        "plddtPath": "plddt/%s.bin.gz" % ids,
        "msaName": m.msa_name,
        "verify": {
            "lutName": cfg.lut_name,
            "points": checkpoints,
            "decoded": decoded,
        },
        "_built": built,
    }


def _worker(task):
    m, cfg = task
    try:
        return ("ok", m.id, process_model(m, cfg))
    except Exception as exc:  # pragma: no cover
        import traceback

        return ("err", m.id, f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}")


# --------------------------------------------------------------------------
# self-check: decode the written image back to Å and compare with the source JSON
# --------------------------------------------------------------------------
def selfcheck(models: list[ModelFiles], cfg: Cfg, n: int) -> None:
    import random

    sample = random.Random(0).sample(models, min(n, len(models)))
    print("\n  decode round-trip self-check")
    worst = 0.0
    for m in sample:
        p = os.path.join(cfg.out, "pae", f"{m.id}.{cfg.codec}")
        if not os.path.exists(p):
            print(f"    ! {m.id}: missing {p}")
            continue
        arr = np.asarray(Image.open(p), dtype=np.uint8)
        if arr.ndim == 3:
            arr = arr[:, :, 0]
        src = np.asarray(json.loads(read_bytes_any(m.scores))["pae"], dtype=np.float32)
        recon = cfg.lut[arr.astype(np.int32)]
        h = min(recon.shape[0], src.shape[0])
        w = min(recon.shape[1], src.shape[1])
        err = float(np.abs(recon[:h, :w] - src[:h, :w]).max())
        worst = max(worst, err)
        print(f"    {m.id[:28]:28s} {src.shape[0]}x{src.shape[1]}  max|Δ| = {err:.3f} Å  "
              f"file {human(os.path.getsize(p))}")
    print(f"    worst error {worst:.3f} Å (expected ≤ {LUT_MAX_ERR.get(cfg.lut_name, '?')} Å)")


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="Build the static web payload (public/data) for orf1viewer.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    ap.add_argument("--source", default="models_ORF1_files", help="directory holding <MODEL>/predictions/...")
    ap.add_argument("--out", default="public/data", help="output directory")
    ap.add_argument("--csv", default=None, help="domain/metadata CSV (default: auto-detect *.csv in --source)")
    ap.add_argument("--msa", default=None, help="Clustal .aln (default: auto-detect *.aln in --source)")
    ap.add_argument("--preset", choices=list(PRESETS), default=DEFAULT_PRESET, help="fidelity/size preset")
    ap.add_argument("--lut", choices=list(PAE_LUTS), default=None, help="override the preset PAE quantisation lut")
    ap.add_argument("--codec", choices=["png", "webp"], default=None, help="override the preset PAE codec")
    ap.add_argument("--img-px", type=int, default=None, help="max edge of accentuated-PAE preview (0 = skip)")
    ap.add_argument("--img-q", type=int, default=None, help="webp quality of the accentuated-PAE preview")
    ap.add_argument("--pdb", default=None, help="pdb variants: 'bb', 'full' or 'bb,full'")
    ap.add_argument("--scores-json", action="store_true", help="also emit the original scores JSON gzip")
    ap.add_argument("--base-url", default="", help="write public/data/base-url.txt (remote data host)")
    ap.add_argument("--limit", type=int, default=0, help="process only the first N models (0 = all)")
    ap.add_argument("--only", default=None, help="comma-separated glob of model ids to build")
    ap.add_argument("--workers", type=int, default=min(24, os.cpu_count() or 4), help="parallel workers")
    ap.add_argument("--force", action="store_true", help="rebuild artifacts even if present")
    ap.add_argument("--checkpoints", type=int, default=24,
                    help="store N random (i,j,Å) checkpoints per model so the app can validate decoding")
    ap.add_argument("--selfcheck", type=int, default=0, help="decode N built models and report the max error vs JSON")
    ap.add_argument("--no-plain-manifest", action="store_true", help="skip the uncompressed manifest.json copy")
    ap.add_argument("--budget", default=None,
                    help="fit the payload in this size (e.g. 900MB, 1GB) by degrading, in order: "
                         "codec->webp (still lossless), smaller previews, drop full-atom PDB, coarser PAE lut")
    ap.add_argument("--dry-run", action="store_true", help="discover + estimate only")
    args = ap.parse_args(argv)

    if not os.path.isdir(args.source):
        sys.exit(f"source directory not found: {args.source}")

    preset = PRESETS[args.preset]
    lut_name = args.lut or preset["lut"]
    codec = args.codec or preset["codec"]
    img_px = args.img_px if args.img_px is not None else preset["img_px"]
    img_q = args.img_q if args.img_q is not None else preset["img_q"]
    if args.pdb:
        pdb_variants = tuple(x.strip() for x in args.pdb.split(",") if x.strip())
        bad = [v for v in pdb_variants if v not in ("bb", "full")]
        if bad:
            sys.exit(f"--pdb: unknown variant(s) {bad}; use bb/full")
    else:
        pdb_variants = tuple(preset["pdb"])
    scores_json = args.scores_json or preset["scores_json"]

    webp_ok = True
    try:
        Image.new("L", (4, 4)).save(io.BytesIO(), "WEBP", lossless=True)
    except Exception:
        webp_ok = False
        if codec == "webp":
            print("! this Pillow build has no lossless WebP -> using PNG", file=sys.stderr)
            codec = "png"

    lut = build_lut(PAE_LUTS[lut_name])
    edges = lut_edges(lut)

    print(f"· source       : {args.source}")
    print(f"· out          : {args.out}")
    print(f"· preset       : {args.preset}  lut={lut_name} (≤{LUT_MAX_ERR.get(lut_name)} Å) codec={codec} "
          f"pdb={'+'.join(pdb_variants)} scores_json={scores_json} img={img_px}px/q{img_q}")
    print(f"· PAE lut      : {lut.size} levels, {float(lut[0]):.2f} → {float(lut[-1]):.2f} Å")

    models, problems = discover(args.source)
    dom_by_acc, csv_path, meta_by_acc = parse_domain_csv(args.source, args.csv)
    print(f"· csv mapping  : {csv_path or 'NOT FOUND'} — {len(dom_by_acc)} accessions, "
          f"{sum(len(v) for v in dom_by_acc.values())} domain ranges")

    msa_path = args.msa
    if not msa_path:
        alns = sorted(glob.glob(os.path.join(args.source, "*.aln")))
        msa_path = next((a for a in alns if "MSA" in os.path.basename(a).upper()), (alns[0] if alns else ""))
    msa_info = scan_msa(msa_path) if msa_path and os.path.exists(msa_path) else {"names": {}, "blocks": 0, "columns": 0}
    print(f"· msa          : {msa_path or 'NOT FOUND'} — {len(msa_info['names'])} sequences, "
          f"{msa_info['columns']} columns, {msa_info['blocks']} blocks")

    # MAFFT truncates Clustal names to 10 chars -> resolve collisions by length
    by_prefix: dict[str, list[str]] = {}
    for m in models:
        by_prefix.setdefault(m.id[:10], []).append(m.id)
    for m in models:
        pref = m.id[:10]
        if pref in msa_info["names"] and len(by_prefix[pref]) == 1:
            m.msa_name = pref
        else:
            cands = [n for n in msa_info["names"] if m.id.startswith(n)]
            exact = [n for n in cands if msa_info["names"][n] in (m.seq_len_csv, m.seq_len_csv + 1)]
            m.msa_name = (exact or cands or [pref])[0]

    for m in models:
        m.domains = dom_by_acc.get(m.accession, [])
        m.meta = meta_by_acc.get(m.accession, {})

    if args.only:
        pats = [re.compile(fnmatch_to_re(p.strip())) for p in args.only.split(",")]
        models = [m for m in models if any(p.match(m.id) for p in pats)]
    if args.limit:
        models = models[: args.limit]

    n_dom = sum(1 for m in models if m.domains)
    print(f"· models       : {len(models)} to build ({n_dom} with domains) — {len(problems)} problem folder(s)")
    for p in problems[:8]:
        print(f"    ! {p}")
    if len(problems) > 8:
        print(f"    ! ... {len(problems) - 8} more")

    def estimate(lut_n: str, codec_n: str, pdb_v: tuple, px: int, sc_json: bool) -> float:
        return (
            MEASURED_KB_PER_MODEL[(lut_n, codec_n)] * 1e3 * len(models)
            + (119e3 * ("bb" in pdb_v) + 215e3 * ("full" in pdb_v)) * len(models)
            + (45e3 * (px / 1100.0) ** 2 if px else 0) * len(models)
            + (4.8e6 if sc_json else 0) * len(models)
        )

    budget = parse_size(args.budget) if args.budget else None
    if budget:
        # degradation ladder — cheapest loss of *convenience* first, PAE fidelity last
        ladder = [
            (lut_name, "webp", pdb_variants, img_px, scores_json, "codec -> lossless webp (-13%, no data loss)"),
            (lut_name, "webp", pdb_variants, min(img_px, 900), scores_json, "previews -> 900 px"),
            (lut_name, "webp", tuple(v for v in pdb_variants if v != "full"), min(img_px, 900), scores_json,
             "drop full-atom PDB (download serves backbone; keep it in the archive preset)"),
            ("balanced" if lut_name in ("hifi", "maxi") else lut_name, "webp",
             tuple(v for v in pdb_variants if v != "full"), min(img_px, 900), scores_json,
             "PAE lut -> balanced (0.5 Å ≤ 8 Å, ≤1.5 Å max)"),
            ("lean", "webp", tuple(v for v in pdb_variants if v != "full"), min(img_px, 800), scores_json,
             "PAE lut -> lean (1 Å ≤ 12 Å, 2 Å max)"),
            ("lean", "webp", ("bb",), 0, False, "drop previews + scores json"),
        ]
        if scores_json:
            ladder.insert(0, (lut_name, codec, pdb_variants, img_px, False, "drop the original scores JSON"))
        chosen = None
        for cand in ladder:
            if estimate(cand[0], cand[1], cand[2], cand[3], cand[4]) <= budget:
                chosen = cand
                break
        if chosen:
            lut_name, codec, pdb_variants, img_px, scores_json, why = chosen
            lut = build_lut(PAE_LUTS[lut_name])
            edges = lut_edges(lut)
            print(f"· budget       : {human(budget)} → applied: {why}")
            print(f"                 now lut={lut_name} codec={codec} pdb={'+'.join(pdb_variants) or 'none'} "
                  f"img={img_px}px scores_json={scores_json}")
        else:
            print(f"· budget       : {human(budget)} cannot be met even at the lowest tier — building as configured",
                  file=sys.stderr)

    est_pae = MEASURED_KB_PER_MODEL[(lut_name, codec)] * 1e3 * len(models)
    est_pdb = (119e3 * ("bb" in pdb_variants) + 215e3 * ("full" in pdb_variants)) * len(models)
    est_img = (45e3 * (img_px / 1100.0) ** 2 if img_px else 0) * len(models)
    est_scores = (4.8e6 if scores_json else 0) * len(models)
    est = est_pae + est_pdb + est_img + est_scores
    print(f"· estimate     : PAE {human(est_pae)} + PDB {human(est_pdb)} + imgs {human(est_img)}"
          + (f" + scores {human(est_scores)}" if scores_json else "") + f"  ≈ {human(est)}")
    if args.dry_run:
        return 0

    os.makedirs(args.out, exist_ok=True)
    cfg = Cfg(
        source=args.source, out=args.out, lut_name=lut_name, lut=lut, edges=edges, codec=codec,
        img_px=img_px, img_q=img_q, pdb_variants=pdb_variants, scores_json=scores_json,
        force=args.force, checkpoints=args.checkpoints,
    )

    entries: dict[str, dict] = {}
    errors: list[tuple[str, str]] = []
    t0 = time.time()
    done = 0
    if args.workers > 1:
        with ProcessPoolExecutor(max_workers=args.workers) as pool:
            futs = [pool.submit(_worker, (m, cfg)) for m in models]
            iters = (f.result() for f in as_completed(futs))
    else:
        iters = (_worker((m, cfg)) for m in models)
    for status, mid, payload in iters:
        if status == "ok":
            entries[mid] = payload
        else:
            errors.append((mid, payload))
            print(f"  ✗ {mid}: {payload.splitlines()[0]}", file=sys.stderr)
        done += 1
        if done % 100 == 0 or done == len(models):
            dt = time.time() - t0
            rate = done / dt if dt else 0
            eta = (len(models) - done) / rate if rate else 0
            print(f"  {done}/{len(models)}  {rate:.1f} model/s  eta {eta/60:.1f} min", flush=True)

    if errors:
        write_atomic(os.path.join(args.out, "errors.txt"),
                     "".join(f"=== {m}\n{v}\n" for m, v in errors).encode())
        print(f"! {len(errors)} model(s) failed — see {args.out}/errors.txt", file=sys.stderr)

    order = sorted(entries.values(), key=lambda e: e["id"])
    for e in order:
        e.pop("_built", None)
    manifest = {
        "schema": SCHEMA_VERSION,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": os.path.basename(os.path.abspath(args.source)),
        "counts": {"models": len(order), "failed": len(errors)},
        "pae": {
            "format": codec,
            "lutName": lut_name,
            "lut": [round(float(v), 4) for v in lut],
            "maxErrorA": LUT_MAX_ERR.get(lut_name),
            "unit": "Angstrom",
            "note": "pixel value = lut index; lossless 8-bit single-channel image",
        },
        "domains": [{"name": k, "color": v} for k, v in DOMAIN_COLORS.items()],
        "hosts": sorted({(e.get("host") or "") for e in order if e.get("host")}),
        "msa": {"path": "msa.aln.gz" if msa_info["names"] else None,
                "sequences": len(msa_info["names"]), "columns": msa_info["columns"]},
        "models": order,
    }
    blob = json.dumps(manifest, separators=(",", ":")).encode()
    write_atomic(os.path.join(args.out, "manifest.json.gz"), blob, compress=True, level=9)
    if not args.no_plain_manifest:
        write_atomic(os.path.join(args.out, "manifest.json"), blob)
    print(f"· manifest     : {human(len(blob))} raw → {human(os.path.getsize(os.path.join(args.out, 'manifest.json.gz')))} gz")

    if msa_path and os.path.exists(msa_path) and msa_info["names"]:
        raw = open(msa_path, "rb").read()
        write_atomic(os.path.join(args.out, "msa.aln.gz"), raw, compress=True, level=9)
        print(f"· msa payload  : {human(len(raw))} → "
              f"{human(os.path.getsize(os.path.join(args.out, 'msa.aln.gz')))} gz")

    if args.base_url:
        write_atomic(os.path.join(args.out, "base-url.txt"), args.base_url.strip().encode())
        print(f"· base url     : {args.base_url}")

    sizes = {}
    for sub in ("pdb-bb", "pdb-full", "pae", "plddt", "paeimg", "scores"):
        d = os.path.join(args.out, sub)
        if os.path.isdir(d):
            sizes[sub] = sum(os.path.getsize(os.path.join(d, f)) for f in os.listdir(d))
    total = sum(sizes.values()) + sum(
        os.path.getsize(os.path.join(args.out, f))
        for f in os.listdir(args.out) if os.path.isfile(os.path.join(args.out, f))
    )
    print("\n  artifact sizes")
    for k, v in sorted(sizes.items()):
        print(f"    {k:9s} {human(v):>12s}   ({v / max(1, len(order)) / 1e3:.0f} KB/model)")
    print(f"    {'TOTAL':9s} {human(total):>12s}")
    if total > 1e9:
        print("  ⚠ GitHub Pages soft-limits a site to ~1 GB (100 MB per file).\n"
              "    For Pages use --preset lean|pages, or host the payload elsewhere\n"
              "    (Zenodo / Hugging Face / S3) and pass --base-url.", file=sys.stderr)
    print(f"  done in {(time.time() - t0)/60:.1f} min → {os.path.join(args.out, 'manifest.json.gz')}")

    if args.selfcheck:
        selfcheck(models, cfg, args.selfcheck)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
