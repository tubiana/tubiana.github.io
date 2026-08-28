# Hepatitis E ORF1 model viewer

A dependency-light, fully static single-page app for browsing, visualising and
interactively cross-referencing **1,178 AlphaFold2 predictions of the HEV ORF1
polyprotein (nsp1)** — 3D structure, predicted-aligned-error (PAE) matrices,
pLDDT profiles, curated domain limits and a 1,178 × 2,944 Clustal/MAFFT
alignment. There is no backend: the whole thing is static files and can be
served by GitHub Pages, an S3 bucket, `python3 -m http.server`, or opened from
any machine that has the payload.

```bash
python3 scripts/prepare_data.py --selfcheck 5   # build public/data  (~1 min, 24 workers)
npm run dev                                     # http://localhost:5173
npm run build && npm run smoke                  # production build + headless smoke test
```

---

## Why it exists

AlphaFold ships, per model, a `*_unrelaxed_*_model_X_seed_000.pdb`, a
`*_scores_*.json` (which contains the full PAE matrix) and an
`accentuated_pae.svg/png`. Nobody can eyeball 1,178 of those, and the naive
web representation is hopeless: one PAE matrix for a 1,691-residue ORF1 is
2.9 M floats ≈ 12 MB as JSON, **15 GB** for the set.

`scripts/prepare_data.py` repacks the corpus into **1.03 GB** of static files
without losing the information that matters for visual inspection:

| artifact | what it is | size |
| --- | --- | --- |
| `pae/<id>.webp` | 8-bit single-channel **lossless** image, pixel = index into a quantisation LUT (Å) — 1700² floats → **490 KB** | 591 MB |
| `pdb-full/<id>.pdb.gz` | full-atom model, as the pipeline produced it (what **↓ PDB** downloads) | 256 MB |
| `pdb-bb/<id>.pdb.gz` | backbone-only atoms (N, CA, C, O, OXT) — what the viewport renders | 140 MB |
| `paeimg/<id>.webp` | accentuated-PAE figure, re-encoded from the pipeline output | 40 MB |
| `plddt/<id>.bin.gz` | one byte per residue | 1.5 MB |
| `manifest.json.gz` | catalogue: lengths, scores, domains, paths, integrity checkpoints, LUT | 0.43 MB |
| `msa.aln.gz` | the alignment | 0.35 MB |

**Domains are never computed.** The ranges used everywhere (3D colouring, the axis
strips, the dotted boundary guides, the pLDDT table, the domain × domain PAE table) are
the `border_*` columns of `dataset_ORF1s_1178_reviewed_111724.csv`, verbatim, sorted by
start position — there is no segmentation, merging or clustering step anywhere in the
pipeline (checked: 0 mismatches against the CSV over 120 randomly sampled models).
Accessions missing from the CSV get no domains, and nothing is invented for them.
`HVR` is a hypervariable stretch rather than a domain, so it is excluded from the
**domains** count (it stays annotated and coloured everywhere else).

Quantisation error is bounded and *stated*: the `balanced` LUT used by the
default `pages` preset is exact to **≤1.5 Å** (0.5 Å steps to 8 Å, 1 Å to
16 Å, 2 Å above). And because silent drift is the real risk in a pipeline like
this, every model carries 24 random `(i, j, Å)` **checkpoints**: after decoding,
the browser re-checks them and shows `decode ok` — or a red mismatch badge with
the worst error. `prepare_data.py --selfcheck N` runs the same verification in
Python (decodes the built image and compares against the JSON scores).

## Data pipeline

```
models_ORF1_files/
  <MODEL>/predictions/<MODEL>_unrelaxed_rank_001_…_model_N_seed_000.pdb
  <MODEL>/predictions/<MODEL>_scores_…_model_N_seed_000.json
  <MODEL>/predictions/accentuated_pae.png
  *.csv    (semicolon-delimited domain table: border_MetY, FABD-like, HVR, domX, Hel, RdRp)
  *.aln    (MAFFT “CLUSTAL format” alignment, names truncated to 10 chars)
```

Filenames are dynamic (rank, model number and seed differ per entry), so they
are discovered at runtime: rank-1 wins, otherwise the first file in
numeric-sort order; the scores JSON is taken from the same seed as the chosen
PDB. Anything missing degrades to `null` in the manifest instead of crashing.

```bash
python3 scripts/prepare_data.py --dry-run              # discovery + size estimate
python3 scripts/prepare_data.py --limit 40 --selfcheck 8
python3 scripts/prepare_data.py --preset lean --budget 900MB
python3 scripts/prepare_data.py --preset archive --base-url https://…/data
```

| preset | LUT (max error) | preview | pdb | scores | ≈ payload |
| --- | --- | --- | --- | --- | --- |
| `lean` | `lean` (2.0 Å) | 900 px | backbone | – | ~0.45 GB |
| `pages` *(default)* | `balanced` (1.5 Å) | 1100 px | backbone + full-atom | – | ~1.03 GB |
| `hifi` | `hifi` (0.25 Å) | 1400 px | backbone + full-atom | – | ~1.1 GB |
| `archive` | `hifi` (0.25 Å) | 1600 px | backbone + full-atom | ✔ | ~1.4 GB → Zenodo/HF |

Individual knobs: `--lut`, `--codec {png,webp}`, `--img-px`, `--img-q`,
`--pdb bb|full|bb,full`, `--scores-json`, `--checkpoints N`, `--only glob`,
`--workers N`, `--force`. `--budget 900MB` walks a degradation ladder
(lossless codec → smaller previews → drop full-atom PDB → coarser LUT) until
the estimate fits, so the *stated* fidelity always matches the bits on disk.
Artifacts already present are skipped (idempotent, cheap reruns); the manifest
is rewritten every time.

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
`layout.initial.showControls / showLeftPanel / showSequenceView / showLog` + the
default `components` (a spec that sets `components: { remoteState: 'none' }`
outright wipes Mol*'s panel components — spread the defaults). The model reloads,
which is also why the toggle looks like a blink.

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
  (`DecompressionStream`) so it opens straight in PyMOL / Coot / Mol\*; **↓ bb** is the
  backbone file the viewport loads. A payload packed with `--pdb bb` only makes **↓ PDB**
  fall back to the backbone file and say so in its tooltip.
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
4. `data/base-url.txt` pointer written by `prepare_data.py --base-url …`
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
* **App on Pages, payload elsewhere (recommended)** — keep the site to a few MB
  and serve the payload from Zenodo (concept DOI, per-version files), a
  Hugging Face dataset/repo (`…/resolve/main/…`), R2/S3 or a lab server; point
  the app at it with `--base-url` (baked in) or `?dataBaseUrl=` / the ⚙ dialog.
  Use `--preset lean` for bandwidth-constrained hosts, `--preset archive` for
  the archival deposit (full-atom PDB + scores JSON included).
* **Local / offline** — `python3 -m http.server` next to `dist/`, or
  `npm run preview`. Nothing leaves the browser.

The CI workflow (`.github/workflows/deploy.yml`) deploys the app and, if the
repository variable `PAYLOAD_URL` points at a `.tar.gz` of `public/data`,
restores it into the build first.

## Testing

```bash
npm run typecheck
npm run build && npm run smoke          # serves dist/, drives Chromium
npm run smoke -- --url http://localhost:5177 --headed
python3 scripts/prepare_data.py --selfcheck 10
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
* Data: AlphaFold2 prediction pipeline outputs for hepevirus ORF1 (nsp1),
  curated ORF1 domain table, MAFFT alignment of the same set.
* 3D: [Mol\*](https://molstar.org) (web viewer), structure parsing via
  `mol-io/eds/pdb`; concepts for the accentuated PAE figure from
  `af_analysis`/AlphaFold DB.
