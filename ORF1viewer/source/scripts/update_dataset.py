#!/usr/bin/env python3
"""
update_dataset.py — the one command that keeps the ORF1 viewer's Hugging Face dataset current.

    python3 scripts/update_dataset.py /path/to/configuration_update_dataset.json

Everything it needs is in that JSON:

    modelfolder       AlphaFold2 runs: <ID>/predictions/… , <ID>/accentuated_PAE.png
    outputfolder      staging directory == the HF repo layout (created if missing)
    dataset           curated annotation CSV → metadata/<outputDatasetName>
    msa               alignment, Clustal .aln or gapped FASTA (sniffed) → <OutputMSAName>.gz
    clusterFile       → metadata/<outputClusterFile>
    tree              → metadata/<outputTreeName>
    PAEresolution     lean | balanced | hifi | maxi     (PAE quantisation table)
    codec             png | webp                        (PAE image codec — lossless either way)
    hfRepo            optional, default ttubiana/HEV-ORF1-models

What lands in the repo (today's layout, minus pdb-bb/):

    manifest.json + manifest.json.gz   model index, PAE look-up table, integrity checkpoints
    pdb-full/<ID>.pdb.gz               full-atom model — what the viewer loads
    pae/<ID>.<codec>                   PAE matrix, 8-bit, pixel = index into the manifest LUT
    plddt/<ID>.bin.gz                  one byte of pLDDT per residue
    paeimg/<ID>.webp                   the accentuated-PAE figure, resized
    <OutputMSAName>.gz                 the alignment
    metadata/                          annotation CSV, cluster table, reference tree, sequence
                                       library, SHA256SUMS.txt (the upload ledger), this script,
                                       provenance.json
    provenance.json                    same provenance at the root

Only rank_001 is ever read: `<ID>_unrelaxed_rank_001_*.pdb` and `<ID>_scores_rank_001_*.json`.

Incremental by construction
---------------------------
A model is rebuilt only if one of its artifacts is missing, older than the model's own source
files, or built with a different PAE table/codec.

**Nothing is pushed.** A run stages everything in `outputfolder` and ends by printing the
`hf upload` command for you to look at the folder and run yourself — the Hub client skips
files whose bytes are already there, so pushing the whole folder is already a delta.
`--upload` is there if you would rather have this script do the pushing (it records what it
sent in metadata/SHA256SUMS.txt, and only that run updates the ledger).

    update_dataset.py cfg.json                  refresh whatever changed, keep it local
    update_dataset.py cfg.json --skip-models    CSV / MSA / tree only, never open a model folder
    update_dataset.py cfg.json --only 'AAA*'    a subset (other manifest entries are kept)
    update_dataset.py cfg.json --force          rebuild everything
    update_dataset.py cfg.json --upload         push it yourself instead of printing the command
    update_dataset.py cfg.json --prune          delete the hub files that nothing references
    update_dataset.py cfg.json --selfcheck 8    decode PAE images back to Å and compare with JSON

Renamed or removed models
-------------------------
Renaming a model leaves its old artifacts on the hub: the manifest no longer mentions them, the
viewer still can, and the model count lies. Every run therefore lists the hub files that no
manifest entry uses; `--prune` deletes them. `.gitattributes` and `README.md` are never touched.

Deploy order matters: the app (GitHub Pages) and the data (Hugging Face) are two deploys.
Dropping pdb-bb/ or changing the alignment format is only safe once the app that is *live*
loads `pdbPath` (= pdb-full now) and can parse the alignment format being published.

Requires numpy + Pillow; publishing needs huggingface_hub with a token (`hf auth login`).
"""
from __future__ import annotations

import argparse
import csv
import glob
import gzip
import hashlib
import io
import json
import os
import re
import sys
import time
import urllib.request
from collections import OrderedDict
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass, field

try:
    import numpy as np
except ImportError:
    sys.exit("numpy is required:  pip install numpy")
try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required:  pip install pillow")

SCHEMA_VERSION = 1
DEFAULT_REPO = "ttubiana/HEV-ORF1-models"
VIEWER_URL = "https://tubiana.github.io/ORF1viewer"

# Domain colours (PyMOL tv_* palette), ordered by position along the chain. Pre-seeded on
# purpose: adding `border_HVR-barrel` / `border_HVR-2` columns to the CSV is enough to get a
# stable colour here and in the viewer. Anything unknown gets DOMAIN_FALLBACK.
DOMAIN_COLORS: "OrderedDict[str, str]" = OrderedDict(
    [
        ("MetY", "#2f6fdb"),         # tv_blue
        ("FABD-like", "#e8c33d"),    # tv_yellow
        ("HVR", "#c04ec2"),          # magenta
        ("HVR-barrel", "#7c5cd6"),   # violet — reserved, not in the CSV yet
        ("HVR-2", "#e05780"),        # pink   — reserved, not in the CSV yet
        ("domX", "#d8452f"),         # tv_red
        ("Hel", "#ec8a2a"),          # tv_orange
        ("RdRp", "#2f9e5f"),         # tv_green
    ]
)
DOMAIN_FALLBACK = "#8b93a7"   # a domain this palette does not know is still shown, in grey

# PAE quantisation tables as (low, high, step Å); 8-bit pixels, so ≤ 255 levels.
PAE_LUTS = {
    "lean": [(0.0, 12.0, 1.0), (12.0, 20.0, 2.0), (20.0, 33.0, 4.0)],
    "balanced": [(0.0, 8.0, 0.5), (8.0, 16.0, 1.0), (16.0, 33.0, 2.0)],
    "hifi": [(0.0, 33.0, 0.5)],
    "maxi": [(0.0, 33.0, 0.25)],
}
# the worst error a table can make is half its coarsest step
LUT_MAX_ERR = {"lean": 2.0, "balanced": 1.5, "hifi": 0.25, "maxi": 0.125}

PREVIEW_PX = 1100       # accentuated-PAE figure: longest edge
PREVIEW_Q = 72          # …and its WebP quality
CHECKPOINTS = 24        # random (i, j, Å) samples so the browser can verify its own decoding
FASTA_LIBRARY = "metadata/ORF1s_1178.fasta"   # headers are model ids (sequence search)
KEEP_ON_HF = {".gitattributes", "README.md", "LICENSE"}   # never orphaned, never pruned
LEDGER = "metadata/SHA256SUMS.txt"
SKIP_UPLOAD = {"errors.txt"}
THREE_TO_ONE = {
    "ALA": "A", "ARG": "R", "ASN": "N", "ASP": "D", "CYS": "C", "GLN": "Q", "GLU": "E",
    "GLY": "G", "HIS": "H", "ILE": "I", "LEU": "L", "LYS": "K", "MET": "M", "PHE": "F",
    "PRO": "P", "SER": "S", "THR": "T", "TRP": "W", "TYR": "Y", "VAL": "V", "MSE": "M",
}
DIR_RE = re.compile(r"^(?P<acc>.+?)-(?P<host>[A-Za-z][A-Za-z0-9_]*)-(?P<len>\d+)$")


# ------------------------------------------------------------------ small helpers
def human(n: float) -> str:
    for unit, div in (("GB", 1e9), ("MB", 1e6), ("KB", 1e3)):
        if abs(n) >= div:
            return f"{n / div:.2f} {unit}"
    return f"{n:.0f} B"


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_atomic(path: str, data: bytes, compress: bool = False) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    if compress:
        with gzip.open(tmp, "wb", compresslevel=9) as fh:
            fh.write(data)
    else:
        with open(tmp, "wb") as fh:
            fh.write(data)
    os.replace(tmp, path)


def read_bytes_any(path: str) -> bytes:
    with (gzip.open if path.endswith(".gz") else open)(path, "rb") as fh:
        return fh.read()


def pdb_residues(text: str) -> tuple["np.ndarray", list[str]]:
    """pLDDT per residue (max over its atoms) and the one-letter sequence."""
    plddt: list[float] = []
    seq: list[str] = []
    seen: dict[tuple, int] = {}
    for line in text.split("\n"):
        if not line.startswith(("ATOM", "HETATM")):
            continue
        try:
            key = (line[21], int(line[22:26]), line[26])
            resn, b = line[17:20].strip(), float(line[60:66])
        except (ValueError, IndexError):
            continue
        i = seen.get(key)
        if i is not None:
            plddt[i] = max(plddt[i], b)
            continue
        seen[key] = len(plddt)
        plddt.append(b)
        seq.append(THREE_TO_ONE.get(resn, "X"))
    return np.asarray(plddt, dtype=np.float32), seq


def build_lut(spec) -> "np.ndarray":
    bins: list[float] = []
    for lo, hi, step in spec:
        x = lo
        while x < hi - 1e-9:
            bins.append(round(x + step / 2.0, 4))
            x += step
    arr = np.asarray(bins, dtype=np.float32)
    if arr.size > 255:
        sys.exit(f"PAE table too fine: {arr.size} levels > 255")
    return arr


def quantize(values: "np.ndarray", lut: "np.ndarray", edges: "np.ndarray") -> "np.ndarray":
    idx = np.searchsorted(edges, values.reshape(-1))
    np.clip(idx, 0, len(lut) - 1, out=idx)
    return idx.astype(np.uint8).reshape(values.shape)


def encode_matrix(q: "np.ndarray", codec: str) -> bytes:
    buf = io.BytesIO()
    img = Image.fromarray(q, mode="L")
    if codec == "webp":
        img.save(buf, "WEBP", lossless=True, method=6)
    else:
        img.save(buf, "PNG", optimize=True, compress_level=9)
    return buf.getvalue()


def encode_preview(path: str) -> bytes | None:
    if not path or not os.path.exists(path):
        return None
    im = Image.open(path)
    im.thumbnail((PREVIEW_PX, PREVIEW_PX), Image.LANCZOS)
    im = im.convert("RGBA") if im.mode in ("RGBA", "LA", "P") else im.convert("RGB")
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=PREVIEW_Q, method=6)
    return buf.getvalue()


class Bar:
    """One-line progress bar on stderr; silent when stderr is not a terminal."""

    def __init__(self, total: int):
        self.total, self.done, self.t0 = total, 0, time.time()
        self.on = sys.stderr.isatty() and total > 0

    def tick(self) -> None:
        self.done += 1
        if not self.on:
            return
        rate = self.done / max(1e-6, time.time() - self.t0)
        eta = (self.total - self.done) / rate if rate else 0.0
        fill = int(28 * self.done / self.total)
        sys.stderr.write(f"\r  {'█' * fill}{'░' * (28 - fill)} {self.done}/{self.total}"
                         f"  {rate:.1f} model/s  eta {eta / 60:.1f} min")
        sys.stderr.flush()
        if self.done >= self.total:
            sys.stderr.write("\n")


# ------------------------------------------------------------------ inputs
@dataclass
class Model:
    id: str
    dir: str
    pdb: str
    scores: str
    image: str = ""
    accession: str = ""
    host: str = ""
    seq_len_csv: int = 0
    domains: list = field(default_factory=list)
    meta: dict = field(default_factory=dict)


@dataclass
class Cfg:
    source: str            # the modelfolder, for the informational pdbSourcePath
    out: str
    lut_name: str
    lut: "np.ndarray"
    edges: "np.ndarray"
    codec: str
    checkpoints: int
    msa_names: tuple = ()  # row names present in the alignment
    force: bool = False


def load_config(path: str) -> dict:
    cfg = json.load(open(path, encoding="utf-8"))
    missing = [k for k in ("modelfolder", "outputfolder", "dataset") if not cfg.get(k)]
    if missing:
        sys.exit(f"{path}: missing key(s): {', '.join(missing)}")
    for k, d in (("hfRepo", DEFAULT_REPO), ("PAEresolution", "balanced"), ("codec", "webp")):
        cfg.setdefault(k, d)
    if cfg["PAEresolution"] not in PAE_LUTS:
        sys.exit(f"PAEresolution must be one of {sorted(PAE_LUTS)}")
    if cfg["codec"] not in ("png", "webp"):
        sys.exit("codec must be png or webp")
    for k in ("modelfolder",):
        if not os.path.isdir(cfg[k]):
            sys.exit(f"{k} is not a directory: {cfg[k]}")
    try:
        Image.new("L", (4, 4)).save(io.BytesIO(), "WEBP", lossless=True)
    except Exception:
        if cfg["codec"] == "webp":
            print("! this Pillow build cannot write lossless WebP — using PNG instead", file=sys.stderr)
            cfg["codec"] = "png"
    return cfg


def discover(root: str) -> tuple[list[Model], list[str]]:
    """One entry per model folder, pinned to rank_001 (the other ranks stay on the disk)."""
    found: list[Model] = []
    problems: list[str] = []
    for name in sorted(os.listdir(root)):
        d = os.path.join(root, name)
        if not os.path.isdir(d) or name.startswith("."):
            continue
        pred = os.path.join(d, "predictions")
        if not os.path.isdir(pred):
            problems.append(f"{name}: no predictions/ directory")
            continue
        pdbs = sorted(p for p in glob.glob(os.path.join(pred, "*unrelaxed_rank_001*seed_*.pdb*")) if not p.endswith(".tmp"))
        js = sorted(p for p in glob.glob(os.path.join(pred, "*scores_rank_001*seed_*.json*")) if not p.endswith(".tmp"))
        if not pdbs:
            problems.append(f"{name}: no rank_001 PDB")
            continue
        if not js:
            problems.append(f"{name}: no rank_001 scores JSON")
            continue
        imgs = glob.glob(os.path.join(d, "*ccentuated*PAE*.png"))
        m = DIR_RE.match(name)
        found.append(Model(
            id=name, dir=d, pdb=pdbs[0], scores=js[0], image=imgs[0] if imgs else "",
            accession=m.group("acc") if m else name.split("-")[0],
            host=m.group("host") if m else "",
            seq_len_csv=int(m.group("len")) if m else 0,
        ))
    return found, problems


def read_annotations(path: str | None) -> tuple[dict, dict]:
    """Curated CSV → ({accession: [domains]}, {accession: metadata}).

    Delimiter is sniffed from the header (";" today, "," if an export changes), quoted fields are
    honoured ("chicken; layer"), CRLF and a UTF-8 BOM are fine, `border_<Domain>` may be written
    "(1-467)" or "1-467", and every other column becomes metadata — which is why the new
    `annotation` column (Manual / Sequence / Structural) needs no change here.
    """
    if not path or not os.path.exists(path):
        print(f"! annotation CSV not found: {path}", file=sys.stderr)
        return {}, {}
    with open(path, newline="", encoding="utf-8-sig") as fh:
        delim = ";" if ";" in fh.readline() else ","
    with open(path, newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh, delimiter=delim))
    idkey = next((k for k in rows[0] if k and k.strip().lower() in ("genbank", "uniprot", "accession", "id")),
                 None) if rows else None
    if not idkey:
        print(f"! {os.path.basename(path)}: no accession column — annotations ignored", file=sys.stderr)
        return {}, {}
    domains: dict[str, list] = {}
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
            s, e = sorted((int(mm.group(1)), int(mm.group(2))))
            doms.append({"name": name, "start": s, "end": e,
                         "color": DOMAIN_COLORS.get(name, DOMAIN_FALLBACK)})
        domains[acc] = sorted(doms, key=lambda d: d["start"])
        meta[acc] = {k: (v.strip() if isinstance(v, str) else v)
                     for k, v in r.items() if k and not k.startswith("border") and k.strip() != idkey}
    return domains, meta


def scan_msa(path: str | None) -> dict:
    """{format, names: row name → ungapped length, columns} for Clustal .aln or gapped FASTA."""
    info = {"format": "clustal", "names": {}, "columns": 0}
    if not path or not os.path.exists(path):
        return info
    with open(path, encoding="utf-8", errors="replace") as fh:
        info["format"] = "fasta" if fh.readline().startswith(">") else "clustal"
    names: dict[str, int] = {}
    with open(path, encoding="utf-8", errors="replace") as fh:
        if info["format"] == "fasta":
            # rows may be wrapped at 60/70 chars: a record's raw length is the column count,
            # its ungapped residue count is what the viewer lists as the sequence length
            row, raw = None, 0
            for line in fh:
                if line.startswith(">"):
                    info["columns"] = max(info["columns"], raw)
                    row = line[1:].split()[0]
                    names.setdefault(row, 0)
                    raw = 0
                    continue
                if row is None:
                    continue
                raw += len(line.rstrip("\n\r"))
                names[row] += sum(1 for c in line if c not in "-.*\n\r")
            info["columns"] = max(info["columns"], raw)
        else:
            # Clustal writes the matrix in blocks of ~60 columns: sum the block widths
            block_cols = 0
            for line in fh:
                if not line.strip() or line.startswith("CLUSTAL"):
                    info["columns"] += block_cols
                    block_cols = 0
                    continue
                mm = re.match(r"^(\S{1,60})\s+([A-Za-z*?.\-]+)\s*$", line)
                if not mm:
                    continue
                name, res = mm.group(1), mm.group(2).rstrip()
                names[name] = names.get(name, 0) + sum(1 for c in res if c not in "-.")
                block_cols = max(block_cols, len(res))
            info["columns"] += block_cols
    info["names"] = names
    return info


def msa_row_name(mid: str, names: set[str]) -> str:
    """The alignment's own row name for a model: the full id (FASTA) or its 10-char Clustal prefix."""
    if not names:
        return mid
    if mid in names:
        return mid
    for cand in (mid[:10], mid[:9]):
        if cand in names:
            return cand
    hits = [n for n in names if mid.startswith(n)]
    return hits[0] if len(hits) == 1 else mid


# ------------------------------------------------------------------ one model
def artifact_paths(cfg: Cfg, mid: str) -> dict:
    return {
        "full": os.path.join(cfg.out, "pdb-full", f"{mid}.pdb.gz"),
        "pae": os.path.join(cfg.out, "pae", f"{mid}.{cfg.codec}"),
        "plddt": os.path.join(cfg.out, "plddt", f"{mid}.bin.gz"),
        "img": os.path.join(cfg.out, "paeimg", f"{mid}.webp"),
    }


def is_fresh(m: Model, cfg: Cfg, prev: dict | None) -> bool:
    """Nothing to do when every artifact exists, is newer than every source file, and was built
    with the settings now in force."""
    if cfg.force or not prev:
        return False
    if prev.get("paeFormat") != cfg.codec or prev.get("verify", {}).get("lutName") != cfg.lut_name:
        return False
    srcs = [m.pdb, m.scores] + ([m.image] if m.image else [])
    try:
        newest = max(os.path.getmtime(p) for p in srcs)
    except OSError:
        return False
    for p in artifact_paths(cfg, m.id).values():
        if not os.path.exists(p) or os.path.getmtime(p) < newest:
            return False
    return True


def process_model(m: Model, cfg: Cfg) -> dict:
    p = artifact_paths(cfg, m.id)
    raw_pdb = read_bytes_any(m.pdb)
    plddt_pdb, seq = pdb_residues(raw_pdb.decode("utf-8", "replace"))
    n_res = len(seq)
    scores = json.loads(read_bytes_any(m.scores))
    pae = np.asarray(scores["pae"], dtype=np.float32)
    prof = np.asarray(scores.get("plddt", []), dtype=np.float32)
    if prof.size != n_res:
        prof = plddt_pdb
    q = quantize(pae, cfg.lut, (cfg.lut[:-1] + cfg.lut[1:]) / 2.0)

    write_atomic(p["full"], raw_pdb, compress=True)
    write_atomic(p["pae"], encode_matrix(q, cfg.codec))
    write_atomic(p["plddt"], np.clip(np.round(prof), 0, 255).astype(np.uint8).tobytes(), compress=True)
    preview = encode_preview(m.image)
    if preview is not None:
        write_atomic(p["img"], preview)

    rng = np.random.default_rng(abs(hash(m.id)) % (2**32))
    points = []
    for _ in range(cfg.checkpoints):
        if not pae.size:
            break
        i, j = int(rng.integers(0, pae.shape[0])), int(rng.integers(0, pae.shape[1]))
        points.append([i, j, round(float(pae[i, j]), 2)])
    decoded = [round(float(cfg.lut[int(q[i, j])]), 3) for i, j, _ in points]

    stats = []
    for d in m.domains:
        s, e = max(1, d["start"]), min(n_res, d["end"])
        if e < s or pae.ndim != 2:
            continue
        stats.append({
            "name": d["name"], "start": s, "end": e,
            "meanPae": round(float(pae[s - 1:e, s - 1:e].mean()), 2),
            "meanPlddt": round(float(prof[s - 1:e].mean()), 1) if prof.size else None,
        })

    return {
        "id": m.id, "name": m.id, "accession": m.accession,
        "length": n_res, "csvLength": m.seq_len_csv,
        "meanPlddt": round(float(prof.mean()), 2) if prof.size else None,
        "pctPlddtLt50": round(float((prof < 50).mean() * 100.0), 2) if prof.size else None,
        "pTM": round(float(scores["ptm"]), 4) if isinstance(scores.get("ptm"), (int, float)) else None,
        "maxPae": round(float(scores.get("max_pae", float(pae.max()) if pae.size else 0.0)), 2),
        "meanPae": round(float(pae.mean()), 2) if pae.size else None,
        "host": m.host, "meta": m.meta, "domains": m.domains, "domainStats": stats,
        # one structure per model now: pdbPath and pdbFullPath are the same full-atom file
        "pdbPath": f"pdb-full/{m.id}.pdb.gz",
        "pdbFullPath": f"pdb-full/{m.id}.pdb.gz",
        "scoresPath": None,
        "accentuatedPaePath": f"paeimg/{m.id}.webp" if preview is not None else None,
        "pdbSourcePath": os.path.relpath(m.pdb, cfg.source).replace(os.sep, "/"),
        "paePath": f"pae/{m.id}.{cfg.codec}",
        "paeFormat": cfg.codec,
        "paeW": int(pae.shape[1]) if pae.ndim == 2 else 0,
        "paeH": int(pae.shape[0]) if pae.ndim == 2 else 0,
        "plddtPath": f"plddt/{m.id}.bin.gz",
        "msaName": msa_row_name(m.id, set(cfg.msa_names)),
        "verify": {"lutName": cfg.lut_name, "points": points, "decoded": decoded},
    }


def _worker(task):
    m, cfg = task
    try:
        return "ok", m.id, process_model(m, cfg)
    except Exception as exc:
        import traceback
        return "err", m.id, f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}"


# ------------------------------------------------------------------ hub
def hub_api(required: bool = False):
    try:
        from huggingface_hub import HfApi
    except ImportError:
        if required:
            sys.exit("--upload/--prune need huggingface_hub:  pip install huggingface_hub   then  hf auth login")
        return None
    return HfApi()


def referenced(m: dict) -> set:
    """Every path the manifest points at."""
    out = {(m.get("msa") or {}).get("path"), "provenance.json", "metadata/provenance.json"}
    for e in m.get("models", []):
        for k in ("pdbPath", "pdbFullPath", "paePath", "plddtPath", "accentuatedPaePath", "scoresPath"):
            out.add(e.get(k))
    return {p for p in out if p}


def previous_manifest(out: str, repo: str, from_hub: bool = True) -> dict | None:
    """The manifest to carry entries from: the staged one, else (partial runs) the live hub one.

    Reusing the staged entries is what makes a second run cheap: an up-to-date model keeps its
    entry and its scores JSON is never parsed again. A partial run (--only/--skip-models) must
    never shrink the catalogue, so it falls back to the published manifest.
    """
    for cand in (os.path.join(out, "manifest.json"), os.path.join(out, "manifest.json.gz")):
        if os.path.exists(cand):
            return json.loads(read_bytes_any(cand))
    if not from_hub:
        return None
    url = f"https://huggingface.co/datasets/{repo}/resolve/main/manifest.json"
    try:
        print(f"· manifest     : none staged — reading the live one from {repo}")
        with urllib.request.urlopen(url, timeout=120) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"! could not read the live manifest ({e})", file=sys.stderr)
        return None


def read_ledger(path: str) -> dict:
    out: dict[str, str] = {}
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            parts = line.split(None, 1)
            if len(parts) == 2:
                out[parts[1].strip().removeprefix("./")] = parts[0]
    return out


def staged_files(out: str) -> list[str]:
    rels = []
    for base, _, files in os.walk(out):
        for f in files:
            if f.endswith(".tmp"):
                continue
            rel = os.path.relpath(os.path.join(base, f), out).replace(os.sep, "/")
            if rel not in SKIP_UPLOAD and rel != LEDGER:
                rels.append(rel)
    return sorted(rels)


# ------------------------------------------------------------------ main
def main() -> int:
    ap = argparse.ArgumentParser(
        description="Build, stage and publish the ORF1 viewer dataset from a JSON configuration file.",
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("config", help="configuration_update_dataset.json")
    ap.add_argument("--only", default=None, help="comma-separated globs of model ids to (re)build")
    ap.add_argument("--skip-models", action="store_true",
                    help="refresh the CSV/MSA/tree/manifest only — never look at the model folders")
    ap.add_argument("--force", action="store_true", help="rebuild artifacts even when they are up to date")
    ap.add_argument("--limit", type=int, default=0, help="build at most N models (smoke runs)")
    ap.add_argument("--workers", type=int, default=min(24, os.cpu_count() or 4))
    ap.add_argument("--upload", action="store_true",
                    help="push with the Hub API instead of only printing the hf upload command")
    ap.add_argument("--prune", action="store_true", help="delete hub files that no manifest entry references")
    ap.add_argument("--selfcheck", type=int, default=0, help="decode N built PAE images and report max |Δ| vs the scores JSON")
    ap.add_argument("--dry-run", action="store_true", help="report what would be built; write and upload nothing")
    args = ap.parse_args()

    cfg_json = load_config(args.config)
    out, repo = cfg_json["outputfolder"], cfg_json["hfRepo"]
    lut_name, codec = cfg_json["PAEresolution"], cfg_json["codec"]
    lut = build_lut(PAE_LUTS[lut_name])

    print(f"· models from  : {cfg_json['modelfolder']}")
    print(f"· staging in   : {out}")
    print(f"· PAE          : {lut_name}, ≤{LUT_MAX_ERR[lut_name]:g} Å, {lut.size} levels, lossless {codec}")
    print(f"· hub repo     : {repo}")

    domains, meta = read_annotations(cfg_json.get("dataset"))
    print(f"· annotations  : {os.path.basename(cfg_json.get('dataset') or '')} — {len(domains)} accessions, "
          f"{sum(len(v) for v in domains.values())} domain ranges")
    msa_info = scan_msa(cfg_json.get("msa"))
    print(f"· alignment    : {os.path.basename(cfg_json.get('msa') or '')} — {msa_info['format']}, "
          f"{len(msa_info['names'])} sequences, {msa_info['columns']} columns")
    msa_out = f"{cfg_json.get('OutputMSAName') or 'ORF1_MSA.aln'}.gz"

    cfg = Cfg(source=cfg_json["modelfolder"], out=out, lut_name=lut_name, lut=lut,
              edges=(lut[:-1] + lut[1:]) / 2.0, codec=codec, checkpoints=CHECKPOINTS,
              msa_names=tuple(msa_info["names"]), force=args.force)

    entries: dict[str, dict] = {}
    todo: list[Model] = []
    errors: list[tuple[str, str]] = []
    built = reused = 0

    prev = previous_manifest(out, repo, from_hub=args.skip_models or bool(args.only))
    entries = {m["id"]: m for m in (prev or {}).get("models", [])}
    if args.skip_models:
        if not entries:
            print("! --skip-models needs an existing manifest (nothing staged, hub unreachable?)", file=sys.stderr)
            return 1
        print(f"· models       : not touched — {len(entries)} existing entries kept")
    if not args.skip_models:
        models, problems = discover(cfg_json["modelfolder"])
        if args.only:
            pats = [re.compile(re.escape(p.strip()).replace("\\*", ".*") + "$") for p in args.only.split(",")]
            models = [m for m in models if any(p.match(m.id) for p in pats)]
        known = {m["id"] for m in entries.values()}
        new = 0
        for m in models:
            if is_fresh(m, cfg, entries.get(m.id)):
                reused += 1
                continue
            m.domains, m.meta = domains.get(m.accession, []), meta.get(m.accession, {})
            if m.id not in known:
                new += 1
            todo.append(m)
        if args.limit:
            todo = todo[: args.limit]
        print(f"· models       : {len(models)} considered · {reused} up to date · {len(todo)} to build"
              f" ({new} new) · {len(problems)} folder problem(s)")
        for p in problems[:6]:
            print(f"    ! {p}")
        if len(problems) > 6:
            print(f"    ! … {len(problems) - 6} more")
        if not args.only:  # a full run defines the catalogue: a folder that vanished leaves with it
            gone = sorted(set(entries) - {m.id for m in models})
            for mid in gone:
                entries.pop(mid, None)
            if gone:
                print(f"· dropped      : {len(gone)} entr(ies) with no model folder any more — "
                      + ", ".join(gone[:6]) + (" …" if len(gone) > 6 else ""))
        if args.dry_run:
            for m in todo[:15]:
                print(f"    would build  {m.id}")
            print(f"    … {len(todo)} total — dry run, nothing written or uploaded")
            return 0
        bar = Bar(len(todo))
        if args.workers > 1 and len(todo) > 1:
            with ProcessPoolExecutor(max_workers=args.workers) as pool:
                results = [f.result() for f in as_completed([pool.submit(_worker, (m, cfg)) for m in todo])]
        else:
            results = [_worker((m, cfg)) for m in todo]
        for status, mid, payload in results:
            bar.tick()
            if status == "ok":
                entries[mid] = payload
                built += 1
            else:
                errors.append((mid, payload))
        if errors:
            write_atomic(os.path.join(out, "errors.txt"), "".join(f"=== {m}\n{v}\n" for m, v in errors).encode())
            print(f"! {len(errors)} model(s) failed → {out}/errors.txt", file=sys.stderr)
            for mid, v in errors[:5]:
                print(f"    ✗ {mid}: {v.splitlines()[0]}")

    if args.dry_run and args.skip_models:
        print(f"dry run: {len(entries)} manifest entries would be kept, small files refreshed")
        return 0

    order = sorted(entries.values(), key=lambda e: e["id"])
    manifest = {
        "schema": SCHEMA_VERSION,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": os.path.basename(os.path.abspath(cfg_json["modelfolder"]).rstrip("/")),
        "counts": {"models": len(order), "failed": len(errors)},
        "pae": {"format": codec, "lutName": lut_name, "lut": [round(float(v), 4) for v in lut],
                "maxErrorA": LUT_MAX_ERR[lut_name], "unit": "Angstrom",
                "note": "pixel value = lut index; lossless 8-bit single-channel image"},
        "domains": [{"name": k, "color": v} for k, v in DOMAIN_COLORS.items()],
        "hosts": sorted({e.get("host") for e in order if e.get("host")}),
        "msa": {"path": msa_out if msa_info["names"] else None, "format": msa_info["format"],
                "sequences": len(msa_info["names"]), "columns": msa_info["columns"]},
        "models": order,
    }
    blob = json.dumps(manifest, separators=(",", ":")).encode()
    if args.dry_run:
        print(f"dry run: manifest would be {human(len(blob))} for {len(order)} models — nothing written")
        return 0

    write_atomic(os.path.join(out, "manifest.json.gz"), blob, compress=True)
    write_atomic(os.path.join(out, "manifest.json"), blob)

    # the small files: annotation CSV, cluster table, reference tree, alignment, this script
    def stage(src: str | None, rel: str, compress: bool = False) -> None:
        if not src or not os.path.exists(src):
            print(f"! no source for {rel}: {src} — leaving whatever is there", file=sys.stderr)
            return
        write_atomic(os.path.join(out, rel), read_bytes_any(src), compress=compress)

    stage(cfg_json.get("dataset"), f"metadata/{cfg_json.get('outputDatasetName') or 'annotations.csv'}")
    stage(cfg_json.get("clusterFile"), f"metadata/{cfg_json.get('outputClusterFile') or 'clusters.csv'}")
    stage(cfg_json.get("tree"), f"metadata/{cfg_json.get('outputTreeName') or 'reference.tree'}")
    if msa_info["names"]:
        stage(cfg_json.get("msa"), msa_out, compress=True)
    write_atomic(os.path.join(out, "metadata", os.path.basename(__file__)), open(__file__, "rb").read())

    fasta_library(out, order, cfg)

    prov = {
        "schema": 1,
        "generatedAt": manifest["generatedAt"],
        "dataset": {"repoId": repo, "rootIsAppDataRoot": True, "viewerUrl": VIEWER_URL,
                    "dataRoot": f"https://huggingface.co/datasets/{repo}/resolve/main"},
        "code": {"repository": "https://github.com/tubiana/tubiana.github.io",
                 "entrypoint": "scripts/update_dataset.py", "configFile": os.path.basename(args.config)},
        "inputs": {k: cfg_json.get(k) for k in
                   ("modelfolder", "dataset", "msa", "clusterFile", "tree", "PAEresolution", "codec")},
        "fidelity": {"paeLut": lut_name, "maxErrorA": LUT_MAX_ERR[lut_name], "codec": codec,
                     "previewPx": PREVIEW_PX, "structures": "full-atom only, no backbone reduction"},
        "models": {"entries": len(order), "built": built, "reused": reused, "failed": len(errors)},
        "alignment": {"path": msa_out, "format": msa_info["format"],
                      "sequences": len(msa_info["names"]), "columns": msa_info["columns"]},
    }
    ptxt = json.dumps(prov, indent=2).encode()
    write_atomic(os.path.join(out, "provenance.json"), ptxt)
    write_atomic(os.path.join(out, "metadata", "provenance.json"), ptxt)

    # what changed since the last --upload this script performed (informational otherwise)
    ledger_path = os.path.join(out, LEDGER)
    ledger = read_ledger(ledger_path)
    rels = staged_files(out)
    sums = {rel: sha256(os.path.join(out, rel)) for rel in rels}
    changed = [rel for rel in rels if ledger.get(rel) != sums[rel]]
    print(f"· staged       : {len(rels)} files, {human(sum(os.path.getsize(os.path.join(out, r)) for r in rels))}"
          f" — {len(changed)} changed since the last --upload")

    api = hub_api(required=args.upload or args.prune)
    if args.upload:
        if changed:
            print(f"· uploading      : {len(changed)} file(s) → {repo}")
            api.upload_folder(repo_id=repo, folder_path=out, repo_type="dataset", allow_patterns=changed)
        # the ledger describes what is on the hub now, so it is written and pushed last
        write_atomic(ledger_path, "".join(f"{v}  {k}\n" for k, v in sorted(sums.items())).encode())
        api.upload_file(repo_id=repo, path_in_repo=LEDGER, path=ledger_path, repo_type="dataset")
        print(f"· ledger         : {LEDGER} updated ({len(sums)} entries)")
    else:
        msg = f"payload {time.strftime('%Y-%m-%d')}"
        print("· not pushed     : staging is local. Check the folder, then run:")
        print(f"    hf upload {repo} {out} . --repo-type dataset --exclude errors.txt \\")
        print(f'        --commit-message "{msg}"')

    # anything on the hub that no model references is a leftover from a rename or a deletion
    if api is None:
        print("· leftovers     : not checked (huggingface_hub is not installed)")
    else:
        try:
            remote = set(api.list_repo_files(repo_id=repo, repo_type="dataset"))
        except Exception as e:
            remote = set()
            print(f"! could not list the hub: {e}", file=sys.stderr)
        # referenced-by-manifest, not staged-this-run: a partial run (--only / --skip-models)
        # must never make the whole published payload look like a leftover
        keep = set(rels) | {LEDGER} | KEEP_ON_HF | referenced(manifest)
        orphans = sorted(p for p in remote if p not in keep and not p.startswith(".git"))
        if args.skip_models or args.only:
            print("· leftovers     : NOT CHECKED, --prune IGNORED — a partial run"
                  " (--skip-models/--only) knows only part of the catalogue; pruning needs a full one")
        elif orphans:
            per_dir: dict[str, int] = {}
            for p in orphans:
                per_dir[os.path.dirname(p) or "/"] = per_dir.get(os.path.dirname(p) or "/", 0) + 1
            print(f"· leftovers     : {len(orphans)} hub file(s) the manifest does not reference — "
                  + ", ".join(f"{k}:{v}" for k, v in sorted(per_dir.items())[:8]))
            for p in orphans[:8]:
                print(f"    {p}")
            if len(orphans) > 8:
                print(f"    … {len(orphans) - 8} more")
            if args.prune and (not sys.stdin.isatty()
                               or input(f"                 delete these {len(orphans)} file(s) from {repo}? [y/N] ")
                               .strip().lower().startswith("y")):
                for i in range(0, len(orphans), 64):
                    api.delete_files(repo_id=repo, repo_type="dataset", delete_patterns=orphans[i:i + 64])
                print(f"· pruned         : {len(orphans)} file(s) deleted")
            else:
                print(f"                 to delete them: python3 {os.path.basename(__file__)} {args.config} --prune"
                      "        (a full run — it rebuilds nothing that is already current)")
        else:
            print("· leftovers     : none")

    if args.selfcheck:
        selfcheck(todo, cfg, args.selfcheck)
    return 0


def fasta_library(out: str, order: list[dict], cfg: Cfg) -> None:
    """metadata/ORF1s_1178.fasta — ungapped sequence per model id, for "search from Fasta sequence".
    Read back from the staged PDBs, so it cannot disagree with what is published."""
    lines = []
    for e in order:
        pdb = os.path.join(out, e.get("pdbPath", ""))
        if not e.get("pdbPath") or not os.path.exists(pdb):
            continue
        _, seq = pdb_residues(read_bytes_any(pdb).decode("utf-8", "replace"))
        lines.append(f">{e['id']}\n{''.join(seq)}\n")
    if lines:
        write_atomic(os.path.join(out, FASTA_LIBRARY), "".join(lines).encode())


def selfcheck(models: list[Model], cfg: Cfg, n: int) -> None:
    import random
    if not models:
        print("  self-check: nothing was built this run, nothing to check")
        return
    sample = random.Random(0).sample(models, min(n, len(models)))
    print(f"\n  decode round-trip self-check ({len(sample)} models)")
    worst = 0.0
    for m in sample:
        p = artifact_paths(cfg, m.id)["pae"]
        if not os.path.exists(p):
            print(f"    ! {m.id}: {p} missing")
            continue
        arr = np.asarray(Image.open(p), dtype=np.uint8)
        if arr.ndim == 3:
            arr = arr[:, :, 0]
        src = np.asarray(json.loads(read_bytes_any(m.scores))["pae"], dtype=np.float32)
        recon = cfg.lut[arr.astype(np.int32)]
        h, w = min(recon.shape[0], src.shape[0]), min(recon.shape[1], src.shape[1])
        err = float(np.abs(recon[:h, :w] - src[:h, :w]).max())
        worst = max(worst, err)
        print(f"    {m.id[:30]:30s} {src.shape[0]}x{src.shape[1]}  max|Δ| {err:.3f} Å  {human(os.path.getsize(p))}")
    print(f"    worst {worst:.3f} Å — table {cfg.lut_name} promises ≤ {LUT_MAX_ERR[cfg.lut_name]:g} Å")


if __name__ == "__main__":
    raise SystemExit(main())
