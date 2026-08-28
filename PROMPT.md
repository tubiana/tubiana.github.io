# Prompt for the VS Code agent — Hepatitis E ORF1 model viewer

Work in this repo (`orf1viewer`). Read `README.md` first. Do not change the data pipeline
(`scripts/prepare_data.py`) unless asked. Keep `npm run smoke` green.

## The app

A **static** SPA (GitHub-Pages sub-path, no server, no DB) to browse, visualise and analyse
**1,178 AlphaFold2 predictions of the Hepatitis E virus ORF1 / nsp1 protein**.

- **Left**: Mol* 3D viewport + quick-action bar (bottom-left of the viewport).
- **Right**: tabs — **PAE matrix**, **pLDDT + domain table**, **original accentuated PAE figure**.
- **Bottom**: collapsible Clustal Omega **MSA** drawer (1,178 × 2,944).
- **Header**: fuzzy model search, colour/style selectors, stat badges, downloads, ⚙ molstar toggle.
- Bidirectional **PAE ⇄ 3D**: hover crosshair with Å readout, cell click → highlight pair + frame
  camera, drag box → span highlight + stats; MSA column → 3D; 3D selection → PAE.
- URL is deep-linkable: `?model=&tab=&color=&msa=&dataBaseUrl=`.

Stack: Vite + TypeScript + **React 18** + Tailwind **v4** (`@tailwindcss/vite`) + **Mol\* 5.11** +
zustand v5; PAE / MSA / pLDDT drawn with canvas 2D (no charting libraries).

## Hard constraints

- All artifact paths in the manifest are **relative to the data root** — always resolve with
  `currentDataUrl()` (`src/lib/dataSource.ts`). Data root overridable via `?dataBaseUrl=`,
  `VITE_DATA_BASE_URL`, `window.__ORF1_DATA_BASE_URL__`, `localStorage['orf1.dataBaseUrl']`.
- PAE = **lossless 8-bit single-channel image + manifest LUT** (never JSON), with per-model
  integrity points so the UI proves the decode (< 1 Å).
- **Domains come verbatim from the reviewed CSV**: no clustering, segmentation, merging or
  inference in the pipeline or the UI. `HVR` is excluded from *domain counts* only
  (`countDomains()` in `src/lib/util.ts`) — it stays coloured and annotated everywhere else.
- The 3D loads the **full-atom** model (`pdb-full/`), never the backbone reduction.
  Downloads are **decompressed** in the browser (`DecompressionStream`) so `.pdb` opens directly.
- `public/data/` (~1 GB) and `models_ORF1_files/` (25 GB raw tree) are **gitignored** — never commit.

## Commands

```bash
npm run dev -- --host --port 5173     # dev (serves public/data)
npm run build                         # tsc --noEmit && vite build
npm run smoke                         # Playwright suite over `vite preview`, 39 checks
npm run probe:molstar-ui              # headless Mol* panel/region probe (no WebGL needed)
npm run prepare:data -- --preset pages
```

**Important**: this environment typically has **no WebGL**, so actual rendering cannot be verified
here. Use `?molui=1` — it mounts the Mol* UI even without a GL context so panel/layout problems stay
debuggable — and `npm run probe:molstar-ui`, which prints the Mol* regions rendered for
`advanced = 0/1`. Ask the user for a screenshot when pixels matter.

## Debug handles (use these before guessing)

```js
__orf1.getState()                    // whole zustand store
__orf1.mol.probe()                   // atoms, units, sample {resnum, b, atom}, repr cells, theme counters
__orf1.mol.themeStats()              // per theme: calls | unassigned | distinct | lastResnum | lastPlddt
__orf1.mol.themes()                  // registered colour-theme ids
__orf1.mol.diagnostics.errors        // every failed Mol* call, newest last
__orf1.mol.setColorMode('domain'); __orf1.mol.setRepr('ballStick'); __orf1.mol.resetThemeStats()
```

Reading `themeStats()`: `calls: 0` → Mol* never consulted the theme; `unassigned === calls` → the
value lookup misses; `distinct > 1` → colouring is live. The amber **“3D:” banner** above the
quick-action bar mirrors `diagnostics.lastError`.

## Key files

`src/mol/scene.ts` (plugin lifecycle, custom themes, full-atom load, repr/colour rebuild, selection,
camera, `probeStructure`), `src/components/StructurePanel.tsx` (mount/recreate, load queue, effects),
`src/App.tsx` (60/40 split, `--split` CSS var), `src/components/Header.tsx`, `PaeMatrixTab.tsx`,
`PlddtTab.tsx`, `MsaDrawer.tsx`, `Overlays.tsx`, `ui.tsx`; `src/state/store.ts`; `src/lib/*.ts`;
`src/index.css` (the `.mol-host` / `.mol-host:not(.advanced)` chrome rules).

## Mol* 5.11 facts already paid for — do not regress

1. `hierarchy.current.structures` **are** the structure components (`.cell`, `.reprs`, never
   `.components`). Style/colour changes = **delete the repr cell and re-add it**, on cells kept from
   `createModel → createStructure → tryCreateComponentStatic('polymer'|'ion'|'ligand')`:
   `plugin.state.data.build().delete(reprCell).commit()` then
   `plugin.builders.structure.representation.addRepresentation(cell, { type, color })`.
   `managers.structure.component.updateRepresentations*` / any `s.components` lookup no-ops silently.
2. Custom colour themes must be **stateless** — read from the location: pLDDT is
   `StructureProperties.atom.B_iso_or_equiv(loc)` (AlphaFold writes it per atom; there is no
   `atom.b_factor` in 5.11), domains from `StructureProperties.residue.label_seq_id(loc)`. Use
   `granularity: 'groupInstance'`. The `prepare()` hook receives a representation *instance* with no
   `.cell` in 5.11 — caching tables there yields a permanently grey model with no error.
3. **Panels are a mount-time decision.** `plugin.layout.setProps({ showControls: true, regionState:
   { left: 'full' } })` does mutate `plugin.layout.state`, but the mounted React tree keeps rendering
   only `msp-layout-region main` (verified headless, `advanced` on: regions stay `["main"]`;
   `isExpanded: true` changes nothing either). So ⚙ molstar **recreates** the plugin with
   `layout.initial.{showControls,showLeftPanel,showSequenceView,showLog}` + `regionState`.
4. Never write `components: { remoteState: 'none' }` without spreading `DefaultPluginUISpec()
   .components` — that object also carries Mol*'s panel components.
5. `Location.element` is a **global atom index**, not unit-local: resolve residues with
   `residueAtomSegments.index[element]`.
6. `updateRepresentations(components: ReadonlyArray<…>, pivot, params)` — first arg is an **array**.
7. No `canvas3d.capture`; use `helpers.viewportScreenshot.setParams({ resolution: { name: 'custom',
   params: { width, height } }, format: { name: 'png' } })` then `.download(filename)`.
8. `.gz` payloads: some hosts send `Content-Encoding: gzip`, some don't — `fetchText()` sniffs the
   gzip magic bytes so both work.

## Status

Working (verified, some by probe): PAE decode + integrity readout, colour ramp with “mute > limit”,
zoom, symmetry masking, axis strips (flip must be applied by `geo` **or** the paint, never both),
accentuated figure, MSA parsing + column mapping, fuzzy search, deep links, 900 px layout, PDB /
full-atom / figure downloads, style switching (cartoon, backbone, ball-and-stick, licorice),
**pLDDT and domain colouring** (`orf1-plddt: calls 5073 / unassigned 0 / distinct 4`; domain colours
now come from each `DomainRange.color` in the CSV).

## Open issues — status after `d87b2d6` (all need a WebGL browser to confirm)

1. **Ball-and-stick / licorice bonds uncoloured** — *fix attempted, high confidence but unverified.*
   The colour callback receives a **bond location** for bond visuals, and the themes were guarded by
   `StructureElement.Location.is()`, so cylinders fell back to grey while atoms were coloured.
   `elementLocations()` in `src/mol/scene.ts` now expands a bond to its two atoms (pLDDT = mean,
   domain = first residue). **Verify:** `__orf1.mol.themeStats()` before/after switching to licorice —
   `calls` must roughly double (atoms + bonds) with `distinct > 1`. If `calls` does **not** increase,
   Mol* never asked our theme for bond geometry (granularity mismatch) and the remaining option is to
   give the themes a bond locator / use `granularity: 'element'`, or fall back to a built-in theme for
   those two styles.
2. **Stale “3D: style 'cartoon': no representation cell” banner** — *fixed, high confidence.* The note
   is suppressed while nothing is on screen (intent is stored in `currentRepr`/`currentColorMode` and
   applied by `showStructure`), and `noteSuccess()` clears `molDiagnostics.lastError` on the next
   success. Real failures still surface.
3. **Benchkey “Toggle Controls Panel” / scene tools missing** — *fixed, verified headless.* In 5.11 the
   scene tools live in the **right** region (`ControlsWrapper`), and our advanced spec had
   `right: 'hidden'`. Now `left: 'full', right: 'full', top: 'collapsed'` and
   `npm run probe:molstar_ui.mjs` reports regions `main/top/left/right/bottom` with
   `.msp-layout-right` containing “Structure Tools … Quick Styles …”. Note the benchkey toggles
   `layout.showControls` at runtime, which cannot reveal regions after mount (fact 3 above) — ⚙ molstar
   remains the recreate path.
4. **Mol* fullscreen/expanded painted under the header and the right panel** — *fix attempted.*
   `.viewer-advanced` now lifts the viewer box to `z-index: 60` (header is `z-30`, the right panel is a
   later sibling) and stops clipping (`overflow: visible`; radius moved to `.mol-host`) so Mol*'s
   popover/dropdown panels can escape the box. Verify: open ⚙ molstar, expand, open a Mol* dropdown
   near the box edge — nothing should be cut off or hidden.

## Ground rules

- Verify with the probes and `npm run smoke`; ask the user for screenshots when pixels decide.
- Reproducible pipeline: `prepare_data.py` stays idempotent; never commit `public/data/` or
  `models_ORF1_files/`.
- Never invent domain boundaries. CSV ranges are the truth.
- Prefer the proven Mol* patterns listed above over new API guesses.
