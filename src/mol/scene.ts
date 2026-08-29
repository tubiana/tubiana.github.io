/**
 * Mol* scene controller — plugin lifecycle, structure loading, custom colour
 * themes (pLDDT bands / smooth pLDDT / annotated domains), residue highlight,
 * selection and camera focus.
 *
 * Mol*'s internals move between major versions, so every call into the plugin is
 * wrapped defensively: the app must stay usable even if one nicety is missing.
 */
import { createPluginUI } from 'molstar/lib/mol-plugin-ui/index.js';
import { renderReact18 } from 'molstar/lib/mol-plugin-ui/react18.js';
import { DefaultPluginUISpec } from 'molstar/lib/mol-plugin-ui/spec.js';
import type { PluginUIContext } from 'molstar/lib/mol-plugin-ui/context.js';
import { PluginCommands } from 'molstar/lib/mol-plugin/commands.js';
import { Structure, StructureElement, StructureProperties, Unit } from 'molstar/lib/mol-model/structure.js';
import { EmptyLoci, Loci } from 'molstar/lib/mol-model/loci.js';
import { OrderedSet } from 'molstar/lib/mol-data/int.js';
import { ColorTheme } from 'molstar/lib/mol-theme/color.js';
import { ColorThemeCategory } from 'molstar/lib/mol-theme/color/categories.js';
import { Color } from 'molstar/lib/mol-util/color/index.js';
import { ColorNames } from 'molstar/lib/mol-util/color/names.js';
import { downloadBlob, hexToInt } from '../lib/util';
import { DomainRange } from '../lib/types';
import { ColorMode, ReprKind } from '../state/store';
import { Range } from '../lib/pae';

export const THEME_PLDDT = 'orf1-plddt';

/**
 * What went wrong inside Mol*. Every 3D call that can fail records here, and the
 * UI shows `lastError` — the 3D path cannot be exercised in every environment
 * (no WebGL), so failures must be visible to the user rather than a console.warn.
 */
export const molDiagnostics: { errors: string[]; lastError: string | null; lastOk: string } = {
  errors: [],
  lastError: null,
  lastOk: '',
};

/** True while a successfully built structure is on screen. */
let sceneHasStructure = false;

/** Clear the banner as soon as something works again — a stale error is worse than none. */
function noteSuccess(what: string) {
  molDiagnostics.lastError = null;
  molDiagnostics.lastOk = what;
}

function note(what: string, e: unknown): string {
  const msg = `${what}: ${String(e instanceof Error ? e.message : e)}`;
  molDiagnostics.lastError = msg;
  if (!molDiagnostics.errors.includes(msg)) molDiagnostics.errors.push(msg);
  console.warn('[mol*]', msg, e);
  return msg;
}

let activePlugin: PluginUIContext | null = null;
export function activeScenePlugin() {
  return activePlugin;
}

/** theme ids currently in the registry (empty list ⇒ custom themes failed to register) */
export function registeredThemeNames(plugin: PluginUIContext): string[] {
  try {
    const list = (plugin.representation.structure.themes.colorThemeRegistry as any).list;
    return Array.isArray(list) ? list.map((x: any) => x.name) : [];
  } catch (e) {
    note('theme listing', e);
    return [];
  }
}
export const THEME_PLDDT_SMOOTH = 'orf1-plddt-smooth';
export const THEME_DOMAIN = 'orf1-domain';

const COLOR_UNASSIGNED = 0x8b93a7;

// ------------------------------------------------------------- per structure data
interface UnitLookup {
  unit: Unit;
  /** residue index (unit's model hierarchy) → residue number */
  resnum: Int32Array;
  /** residue index → pLDDT (0 = unknown) */
  resPlddt: Float32Array;
  /** residue index → index into the domain array, -1 when unassigned */
  resDomain: Int16Array;
  /** unit element index → residue number; ordered, used to build loci */
  elemResnum: Int32Array;
}

export interface StructureLookup {
  byUnit: Map<Unit, UnitLookup>;
  domains: DomainRange[];
  minRes: number;
  maxRes: number;
}

const lookups = new WeakMap<Structure, StructureLookup>();
let domainPalette: number[] = [];

export function setDomainPalette(domains: { name: string; color: string }[]) {
  domainPalette = domains.map((d) => hexToInt(d.color));
  activeDomainColors = domainPalette;
}

function domainIndexOf(domains: DomainRange[], res: number): number {
  for (let i = 0; i < domains.length; i++) {
    const d = domains[i];
    if (res >= d.start && res <= d.end) return i;
  }
  return -1;
}

/** Scan the structure once and cache residue / pLDDT / domain per unit element. */
export function buildLookup(structure: Structure, plddt: Uint8Array | null, domains: DomainRange[]): StructureLookup {
  const byUnit = new Map<Unit, UnitLookup>();
  let minRes = Number.POSITIVE_INFINITY;
  let maxRes = 0;
  for (const unit of structure.units) {
    if (!Unit.isAtomic(unit)) continue;
    const atomic = unit.model.atomicHierarchy;
    const residues = atomic.residues;
    const residueAtomSegments = atomic.residueAtomSegments;
    const atomsResidueNumber = residues.auth_seq_id;
    const atomsResidueLabel = residues.label_seq_id;

    // per *residue index* tables: what the colour themes query
    const nRes = residueAtomSegments.count; // == number of residues in this hierarchy
    const resnum = new Int32Array(nRes);
    const p = new Float32Array(nRes);
    const dom = new Int16Array(nRes).fill(-1);
    for (let r = 0; r < nRes; r++) {
      let rn = atomsResidueNumber ? atomsResidueNumber.value(r) : NaN;
      if (!Number.isFinite(rn) || rn === 0) rn = atomsResidueLabel ? atomsResidueLabel.value(r) : NaN;
      if (!Number.isFinite(rn)) rn = r + 1;
      resnum[r] = rn;
      if (plddt && rn >= 1 && rn <= plddt.length) p[r] = plddt[rn - 1];
      dom[r] = domainIndexOf(domains, rn);
    }

    // per *unit element* residue numbers, ordered: used to build loci
    const count = unit.elements.length;
    const elemResnum = new Int32Array(count);
    for (let i = 0; i < count; i++) {
      const rn = resnum[residueAtomSegments.index[unit.elements[i]]] ?? 0;
      elemResnum[i] = rn;
      if (rn < minRes) minRes = rn;
      if (rn > maxRes) maxRes = rn;
    }
    byUnit.set(unit, { unit, resnum, resPlddt: p, resDomain: dom, elemResnum });
  }
  const lk: StructureLookup = { byUnit, domains, minRes, maxRes };
  lookups.set(structure, lk);
  return lk;
}

export function getLookup(structure: Structure | undefined): StructureLookup | undefined {
  if (!structure) return undefined;
  return lookups.get(structure);
}

// ------------------------------------------------------------------ colour themes
type ThemeCtx = Parameters<ColourThemeFactory>[0];
type ColourThemeFactory = NonNullable<ColorTheme.Provider<any, any>['factory']>;

function plddtBandColor(v: number): number {
  if (v >= 90) return 0x1e5da6;
  if (v >= 70) return 0x7cc8f5;
  if (v >= 50) return 0xfacc41;
  if (v > 0) return 0xff7d45;
  return COLOR_UNASSIGNED;
}

/** smooth 0→100 ramp (red → yellow → light blue → dark blue) */
function plddtSmoothColor(v: number): number {
  const stops: [number, number][] = [
    [0, 0xd7191c],
    [40, 0xfdae61],
    [55, 0xfacc41],
    [75, 0x8fd0f7],
    [92, 0x2b6cb0],
    [100, 0x08306b],
  ];
  if (!(v > 0)) return COLOR_UNASSIGNED;
  const x = Math.max(0, Math.min(100, v));
  for (let i = 0; i < stops.length - 1; i++) {
    const [x0, c0] = stops[i];
    const [x1, c1] = stops[i + 1];
    if (x >= x0 && x <= x1) {
      const f = x1 > x0 ? (x - x0) / (x1 - x0) : 0;
      const r = Math.round(((c0 >> 16) & 255) + (((c1 >> 16) & 255) - ((c0 >> 16) & 255)) * f);
      const g = Math.round(((c0 >> 8) & 255) + (((c1 >> 8) & 255) - ((c0 >> 8) & 255)) * f);
      const b = Math.round((c0 & 255) + ((c1 & 255) - (c0 & 255)) * f);
      return (r << 16) | (g << 8) | b;
    }
  }
  return 0x08306b;
}

// ---------------------------------------------------------------- theme data
//
// The themes read two module-level values that `showStructure` fills in for the
// model currently on screen. They used to resolve per-representation tables
// through a `prepare()` hook, but the object Mol* hands `prepare` is a
// representation *instance* (it has no `.cell` here), so the tables stayed
// empty and every theme fell back to the same grey — the model never looked
// coloured even though the calls succeeded.
//
// Reading the value straight off the location is stateless and version-proof:
// AlphaFold writes pLDDT into the PDB B-factor column, and domains map from the
// residue number, which is the manifest index (the same trick af_analysis uses
// with `StructureProperties.atom.B_iso_or_equiv`).

let activePlddt: Uint8Array | null = null;
let activeDomains: DomainRange[] = [];
/** Domain colours from the manifest palette, index-aligned with the CSV domain list. */
let activeDomainColors: number[] = [];


/** Per-model data the colour themes read (called from `showStructure`). */
/**
 * One-shot inspection of the live scene: what Mol* actually parsed, whether the
 * residue numbers / B-factors our themes rely on resolve, and whether the theme
 * `color()` callbacks ran. `__orf1.mol.probe()`.
 */
export function probeStructure(plugin: PluginUIContext) {
  const structures = currentStructures(plugin);
  const s = structures[0];
  const out: Record<string, any> = {
    structures: structures.length,
    componentCells: activeComps.map((c) => ({ kind: c.kind, repr: !!c.reprCell })),
    themeStats: themeStatsSnapshot(),
    themeData: { plddtLen: activePlddt?.length ?? -1, domains: activeDomains.length, palette: activeDomainColors.length },
  };
  if (!s) {
    out.error = 'no structure in the scene graph';
    return out;
  }
  out.atoms = s.elementCount;
  out.unitCount = s.units.length;
  const loc = StructureElement.Location.create(s);
  const first = s.units[0];
  if (first) {
    out.atoms = first.elements.length;
    out.modelKind = String((first as any).modelKind ?? '?');
    const samples: any[] = [];
    for (const i of [0, 1, Math.max(0, Math.floor(first.elements.length / 2))]) {
      loc.unit = first;
      loc.element = first.elements[i];
      let resnum = -1;
      let b = -1;
      let atom = '';
      try {
        resnum = StructureProperties.residue.label_seq_id(loc);
      } catch {
        /* ignore */
      }
      try {
        b = StructureProperties.atom.B_iso_or_equiv(loc);
      } catch {
        /* ignore */
      }
      try {
        atom = StructureProperties.atom.label_atom_id(loc);
      } catch {
        /* ignore */
      }
      samples.push({ atomIndex: i, resnum, b, atom });
    }
    out.firstAtoms = samples;
  }
  return out;
}

export function setThemeData(plddt: Uint8Array | null, domains: DomainRange[]) {
  activePlddt = plddt ?? null;
  activeDomains = domains ?? [];
  // Each CSV domain carries its own colour, so the themes do not depend on the
  // manifest palette being pushed separately (it never was — domains rendered grey).
  activeDomainColors = activeDomains.map((d) => hexToInt(d.color) ?? fallbackDomainColor(d.name));
}

export function clearThemeCaches(_modelId?: string) {
  activePlddt = null;
  activeDomains = [];
}

/**
 * Per-theme counters: whether Mol* actually calls our `color()`, and what it
 * resolves. `__orf1.mol.themeStats()` in the console — if `calls` stays 0 the
 * theme is never consulted; if `unassigned` is 100 % the residue/pLDDT lookup misses.
 */
export interface ThemeStat {
  calls: number;
  /** calls made with a bond location — the bond cylinders of ball-and-stick / licorice */
  bondCalls: number;
  unassigned: number;
  distinct: number;
  lastResnum: number;
  lastPlddt: number;
}
const themeStats: Record<string, ThemeStat> = {};
const seenColors: Record<string, Set<number>> = {};
function stat(name: string): ThemeStat {
  return (themeStats[name] ??= {
    calls: 0,
    bondCalls: 0,
    unassigned: 0,
    distinct: 0,
    lastResnum: -1,
    lastPlddt: -1,
  });
}
export function themeStatsSnapshot(): Record<string, ThemeStat> {
  return JSON.parse(JSON.stringify(themeStats));
}
export function resetThemeStats() {
  for (const k of Object.keys(themeStats)) delete themeStats[k];
  for (const k of Object.keys(seenColors)) delete seenColors[k];
}

/**
 * Reduce whatever Mol* hands `color()` to element locations.
 *
 * Bond visuals (`intra-bond` / `structure-intra-bond` of ball-and-stick &
 * licorice) pass a **bond location**, not a `StructureElement.Location`, so a
 * naive `StructureElement.Location.is()` guard makes every bond fall back to the
 * grey colour — atoms coloured, cylinders white. For a bond we return both
 * bonded atoms and let the callers combine them.
 */
function elementLocations(location: any): any[] {
  if (!location) return [];
  if (location.unit && typeof location.element === 'number') return [location];

  // Structure.Bond.Location = { structure, aUnit, aIndex, bUnit, bIndex } with the
  // indices into each unit's `elements` — this is what the bond visuals of
  // ball-and-stick / licorice / surface pass to the colour callback.
  if (location.aUnit || location.bUnit) {
    const out: any[] = [];
    const pairs: Array<[any, number | undefined]> = [
      [location.aUnit, location.aIndex],
      [location.bUnit, location.bIndex],
    ];
    for (const [unit, idx] of pairs) {
      if (!unit || typeof idx !== 'number') continue;
      const el = unit.elements?.[idx];
      if (typeof el !== 'number') continue;
      out.push({ structure: location.structure ?? unit.model?.structure, unit, element: el });
    }
    if (out.length) return out;
  }

  // defensive: a few code paths hand over a Bond object instead of a Location
  const b = location.b;
  if (b) {
    const unit = b.unit ?? b.units?.[0];
    const indices: number[] = Array.isArray(b.index) ? b.index : [b.index0, b.index1];
    const out: any[] = [];
    for (const i of indices) {
      const el = unit?.elements?.[i];
      if (typeof el !== 'number') continue;
      out.push({ structure: location.structure ?? unit?.model?.structure, unit, element: el });
    }
    if (out.length) return out;
  }
  // anything Mol* still considers an element location
  try {
    if (StructureElement.Location.is(location)) return [location];
  } catch {
    /* ignore */
  }
  return [];
}

function resnumOf(location: any): number {
  for (const loc of elementLocations(location)) {
    try {
      const n = StructureProperties.residue.label_seq_id(loc);
      if (typeof n === 'number' && isFinite(n)) return n;
    } catch {
      /* try the next atom */
    }
  }
  return -1;
}

/**
 * pLDDT at a location: B-factor first (per atom, always present), manifest array
 * as backup. A bond location gets the mean of its two atoms so the cylinder is
 * coloured like the residues it joins.
 */
function plddtOf(location: any): number {
  const locs = elementLocations(location);
  if (!locs.length) return -1;
  let sum = 0;
  let n = 0;
  for (const loc of locs) {
    let v = -1;
    try {
      const b = StructureProperties.atom.B_iso_or_equiv(loc);
      if (typeof b === 'number' && b > 0 && b <= 100) v = b;
    } catch {
      /* fall through to the manifest */
    }
    if (v < 0) {
      const r = resnumOf(loc);
      if (activePlddt && r >= 1 && r <= activePlddt.length) v = activePlddt[r - 1];
    }
    if (v >= 0) {
      sum += v;
      n++;
    }
  }
  return n ? sum / n : -1;
}

/** Stable per-name colour, only used if a domain row has no usable colour. */
function fallbackDomainColor(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffff;
  const hue = h % 360;
  // cheap HSV(·, .62, .82) -> int so fallbacks stay distinguishable
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    const a = 0.82 * 0.62;
    const c = 0.82 * Math.max(0, Math.min(1, Math.max(k - 3, Math.min(9 - k, 1))));
    const m = 0.82 - c;
    void a;
    return Math.round(((c + m) * 255) & 255);
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

function domainColorAt(resnum: number): number {
  if (resnum < 0) return COLOR_UNASSIGNED;
  for (let i = 0; i < activeDomains.length; i++) {
    const d = activeDomains[i];
    if (resnum >= d.start && resnum <= d.end) return activeDomainColors[i] ?? COLOR_UNASSIGNED;
  }
  return COLOR_UNASSIGNED;
}

function makeTheme(
  name: string,
  label: string,
  description: string,
  pick: (location: any) => number,
  sample?: (location: any) => { resnum: number; value: number },
): ColorTheme.Provider<any, any> {
  // Mol* expects `Color` (a branded int); the registry signature moves between
  // releases, so the factory is assembled loosely and cast at the boundary.
  const factory: any = (_ctx: ThemeCtx, props: any) => ({
    factory,
    granularity: 'groupInstance',
    color: (location: any) => {
      const c = pick(location) | 0;
      const st = stat(name);
      st.calls++;
      if (location && (location.aUnit || location.bUnit || location.b)) st.bondCalls++;
      if (c === COLOR_UNASSIGNED) st.unassigned++;
      const seen = (seenColors[name] ??= new Set<number>());
      seen.add(c);
      st.distinct = seen.size;
      if (sample) {
        try {
          const info = sample(location);
          st.lastResnum = info.resnum;
          st.lastPlddt = info.value;
        } catch {
          /* ignore */
        }
      }
      return Color(c);
    },
    props,
    description,
  });
  return {
    name,
    label,
    category: ColorThemeCategory.Misc as any,
    factory,
    getParams: () => ({}),
    defaultValues: {},
    isApplicable: () => true,
  } as ColorTheme.Provider<any, any>;
}

export const PlddtTheme = makeTheme(
  THEME_PLDDT,
  'ORF1 pLDDT bands',
  'AlphaFold confidence bands (>90 dark blue, 70–90 light blue, 50–70 yellow, <50 orange).',
  (loc) => {
    const v = plddtOf(loc);
    return v < 0 ? COLOR_UNASSIGNED : plddtBandColor(v);
  },
  (loc) => ({ resnum: resnumOf(loc), value: plddtOf(loc) }),
);

export const PlddtSmoothTheme = makeTheme(
  THEME_PLDDT_SMOOTH,
  'ORF1 pLDDT gradient',
  'Smooth pLDDT ramp.',
  (loc) => {
    const v = plddtOf(loc);
    return v < 0 ? COLOR_UNASSIGNED : plddtSmoothColor(v);
  },
  (loc) => ({ resnum: resnumOf(loc), value: plddtOf(loc) }),
);

export const DomainTheme = makeTheme(
  THEME_DOMAIN,
  'ORF1 domains',
  'Domains from the annotation CSV (MetY, FABD-like, HVR, domX, Hel, RdRp). Grey = unannotated.',
  (loc) => domainColorAt(resnumOf(loc)),
  (loc) => ({ resnum: resnumOf(loc), value: domainColorAt(resnumOf(loc)) }),
);

// ------------------------------------------------------------------------- plugin
export interface Scene {
  plugin: PluginUIContext;
  dispose: () => void;
}

/** App style -> Mol* representation type name. */
export const REPR_NAMES: Record<ReprKind, string> = {
  cartoon: 'cartoon',
  backbone: 'backbone',
  licorice: 'line',
  ballStick: 'ball-and-stick',
  sphere: 'spacefill',
  spacefill: 'spacefill',
  surface: 'surface',
  molecularSurface: 'molecular-surface',
};

/** Mol* throws its own unstyled fallback when GL is missing — check first. */
export function hasWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

/** `?molui=1` mounts the Mol* UI even without WebGL — the panels are plain DOM,
 * so layout problems (⚙ molstar not revealing the left panel) stay debuggable on
 * machines/CI without a GL context. Rendering obviously still fails. */
export function molUiForced(): boolean {
  try {
    return new URLSearchParams(window.location.search).has('molui');
  } catch {
    return false;
  }
}

/**
 * Build the plugin. `advanced` must be decided **at mount time**: Mol* 5.11 lets
 * you write `plugin.layout.setProps({ showControls: true, … })` and the state
 * object does change, but the mounted React tree keeps rendering only the
 * `main` region — `.msp-layout-left` never appears (verified headless: the class
 * list stays `msp-layout-standard …` even with `isExpanded: true`, and Mol*'s own
 * expand button does nothing either). So ⚙ molstar recreates the scene instead of
 * mutating it, which is the only path that yields the real Mol* panels.
 */
export interface SceneOptions {
  advanced?: boolean;
}

export async function createScene(container: HTMLElement, opts: SceneOptions = {}): Promise<Scene> {
  if (!hasWebGL2() && !molUiForced()) {
    throw new Error(
      'WebGL2 is not available in this browser, so the 3D viewport cannot start. ' +
        'The PAE matrices, pLDDT profile and alignment still work.'
    );
  }
  const adv = !!opts.advanced;
  const base: any = DefaultPluginUISpec();
  const spec = {
    ...base,
    layout: {
      initial: {
        isExpanded: false,
        showControls: adv,
        showLeftPanel: adv,
        showSequenceView: adv,
        showLog: adv,
        isRotated: false,
        // `right` is where Mol* keeps the scene tools (Quick Styles, Components,
        // Goals, …) in 5.11; `left` is only Home/State/Help. Keeping it hidden is
        // exactly why the benchkey "Toggle Controls Panel" icon looked dead.
        regionState: adv
          ? { left: 'full', top: 'collapsed', right: 'full', bottom: 'hidden' }
          : { left: 'hidden', top: 'hidden', right: 'hidden', bottom: 'hidden' },
      },
    },
    // MUST spread the defaults: they carry Mol*'s panel components. The previous
    // `components: { remoteState: 'none' }` replaced the whole object.
    components: { ...(base.components ?? {}), remoteState: 'none' as const },
    customStructureColors: undefined,
  } as any;

  const plugin = await createPluginUI({ target: container, render: renderReact18 as any, spec });
  activePlugin = plugin;

  const registry: any = plugin.representation.structure.themes.colorThemeRegistry;
  for (const t of [PlddtTheme, PlddtSmoothTheme, DomainTheme]) {
    try {
      registry.add(t as any);
    } catch (e) {
      note(`colour theme registration (${t.name})`, e);
    }
  }
  // verify the registration actually took: a theme that is not in the registry
  // silently falls back to grey, which looks like "colouring does not work"
  const missing = [THEME_PLDDT, THEME_PLDDT_SMOOTH, THEME_DOMAIN].filter((n) => {
    try {
      return !registry.get(n);
    } catch {
      return true;
    }
  });
  if (missing.length) {
    note(`colour theme registration (${missing.join(', ')})`, new Error('absent from the registry after add() — the 3D will stay grey'));
  }

  try {
    PluginCommands.Canvas3D.SetSettings(plugin, {
      settings: (props: any) => ({
        renderer: { ...props.renderer, backgroundColor: Color(0x0b1017), transparentBackground: false },
        camera: { ...props.camera, far: Math.max(props.camera.far, 6000) },
        highlightColor: { ...props.highlightColor, color: Color(0xffe27a), alphaFactor: 0.65 },
      }),
    });
  } catch (e) {
    console.warn('canvas3d defaults not applied', e);
  }

  let disposed = false;
  return {
    plugin,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      try {
        plugin.dispose();
      } catch (e) {
        console.warn(e);
      }
    },
  };
}

export function currentStructures(plugin: PluginUIContext): Structure[] {
  activePlugin = plugin;
  try {
    const out: Structure[] = [];
    for (const s of plugin.managers.structure.hierarchy.current.structures ?? []) {
      const obj: any = s.cell?.obj;
      const data = obj?.data;
      // duck-typing beats a version-sensitive `Structure.is`
      if (data && Array.isArray(data.units) && data.models) out.push(data as Structure);
    }
    return out;
  } catch {
    return [];
  }
}

export interface LoadOptions {
  label: string;
  plddt?: Uint8Array | null;
  domains?: DomainRange[];
  repr: ReprKind;
  colorMode: ColorMode;
}

type CompKind = 'polymer' | 'ion' | 'ligand' | 'whole';

/**
 * Component cells of the structure currently on screen, each with the
 * representation cell built from it.
 *
 * Style and colour changes delete the representation cell and re-add it with
 * the new type + theme — the approach a production Mol* front-end uses
 * (af_analysis' molstar.js). We deliberately do NOT use
 * `managers.structure.component.updateRepresentations*`: those need live
 * `StructureComponent` refs, while `hierarchy.current.structures` already
 * *are* components (they carry `.cell`/`.reprs`, not `.components`), which is
 * why an earlier version reported "no structure component in the scene graph"
 * and left both the colour selector and the style selector dead.
 */
/** Last style/colour applied — a rebuild of one dimension must not reset the other. */
let currentRepr: ReprKind = 'cartoon';
let currentColorMode: ColorMode = 'plddt';

interface CompEntry {
  cell: any;
  kind: CompKind;
  reprCell: any | null;
}
let activeComps: CompEntry[] = [];

export function componentCount(plugin?: PluginUIContext): number {
  if (activeComps.length) return activeComps.length;
  const p = plugin ?? activePlugin;
  if (!p) return 0;
  try {
    return currentStructures(p).length;
  } catch {
    return 0;
  }
}

/** Theme id to hand to Mol* for a colour mode (custom themes or built-ins). */
function themeIdOf(plugin: PluginUIContext, mode: ColorMode): string {
  if (mode === 'chain') return 'chain-id';
  if (mode === 'uniform') return 'uniform';
  if (mode === 'domain') return THEME_DOMAIN;
  const custom = mode === 'plddtSmooth' ? THEME_PLDDT_SMOOTH : THEME_PLDDT;
  try {
    const registered = registeredThemeNames(plugin);
    if (!registered.length || registered.includes(custom)) return custom;
  } catch {
    return custom;
  }
  return 'confidence'; // Mol*'s built-in pLDDT theme
}

/** Representation type name for one component kind under the requested style. */
function reprTypeFor(repr: ReprKind, kind: CompKind): string {
  const name = REPR_NAMES[repr] ?? 'cartoon';
  if (kind === 'polymer' || kind === 'whole') return name;
  // Ligands and ions are never modelled as cartoon/backbone/surface: they get
  // sticks or spheres, otherwise they vanish from the view.
  if (repr === 'sphere' || repr === 'spacefill') return 'spacefill';
  if (repr === 'surface' || repr === 'molecularSurface') return 'ball-and-stick';
  return kind === 'ion' ? 'spacefill' : 'ball-and-stick';
}

async function buildRepr(
  plugin: PluginUIContext,
  entry: CompEntry,
  typeName: string,
  themeId: string,
  what: string,
): Promise<boolean> {
  try {
    if (entry.reprCell) {
      await plugin.state.data.build().delete(entry.reprCell).commit();
      entry.reprCell = null;
    }
    entry.reprCell = await plugin.builders.structure.representation.addRepresentation(entry.cell, {
      type: typeName,
      color: themeId,
    } as any);
    return true;
  } catch (e) {
    note(`${what} (${entry.kind}, ${typeName}/${themeId})`, e);
    return false;
  }
}

/** Replace whatever is shown with the given PDB text. */
export async function showStructure(plugin: PluginUIContext, pdbText: string, o: LoadOptions): Promise<Structure | null> {
  try {
    await plugin.clear();
    activeComps = [];
    sceneHasStructure = false;
    activePlugin = plugin;

    const data = await plugin.builders.data.rawData({ data: pdbText, label: o.label }, { state: { label: o.label } } as any);
    let trajectory: any;
    try {
      trajectory = await plugin.builders.structure.parseTrajectory(data, 'pdb' as any);
    } catch (e) {
      note('parseTrajectory(pdb)', e);
      trajectory = await plugin.builders.structure.parseTrajectory(data, 'mmcif' as any);
    }
    const model = await plugin.builders.structure.createModel(trajectory);
    const structure = await plugin.builders.structure.createStructure(model);

    setThemeData(o.plddt ?? null, o.domains ?? []);
    const themeId = themeIdOf(plugin, o.colorMode);
    const kinds: CompKind[] = ['polymer', 'ion', 'ligand'];
    for (const kind of kinds) {
      const cell = await plugin.builders.structure.tryCreateComponentStatic(structure as any, kind as any, {
        label: o.label,
      } as any);
      if (!cell) continue;
      const entry: CompEntry = { cell, kind, reprCell: null };
      await buildRepr(plugin, entry, reprTypeFor(o.repr, kind), themeId, `representation ${o.repr}`);
      if (entry.reprCell) activeComps.push(entry);
    }
    if (!activeComps.length) {
      // No polymer/ion/ligand resolved (e.g. a model without standard records):
      // fall back to one component covering the whole structure.
      const cell = await plugin.builders.structure.tryCreateComponentStatic(structure as any, 'whole' as any, {
        label: o.label,
      } as any);
      if (cell) {
        const entry: CompEntry = { cell, kind: 'whole', reprCell: null };
        await buildRepr(plugin, entry, reprTypeFor(o.repr, 'whole'), themeId, `representation ${o.repr}`);
        if (entry.reprCell) activeComps.push(entry);
      }
    }
    if (!activeComps.length) {
      note('structure build', new Error('no component could be created from the model'));
    }

    const structures = currentStructures(plugin);
    for (const s of structures) buildLookup(s, o.plddt ?? null, o.domains ?? []);
    sceneHasStructure = activeComps.length > 0;
    if (sceneHasStructure) noteSuccess(`loaded ${o.label} (${o.repr}/${themeId})`);
    return structures[0] ?? null;
  } catch (e) {
    note('structure load', e);
    throw e;
  }
}

/**
 * Hand the full Mol* UI (left panel, controls, sequence view, timeline) to the
 * user, or take it back again. Kept inside the viewer box on purpose: Mol*'s
 * "expanded" layout wants the whole page and then renders its panels behind
 * our header/toolbar, so we only toggle `showControls` + the region states.
 */
/** Best-effort runtime tweak (see `createScene`: it cannot reveal the panels —
 * the UI toggle recreates the scene with the right mount-time spec). */
export function setUiAdvanced(plugin: PluginUIContext, on: boolean) {
  try {
    plugin.layout.setProps({
      isExpanded: false,
      showControls: on,
      regionState: {
        left: on ? 'full' : 'hidden',
        top: on ? 'collapsed' : 'hidden',
        right: 'hidden',
        bottom: on ? 'full' : 'hidden',
      },
    } as any);
  } catch (e) {
    console.warn('could not toggle the Mol* UI', e);
  }
  try {
    // Mol* re-layouts its viewport on the window resize event. It needs a nudge
    // again once React has committed the new panel sizes, otherwise the canvas
    // keeps its old width and the viewport is clipped by the freshly opened panel.
    window.dispatchEvent(new Event('resize'));
    window.setTimeout(() => window.dispatchEvent(new Event('resize')), 250);
    window.setTimeout(() => window.dispatchEvent(new Event('resize')), 900);
  } catch {
    /* noop */
  }
}

export async function setColorMode(plugin: PluginUIContext, mode: ColorMode): Promise<void> {
  activePlugin = plugin;
  currentColorMode = mode;
  const themeId = themeIdOf(plugin, mode);
  if (!activeComps.length) {
    // Nothing on screen yet (effects run before the first load finished, or the scene
    // was recreated): the intent lives in `currentColorMode` and showStructure applies
    // it — not an error worth a banner.
    if (sceneHasStructure) note(`colour mode '${mode}'`, new Error('no representation cell — reload the structure'));
    return;
  }
  let ok = 0;
  for (const entry of activeComps) {
    if (await buildRepr(plugin, entry, reprTypeFor(currentRepr, entry.kind), themeId, `colour mode '${mode}'`)) ok++;
  }
  if (!ok) {
    note(`colour mode '${mode}' (${themeId})`, new Error('all representations failed to rebuild'));
  } else {
    noteSuccess(`colour mode '${mode}' (${themeId})`);
  }
}

export async function setRepr(plugin: PluginUIContext, repr: ReprKind): Promise<void> {
  activePlugin = plugin;
  currentRepr = repr;
  if (!activeComps.length) {
    if (sceneHasStructure) note(`style '${repr}'`, new Error('no representation cell — reload the structure'));
    return; // otherwise pending intent, applied by showStructure
  }
  let ok = 0;
  for (const entry of activeComps) {
    if (await buildRepr(plugin, entry, reprTypeFor(repr, entry.kind), themeIdOf(plugin, currentColorMode), `style '${repr}'`))
      ok++;
  }
  if (!ok) note(`style '${repr}'`, new Error('all representations failed to rebuild'));
  else noteSuccess(`style '${repr}'`);
}

// ---------------------------------------------------------------------- selection
export function lociForResidues(structure: Structure, residues: Set<number>, ranges?: Range[]): Loci {
  const lk = lookups.get(structure);
  if (!lk) return EmptyLoci;
  const useRanges = ranges && ranges.length ? ranges : null;
  const elements: { unit: Unit; indices: OrderedSet }[] = [];
  for (const [unit, u] of lk.byUnit) {
    const idx: number[] = [];
    if (useRanges) {
      // elements are ordered by residue → keep sorted order by scanning once
      for (let i = 0; i < u.elemResnum.length; i++) {
        const r = u.elemResnum[i];
        for (const rg of useRanges) if (r >= rg.s && r <= rg.e) {
          idx.push(i);
          break;
        }
      }
    } else {
      for (let i = 0; i < u.elemResnum.length; i++) if (residues.has(u.elemResnum[i])) idx.push(i);
    }
    if (idx.length) elements.push({ unit, indices: OrderedSet.ofSortedArray(idx) as any });
  }
  if (!elements.length) return EmptyLoci;
  return StructureElement.Loci(structure, elements as any);
}

export function residuesFromRanges(ranges: Range[]): Set<number> {
  const s = new Set<number>();
  for (const r of ranges) for (let i = r.s; i <= r.e; i++) s.add(i);
  return s;
}

/** The one highlight entry point: hover ∪ selection are always shown together. */
export function highlightResidues(plugin: PluginUIContext, structure: Structure | null, residues: Set<number>) {
  try {
    if (!structure || residues.size === 0) {
      plugin.managers.interactivity.lociHighlights.highlightOnly({ loci: EmptyLoci as any });
      return;
    }
    plugin.managers.interactivity.lociHighlights.highlightOnly({ loci: lociForResidues(structure, residues) as any });
  } catch (e) {
    console.warn('highlight failed', e);
  }
}

export function clearHighlights(plugin: PluginUIContext) {
  try {
    plugin.managers.interactivity.lociHighlights.highlightOnly({ loci: EmptyLoci as any });
  } catch {
    /* noop */
  }
}

export function setSelectionVisual(plugin: PluginUIContext, structure: Structure | null, residues: Set<number>) {
  try {
    if (!structure || residues.size === 0) {
      plugin.managers.interactivity.lociSelects.deselectAll();
      return;
    }
    plugin.managers.interactivity.lociSelects.selectOnly({ loci: lociForResidues(structure, residues) as any });
  } catch (e) {
    console.warn('selection visual failed', e);
  }
}

export function focusResidues(plugin: PluginUIContext, structure: Structure | null, residues: Set<number>) {
  if (!structure || residues.size === 0) return;
  try {
    const loci = lociForResidues(structure, residues);
    if (loci === EmptyLoci) return;
    plugin.managers.camera.focusLoci(loci as any, { durationMs: 420, extraRadius: 8, minRadius: 12 });
  } catch (e) {
    console.warn('focus failed', e);
  }
}

export function setSpin(plugin: PluginUIContext, on: boolean) {
  try {
    const trackball: any = plugin.canvas3d?.props?.trackball ?? {};
    PluginCommands.Canvas3D.SetSettings(plugin, {
      settings: {
        trackball: {
          ...trackball,
          animate: on
            ? { name: 'spin', params: { speed: 0.6, axis: [0, -1, 0] } }
            : { name: 'off', params: {} },
        },
      },
    } as any);
  } catch (e) {
    console.warn('spin not available', e);
  }
}

export function resetCamera(plugin: PluginUIContext, durationMs = 500) {
  try {
    PluginCommands.Camera.Reset(plugin, { durationMs });
  } catch (e) {
    console.warn('camera reset failed', e);
  }
}

/**
 * Save a PNG of the viewport.
 *
 * Mol* 5.x exposes only `helpers.viewportScreenshot` publicly (it renders at a
 * chosen resolution and drives the download itself); older builds had
 * `canvas3d.capture`. Reading the WebGL canvas directly only works when the
 * drawing buffer is preserved, so it is the last resort.
 */
export async function captureViewport(plugin: PluginUIContext, filename: string): Promise<boolean> {
  const shot: any = (plugin as any).helpers?.viewportScreenshot;
  if (shot?.download) {
    try {
      const values = shot.values ?? {};
      shot.setParams?.({
        ...values,
        resolution: { name: 'custom', params: { width: 1600, height: 1600 } },
        format: { name: 'png', params: {} },
        transparent: false,
      });
      await shot.download(filename);
      return true;
    } catch (e) {
      console.warn('viewport screenshot failed, falling back to canvas capture', e);
    }
  }
  try {
    const c3d: any = plugin.canvas3d;
    if (c3d && typeof c3d.capture === 'function') {
      const info = await c3d.capture({ count: 1, hidden: false, background: { visible: false, color: 'white' } });
      if (info?.image) {
        downloadBlob(info.image as Blob, filename);
        return true;
      }
    }
    const canvas: HTMLCanvasElement | undefined = c3d?.canvas;
    const url: string | undefined = canvas?.toDataURL?.('image/png');
    if (url && url.length > 2000) {
      downloadBlob(await (await fetch(url)).blob(), filename);
      return true;
    }
    return false;
  } catch (e) {
    console.warn('screenshot failed', e);
    return false;
  }
}

export function colorModeLabel(mode: ColorMode): string {
  switch (mode) {
    case 'plddt':
      return 'pLDDT bands';
    case 'plddtSmooth':
      return 'pLDDT gradient';
    case 'domain':
      return 'Domains';
    case 'chain':
      return 'Chain';
    default:
      return 'Uniform';
  }
}

export const MOLSTAR_BG = 0x0b1017;
export { ColorNames };
