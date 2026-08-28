/** Central app state (zustand): data loading, view options, selection/hover, UI layout. */
import { create } from 'zustand';
import { LoadPhase, Manifest, ModelEntry } from '../lib/types';
import { PaeMatrix, Range } from '../lib/pae';
import { MsaData, PdbResidues, ResidueMap, mapRowToResidues, parsePdbResidues } from '../lib/msa';
import {
  currentDataUrl,
  loadBinaryForDownload,
  loadManifest,
  loadPlddt,
  loadStructure,
  resolveDataBaseUrl,
  setDataBaseUrl,
} from '../lib/dataSource';
import { decodePae, recolorPae } from '../lib/paeService';
import { parseClustal } from '../lib/msa';
import { msaWorker } from '../lib/rpcWorker';
import { fetchBytes, bytesToText, debounce, gunzipBlob, lsGet, lsSet } from '../lib/util';

export type ColorMode = 'plddt' | 'plddtSmooth' | 'domain' | 'chain' | 'uniform';
export type ReprKind = 'cartoon' | 'backbone' | 'ballStick' | 'licorice';
export type TabId = 'accent' | 'pae' | 'plddt';
export type SourceKind = 'pae' | 'plddt' | 'msa' | 'domain' | 'pair';

export interface Selection {
  /** residue ranges highlighted in 3D (union) */
  ranges: Range[];
  /** set when the selection comes from the PAE matrix: PAE[a, b] is meaningful */
  cross?: { a: Range; b: Range };
  label: string;
  source: SourceKind;
  /** bump so effects can distinguish repeated identical ranges */
  nonce: number;
}

export interface Cursor {
  i: number; // matrix row index (0-based) → residue i+1
  j: number; // matrix column index (0-based) → residue j+1
  v: number; // PAE(i, j) in Å
  vt: number; // PAE(j, i) in Å
}

export interface Status {
  structure: LoadPhase;
  pae: LoadPhase;
  plddt: LoadPhase;
  msa: LoadPhase;
}

interface AppState {
  // ---- data ------------------------------------------------------------
  manifest: Manifest | null;
  lut: Float32Array | null;
  manifestStatus: LoadPhase;
  error: string | null;
  baseUrl: string;
  baseUrlHow: string;

  model: ModelEntry | null;
  structureText: string | null;
  plddt: Uint8Array | null;
  pae: PaeMatrix | null;
  paeTiming: { decode: number; color: number } | null;
  msa: MsaData | null;
  residueMap: ResidueMap | null;
  /** row of the current model inside the alignment (-1 = unresolved) */
  msaRow: number;
  pdb: PdbResidues | null;
  status: Status;

  // ---- view options ----------------------------------------------------
  colorMode: ColorMode;
  repr: ReprKind;
  tab: TabId;
  paeColormap: string; // colormap name or 'bands'
  paeScaleMax: number;
  paeShowDomains: boolean;
  /** flatten cells with PAE ≥ scaleMax (the AlphaFold figure convention) */
  paeMuteHigh: boolean;
  paeShowLabels: boolean;
  paeInvertY: boolean;
  paeSymmetry: 'full' | 'upper' | 'lower';
  /** zoom window over the matrix, normalised 0..1 over the full square */
  paeWindow: { x0: number; y0: number; x1: number; y1: number };
  highlightSelectionVisual: boolean;
  /** show Mol*'s own panels (scene graph, styles & properties, sequence view) */
  molstarAdvanced: boolean;
  msaOpen: boolean;
  msaHeight: number;
  helpOpen: boolean;
  settingsOpen: boolean;

  // ---- interaction -----------------------------------------------------
  selection: Selection | null;
  hover: number[]; // residue numbers
  cursor: Cursor | null;

  // ---- actions ---------------------------------------------------------
  init: () => Promise<void>;
  setModel: (id: string, opts?: { keepSelection?: boolean }) => Promise<void>;
  reloadStructure: () => Promise<void>;
  setPaeView: (
    patch: Partial<
      Pick<AppState, 'paeColormap' | 'paeScaleMax' | 'paeShowDomains' | 'paeInvertY' | 'paeSymmetry' | 'paeMuteHigh'>
    >
  ) => void;
  setPaeWindow: (w: Partial<AppState['paeWindow']>) => void;
  resetPaeWindow: () => void;
  setColorMode: (m: ColorMode) => void;
  setRepr: (r: ReprKind) => void;
  setTab: (t: TabId) => void;
  setSelection: (sel: Omit<Selection, 'nonce'> | null) => void;
  selectPair: (i: number, j: number) => void;
  selectRange: (s: number, e: number, source?: SourceKind, label?: string) => void;
  setHover: (residues: number[]) => void;
  setCursor: (c: Cursor | null) => void;
  toggleMsa: (open?: boolean) => void;
  setMsaHeight: (h: number) => void;
  setMolstarAdvanced: (v: boolean) => void;
  setHelpOpen: (v: boolean) => void;
  setSettingsOpen: (v: boolean) => void;
  applyDataBaseUrl: (base: string | null) => Promise<void>;
  downloadCurrent: (kind: 'pdb' | 'pdbFull' | 'paeImage') => Promise<void>;
  loadMsa: () => Promise<void>;
  recomputeResidueMap: () => void;
}

/** Shareable URL: the header's ⧉ link button and the popstate handler rely on it. */
export function urlOf(s: { model: ModelEntry | null; tab: TabId; colorMode: ColorMode; msaOpen: boolean }): string {
  const p = new URLSearchParams(location.search);
  if (s.model) p.set('model', s.model.id);
  p.set('tab', s.tab);
  p.set('color', s.colorMode);
  if (s.msaOpen) p.set('msa', '1');
  else p.delete('msa');
  return `${location.pathname}?${p.toString()}${location.hash}`;
}

function syncUrl(s: Parameters<typeof urlOf>[0]) {
  try {
    history.replaceState(null, '', urlOf(s));
  } catch {
    /* sandboxed iframes */
  }
}

let modelAbort: AbortController | null = null;
let nonce = 1;
let parsedCache: { id: string; text: string; pdb: PdbResidues } | null = null;

const emptyStatus: Status = { structure: 'idle', pae: 'idle', plddt: 'idle', msa: 'idle' };

function paeViewOf(s: AppState) {
  return {
    lut: s.lut ?? new Float32Array([0]),
    mode: s.paeColormap,
    scaleMax: s.paeScaleMax,
    muteHigh: s.paeMuteHigh,
  };
}

export const useStore = create<AppState>((set, get) => ({
  manifest: null,
  lut: null,
  manifestStatus: 'idle',
  error: null,
  baseUrl: '',
  baseUrlHow: '',

  model: null,
  structureText: null,
  plddt: null,
  pae: null,
  paeTiming: null,
  msa: null,
  residueMap: null,
  msaRow: -1,
  pdb: null,
  status: { ...emptyStatus },

  colorMode: 'domain',
  repr: 'cartoon',
  tab: 'pae',
  paeColormap: 'accent',
  paeScaleMax: 12,
  paeShowDomains: true,
  paeMuteHigh: true,
  paeShowLabels: true,
  paeInvertY: true,
  paeSymmetry: 'full',
  paeWindow: { x0: 0, y0: 0, x1: 1, y1: 1 },
  highlightSelectionVisual: true,
  molstarAdvanced: lsGet('orf1.molstarAdvanced') === '1',
  msaOpen: false,
  msaHeight: 260,
  helpOpen: false,
  settingsOpen: false,

  selection: null,
  hover: [],
  cursor: null,

  init: async () => {
    try {
      const { base, how } = await resolveDataBaseUrl();
      set({ baseUrl: base, baseUrlHow: how });
      set({ manifestStatus: 'loading' });
      const manifest = await loadManifest();
      const lut = new Float32Array(manifest.pae.lut);
      set({ manifest, lut, manifestStatus: 'ready' });
    } catch (e) {
      set({ manifestStatus: 'error', error: String(e instanceof Error ? e.message : e) });
      return;
    }
    const params = new URLSearchParams(location.search);
    const requested = params.get('model');
    const m = get().manifest!;
    const id = requested && m.models.some((x) => x.id === requested) ? requested : m.models[0]?.id;
    if (id) await get().setModel(id);
    const tabParam = params.get('tab');
    if (tabParam === 'accent' || tabParam === 'pae' || tabParam === 'plddt') set({ tab: tabParam });
    const colorParam = params.get('color');
    if (colorParam && ['plddt', 'plddtSmooth', 'domain', 'chain', 'uniform'].includes(colorParam))
      set({ colorMode: colorParam as ColorMode });
    if (params.get('msa') === '1') set({ msaOpen: true });
    syncUrl(get());
  },

  setModel: async (id, opts = {}) => {
    const s = get();
    const entry = s.manifest?.models.find((m) => m.id === id) ?? null;
    if (!entry) return;
    modelAbort?.abort();
    const ctrl = new AbortController();
    modelAbort = ctrl;
    set({
      model: entry,
      structureText: null,
      plddt: null,
      pae: null,
      paeTiming: null,
      residueMap: null,
      msaRow: -1,
      paeWindow: { x0: 0, y0: 0, x1: 1, y1: 1 },
      selection: opts.keepSelection ? s.selection : null,
      hover: [],
      cursor: null,
      error: s.error && s.error.startsWith('PAE') ? null : s.error,
      status: { ...emptyStatus, msa: s.msa ? 'ready' : 'idle' },
    });

    // structure first: it is what the user looks at
    (async () => {
      try {
        set({ status: { ...get().status, structure: 'loading' } });
        const text = await loadStructure(entry, ctrl.signal);
        if (ctrl.signal.aborted) return;
        set({ structureText: text, status: { ...get().status, structure: 'ready' } });
        get().recomputeResidueMap();
      } catch (e) {
        if (ctrl.signal.aborted) return;
        set({
          status: { ...get().status, structure: 'error' },
          error: `Structure: ${String(e instanceof Error ? e.message : e)}`,
        });
      }
    })();

    (async () => {
      try {
        set({ status: { ...get().status, plddt: 'loading' } });
        const plddt = await loadPlddt(entry, ctrl.signal);
        if (ctrl.signal.aborted) return;
        set({ plddt, status: { ...get().status, plddt: 'ready' } });
      } catch (e) {
        if (!ctrl.signal.aborted) set({ status: { ...get().status, plddt: 'error' } });
      }
    })();

    (async () => {
      try {
        set({ status: { ...get().status, pae: 'loading' } });
        const st = get();
        const url = currentDataUrl(entry.paePath);
        const t0 = performance.now();
        const matrix = await decodePae(
          await fetchBytes(url, ctrl.signal),
          entry.paeFormat,
          entry.id,
          url,
          paeViewOf(st),
          entry.verify?.points ?? [],
          entry.verify?.decoded ?? []
        );
        if (ctrl.signal.aborted) return;
        set({
          pae: matrix,
          paeTiming: { decode: performance.now() - t0, color: 0 },
          status: { ...get().status, pae: 'ready' },
          error: !matrix.checks.ok ? `PAE decode mismatch (Δ=${matrix.checks.maxAbsErr.toFixed(2)} Å)` : get().error,
        });
      } catch (e) {
        if (!ctrl.signal.aborted) {
          set({
            status: { ...get().status, pae: 'error' },
            error: `PAE: ${String(e instanceof Error ? e.message : e)}`,
          });
        }
      }
    })();

    if (!get().msa) void get().loadMsa();
  },

  recomputeResidueMap: () => {
    const { msa, structureText, model } = get();
    if (!structureText || !model) return;
    let parsed =
      parsedCache && parsedCache.id === model.id && parsedCache.text === structureText
        ? parsedCache.pdb
        : null;
    if (!parsed) {
      parsed = parsePdbResidues(structureText);
      parsedCache = { id: model.id, text: structureText, pdb: parsed };
    }
    let map: ResidueMap | null = null;
    let rowIdx = -1;
    if (msa) {
      // MAFFT truncates record names to 10 chars, so several models can map to
      // the same prefix (the parser suffixes real collisions with "#k"). Pick the
      // candidate row that actually matches this structure's sequence.
      const candidates: number[] = [];
      for (const key of Object.keys(msa.indexByName)) {
        const root = key.split('#')[0];
        if (root === model.msaName || (root.length >= 6 && model.id.startsWith(root))) candidates.push(msa.indexByName[key]);
      }
      let bestScore = Infinity;
      for (const idx of candidates) {
        const cand = mapRowToResidues(msa.rows[idx], parsed.oneLetter);
        const mismatch = cand.compared ? cand.mismatches / cand.compared : 0;
        const lenPenalty = (Math.abs(cand.length - model.length) / Math.max(1, model.length)) * 0.4;
        const score = mismatch + lenPenalty;
        if (score < bestScore) {
          bestScore = score;
          rowIdx = idx;
        }
      }
      if (rowIdx >= 0) map = mapRowToResidues(msa.rows[rowIdx], parsed.oneLetter);
    }
    set({ pdb: parsed, residueMap: map, msaRow: rowIdx });
  },

  reloadStructure: async () => {
    const entry = get().model;
    if (!entry) return;
    const ctrl = new AbortController();
    try {
      set({ status: { ...get().status, structure: 'loading' } });
      const text = await loadStructure({ ...entry }, ctrl.signal);
      set({ structureText: text, status: { ...get().status, structure: 'ready' } });
    } catch (e) {
      set({ status: { ...get().status, structure: 'error' }, error: String(e) });
    }
  },

  loadMsa: async () => {
    const manifest = get().manifest;
    if (!manifest?.msa?.path) return;
    if (get().status.msa === 'loading') return;
    try {
      set({ status: { ...get().status, msa: 'loading' } });
      const url = currentDataUrl(manifest.msa.path);
      const bytes = await fetchBytes(url);
      let data: MsaData | null = null;
      const raw = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      if (!msaWorker.unavailable) {
        try {
          const res = await msaWorker.call<MsaData>({ bytes: raw }, [raw]);
          data = res;
        } catch (e) {
          console.warn('MSA worker failed, parsing on the main thread', e);
        }
      }
      if (!data) data = parseClustal(bytesToText(bytes));
      set({ msa: data, status: { ...get().status, msa: 'ready' } });
      get().recomputeResidueMap();
    } catch (e) {
      set({ status: { ...get().status, msa: 'error' }, error: `MSA: ${String(e)}` });
    }
  },

  setPaeView: (patch) => {
    set(patch as Partial<AppState>);
    scheduleRecolor(set, get);
    syncUrl(get());
  },

  setPaeWindow: (w) => set({ paeWindow: { ...get().paeWindow, ...w } }),
  resetPaeWindow: () => set({ paeWindow: { x0: 0, y0: 0, x1: 1, y1: 1 } }),

  setColorMode: (colorMode) => {
    set({ colorMode });
    syncUrl(get());
  },
  setRepr: (repr) => set({ repr }),
  setTab: (tab) => {
    set({ tab });
    syncUrl(get());
  },

  setSelection: (sel) => set(sel ? { selection: { ...sel, nonce: nonce++ } } : { selection: null }),

  selectPair: (i, j) =>
    set({
      selection: {
        ranges: [
          { s: i, e: i },
          { s: j, e: j },
        ],
        cross: { a: { s: i, e: i }, b: { s: j, e: j } },
        label: `pair ${i} ↔ ${j}`,
        source: 'pair',
        nonce: nonce++,
      },
    }),

  selectRange: (s, e, source = 'plddt', label) =>
    set({
      selection: {
        ranges: [{ s, e }],
        label: label ?? `residues ${s}–${e}`,
        source,
        nonce: nonce++,
      },
    }),

  setHover: (hover) => {
    const cur = get().hover;
    if (cur.length === hover.length && cur.every((v, k) => v === hover[k])) return;
    set({ hover });
  },
  setCursor: (cursor) => set({ cursor }),

  toggleMsa: (open) => {
    set((s) => ({ msaOpen: open ?? !s.msaOpen }));
    syncUrl(get());
  },
  setMsaHeight: (msaHeight) => set({ msaHeight }),
  setMolstarAdvanced: (molstarAdvanced) => {
    set({ molstarAdvanced });
    lsSet('orf1.molstarAdvanced', molstarAdvanced ? '1' : '0');
  },
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),

  applyDataBaseUrl: async (base) => {
    setDataBaseUrl(base);
    set({ manifest: null, manifestStatus: 'idle', error: null, model: null, pae: null, msa: null });
    await get().init();
  },

  downloadCurrent: async (kind) => {
    const entry = get().model;
    if (!entry) return;
    const path =
      kind === 'pdb' ? entry.pdbPath : kind === 'pdbFull' ? entry.pdbFullPath ?? entry.pdbPath : entry.accentuatedPaePath;
    if (!path) throw new Error('this artifact was not built (check the prepare_data.py preset)');
    const blob = await loadBinaryForDownload(path);
    const { downloadBlob } = await import('../lib/util');
    // '…_full-atom.pdb' (decompressed) rather than '…pdb.gz' so it opens directly
    const suffix = kind === 'paeImage' ? 'accentuated_PAE.webp' : kind === 'pdbFull' ? 'full-atom.pdb' : 'backbone.pdb';
    downloadBlob(kind === 'paeImage' ? blob : await gunzipBlob(blob), `${entry.id}_${suffix}`);
  },
}));

// recoloring is debounced: dragging the scale slider would otherwise re-render 2.9 M pixels per event
const recolorImpl = (set: (p: Partial<AppState>) => void, get: () => AppState) => {
  const s = get();
  if (!s.pae) return;
  const prev = s.status.pae;
  set({ status: { ...s.status, pae: 'loading' } });
  void recolorPae(s.pae, paeViewOf(s))
    .then((next) => {
      if (get().pae?.id !== next.id) return;
      set({ pae: next, status: { ...get().status, pae: 'ready' } });
    })
    .catch(() => set({ status: { ...get().status, pae: prev } }));
};
const scheduleRecolor = debounce(recolorImpl, 140);

export const selectors = {
  modelById: (id: string | null | undefined) => {
    if (!id) return null;
    const m = useStore.getState().manifest;
    return m?.models.find((x) => x.id === id) ?? null;
  },
};
