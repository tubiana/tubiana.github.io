# Handoff prompt — Hepatitis E ORF1 model viewer

Paste this into a new session (it is self-contained; the repo is the source of truth).

---

You are working on **`/mnt/DATASPEED/ai/orf1viewer`**, a static SPA that browses, visualises and
interactively analyses **1,178 AlphaFold2 predictions of the Hepatitis E virus ORF1 (nsp1)
protein**. Repo is a git repo (`git log` from `274e7fe`). Read `README.md` first, then the files
listed under *Architecture*.

## What the app does

Left: Mol* 3D viewport. Right: tabbed panel — **PAE matrix** (predicted aligned errors),
**pLDDT + domain table**, **original accentuated PAE figure**. Bottom: collapsible Clustal Omega
**MSA** drawer (1,178 × 2,944). Header: model search (fuzzy), colour/style controls, stat badges,
downloads. Interactions are bidirectional: PAE cell hover ↔ 3D crosshair with Å readout, cell
click → highlight residue pair + frame camera, drag box → span highlight + statistics; MSA column
→ 3D highlighting; 3D selection → PAE cross-highlight. URL is deep-linkable
(`?model=&tab=&color=&msa=&dataBaseUrl=`).

## Stack & hard constraints

- Vite + TypeScript + **React 18** + Tailwind **v4** (`@tailwindcss/vite`), **Mol\* 5.11**, zustand v5,
  canvas 2D for PAE/MSA/pLDDT (no charting libraries).
- **Static only** — must deploy to a GitHub Pages **sub-path** (`base: './'` in `vite.config.ts`).
  No server, no DB.
- `public/data/` (≈1 GB) and `models_ORF1_files/` (25 GB raw tree) are **gitignored**.
- PAE matrices are shipped as **lossless 8-bit single-channel images + a manifest LUT**, not JSON,
  with per-model integrity points so the UI can prove the decode (`<1 Å` error).
- **Domains come verbatim from the reviewed CSV.** No clustering, segmentation, merging or
  inference anywhere in the pipeline or the UI. `HVR` is *excluded from domain counts* (it is a
  hypervariable stretch) but stays coloured/annotated everywhere else.
- The 3D loads the **full-atom** PDB (`pdb-full/`), not the backbone reduction. Downloads are served
  **decompressed** (`.pdb`, not `.pdb.gz`) via `DecompressionStream`.
- Data root is configurable: `?dataBaseUrl=`, `VITE_DATA_BASE_URL`, `window.__ORF1_DATA_BASE_URL__`,
  `localStorage['orf1.dataBaseUrl']`; **all manifest paths are relative to the data root** — always
  resolve through `currentDataUrl()` (`src/lib/dataSource.ts`).

## Commands

```bash
npm run dev -- --host --port 5173      # dev server (serves public/data)
npm run build                          # tsc --noEmit && vite build
npm run smoke                          # Playwright suite over `vite preview` (39 checks)
npm run probe:molstar-ui               # headless Mol* panel check, no WebGL needed
npm run prepare:data -- --preset pages # regenerate the payload from models_ORF1_files/
```

Payload layout: `public/data/{manifest.json[.gz], msa.aln.gz, pae/<id>.webp, pdb-full/<id>.pdb.gz,
pdb-bb/<id>.pdb.gz, plddt/<id>.bin.gz, paeimg/<id>.webp}`.

**This sandbox has no WebGL at all** (every Chromium/Chrome × flag combination fails to create a GL
context), so the rendering itself cannot be verified here — only the DOM/TS/behaviour. Use
`?molui=1` to mount Mol\*'s UI without GL for panel/layout debugging.

## Architecture

| File | Role |
|---|---|
| `scripts/prepare_data.py` | 25 GB tree → compact payload; presets `lean/pages/hifi/archive`, `--budget`, `--selfcheck` |
| `src/lib/{types,dataSource,colormap,pae,paeService,search,msa,rpcWorker,util}.ts` | data layer, LUT decode, fuzzy search, Clustal parser, RPC workers, `gunzip*`, `countDomains` |
| `src/workers/{pae,msa}.worker.ts` | Vite `?worker` RPC workers |
| `src/state/store.ts` | zustand store: model/tab/colour/repr/selection/hover/zoom window/MSA/`molstarAdvanced` |
| `src/mol/scene.ts` | Mol\* lifecycle, custom colour themes, full-atom load, repr/style rebuild, selection, camera, `probeStructure()` |
| `src/components/*.tsx` | `ModelSearch`, `Header`, `StructurePanel`, `PaeMatrixTab`, `PlddtTab`, `AnalysisTabs`, `MsaDrawer`, `Overlays`, `ui` |
| `scripts/smoke_test.mjs` | WebGL-adaptive Playwright suite; screenshots → `smoke-artifacts/` |

## Debug handles (use these before guessing)

```js
__orf1.getState()                 // whole store
__orf1.mol.probe()                // live scene: atoms, units, {resnum, b, atom} samples, repr cells, theme counters
__orf1.mol.themeStats()           // per theme: calls, unassigned, distinct, lastResnum, lastPlddt
__orf1.mol.themes()               // registered colour theme ids
__orf1.mol.setColorMode('plddt')  // or setRepr('ballStick'), resetThemeStats(), diagnostics.errors
```

Interpretation: `calls: 0` → Mol\* never consulted the theme; `unassigned === calls` → the value
lookup misses; `distinct > 1` → colouring is live.

## Mol\* 5.11 gotchas already paid for (do not regress)

1. **`hierarchy.current.structures` ARE the structure components** — they have `.cell`/`.reprs`,
   never `.components`. Style/colour changes must **delete the representation cell and re-add it**
   (`state.data.build().delete(reprCell).commit()` then
   `builders.structure.representation.addRepresentation(cell, { type, color })`), keeping the
   component cells from `createModel → createStructure → tryCreateComponentStatic('polymer'|'ion'|'ligand')`.
   `managers.structure.component.updateRepresentations*` and any `s.components` lookup silently do nothing.
2. **Custom colour themes must be stateless** — read from the location: pLDDT is
   `StructureProperties.atom.B_iso_or_equiv(loc)` (AlphaFold writes it per atom; note the property
   name, there is no `atom.b_factor`), domains from
   `StructureProperties.residue.label_seq_id(loc)`. The `prepare()` hook receives a representation
   *instance* with no `.cell` in 5.11, so table caching there silently yields grey.
   Use `granularity: 'groupInstance'`.
3. **Panels are a mount-time decision.** `plugin.layout.setProps({ showControls: true, regionState:
   { left: 'full' } })` mutates state but the mounted tree keeps rendering only the `main` region;
   Mol\*'s own expand icon does nothing. Configure `layout.initial.*` in the spec and **recreate** the
   plugin (that is what ⚙ molstar does). Also: never write `components: { remoteState: 'none' }`
   without spreading `DefaultPluginUISpec().components` — it wipes the panel components.
4. `Location.element` is a **global atom index**, not a unit-element index: resolve residues via
   `residueAtomSegments.index[element]`.
5. `updateRepresentations(components: ReadonlyArray<…>, pivot, params)` takes an **array** first.
6. No `canvas3d.capture` in 5.11 — screenshots go through
   `helpers.viewportScreenshot.setParams({ resolution: { name: 'custom', params: { w, h } }, format: { name: 'png' } })`
   + `.download(filename)`.
7. `.gz` artifacts: some hosts send `Content-Encoding: gzip`, some don't — `fetchText` sniffs the
   gzip magic so both work.

## Status — verified working

PAE decode + integrity readout, colour ramp with `> limit` muting, zoom, symmetry masking, axis
strips (flip bug fixed: the flip must be applied by `geo` **or** the paint, never both), accentuated
figure tab, MSA parsing/column mapping, search, deep links, layout at 900 px, full-atom and
backbone downloads, style switching (cartoon / backbone / ball-and-stick / licorice), pLDDT colouring
(probe: `orf1-plddt {calls: 5073, unassigned: 0, distinct: 4}`).

## Open work — please verify in a WebGL browser

1. **Domain colouring.** Root cause was found and fixed (`a4f3315`): the theme read an empty palette
   (`setDomainPalette` was never called → `probe().themeData.palette === 0`, `unassigned === calls`).
   Colours now come from each `DomainRange.color` (the CSV carries them) with a per-name fallback.
   Confirm in `pLDDT/Domains`: six coloured regions + grey linkers, and
   `__orf1.mol.themeStats()['orf1-domain'].distinct > 1`.
2. **⚙ molstar panel.** Now recreates the scene with the full UI; headless probe shows regions
   `main, top, left, right, bottom`. Check on screen: Mol\*'s left panel sits **inside the viewer
   column**, does not overlap our header/toolbar, the canvas re-fits after the panels open
   (`setUiAdvanced` dispatches `resize` at 0/250/900 ms), and toggling back restores the clean view.
   If Mol\*'s panel crushes the viewport, widen the split while advanced mode is on
   (`--split` CSS var in `src/App.tsx`).
3. Reload/robustness: toggling ⚙ reloads the structure (by design) — make sure the current
   selection/highlight is re-applied afterwards (`StructurePanel` re-applies after each load).
4. Optional: keyboard shortcut for ⚙, persist `paeWindow` in the URL, `--hf-export` mode in
   `prepare_data.py` for a Hugging Face dataset release (canonical `pdb.gz` + `scores.json.gz`
   per model, viewer payload as a separate archive, `SHA256SUMS`, `provenance.json`).

## Style requests

Keep the payload reproducible (`prepare_data.py` must stay idempotent), keep `npm run smoke` green,
never commit `public/data/` or `models_ORF1_files/`, and never invent domain annotations.
