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

## Open issues — in this order

### 1. Ball-and-stick / licorice: bonds are not coloured

Only the atoms (spheres/sticks) take the theme colour; the **bond cylinders stay default**
(white/grey), so the two styles look uncoloured in the middle.

Cause: for `ball-and-stick` / `licorice`, Mol* colours *verticals* and *horizontals* separately, and
our `addRepresentation(cell, { type, color })` only supplies the main colour. In addition, our custom
themes are guarded by `StructureElement.Location.is(location)`, which is **false for bond
locations**, so a theme asked to colour a bond falls back to grey.

Do:
- pass the theme to both slots when building the repr (`verticalColors` + `horizontalColors` in the
  ball-and-stick / licorice params, or `colorParams` if the builder maps it), e.g. build
  `params = { verticalColors: { name: themeId, params: {} }, horizontalColors: { name: themeId, params: {} } }`
  via `plugin.builders.structure.representation.addRepresentation(cell, { type: 'ball-and-stick', ... })`;
- make the themes bond-aware: handle `StructureBond.Location` (`mol-model/structure` →
  `StructureBond.Location.is(loc)`, then `loc.b.units[0]/[1]` + `indices[0]/[1]`) and colour by the
  bonded residues (pLDDT mean, or the domain of residue `a`);
- verify with `themeStats()`: `calls` must roughly double (atoms + bonds) and `distinct` stay > 1,
  and with the user's eyes — ask for a screenshot.

### 2. Stale error banner: “3D: style 'cartoon': no representation cell — reload the structure”

`activeComps` (`src/mol/scene.ts`) is module state; `setRepr`/`setColorMode` are called from
`StructurePanel` effects before the first `showStructure()` finished (and again right after a scene
recreate), so they note “no representation cell”, and `molDiagnostics.lastError` is **never cleared**
— the amber banner then shows a stale error forever.

Do:
- don't record an error when there is nothing to colour yet: skip silently if no structure text is
  loaded / a load is in flight (e.g. pass a `loaded` flag or compare against the store status),
  or queue the requested style/colour and apply it in `showStructure()` instead of erroring;
- clear `molDiagnostics.lastError` on the next successful apply (and on model switch / scene
  recreate), so the banner disappears when the problem is gone;
- keep real failures visible (`diagnostics.errors` history may keep the last few).

### 3. Mol*'s “Toggle Controls Panel” (benchkey icon) shows nothing — the scene tools
   (Quick Styles / Components / Goals / …) never appear

Facts from the source: the benchkey icon is `BuildOutlinedSvg` → `toggleControls` →
`layout.showControls` (`mol-plugin-ui/viewport.js`), and per `mol-plugin-ui/plugin.js` each region is
rendered as `layout.showControls && controls.<region> !== 'none' && this.region(...)`. In 5.11 the
**scene tools live in the `right` region (`ControlsWrapper`)**, while our advanced spec sets
`regionState.right: 'hidden'` (see `createScene`, `src/mol/scene.ts`, the line with
`{ left: 'full', top: 'collapsed', right: 'hidden', bottom: 'hidden' }`). The `left` region we already
enable is the Home/State/Help panel, which is not the tools menu.

Do:
- in advanced mode set `regionState.right: 'full'` (and `left: 'full'`, `top: 'collapsed'`,
  `bottom: adv ? 'full' : 'hidden'` as today);
- confirm with `npm run probe:molstar-ui` that `right` renders and contains the tools
  (look for “Quick Styles” / “Components” text inside `.msp-layout-right`);
- since the benchkey toggles `showControls` at runtime and runtime toggles cannot re-render regions
  (fact 3 above), keep ⚙ molstar as the recreate path and, if the benchkey still looks dead, hide
  it in advanced mode via CSS (`.mol-host.advanced .msp-viewport-controls [title='Toggle Controls Panel']`)
  or route it through our own toggle.

### 4. Mol* fullscreen / expanded view is painted behind our header and the right panel

The plugin lives inside the viewer column, so Mol\* can only paint within its host, while our
`<header>` (`z-30` in `Header.tsx`) and the right panel are siblings above it; when Mol\* expands
(`isExpanded` / `expandToFullscreen`) it therefore appears **under** the header and the PAE/pLDDT
canvases.

Do (pick one, keep it simple):
- **overlay route**: when `molstarAdvanced` (or Mol\*'s expanded state) is on, lift the viewer column
  (`position: relative; z-index: 60; background: …`), and hide the header content, the splitter and the
  right panel while expanded, with an obvious way back (Esc + the ⚙ button); listen to Mol\*'s layout
  state (`plugin.layout.events.updated`) so Mol\*'s own buttons do the same thing; or
- **portal route**: mount the plugin host in a `document.body` portal sized
  `position: fixed; inset: 0; z-index: 70` in advanced mode, unmount/reparent on toggle-off.
- either way: after any layout change dispatch `resize` (we already nudge at 0 / 250 / 900 ms in
  `setUiAdvanced`) and re-apply the current selection/highlight after a scene recreate
  (`StructurePanel` re-applies after each load — keep that).

## Ground rules

- Verify with the probes and `npm run smoke`; ask the user for screenshots when pixels decide.
- Reproducible pipeline: `prepare_data.py` stays idempotent; never commit `public/data/` or
  `models_ORF1_files/`.
- Never invent domain boundaries. CSV ranges are the truth.
- Prefer the proven Mol* patterns listed above over new API guesses.
