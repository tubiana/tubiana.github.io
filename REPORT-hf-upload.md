# Uploading the ORF1 dataset to Hugging Face (code stays on GitHub)

Target: **code → GitHub Pages**, **data → Hugging Face dataset**
[`ttubiana/HEV-ORF1-models`](https://huggingface.co/datasets/ttubiana/HEV-ORF1-models).
The app already reads its payload from a configurable data base URL, so the split needs no code
change — only the URL.

---

## 0. TL;DR — four commands

```bash
# 1) build the viewer payload (1 GB, deterministic)
python3 scripts/prepare_data.py --preset pages                    # -> public/data/

# 2) stage the Hub tree (hardlinks, ~4 s): payload + annotation CSV + card + provenance + sha256
hf download ttubiana/HEV-ORF1-models .gitattributes --repo-type dataset --local-dir /tmp/hev_repo
python3 scripts/make_hf_dataset.py --gitattributes /tmp/hev_repo/.gitattributes    # -> hf-dataset/

# 3) upload (repo root == the app's data root, so pass "." as path_in_repo!)
hf upload ttubiana/HEV-ORF1-models hf-dataset . --repo-type dataset \
    --commit-message "ORF1 viewer payload: 1178 models (pae/pdb-full/pdb-bb/plddt/msa/csv)"

# 4) point the app at it
#    https://<your pages url>/?dataBaseUrl=https://huggingface.co/datasets/ttubiana/HEV-ORF1-models/resolve/main
```

Skipping steps 3's "big bang" in favour of **staged uploads** (recommended, see §5) is just as easy:
the stager also writes `stages/stage-0X-*.txt` file lists.

---

## 1. What belongs where

| | goes to | why |
|---|---|---|
| `src/`, `index.html`, `package.json`, `vite.config.ts`, `Dockerfile`, `.github/` | **GitHub** | code |
| `scripts/prepare_data.py`, `scripts/make_hf_dataset.py`, `scripts/smoke_test.mjs` | **GitHub** | code that *produces* data |
| `public/data/**` (~1 GB viewer payload) | **Hugging Face only** | too big for git/Pages commits |
| `models_ORF1_files/**` (~25 GB raw AlphaFold outputs) | **Hugging Face optional** (Tier B, §7) | archive, not needed by the app |
| `dataset_ORF1s_1178_reviewed_111724.csv` | **Hugging Face `metadata/`** (and GitHub if you want it reviewed in PRs — it is 232 KB) | it is the annotation source of truth |
| `hf-dataset/`, `stages/`, `dist/`, `smoke-artifacts/` | nowhere (gitignored) | generated |

`.gitignore` enforces this (`git status` stays clean with the 1 GB payload and 25 GB tree on disk).

---

## 2. Layout produced by `scripts/make_hf_dataset.py`

The **repo root is the app's data root** — every path inside `manifest.json` is relative to it, so
the viewer needs nothing but `…/resolve/main`.

```
.gitattributes                      # HF default LFS patterns + *.webp *.pdb *.pdb.gz *.png *.aln*
README.md                           # dataset card (generated: layout, LUT decode, coverage, sums)
manifest.json / manifest.json.gz    # 1178 entries, PAE LUT (balanced 33 levels, ±1.5 Å), integrity points
msa.aln.gz                          # 1178 × 2944 Clustal Omega alignment
pae/<id>.webp                       # lossless 8-bit single-channel PAE index images   (563 MB)
pdb-full/<id>.pdb.gz                # full-atom models — what the viewer loads          (245 MB)
pdb-bb/<id>.pdb.gz                  # backbone reduction (downloads / fast parse)       (133 MB)
plddt/<id>.bin.gz                   # per-residue pLDDT bytes                           (1.4 MB)
paeimg/<id>.webp                    # original accentuated PAE figures                   (38 MB)
metadata/dataset_ORF1s_1178_reviewed_111724.csv   # the reviewed annotation CSV (";"-separated)
metadata/provenance.json            # pipeline preset, LUT, integrity, coverage, artifact counts
metadata/SHA256SUMS.txt             # sha256 of every file in the repo
metadata/make_hf_dataset.py         # the script that built this snapshot (self-documenting)
```

Idempotent and cheap: files are **hardlinked** (`--copy` for a real copy), so staging 984 MB takes
seconds and costs no disk.

Useful flags: `--payload`, `--csv`, `--source-dir`, `--out`, `--repo-id`, `--code-url`, `--no-sums`.

---

## 3. `.gitattributes` — the one gotcha that bites

Hugging Face's default `.gitattributes` tracks `.gz`, `.bin`, `.npy`, … in LFS but **not** `.webp`,
`.pdb` or `.png`. Our biggest directory (`pae/*.webp`, 563 MB) would land as plain git blobs: the
commit works, but the repository's git history swells and later renames/re-uploads duplicate it.

`make_hf_dataset.py` appends the missing patterns to whatever `.gitattributes` you pass with
`--gitattributes` (fetch the current one first — §0 step 2 — so you never lose HF's defaults).
**Upload `.gitattributes` before the payload** (stage 0 below) so every payload file is committed as
LFS from the start.

Already uploaded without LFS? Re-upload after fixing `.gitattributes`, then remove the plain-blob
copies (`hf upload … --delete "pae/*.webp"`, or
`HfApi().delete_files("ttubiana/HEV-ORF1-models", paths=[...], repo_type="dataset")`) — or, if the
repo is still empty as it is now, just get the order right the first time.

---

## 4. Visibility: the repo must be **public** for the viewer

> **Status — done 2026-08-29**: Tier A uploaded (5 899 files, **1.02 GB**, 6 commits, all payloads in
> LFS), repo switched to **public**, and `npm run smoke -- --data-url <hub root>` passes **39/39**
> with the viewport mounted and PAE checkpoints at `maxΔ 0.000 Å`. Anonymous GET goes 302 → CDN → 200
> with `access-control-allow-origin` echoed, `manifest.json` = 2 806 747 bytes.

A browser cannot send your token from a static site, so:

* Web UI → dataset settings → *Repository settings* → visibility → public, or
  `huggingface_hub.HfApi().update_repo_settings("ttubiana/HEV-ORF1-models", repo_type="dataset", private=False)`
  with a write-scoped token.
* Verified with `curl -I` on a `resolve/main` URL: HF answers
  `access-control-allow-origin: <origin>` and exposes `Accept-Ranges`/`Content-Range`, i.e. **CORS and
  range requests work** — the app fetches the manifest, `.gz` payloads and WebP images directly. No
  proxy, no `no-cors`, no copy of the payload in the Pages build.
* If the dataset must stay private (embargo, institute policy): serve the same directory layout from
  institute storage / S3 / HF Buckets and set the data base URL there. Nothing in the app changes.

---

## 5. Staged upload (recommended for 984 MB / 5 893 files)

Each stage is one commit, so a network hiccup never costs the whole upload, and the dataset becomes
usable progressively. Run from inside the staging dir so the globs match repo-relative paths:

```bash
cd hf-dataset
export HF_HUB_ENABLE_HF_TRANSFER=1                      # faster uploads (pip install hf_transfer)
R="ttubiana/HEV-ORF1-models --repo-type dataset"

hf upload $R . . --include ".gitattributes" --commit-message "chore: LFS patterns"
hf upload $R . . --include "README.md"     --commit-message "docs: dataset card"
hf upload $R . . --include "manifest.json*" --include "msa.aln.gz" --include "metadata/*" \
                --commit-message "feat: manifest + LUT + integrity + annotation CSV"
hf upload $R . . --include "plddt/*" --include "paeimg/*" --commit-message "feat: pLDDT bytes + PAE figures"
hf upload $R . . --include "pdb-bb/*" --include "pdb-full/*" --commit-message "feat: PDB models (backbone + full-atom)"
hf upload $R . . --include "pae/*"     --commit-message "feat: PAE index images (lossless)"
```

File lists per stage are written to `stages/stage-0{0..4}-*.txt` if you prefer explicit control
(`--include "$(cat stages/stage-04-pae.txt)"` is not supported — glob per directory instead, or loop
over the list with `hf upload $R "<file>"`).

Re-running any stage is safe: identical content is a no-op commit, changed content is a new commit.

---

## 6. Verify after uploading

```bash
# 6.1 smallest possible smoke test — the manifest is what the app reads first
curl -sL https://huggingface.co/datasets/ttubiana/HEV-ORF1-models/resolve/main/manifest.json \
  | python3 -c "import json,sys; m=json.load(sys.stdin); print(m['counts'], m['pae']['lutName'], len(m['pae']['lut']))"

# 6.2 checksums of everything (also proves LFS passthrough and gzip integrity)
DIR=$(mktemp -d) && hf download ttubiana/HEV-ORF1-models --repo-type dataset --local-dir "$DIR"
( cd "$DIR" && sha256sum -c metadata/SHA256SUMS.txt )

# 6.3 lossless decode of one PAE matrix through the LUT (must be <= 1.5 Å vs verify.points)
#     snippet is in the dataset card's "Reading the numbers without the app"

# 6.3bis the whole 39-check suite, driven against the Hub payload (manifest, PAE image + LUT,
#     full-atom PDB, MSA, Mol* viewport) — needs a local build or dev server
npm run smoke -- --data-url https://huggingface.co/datasets/ttubiana/HEV-ORF1-models/resolve/main
npm run smoke -- --url http://localhost:5173/ --data-url https://huggingface.co/datasets/ttubiana/HEV-ORF1-models/resolve/main

# 6.4 the app against the Hub payload
#     <pages url>/?dataBaseUrl=https://huggingface.co/datasets/ttubiana/HEV-ORF1-models/resolve/main
#     then in DevTools:
#       __orf1.data.stats            -> { models: 1178, source: 'remote (hub)', ... }
#       __orf1.data.integrity()      -> { checked, maxAbsErrA, failed }
#     and the header's "decode" badge -> "max X Å · N pts"
```

The app sniffs gzip magic bytes, so `manifest.json.gz` / `*.pdb.gz` work whether or not the host
sends `Content-Encoding: gzip` — no double-decode bug.

---

## 7. Tier B (optional): the raw 25 GB AlphaFold tree

Only if you want the originals archived (the viewer never touches it). Two sane shapes:

```bash
# a) one tar shard per 100 models (176 files instead of ~70 000; cheap, streamable)
python3 - <<'PY'
import os, tarfile, glob, json
src="models_ORF1_files"; out="hf-raw"; os.makedirs(out, exist_ok=True)
dirs=sorted(d for d in os.listdir(src) if os.path.isdir(os.path.join(src,d)))
for i in range(0, len(dirs), 100):
    shard=dirs[i:i+100]; path=os.path.join(out,f"raw-{i//100:03d}.tar.gz")
    with tarfile.open(path,"w:gz") as tf:
        for d in shard:
            tf.add(os.path.join(src,d), arcname=d)
    print(path, len(shard))
PY
hf upload ttubiana/HEV-ORF1-models hf-raw raw --repo-type dataset \
    --commit-message "raw: AlphaFold outputs (PDB + full confidence JSON), sharded"
```

```bash
# b) mirror the directory tree (many small files — slower, but browsable per model on the Hub)
hf upload ttubiana/HEV-ORF1-models models_ORF1_files raw --repo-type dataset
```

Prefer (a): fewer objects, and `tarfile` reads them lazily (`tar -tzf raw-000.tar.gz`). Note that the
full confidence JSON is ~19 MB per model — that is what makes Tier B heavy; the viewer's
`pae/` + `plddt/` already encode the same information losslessly within ±1.5 Å.

Also worth uploading when you go Tier B: `*.cif` if you keep the AlphaFold CIF outputs, and
`metadata/model_list.csv` (the manifest flattened to a table — `provenance.json` has the summary).

---

## 8. Telling the deployed app where the data is

Four ways, highest precedence first — all already implemented:

1. `?dataBaseUrl=<root>` (also stored in `localStorage['orf1.dataBaseUrl']`) — best for testing.
2. `localStorage['orf1.dataBaseUrl'] = "<root>"` — permanent for one browser.
3. `window.__ORF1_DATA_BASE_URL = "<root>"` in `index.html` — per-deployment, no build flag.
4. `VITE_DATA_BASE_URL=<root> npm run build` — baked in at build time (what CI should do).

Then the Pages build carries **no payload** (dist stays ~1 MB, well under GitHub's limits):

```bash
VITE_DATA_BASE_URL=https://huggingface.co/datasets/ttubiana/HEV-ORF1-models/resolve/main npm run build
```

In `.github/workflows/deploy.yml` either export that env var for the build step, or keep the existing
`PAYLOAD_URL` mechanism if you later move the payload to institute storage (it downloads a tar.gz into
`dist/data/`; with HF you do not need it — just set `VITE_DATA_BASE_URL`).

Pin a reproducible snapshot by adding the revision to the URL, e.g.
`…/resolve/<sha-or-branch>/` — the Hub serves any commit/branch, so a paper can cite an immutable
data root.

### …and the app lives in a subfolder of a user site

`https://tubiana.github.io/ORF1viewer/` is a folder of the **user site repository**, which Pages
serves from the branch root. `base: './'` already makes the build path-agnostic, so nothing in §8
changes — but the deployment command is different (and `git push`ing this repository *as* that
repository would replace the whole site):

```bash
git clone git@github.com:tubiana/tubiana.github.io.git
scripts/publish_subdir.sh --site ../tubiana.github.io --subdir ORF1viewer \
    --data-url https://huggingface.co/datasets/ttubiana/HEV-ORF1-models/resolve/main --push
```

That script drops `dist/data/` (Vite copies `public/` verbatim — 999 MB otherwise), syncs only
`ORF1viewer/`, adds `.nojekyll`, and commits **only that path** (~3.6 MB). Never add
`.github/workflows/deploy.yml` to a user-site repository: `upload-pages-artifact` replaces the
entire site, not one folder. If you prefer CI instead of a local push, make a standalone
`orf1viewer` repository — the workflow then serves `https://tubiana.github.io/orf1viewer/` as a
project site.

---

## 9. Updating an existing dataset

```bash
python3 scripts/prepare_data.py --preset pages                      # rebuild payload
python3 scripts/make_hf_dataset.py --gitattributes /tmp/hev_repo/.gitattributes
cd hf-dataset && hf upload ttubiana/HEV-ORF1-models . . --repo-type dataset \
    --include "manifest.json*" --include "metadata/*" --commit-message "data: refresh manifest + CSV"
# unchanged binary files are byte-identical -> LFS dedupes them, only new/changed bytes travel
```

Remove stale models: `hf upload … --delete "pae/<id>.webp" --delete "pdb-full/<id>.pdb.gz" …`.
Never `--delete "*"` together with an upload you did not stage first.

---

## 10. Checklist for a tidy release

* [ ] `python3 scripts/prepare_data.py --preset pages` then `npm run smoke` passes locally
* [ ] `make_hf_dataset.py` prints `0 over the limit` for LUT integrity and the CSV coverage you expect
      (`AQN78288.1` is the single annotated accession without a model — documented in the card)
* [ ] `.gitattributes` uploaded **before** the payload (§3)
* [ ] all six stages of §5 done, `hf datasets info ttubiana/HEV-ORF1-models` shows the files
* [ ] dataset made **public** (§4) unless institute storage serves the payload instead
* [ ] `sha256sum -c metadata/SHA256SUMS.txt` clean after a fresh `hf download`
* [ ] Pages deployment built with `VITE_DATA_BASE_URL` → header decode badge shows `max 1.0 Å`
* [ ] `git status` clean in the code repo: no `public/data/`, `models_ORF1_files/`, `hf-dataset/`
* [ ] dataset card renders (it is generated — edit `make_hf_dataset.py:card_text`, not the Hub UI, so
      the next snapshot keeps the same content)
