#!/usr/bin/env python3
"""
Stage the ORF1 viewer payload + annotation CSV for a Hugging Face **dataset** upload.

Hub layout produced (repo root == the app's data root, so the viewer only needs
`?dataBaseUrl=https://huggingface.co/datasets/<ns>/<repo>/resolve/main`):

    .gitattributes                    HF default LFS patterns + .webp/.pdb/.png
    README.md                         dataset card (generated)
    manifest.json / manifest.json.gz  model index + PAE LUT + integrity points
    msa.aln.gz                        Clustal Omega alignment (1178 x 2944)
    pae/<id>.webp                     lossless 8-bit single-channel PAE images
    paeimg/<id>.webp                  accentuated PAE figures (original PNG/WEBP)
    pdb-full/<id>.pdb.gz              full-atom models  <- what the viewer loads
    pdb-bb/<id>.pdb.gz                backbone reduction (downloads / fast parse)
    plddt/<id>.bin.gz                 per-residue pLDDT bytes
    metadata/<annotation>.csv         reviewed annotation CSV (domains + metadata)
    metadata/provenance.json          how this snapshot was produced
    metadata/SHA256SUMS.txt           sha256 of every payload + metadata file

Files are hardlinked by default (no extra disk use); --copy for a real copy.
Idempotent: existing files are replaced, the tree is rebuilt deterministically.

    python3 scripts/make_hf_dataset.py                     # -> ./hf-dataset
    python3 scripts/make_hf_dataset.py --out /tmp/hev --copy
    python3 scripts/make_hf_dataset.py --gitattributes /path/to/remote.gitattributes
"""

from __future__ import annotations

import argparse
import collections
import csv
import glob
import gzip
import hashlib
import io
import json
import os
import shutil
import statistics
import sys
import time

PAYLOAD_DIRS = ["pae", "paeimg", "pdb-full", "pdb-bb", "plddt"]
PAYLOAD_FILES = ["manifest.json", "manifest.json.gz", "msa.aln.gz"]

# patterns HF's default .gitattributes does not ship
EXTRA_LFS = [
    "*.webp filter=lfs diff=lfs merge=lfs -text",
    "*.pdb filter=lfs diff=lfs merge=lfs -text",
    "*.pdb.gz filter=lfs diff=lfs merge=lfs -text",
    "*.png filter=lfs diff=lfs merge=lfs -text",
    "*.aln filter=lfs diff=lfs merge=lfs -text",
    "*.aln.gz filter=lfs diff=lfs merge=lfs -text",
    "*.cif filter=lfs diff=lfs merge=lfs -text",
    "*.cif.gz filter=lfs diff=lfs merge=lfs -text",
]


def log(msg: str) -> None:
    print(msg, flush=True)


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(n) < 1024 or unit == "TB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024.0
    return f"{n:.1f} TB"


def sha256(path: str, bufsize: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(bufsize), b""):
            h.update(chunk)
    return h.hexdigest()


def link_or_copy(src: str, dst: str, copy: bool) -> None:
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if os.path.lexists(dst):
        os.remove(dst)
    if not copy:
        try:
            os.link(src, dst)
            return
        except OSError:
            pass
    shutil.copy2(src, dst)


def load_manifest(payload: str) -> dict:
    for rel in ("manifest.json.gz", "manifest.json"):
        p = os.path.join(payload, rel)
        if not os.path.exists(p):
            continue
        raw = open(p, "rb").read()
        if raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        return json.loads(raw.decode("utf-8"))
    raise SystemExit(f"no manifest.json[.gz] in {payload}")


def find_csv(source_dir: str, explicit: str | None) -> str:
    if explicit:
        if not os.path.exists(explicit):
            raise SystemExit(f"--csv not found: {explicit}")
        return explicit
    cands = sorted(glob.glob(os.path.join(source_dir, "*.csv")))
    if not cands:
        cands = sorted(glob.glob(os.path.join(source_dir, "**", "*.csv"), recursive=True))
    if not cands:
        raise SystemExit(
            f"no annotation CSV found in {source_dir!r} — pass --csv path/to/annotation.csv"
        )
    # prefer a reviewed annotation file when several are present
    cands.sort(key=lambda p: (("reviewed" not in os.path.basename(p).lower()), len(p), p))
    return cands[0]


def artifact_report(payload: str) -> dict:
    """file counts + bytes per artifact directory (from the filesystem, not the manifest)."""
    out: dict[str, dict] = {}
    for d in PAYLOAD_DIRS:
        root = os.path.join(payload, d)
        if not os.path.isdir(root):
            out[d] = {"files": 0, "bytes": 0}
            continue
        n = 0
        total = 0
        sizes: list[int] = []
        for name in os.listdir(root):
            p = os.path.join(root, name)
            if not os.path.isfile(p):
                continue
            s = os.path.getsize(p)
            n += 1
            total += s
            sizes.append(s)
        out[d] = {
            "files": n,
            "bytes": total,
            "meanBytes": round(total / n) if n else 0,
            "minBytes": min(sizes) if sizes else 0,
            "maxBytes": max(sizes) if sizes else 0,
        }
    for f in PAYLOAD_FILES:
        p = os.path.join(payload, f)
        out[f] = {"files": 1, "bytes": os.path.getsize(p)} if os.path.exists(p) else {"files": 0, "bytes": 0}
    return out


def manifest_stats(man: dict) -> dict:
    models = man["models"]
    lens = [m["length"] for m in models]
    plddts = [m["meanPlddt"] for m in models]
    genotypes = collections.Counter((m.get("meta") or {}).get("Genogroupe") or "Unknown" for m in models)
    hosts = collections.Counter(m["host"] for m in models)
    n_dom = sum(1 for m in models if m.get("domains"))
    return {
        "models": len(models),
        "length": {"min": min(lens), "median": int(statistics.median(lens)), "max": max(lens)},
        "meanPlddt": {"mean": round(statistics.mean(plddts), 1), "min": round(min(plddts), 1), "max": round(max(plddts), 1)},
        "genotypes": genotypes.most_common(),
        "hosts": hosts.most_common(),
        "modelsWithDomainAnnotation": n_dom,
        "domainNames": [d["name"] for d in man.get("domains", [])],
        "lutName": man["pae"]["lutName"],
        "lutLevels": len(man["pae"]["lut"]),
        "lutMaxA": max(man["pae"]["lut"]),
        "maxErrorA": man["pae"].get("maxErrorA"),
        "msa": man.get("msa"),
    }


def integrity_report(man: dict) -> dict:
    """Re-derive the LUT round-trip error from the manifest's integrity points.

    verify.points = (i, j, A_original) 0-based, verify.decoded = same points decoded back
    through the LUT. max abs difference is the guarantee the viewer shows.
    """
    lut = man["pae"]["lut"]
    limit = float(man["pae"].get("maxErrorA", 1.5))
    worst = 0.0
    n_points = 0
    models_checked = 0
    bad = 0
    for m in man["models"]:
        v = m.get("verify") or {}
        pts = v.get("points") or []      # [[i, j, A_original], ...] 0-based
        dec = v.get("decoded") or []     # [A_decoded_through_lut, ...] same order
        if not pts or len(pts) != len(dec):
            continue
        models_checked += 1
        n_points += len(pts)
        for p, got in zip(pts, dec):
            err = abs(float(got) - float(p[2]))
            worst = max(worst, err)
            if err > limit + 1e-9:
                bad += 1
    return {
        "modelsChecked": models_checked,
        "pointsChecked": n_points,
        "maxAbsErrA": round(worst, 4),
        "pointsOverLimit": bad,
        "lutLevels": len(lut),
    }


def gitattributes_text(remote: str | None) -> str:
    base = ""
    if remote and os.path.exists(remote):
        base = open(remote, encoding="utf-8").read().rstrip("\n")
    if not base.strip():
        base = "# keep binary payloads in Git LFS (Hugging Face)"
    have = {ln.strip() for ln in base.splitlines()}
    extra = [ln for ln in EXTRA_LFS if ln not in have] or ["# (ORF1 LFS patterns already present)"]
    return "\n".join([base, "", "# ORF1 viewer payload (added by scripts/make_hf_dataset.py)"] + extra) + "\n"


PAE_SNIPPET = """import json, urllib.request, numpy as np
from PIL import Image

root = "@ROOT@"
man = json.load(urllib.request.urlopen(f"{root}/manifest.json"))
lut = np.asarray(man["pae"]["lut"], dtype=np.float32)

m = man["models"][0]
img = Image.open(urllib.request.urlopen(f"{root}/{m['paePath']}"))   # mode 'L' (8-bit)
pae = lut[np.asarray(img, dtype=np.int16)]                          # Angstrom, shape (len, len)
print(m["id"], pae.shape, round(float(pae.max()), 2))
"""


def card_text(repo_id: str, code_url: str, viewer_url: str, prov: dict, stats: dict, arts: dict, csv_name: str) -> str:
    total_bytes = sum(a.get("bytes", 0) for a in arts.values())
    pae_snippet = PAE_SNIPPET.replace(
        "@ROOT@", f"https://huggingface.co/datasets/{repo_id}/resolve/main"
    )
    gen = "| genus / group | models |\n|---|---:|\n" + "\n".join(
        f"| {k} | {v} |" for k, v in stats["genotypes"]
    )
    hosts = ", ".join(f"{k} ({v})" for k, v in stats["hosts"][:8])
    art_rows = "\n".join(
        f"| `{d}/` | {a['files']:,} | {human(a['bytes'])} |"
        for d, a in arts.items()
        if a.get("files")
    )
    return f"""---
license: mit
pretty_name: "Hepatitis E virus ORF1 (nsp1) — AlphaFold2 model collection"
tags:
  - hepatitis-e
  - orf1
  - nsp1
  - alphafold2
  - protein-structure
  - predicted-aligned-errors
  - plddt
  - structural-bioinformatics
size_categories:
  - 1K<n<10K
task_categories:
  - other
---

# Hepatitis E virus ORF1 (nsp1) — AlphaFold2 model collection

**{stats['models']:,}** AlphaFold2 predictions of the HEV ORF1 (nsp1) replicase, packaged so a
static web app can render the 3D model, the predicted aligned error (PAE) matrix and the multiple
sequence alignment without a server.

* **open the viewer: <{viewer_url}>** (this dataset is its data root)
* repository — app + pipeline code, no data: **{code_url}**
* dataset repo: **https://huggingface.co/datasets/{repo_id}**
* generated **{prov['generatedAt']}** by `scripts/prepare_data.py` (preset `{prov['pipeline']['preset']}`)

## Layout — the repo root *is* the app's data root

| path | files | size | what |
|---|---:|---:|---|
| `manifest.json` / `.gz` | 1 | {human(arts['manifest.json']['bytes'])} | model index, PAE LUT, integrity points |
| `msa.aln.gz` | 1 | {human(arts['msa.aln.gz']['bytes'])} | Clustal Omega alignment ({(stats['msa'] or {}).get('sequences')} seqs × {(stats['msa'] or {}).get('columns')} cols) |
| `pae/` | {arts['pae']['files']:,} | {human(arts['pae']['bytes'])} | lossless 8-bit single-channel PAE images |
| `pdb-full/` | {arts['pdb-full']['files']:,} | {human(arts['pdb-full']['bytes'])} | full-atom models — what the viewer loads |
| `pdb-bb/` | {arts['pdb-bb']['files']:,} | {human(arts['pdb-bb']['bytes'])} | backbone reduction (downloads, fast parse) |
| `plddt/` | {arts['plddt']['files']:,} | {human(arts['plddt']['bytes'])} | per-residue pLDDT bytes |
| `paeimg/` | {arts['paeimg']['files']:,} | {human(arts['paeimg']['bytes'])} | original accentuated PAE figures |
| `metadata/{csv_name}` | 1 | {human(prov['csv']['bytes'])} | reviewed annotation CSV (domains + metadata) |
| `metadata/provenance.json` | 1 | — | how this snapshot was produced |
| `metadata/SHA256SUMS.txt` | 1 | — | sha256 of every file above |

Total payload **{human(total_bytes)}**. All payloads are gzip/WebP-lossless where the numbers matter
(PAE images are index images: no colour-space quantisation of the values themselves).

## Use it from the viewer

```
{viewer_url}/?dataBaseUrl=https://huggingface.co/datasets/{repo_id}/resolve/main
```

Every path inside `manifest.json` is relative to that root. Other overrides (see the repo README):
`VITE_DATA_BASE_URL` at build time, `window.__ORF1_DATA_BASE_URL__` in `index.html`, or
`localStorage['orf1.dataBaseUrl']`.

> **Note** — if this repo is private, the browser cannot read it from a static site: make it public,
> or serve the payload from storage that allows plain HTTP GET (institute storage, Buckets, …).

## Reading the numbers without the app

PAE images are **lossless**: a pixel value is an *index* into `manifest.pae.lut`
(`{stats['lutName']}`, {stats['lutLevels']} levels, max {stats['lutMaxA']} Å, documented tolerance
±{stats['maxErrorA']} Å):

```python
{pae_snippet}```

Integrity, per model: `verify.points` = `(i, j, Å_original)` (0-based matrix indices) and
`verify.decoded` = the same cells decoded back through the LUT. In this snapshot:
**{prov['integrity']['modelsChecked']} models / {prov['integrity']['pointsChecked']:,} points,
max abs error {prov['integrity']['maxAbsErrA']} Å, {prov['integrity']['pointsOverLimit']} over the limit.**

## The annotation CSV (source of truth for domains)

`metadata/{csv_name}` — `{prov['csv']['delimiter']}`-separated (it is **not** comma-separated),
**{prov['csv']['rows']}** data rows, UTF-8, {len(prov['csv']['columns'])} columns:

`{', '.join(prov['csv']['columns'])}`

Domain borders arrive as `border_<Domain>` = `"(start-end)"` (1-based, e.g. `"(1-467)"`) with matching
`size_<Domain>` columns; `genbank` is the protein accession that keys every model in `manifest.json`.

**Domains are taken verbatim from this CSV** — the pipeline and the app never cluster, segment or
merge them. `HVR` is a hypervariable stretch, so it is excluded from the *domain count* in the UI
while remaining annotated and coloured everywhere else. Accessions absent from the CSV simply have no
domains; nothing is invented for them.

## Composition

* lengths: min {stats['length']['min']}, median {stats['length']['median']}, max {stats['length']['max']} aa
* mean pLDDT: {stats['meanPlddt']['mean']} (range {stats['meanPlddt']['min']}–{stats['meanPlddt']['max']})
* models with domain annotation: {stats['modelsWithDomainAnnotation']:,} / {stats['models']:,}
* CSV coverage: {prov['csv']['rows']} annotated accessions, {stats['models']:,} with an AlphaFold model
  ({prov['coverage']['accessionsWithoutModel']} without: {', '.join(prov['coverage']['withoutModel']) or '—'})

{gen}

* hosts (top 8): {hosts}

## Verification after download

```bash
DIR=$(mktemp -d)
hf download {repo_id} --repo-type dataset --local-dir "$DIR"
( cd "$DIR" && sha256sum -c metadata/SHA256SUMS.txt )   # every file, payload included
```

## Provenance & license

See `metadata/provenance.json` (source tree, AlphaFold pipeline preset, LUT, integrity summary,
artifact counts, app version). Code and data are released under the **MIT** license; the underlying
sequences are public GenBank records — cite the original accessions and the AlphaFold2 publication
for any scientific use.
"""


# --------------------------------------------------------------------------- main


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--payload", default="public/data", help="staged payload from prepare_data.py")
    ap.add_argument("--csv", default=None, help="annotation CSV (default: auto-detect in --source-dir)")
    ap.add_argument("--source-dir", default="models_ORF1_files", help="where to look for the annotation CSV")
    ap.add_argument("--out", default="hf-dataset", help="staging directory for the Hub upload")
    ap.add_argument("--repo-id", default="ttubiana/HEV-ORF1-models", help="dataset repo id (used in the card)")
    ap.add_argument("--code-url", default="https://github.com/tubiana/tubiana.github.io", help="where the code lives")
    ap.add_argument("--viewer-url", default="https://tubiana.github.io/ORF1viewer",
                    help="public URL of the deployed app (subfolder of a user site by default)")
    ap.add_argument("--preset", default="pages", help="prepare_data.py preset used for this payload")
    ap.add_argument("--gitattributes", default=None, help="existing .gitattributes to keep (fetched from the Hub)")
    ap.add_argument("--copy", action="store_true", help="copy instead of hardlink")
    ap.add_argument("--no-sums", action="store_true", help="skip sha256sums (faster)")
    ap.add_argument("--stages-dir", default="stages", help="where to write the upload stage manifests")
    args = ap.parse_args()

    t0 = time.time()
    payload = os.path.abspath(args.payload)
    out = os.path.abspath(args.out)
    if not os.path.isdir(payload):
        raise SystemExit(f"payload dir not found: {payload}")
    os.makedirs(out, exist_ok=True)

    man = load_manifest(payload)
    stats = manifest_stats(man)
    arts = artifact_report(payload)
    csv_path = find_csv(os.path.abspath(args.source_dir), args.csv)
    log(f"· payload      : {payload}")
    log(f"· csv          : {csv_path}  ({human(os.path.getsize(csv_path))})")
    log(f"· models       : {stats['models']:,}  (domain-annotated {stats['modelsWithDomainAnnotation']:,})")

    # ---- payload (root of the Hub repo) ----------------------------------------
    copied = 0
    for f in PAYLOAD_FILES:
        src = os.path.join(payload, f)
        if os.path.exists(src):
            link_or_copy(src, os.path.join(out, f), args.copy)
            copied += 1
    for d in PAYLOAD_DIRS:
        src_root = os.path.join(payload, d)
        if not os.path.isdir(src_root):
            log(f"· skip {d}/     : not present")
            continue
        n = 0
        for name in sorted(os.listdir(src_root)):
            p = os.path.join(src_root, name)
            if os.path.isfile(p):
                link_or_copy(p, os.path.join(out, d, name), args.copy)
                n += 1
        log(f"· {d:<13s}: {n:,} files -> {d}/")
        copied += n

    # ---- metadata -------------------------------------------------------------
    csv_name = os.path.basename(csv_path)
    link_or_copy(csv_path, os.path.join(out, "metadata", csv_name), args.copy)
    link_or_copy(os.path.abspath(__file__), os.path.join(out, "metadata", "make_hf_dataset.py"), args.copy)

    integrity = integrity_report(man)
    delimiter = ";"
    with open(csv_path, encoding="utf-8", newline="") as fh:
        first = fh.readline()
        delimiter = ";" if ";" in first else ("," if "," in first else "\t")
    with open(csv_path, encoding="utf-8") as fh:
        header = fh.readline().rstrip("\n")
        rows = sum(1 for _ in fh)
    columns = [c.strip() for c in header.split(delimiter) if c.strip()]

    # coverage: annotated accessions vs accessions that actually have a model
    key = "genbank" if "genbank" in columns else columns[0]
    with open(csv_path, encoding="utf-8", newline="") as fh:
        acc_csv = [r[key].strip() for r in csv.DictReader(fh, delimiter=delimiter) if r.get(key)]
    have = {m["accession"] for m in man["models"]}
    without_model = sorted(set(acc_csv) - have)
    not_annotated = sorted(have - set(acc_csv))
    coverage = {
        "csvRows": len(acc_csv),
        "uniqueCsvAccessions": len(set(acc_csv)),
        "models": len(have),
        "accessionsWithoutModel": len(without_model),
        "withoutModel": without_model[:40],
        "modelsWithoutCsvRow": len(not_annotated),
        "accessionsWithoutCsvRow": not_annotated[:40],
        "keyColumn": key,
    }

    prov = {
        "schema": 1,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "dataset": {"repoId": args.repo_id, "rootIsAppDataRoot": True, "viewerUrl": args.viewer_url,
                    "dataRoot": f"https://huggingface.co/datasets/{args.repo_id}/resolve/main"},
        "code": {"repository": args.code_url, "entrypoint": "scripts/prepare_data.py", "app": "Hepatitis E ORF1 model viewer"},
        "pipeline": {
            "preset": args.preset,
            "sourceTree": man.get("source"),
            "pdbArtifacts": ["backbone", "full-atom"],
            "paeEncoding": {"format": man["pae"]["format"], "kind": "lossless 8-bit index image + manifest LUT",
                            "lutName": stats["lutName"], "lutLevels": stats["lutLevels"],
                            "lutMaxA": stats["lutMaxA"], "maxErrorA": stats["maxErrorA"]},
        },
        "csv": {"file": f"metadata/{csv_name}", "delimiter": delimiter, "rows": rows, "columns": columns,
                "bytes": os.path.getsize(csv_path), "sha256": sha256(csv_path) if not args.no_sums else None,
                "guarantee": "domains taken verbatim from the reviewed CSV; no clustering/merging anywhere"},
        "integrity": integrity,
        "coverage": coverage,
        "stats": stats,
        "artifacts": arts,
    }
    with open(os.path.join(out, "metadata", "provenance.json"), "w", encoding="utf-8") as fh:
        json.dump(prov, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    with open(os.path.join(out, ".gitattributes"), "w", encoding="utf-8") as fh:
        fh.write(gitattributes_text(args.gitattributes))

    with open(os.path.join(out, "README.md"), "w", encoding="utf-8") as fh:
        fh.write(card_text(args.repo_id, args.code_url, args.viewer_url, prov, stats, arts, csv_name))

    # ---- checksums ------------------------------------------------------------
    if not args.no_sums:
        paths: list[str] = []
        for root, _dirs, files in os.walk(out):
            for name in files:
                rel = os.path.relpath(os.path.join(root, name), out).replace(os.sep, "/")
                if rel in ("metadata/SHA256SUMS.txt",):
                    continue
                paths.append(rel)
        paths.sort()
        with open(os.path.join(out, "metadata", "SHA256SUMS.txt"), "w", encoding="utf-8") as fh:
            for rel in paths:
                fh.write(f"{sha256(os.path.join(out, rel))}  {rel}\n")
        log(f"· checksums    : {len(paths):,} files -> metadata/SHA256SUMS.txt")

    # ---- upload stage manifests (see REPORT-hf-upload.md) ---------------------
    stage_dir = os.path.abspath(args.stages_dir)
    stages = {
        "stage-00-meta.txt": [".gitattributes", "README.md"],
        "stage-01-index.txt": [f for f in PAYLOAD_FILES if os.path.exists(os.path.join(out, f))]
        + ["metadata/provenance.json", f"metadata/{csv_name}", "metadata/SHA256SUMS.txt", "metadata/make_hf_dataset.py"],
        "stage-02-small.txt": [f"plddt/{n}" for n in sorted(os.listdir(os.path.join(out, "plddt")))]
        + [f"paeimg/{n}" for n in sorted(os.listdir(os.path.join(out, "paeimg")))]
        if os.path.isdir(os.path.join(out, "plddt")) and os.path.isdir(os.path.join(out, "paeimg"))
        else [],
        "stage-03-pdb.txt": [f"pdb-bb/{n}" for n in sorted(os.listdir(os.path.join(out, "pdb-bb")))]
        + [f"pdb-full/{n}" for n in sorted(os.listdir(os.path.join(out, "pdb-full")))]
        if os.path.isdir(os.path.join(out, "pdb-bb")) and os.path.isdir(os.path.join(out, "pdb-full"))
        else [],
        "stage-04-pae.txt": [f"pae/{n}" for n in sorted(os.listdir(os.path.join(out, "pae")))]
        if os.path.isdir(os.path.join(out, "pae"))
        else [],
    }
    os.makedirs(stage_dir, exist_ok=True)
    for name, items in stages.items():
        with open(os.path.join(stage_dir, name), "w", encoding="utf-8") as fh:
            fh.write("\n".join(items) + ("\n" if items else ""))
    log(f"· stages       : {', '.join(sorted(stages))} (in {stage_dir})")

    total = sum(a.get("bytes", 0) for a in arts.values())
    log(f"· out          : {out} — {copied:,} payload files, {human(total)} payload, {time.time() - t0:.1f}s")
    log("")
    log("Next: hf upload <repo-id> <out> --type dataset --include '<glob>'   (see REPORT-hf-upload.md)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
