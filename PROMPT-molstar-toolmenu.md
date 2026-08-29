# Prompt: make Mol*'s **Structure Tools** panel appear in the embedded viewer

Paste this to a coding agent working in the `orf1viewer` repo. It is a single, well-scoped bug;
everything you need is below. **You must use a real browser (hardware-accelerated Chrome/Firefox)** —
CI/headless has no WebGL and cannot settle this.

## Symptom

`⚙ molstar` (our toolbar toggle) rebuilds the Mol* plugin with the full UI. After that:

* **visible / working**: left panel (Home, Download Structure, Load Trajectory, Remote States…),
  sequence view on top, log row at the bottom, viewport controls column on the right edge.
* **MISSING**: the panel with **Structure Tools → Structure / Measurements / Quick Styles /
  Procedural Animation / Components / Export Models / Export Animation / Export Geometry**.
  Reference screenshot of what is wanted: `smoke-artifacts/10-molstar-toolmenu.png` (red square);
  current state: `smoke-artifacts/11-start_to_be_tired.png`.

Related bits already fixed — do not regress: bond cylinders take the theme colour (`elementLocations()`
in `src/mol/scene.ts`), the legend is collapsible and hides in fullscreen, styles list is complete,
the stale “no representation cell” banner is gone.

## Facts from the installed Mol* (`node_modules/molstar`, plugin reports 5.11.0)

`mol-plugin-ui/plugin.js`:

* `const controls = plugin.spec.components?.controls ?? {};`
* a region is rendered **iff** `layout.showControls && controls.<region> !== 'none'`;
* `msp-layout-hide-<region>` is added when `layout.regionState.<region> === 'hidden'`
  (`left: 'collapsed'` → `msp-layout-collapse-left`);
* class list = `msp-plugin-content` + (`msp-layout-expanded` **or**
  `msp-layout-standard` + `msp-layout-standard-${layout.controlsDisplay}`).

Exports you need: `ControlsWrapper`, `Log`, `LeftPanelControls` from `mol-plugin-ui/plugin.js`;
`SequenceView` from `mol-plugin-ui/sequence.js`. The scene tools live in **`ControlsWrapper`**, i.e.
the **`right`** region.

There is **no `mol-plugin-viewer`** in this npm package — don't chase `molstar.Viewer` from the CDN docs.

Our code: `createScene(container, { advanced })` in `src/mol/scene.ts` (the spec: `layout.initial`,
`components`), `src/components/StructurePanel.tsx` (mount/recreate, `mol-host` + `viewer-advanced`
classes), `src/index.css` (the `.mol-host:not(.advanced) …` chrome-hiding rules and `.viewer-advanced`
stacking rules).

## Step 1 — diagnose, do not guess (30 s in DevTools on the running page)

```js
const p = window.__orf1.mol.plugin();
console.log('layout', JSON.stringify(p.layout.state), p.layout.state.regionState);
console.log('spec.controls keys', Object.keys(p.spec?.components?.controls ?? {}));
const r = document.querySelector('.msp-layout-right');
console.log('right el', r, r && r.getBoundingClientRect(), r && getComputedStyle(r));
console.log('content class', document.querySelector('.msp-plugin-content')?.className);
console.log('hide-right?', !!document.querySelector('.msp-layout-hide-right'));
```

* `right el === null` → the region is **not rendered** → go to **Fix A**.
* `right el` exists but `width === 0` / `display: none` / `overflow` clipped → **Fix B**.
* exists with a width but hidden behind something → **Fix C**.

## Fix A — hand Mol* the panel components explicitly

In `createScene`, when `advanced`:

```ts
import { ControlsWrapper, Log, LeftPanelControls } from 'molstar/lib/mol-plugin-ui/plugin.js';
import { SequenceView } from 'molstar/lib/mol-plugin-ui/sequence.js';

components: {
  ...(base.components ?? {}),
  remoteState: 'none',
  controls: {
    left: LeftPanelControls,
    right: ControlsWrapper,        // ← the Structure Tools panel
    top: SequenceView,
    bottom: Log,
  },
},
```

If the import path for the class list differs in this build, take what `mol-plugin-ui/plugin.js`
actually exports (grep `export declare class ControlsWrapper`).

## Fix B — geometry / our own CSS is eating the panel

1. Delete the chrome rules that match advanced mode by accident: `src/index.css` scopes them with
   `.mol-host:not(.advanced)` — verify with DevTools that **no** `display:none` rule from our file
   applies to `.msp-layout-right` / `.msp-right-panel-wrapper`. If `StructurePanel` fails to add
   `advanced` to `.mol-host` (it does: `mol-host advanced`), fix the class toggle.
2. `controlsDisplay` decides which layout SCSS applies:
   `skin/base/layout/controls-outside.scss` vs `controls-landscape.scss`. Try
   `plugin.layout.setProps({ controlsDisplay: 'inside' })` (and `'outside'`) at mount, then
   re-check the rect — one of the two gives the right region a real width.
3. `splitPercentage` / region `width`: if the right region is `position: absolute; width: 0`, force it
   in CSS for our host only, e.g. `.mol-host.advanced .msp-layout-right { width: 300px; right: 0; top: 0; bottom: 0; }`.
4. Make sure the host is not double-clipped: `.viewer-advanced` currently sets `overflow: visible` and
   the host keeps the radius. Keep `overflow: hidden` off `.msp-plugin` in advanced mode.

## Fix C — layout/stacking

The viewer box must out-rank the header (`z-30`) and the right panel (later sibling). `.viewer-advanced`
already sets `z-index: 60`. If Mol\*'s dropdowns are still clipped or the panel lands off-screen, mount
the plugin host through a `createPortal(..., document.body)` sized
`position: fixed; inset: 0; z-index: 70` while advanced mode is on, and restore it on toggle-off.
After any of this, dispatch `resize` (we already do at 0/250/900 ms in `setUiAdvanced`) so the canvas
re-fits, and re-apply the current selection/highlight after the scene recreate
(`StructurePanel` does this after each load — keep it).

## Verify

* `npm run probe:molstar-ui` — extend it to assert the right region **has a width and contains
  “Structure Tools”/“Quick Styles”** text:

```js
rightPanelText: (document.querySelector('.msp-layout-right')?.innerText || '').slice(0, 160)
```

* In the browser: `⚙ molstar` → Structure Tools visible; select a structure → Quick Styles
  (Cartoon / Spacefill / Surface…) apply without touching our toolbar; our toolbar (bottom-left) and
  legend (bottom-right) do not cover it; toggling back restores the minimal UI.
* `npm run build && npm run smoke` stays green (39 checks).

## Ground rules

* Do not commit `public/data/` or `models_ORF1_files/` (gitignored, ~1 GB and ~25 GB).
* `scripts/prepare_data.py` stays idempotent; domains are **verbatim** from the reviewed CSV — never
  invent, cluster or merge them; `HVR` stays excluded from domain *counts* only.
* The 3D keeps loading the full-atom PDB (`pdb-full/`); downloads stay decompressed.
* Respect the proven Mol* patterns in `PROMPT.md` (repr delete+re-add, stateless themes,
  mount-time panels) instead of new API guesses.
* Timebox: Step 1 → A → B → C, ~15 min each. If Step 1 shows `right el === null` and Fix A does not
  help, stop and report the DevTools output rather than rewriting the viewer.
