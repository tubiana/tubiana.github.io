# Hepatitis E ORF1 model viewer

A dependency-light, fully static single-page app for browsing, visualising and
interactively cross-referencing **1,178 AlphaFold2 predictions of the HEV ORF1
polyprotein** — 3D structure, predicted-aligned-error (PAE) matrices,
pLDDT profiles, curated domain limits and a 1,178 × 2,944 Clustal/MAFFT
alignment. There is no backend: the whole thing is static files and can be
served by GitHub Pages, an S3 bucket, `python3 -m http.server`, or opened from
any machine that has the payload.

## Updating the GitHub Pages app

This source folder and the published app are deliberately kept together:

```text
ORF1viewer/
  index.html, assets/    # deployed at https://tubiana.github.io/ORF1viewer/
  source/                # this maintainable React/Vite project
```

From this `source` directory, install dependencies once and use:

```bash
npm ci
npm run dev          # local development server
npm run build:site   # type-check, build, and replace only ../index.html + ../assets
npm run deploy       # the same, then `git add` the result (stages only — never commits)
npm run smoke        # test the most recent build
```

`build:site` never copies the large local `public/data` directory: the public
viewer loads its model data from Hugging Face by default. Commit the updated
`ORF1viewer/` directory to publish the new version. To work with a different
payload temporarily, use the settings dialog or `?dataBaseUrl=...`.

### Why the built files are named `index-y_MTWPsM.js`

That suffix is a **content hash**, added by Vite/Rollup, and it is the standard
way to ship a web app. A browser (and GitHub's CDN) caches a script under its URL:
with a fixed name like `index.js`, a visitor who still holds yesterday's copy would
load it next to a new `index.html` — the classic half-updated app that breaks in ways
that only ever happen to other people. With the hash in the name the URL changes
exactly when the bytes change, so old and new builds can never mix, and the scripts
can be cached hard. `index.html` itself is rewritten by the build, so a name is never
maintained by hand.

The consequence for git is that each build *renames* the assets. `scripts/sync-site.mjs`
deletes the previous copy first, so nothing stale is left behind, and one command stages
the whole set of renames — plain `git add <file>` is what makes it feel tedious:

```bash
npm run deploy                       # build + sync + git add ..
#  or, after a manual build:  git add -A ORF1viewer   (or git commit -aR after sync)
```

If you would rather have plain `assets/index.js` names, `STABLE_ASSET_NAMES=1 npm run build:site`
does that (see `vite.config.ts`) — at the price of visitors possibly running a cached bundle
for a while. Keeping the hash is the recommendation.

```bash
npm run dev                                     # http://localhost:5173 (reads the Hugging Face payload)
npm run update:data -- configuration_update_dataset.json   # rebuild + republish the dataset
npm run build && npm run smoke                  # production build + headless smoke test
```

---

## Why it exists

AlphaFold ships, per model, a `*_unrelaxed_*_model_X_seed_000.pdb`, a
`*_scores_*.json` (which contains the full PAE matrix) and an
`accentuated_pae.svg/png`. Nobody can eyeball 1,178 of those, and the naive
web representation is hopeless: one PAE matrix for a 1,691-residue ORF1 is
2.9 M floats ≈ 12 MB as JSON, **15 GB** for the set.

`scripts/update_dataset.py` repacks the corpus into static files that keep every pixel of
information the browser needs, and nothing it does not. Per 1691-residue model:

| artifact | what it is | ≈ size |
| --- | --- | --- |
| `pae/<id>.webp` | 8-bit single-channel **lossless** image, pixel = index into a quantisation LUT (Å) — 1691² floats → **0.85 MB** at `hifi` | 0.85 MB |
| `pdb-full/<id>.pdb.gz` | the full-atom model: what the viewport renders *and* what **↓ PDB** downloads | 0.2 MB |
| `paeimg/<id>.webp` | accentuated-PAE figure, re-encoded from the pipeline PNG | 45 KB |
| `plddt/<id>.bin.gz` | one byte per residue | 1.3 KB |
| `manifest.json(.gz)` | catalogue: lengths, scores, hosts, domains, paths, integrity checkpoints, LUT, palette | ~0.4 MB |
| the alignment | gzip, Clustal or FASTA, kept under the name given in the config | ~0.4 MB |
| `metadata/` | annotation CSV, cluster table, host tree, sequence library, this script, `provenance.json` | ~2 MB |

There is no backbone-only reduction any more: one PDB per model, full atoms, used for both
the viewport and the download.

**Domains are never computed.** The ranges used everywhere (3D colouring, the axis
strips, the dotted boundary guides, the pLDDT table, the domain × domain PAE table) are
the `border_*` columns of the curated annotation CSV, verbatim, sorted by
start position — there is no segmentation, merging or clustering step anywhere in the
pipeline (checked: 0 mismatches against the CSV over 120 randomly sampled models).
Accessions missing from the CSV get no domains, and nothing is invented for them. See
[Keeping the annotations current](#keeping-the-annotations-current) for which CSV is used
and how a new one reaches the browser.
`HVR` is a hypervariable stretch rather than a domain, so it is excluded from the
**domains** count (it stays annotated and coloured everywhere else).

Quantisation error is bounded and *stated*: the table is chosen by `PAEresolution` in the
config (currently `hifi` → **≤0.25 Å**), and its name, worst error and values travel in the
manifest. And because silent drift is the real risk in a pipeline like this, every model
carries 24 random `(i, j, Å)` **checkpoints**: after decoding, the browser re-checks them and
shows `decode ok` — or a red mismatch badge with the worst error. `update_dataset.py
--selfcheck N` runs the same verification in Python (decodes the built image with Pillow and
compares against the JSON scores).

## Data pipeline

```
<modelfolder>/
  <ACCESSION-host-len>/predictions/
      <MODEL>_unrelaxed_rank_001_…_model_N_seed_000.pdb      ← full atoms
      <MODEL>_scores_…_model_N_seed_000.json                 ← the PAE matrix lives here
      accentuated_pae.png
<dataset csv>   border_<Domain> columns, plus genbank / host / annotation metadata
<alignment>     Clustal .aln (MAFFT “CLUSTAL format”) or gapped .fasta — sniffed at load
```

### Keeping the annotations current

The curated annotation CSV is the source of truth for domains and per-model metadata, and
it is also read **by the running app** (`src/lib/annotations.ts`): the catalogue is patched
with it at load time, in parallel with fetching `manifest.json`. So refreshing the
annotations is *upload the CSV to the dataset, reload the page* — no payload regeneration,
no rebuild, and the 3D colouring, the per-domain MSA colouring, the domain tables and the
search-bar summary all follow. Nothing blocks on it either: if the table is missing,
unreachable or unreadable the manifest's own annotations are used, and the footer says
which of the two is in effect (`annotation table 1176/1178 (…)`).

| | |
| --- | --- |
| table in use | `metadata/dataset_ORF1s_1178_reviewed_renumbered.csv` (`ANNOTATIONS_CSV`) |
| point elsewhere for one page load | `?annotations=metadata/other.csv`, or a full `https://…` URL |
| format | `;`- or `,`-delimited, header row 1, CRLF/UTF-8-BOM tolerant, `"quoted; fields"` honoured, `border_<Domain>` = `(start-end)`, accession column `genbank`/`uniprot`/`accession`/`id` |
| new domain column | appears with the manifest palette colour, grey (`#8b93a7`) if the palette does not know it |
| accession with no row | keeps the manifest annotation — a partly updated table is never a regression |
| when the payload *is* regenerated | the CSV is whatever `dataset` says in the config — an explicit path, no name guessing. A renamed CSV reaches the browser when the config says so (the app reads `ANNOTATIONS_CSV` from `metadata/`; `?annotations=` overrides it for one page load) |

**Rename nothing if you can help it.** What the viewer *displays* — host, organism, strain,
isolate, domains — comes from this CSV, so a naming fix is a CSV edit. What the CSV cannot
change is the **file map**: the model id and the artifact paths (`pdb-full/<id>.pdb.gz`, …) live
only in `manifest.json`, and a file renamed on the server behind its back shows up as
`Structure: 404`. Treat the stem (`AAA45730.1-human-1691`) as an immutable identifier, not as
label text.

If files *were* renamed, `scripts/repair_manifest_names.py` re-derives the manifest from the
files that actually exist (it matches them by accession, which is unique across the corpus) and
reports anything it cannot resolve:

```bash
python3 scripts/repair_manifest_names.py                       # dry run: what is broken / renamed
python3 scripts/repair_manifest_names.py --write --out /tmp/man
hf upload ttubiana/HEV-ORF1-models /tmp/man/manifest.json    --repo-type dataset
hf upload ttubiana/HEV-ORF1-models /tmp/man/manifest.json.gz --repo-type dataset
```

Upload **both** copies: the app tries `manifest.json.gz` first, so a repaired `manifest.json`
alone changes nothing, and the script warns when the two disagree. Then clear the browser cache —
the manifest is fetched with the cacheable `force-cache` policy like every other artifact.

Only rank-1 predictions are read (`*_unrelaxed_rank_001_*.pdb` of the lowest
seed, plus its scores JSON, plus `accentuated_pae.png`); the folder name is
`{genbank}-{host}-{length}` — id, host and length separately, host never parsed
from an accession. Anything missing degrades to `null` in the manifest or is
reported as a folder problem, never a crash.

```bash
python3 scripts/update_dataset.py /path/to/configuration_update_dataset.json
```

The config file is the whole interface — source folder, annotation CSV, alignment,
clusters, host tree, output folder, `huggingface_dataset`, `PAEresolution`, workers:

```json
{
  "modelfolder": "…/modelling/orf1s",          // one subfolder per prediction
  "dataset":   "…/dataset_ORF1s_1178_reviewed.csv",
  "ORF1_MSA":  "…/merged_alignment.fasta",     // .aln (Clustal) or .fasta — sniffed
  "clusters":  "…/ICTV_ORF1s_clusters.csv",
  "tree":      "…/ICTV_hepeviridae.tree",
  "outputfolder": "…/hf-stage",                 // created if absent; == modelfolder is refused
  "huggingface_dataset": "ttubiana/HEV-ORF1-models",
  "PAEresolution": "hifi",                      // lean 2.0 Å | balanced 1.5 | hifi 0.25 | maxi 0.1
  "maxWorkers": 8, "imageFormat": "webp", "checkpoints": 24
}
```

| flag | what it does |
| --- | --- |
| *(nothing)* | build what is stale, upload what changed, report leftovers |
| `--dry-run` | discovery + decisions, nothing written |
| `--skip-models` | refresh CSV / alignment / tree / clusters / manifest only — model folders are never read or written |
| `--only 'X*,Y*'` | rebuild a subset and re-publish them, **keeping** the rest of the catalogue |
| `--force` | rebuild even when the artifacts look current |
| `--limit N` | first N pending models (a smoke run, not a release) |
| `--no-upload` / `--no-git` | stage locally / skip the optional git mirror of `outputfolder` |
| `--prune` | delete the reported leftovers from the hub (default: report only) |
| `--selfcheck N` | after building, decode N artifacts and diff against the JSON scores |

Nothing is rebuilt or uploaded that is already current — a model counts as current when its
artifacts are newer than the scores JSON *and* were written with the configured LUT/codec
(re-recorded in `provenance.json`). A renamed or deleted model folder leaves the catalogue on
the next run and its files appear in the leftovers report; `--prune` deletes them.
The upload itself is a delta: artifacts are SHA256-compared against a ledger
(`metadata/SHA256SUMS.txt`), only changed files are sent, and the ledger is written *after* a
successful upload. `--only`/`--skip-models` never shrink the catalogue (they fall back to the
published manifest when nothing is staged).

## Frontend

Vite + TypeScript + React 18 + Tailwind v4, Mol\* for 3D, everything else
hand-rolled on `<canvas>` (a 1700² matrix and a 1,178 × 2,944 alignment do not
belong in the DOM).

```
src/lib/      types, util, dataSource (endpoint resolution + LRU caches),
              colormap, pae (decode/verify/colour/stats), msa (parse + mapping),
              search (fuzzy), paeService + rpcWorker (worker RPC w/ fallback)
src/workers/  pae.worker.ts, msa.worker.ts
src/state/    store.ts — zustand: catalogue, artifacts, view options, selection
src/mol/      scene.ts — plugin lifecycle, custom themes, highlight, camera
src/components/ Header · ModelSearch · StructurePanel · AnalysisTabs ·
               PaeMatrixTab · PlddtTab · MsaDrawer · Overlays · ui
```

Data flow: UI → `store` → `currentDataUrl(path)` → worker → index buffer →
`colorize` → `ImageData` → canvas. Heavy work (WebP decode, 2.9 M-cell
recolouring, alignment parsing) runs in module workers with an automatic
main-thread fallback if the worker cannot start; the recolour is debounced so
dragging the scale slider stays smooth.

**Bidirectional PAE ⇄ 3D**
* hover → crosshair + both residue numbers + `PAE(i,j)` *and* `PAE(j,i)` (the
  raw matrix is asymmetric) + both residues highlighted in 3D;
* click a cell → pair selection, a distance line through the cartoon, camera
  frames the pair;
* drag a box → row-span × column-span selection, with mean PAE, fraction
  <5 Å / <12 Å and the pair count in the footer, plus *zoom sel*;
* *domain×domain PAE* copies the 6×6 mean-PAE matrix as TSV for external use.

**MSA drawer ⇄ 3D** (`M`)
* hover a column → that residue of the selected model is highlighted in 3D, the toolbar
  chip shows `col / res / aa / domain`, click selects it (column ↔ residue goes through the
  same mapping the 3D highlight uses, so indels in the alignment cannot shift it);
* *model seq on top* pins the loaded model's own row under the ruler while the rest scrolls;
* *per domain* colours every column by the domain of the model residue in it — the CSV
  annotation and the palette of the 3D / PASTRIPO bars.

**Robustness:** every artifact load is independent (a missing pLDDT never blanks
the 3D view), paths in the manifest are always resolved against the data root,
colours fall back to Mol\* built-ins if a custom theme misbehaves, and without
WebGL2 the viewport says so while the PAE / pLDDT / MSA panels keep working.

**URL state.** The address bar is kept in sync (`?model=…&tab=pae|plddt|accent&color=…&msa=1`,
plus the zoom window in the store) via `history.replaceState`, so ⧉ *link* copies a
shareable permalink and any of those URLs can be pasted cold. `?dataBaseUrl=` is honoured
on load and never overwritten.

## ⚙ molstar (full Mol* UI)

Mol* 5.11 lets you *write* `plugin.layout.setProps({ showControls: true })` and
the state does change, but the mounted React tree keeps rendering only the
`main` region — `.msp-layout-left` never appears (verified headless; Mol*'s own
expand button does nothing either). The panels are therefore configured **at
mount time**: ⚙ molstar tears down the plugin and rebuilds it with
`layout.initial.showControls` + `regionState` + the default `components` (a spec
that sets `components: { remoteState: 'none' }` outright wipes Mol*'s panel
components — spread the defaults). The model reloads, which is also why the
toggle looks like a blink.

Only the **right** region (Structure Tools: representation/colour, components,
scene tree) is ever shown — `left` (Home/State) and `top` (sequence view) are
kept hidden. `regionState` alone isn't enough, though: Mol*'s default
`controlsDisplay: 'outside'` renders every region *outside* the plugin's own
box (negative offsets, meant for a Mol* that owns the whole page), which is why
the sequence view used to sit on top of this app's header and the right panel
used to render below the viewport, over the MSA drawer. `controlsDisplay:
'landscape'` keeps every region inside the box instead, which is what makes the
Structure Tools panel dock properly on the right of the viewport.

`npm run probe:molstar-ui` re-runs the headless check (`?molui=1` mounts the Mol*
UI even without WebGL — the panels are plain DOM) and prints the rendered regions
per setting.

## Debugging the 3D

`__orf1` is exposed in the console: `getState()` (whole store) and `mol.*` —
`probe()` (what Mol* parsed: residue numbers, B-factors, representation cells,
theme call counters), `themes()`, `themeStats()`, `setColorMode('plddt')`,
`setRepr('ballStick')`, `diagnostics.errors`. The 3D path cannot run without
WebGL, so this is how colouring/style problems get diagnosed: `themeStats()`
tells you whether Mol* consulted a theme at all (`calls`), whether the lookup
hit (`unassigned`, `distinct`), and which residue number / pLDDT it read.

## Downloads & the advanced Mol\* view

* **↓ PDB** — the full-atom model of the current entry, decompressed in the browser
  (`DecompressionStream`) so it opens straight in PyMOL / Coot / Mol\*. It is the very file
  the viewport renders — the payload ships one PDB per model.
* **↗ Open genbank protein / ↗ Open genbank nuccore** — NCBI record of the entry's
  `genbank` protein accession (`…/protein/<id>`) or its `genbank_nucl` nucleotide
  accession (`…/nuccore/<id>`), in a new tab; each button shows only when that
  identifier exists in the annotation CSV.
* **◍ PNG** (PAE and pLDDT tabs) — composites the canvas layers (matrix + domain strips +
  guides, or the confidence plot) into a single image; **◍ png** in the viewport saves the
  3D scene through Mol\*'s screenshot helper.
* **⚙ molstar** (floating bar under the viewport buttons) — reveals Mol\*'s own interface:
  scene tree, styles &amp; properties, settings, sequence viewer, timeline. The simple view
  hides all of it behind this app's controls; the choice persists in
  `localStorage['orf1.molstarAdvanced']`.

## Data source resolution

Same-origin `./data/` by default, overridable (first match wins):

1. `?dataBaseUrl=https://…/data/`
2. `window.__ORF1_DATA_BASE_URL__` in `index.html`
3. `VITE_DATA_BASE_URL` at build time
4. `data/base-url.txt` pointer file (optional; write it by hand if you want a data host that
   survives a rebuild)
5. `localStorage['orf1.dataBaseUrl']`, set from the ⚙ dialog (which also offers
   *copy diagnostics* — resolved URLs, phases, integrity result, cache state)

The root must be CORS-enabled when it is a different origin.

## Serving the payload

`public/data/` is generated and **git-ignored** — 1.03 GB does not belong in
git. Realistic deployments:

* **App + data on GitHub Pages** — build the payload locally, then
  `npm run deploy:gh-pages` (pushes `dist/`, payload included, to `gh-pages`).
  Works, but you are now ~1 GB in a Pages site and every byte counts against
  the 100 GB/month soft bandwidth cap; force-push keeps the branch small.
* **App on Pages, payload on Hugging Face (this deployment)** — code lives on
  GitHub, the ~1 GB payload lives in the dataset
  [`ttubiana/HEV-ORF1-models`](https://huggingface.co/datasets/ttubiana/HEV-ORF1-models)
  whose **repo root is this app's data root**. Build the site with
  `VITE_DATA_BASE_URL=https://huggingface.co/datasets/ttubiana/HEV-ORF1-models/resolve/main`
  (or override at runtime with `?dataBaseUrl=` / the ⚙ dialog). `dist/` stays ~1 MB.
  `scripts/update_dataset.py` stages into `outputfolder` and uploads the delta itself; the
  first upload into a brand-new repo still needs its LFS patterns set up once — see
  **[`REPORT-hf-upload.md`](REPORT-hf-upload.md)** for that, for the checksum / provenance
  verification, and for the two-script workflow this replaced.
  *Status: uploaded 2026-08-29 — 5 899 files / 1.02 GB, public, `smoke --data-url`
  green (39/39).*
  Bandwidth-constrained host? Set `"PAEresolution": "lean"` (2.0 Å) in the config and
  rebuild — the manifest always states the table that is actually on disk.
* **Payload on Zenodo / R2 / S3 / a lab server** — same layout, same data-root
  contract; only the URL changes (`VITE_DATA_BASE_URL`, `?dataBaseUrl=`,
  `window.__ORF1_DATA_BASE_URL__`, `localStorage['orf1.dataBaseUrl']`).
* **Local / offline** — `python3 -m http.server` next to `dist/`, or
  `npm run preview`. Nothing leaves the browser.

> **Data never goes into git.** `.gitignore` excludes `public/data/`,
> `models_ORF1_files/`, `hf-dataset/` and `stages/`, so the same working tree can
> be pushed to GitHub and staged for Hugging Face without accidents.

### Publishing into a **subfolder** of an existing Pages site

The app is already a subfolder of the user site. Run `npm run build:site` in
this directory and commit the resulting `ORF1viewer/` changes; the command
updates only the generated `index.html` and `assets/` files next to `source/`.
Vite's `base: './'` keeps asset URLs relative, so the viewer remains portable.

## Testing

```bash
npm run typecheck
npm run build && npm run smoke          # serves dist/, drives Chromium
npm run smoke -- --url http://localhost:5177 --headed
python3 scripts/update_dataset.py <config>.json --selfcheck 10

# run every check against the Hugging Face payload instead of public/data/
npm run smoke -- --data-url https://huggingface.co/datasets/ttubiana/HEV-ORF1-models/resolve/main
```

`scripts/smoke_test.mjs` boots the built app and asserts the interactions that
matter: manifest + first-model artifacts, per-model integrity checkpoints
(Δ = 0 required), pixel→residue mapping of the PAE matrix (corner and axis
orientation checks — it is what caught a normalised-vs-index bug), pair and
region selections, tab switching, figure decoding, MSA parsing plus
alignment-vs-structure consistency (< 2 % mismatch), model switching,
`?model=&tab=&color=` deep links, and a 900 px layout with no horizontal
overflow. It fails on uncaught page/console errors, and reports WebGL-dependent
checks as skipped when the test browser has no GL (the CI sandbox case).
Screenshots land in `smoke-artifacts/`.

With `--data-url` the same 39 checks run with **every payload fetch pointed at a
remote data root** — the Hugging Face dataset currently passes it end to end
(manifest, PAE image + LUT decode at Δ 0, full-atom PDB, MSA, Mol* viewport).

## Notes & acknowledgements

* PAE is deliberately *not* rendered with Mol\*'s native PAE theme: it keeps a
  full `Float32Array` per structure and re-derives unit-local index arrays, which
  is memory-hungry and awkward to drive programmatically. The canvas renderer
  costs ~3 MB per matrix, recolours in ~35 ms and exposes the indices directly —
  which is what enables the hover read-out, the two-axis box selection and the
  exact integrity check. Structures still load through Mol\*'s own PDB parser
  (`parseTrajectory('pdb')` + `applyPreset('default')`), so the cartoon, unit
  bookkeeping and camera APIs are all standard.
* Colour maps follow the AlphaFold figures (`accent` blue → violet → red for
  confident → undefined, plus viridis/turbo/grey and the 5/12/20 Å band mode);
  pLDDT bands are the conventional >90 / 70–90 / 50–70 / <50.
* Data: AlphaFold2 prediction pipeline outputs for hepevirus ORF1,
  curated ORF1 domain table, MAFFT alignment of the same set.
* 3D: [Mol\*](https://molstar.org) (web viewer), structure parsing via
  `mol-io/eds/pdb`; concepts for the accentuated PAE figure from
  `af_analysis`/AlphaFold DB.
