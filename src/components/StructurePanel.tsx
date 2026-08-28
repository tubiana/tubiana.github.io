import { useEffect, useRef, useState } from 'react';
import type { PluginUIContext } from 'molstar/lib/mol-plugin-ui/context.js';
import type { Structure } from 'molstar/lib/mol-model/structure.js';
import {
  createScene,
  molDiagnostics,
  showStructure,
  setColorMode as sceneSetColorMode,
  setRepr as sceneSetRepr,
  highlightResidues,
  setSelectionVisual,
  setSpin as sceneSetSpin,
  focusResidues,
  resetCamera,
  captureViewport,
  residuesFromRanges,
  setUiAdvanced,
} from '../mol/scene';
import { useStore } from '../state/store';
import { Btn, Spinner } from './ui';
import { PLDDT_BANDS } from '../lib/colormap';
import { rafThrottle } from '../lib/util';

export function StructurePanel() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const pluginRef = useRef<PluginUIContext | null>(null);
  const structRef = useRef<Structure | null>(null);
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [loadMs, setLoadMs] = useState<number | null>(null);
  const [spin, setSpinOn] = useState(false);
  const [molErr, setMolErr] = useState<string | null>(null);
  const advanced = useStore((s) => s.molstarAdvanced);

  const model = useStore((s) => s.model);
  const structureText = useStore((s) => s.structureText);
  const plddt = useStore((s) => s.plddt);
  const colorMode = useStore((s) => s.colorMode);
  const repr = useStore((s) => s.repr);
  const statusStructure = useStore((s) => s.status.structure);
  const statusPlddt = useStore((s) => s.status.plddt);
  const selection = useStore((s) => s.selection);
  const setSelection = useStore((s) => s.setSelection);
  const setAdvanced = useStore((s) => s.setMolstarAdvanced);
  const highlightVisual = useStore((s) => s.highlightSelectionVisual);

  // ---------------------------------------------------------------- create
  useEffect(() => {
    let disposed = false;
    let scene: { plugin: PluginUIContext; dispose: () => void } | null = null;
    const host = hostRef.current;
    if (!host) return;
    (async () => {
      try {
        const ctx = await createScene(host);
        if (disposed) {
          ctx.dispose();
          return;
        }
        scene = ctx;
        pluginRef.current = ctx.plugin;
        setReady(true);
      } catch (e) {
        console.error(e);
        const msg = String(e instanceof Error ? e.message : e);
        setInitError(
          msg.toLowerCase().includes('webgl')
            ? `${msg.replace(/\.+$/, '')}. Try Chrome or Firefox with hardware acceleration enabled, or use the PAE / pLDDT / MSA panels on the right.`
            : `Could not start the Mol* viewer: ${msg}.`
        );
      }
    })();
    return () => {
      disposed = true;
      scene?.dispose();
      pluginRef.current = null;
      setReady(false);
    };
  }, []);

  // ------------------------------------------------------------- (re)load
  const modelId = model?.id ?? null;
  // Loads are serialized (showStructure clears the scene, so two overlapping runs
  // could leave the *older* model on screen) and superseded by request id.
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const reqRef = useRef(0);
  useEffect(() => {
    if (!ready || !pluginRef.current) return;
    if (!structureText || !model) return;
    if (statusPlddt === 'loading') return; // wait for pLDDT so the first paint is coloured
    const req = ++reqRef.current;
    queueRef.current = queueRef.current.then(async () => {
      const plugin = pluginRef.current;
      if (!plugin || req !== reqRef.current) return;
      const t0 = performance.now();
      try {
        const struct = await showStructure(plugin, structureText, {
          label: model.id,
          plddt,
          domains: model.domains,
          repr,
          colorMode,
        });
        if (req !== reqRef.current) return;
        structRef.current = struct ?? null;
        setLoadMs(performance.now() - t0);
        // the previous structure is gone: re-apply highlight + selection to the new one
        if (struct) {
          const st = useStore.getState();
          const sel = st.selection ? residuesFromRanges(st.selection.ranges) : new Set<number>(st.hover);
          if (sel.size) {
            if (st.highlightSelectionVisual) setSelectionVisual(plugin, struct, sel);
            highlightResidues(plugin, struct, sel);
          }
        }
      } catch (e) {
        console.error(e);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, structureText, plddt, statusPlddt, modelId]);

  // ------------------------------------------------ Mol* UI: simple ↔ full
  useEffect(() => {
    hostRef.current?.classList.toggle('advanced', advanced);
    if (ready && pluginRef.current) setUiAdvanced(pluginRef.current, advanced);
  }, [advanced, ready]);

  // -------------------------------------------------------- appearance fx
  useEffect(() => {
    if (!ready || !pluginRef.current || !structureText) return;
    void sceneSetColorMode(pluginRef.current, colorMode);
  }, [colorMode, ready, structureText]);

  useEffect(() => {
    if (!ready || !pluginRef.current || !structureText) return;
    void sceneSetRepr(pluginRef.current, repr);
  }, [repr, ready, structureText]);

  // Mol* call failures are recorded in molDiagnostics: show them, don't hide in a console
  useEffect(() => {
    const sync = () => setMolErr(molDiagnostics.lastError);
    const t = window.setInterval(sync, 700);
    return () => window.clearInterval(t);
  }, []);

  // ------------------------------------------------- hover + selection fx
  useEffect(() => {
    if (!ready || !pluginRef.current) return;
    const plugin = pluginRef.current;
    const apply = rafThrottle(() => {
      const st = useStore.getState();
      const struct = structRef.current;
      if (!struct) return;
      const sel = new Set<number>();
      if (st.selection) for (const r of st.selection.ranges) for (let i = r.s; i <= r.e; i++) sel.add(i);
      for (const r of st.hover) sel.add(r);
      highlightResidues(plugin, struct, sel);
    });
    apply();
    const unsub = useStore.subscribe((s, prev) => {
      if (s.hover !== prev.hover || s.selection !== prev.selection) apply();
    });
    return () => {
      unsub();
      apply.cancel();
    };
  }, [ready]);

  useEffect(() => {
    if (!ready || !pluginRef.current) return;
    const plugin = pluginRef.current;
    const residues = selection ? residuesFromRanges(selection.ranges) : new Set<number>();
    if (highlightVisual) setSelectionVisual(plugin, structRef.current, residues);
    if (selection && (selection.source === 'pair' || selection.source === 'domain')) {
      focusResidues(plugin, structRef.current, residues);
    }
  }, [selection, ready, highlightVisual]);

  // ------------------------------------------------------------ shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
      if (!pluginRef.current) return;
      const st = useStore.getState();
      if (e.key === 'r' || e.key === 'R') resetCamera(pluginRef.current);
      else if (e.key === 'f' || e.key === 'F') {
        const sel = st.selection ? residuesFromRanges(st.selection.ranges) : new Set<number>(st.hover);
        focusResidues(pluginRef.current, structRef.current, sel);
      } else if (e.key === 'Escape') setSelection(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSelection]);

  const toggleSpin = () => {
    const plugin = pluginRef.current;
    if (!plugin) return;
    const next = !spin;
    setSpinOn(next);
    sceneSetSpin(plugin, next);
  };

  const doScreenshot = async () => {
    const plugin = pluginRef.current;
    if (!plugin) return;
    const ok = await captureViewport(plugin, `ORF1_${model?.id ?? 'model'}.png`);
    if (!ok) {
      setInitError('The viewport could not be captured (no frame available from this GL context).');
      window.setTimeout(() => setInitError(null), 3000);
    }
  };

  const toggleFullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  return (
    <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-800 bg-[#0b1017]">
      <div ref={hostRef} className={`mol-host${advanced ? ' advanced' : ''}`} />

      {statusStructure === 'loading' && !ready && (
        <div className="absolute inset-0 grid place-items-center text-slate-400">
          <div className="flex items-center gap-2 text-[13px]">
            <Spinner size={16} /> starting Mol*…
          </div>
        </div>
      )}
      {statusStructure === 'loading' && ready && (
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded-md border border-slate-700 bg-slate-950/80 px-2 py-1 text-[11px] text-slate-300">
          <Spinner size={11} /> loading {model?.id}
        </div>
      )}
      {initError && (
        <div className="absolute inset-x-3 top-3 rounded-lg border border-rose-800 bg-rose-950/70 p-3 text-[12px] text-rose-200">
          {initError}
        </div>
      )}

      {/* quick actions */}
      <div className="pointer-events-none absolute bottom-9 left-2 flex flex-col items-start gap-1">
        <div className="pointer-events-auto flex flex-col items-start gap-1 rounded-lg border border-slate-800/80 bg-slate-950/70 p-1 backdrop-blur">
          <Btn onClick={() => pluginRef.current && resetCamera(pluginRef.current)} title="reset camera (R)">
            ⟲ camera
          </Btn>
          <Btn
            onClick={() => {
              const st = useStore.getState();
              const sel = st.selection ? residuesFromRanges(st.selection.ranges) : new Set<number>(st.hover);
              if (pluginRef.current) focusResidues(pluginRef.current, structRef.current, sel);
            }}
            title="frame the current selection (F)"
            disabled={!selection}
          >
            ⛶ focus
          </Btn>
          <Btn onClick={toggleSpin} active={spin} title="toggle slow rotation">
            ↻ spin
          </Btn>
          <Btn onClick={() => void doScreenshot()} title="save a PNG of the viewport">
            ◍ png
          </Btn>
          <Btn onClick={toggleFullscreen} title="fullscreen the 3D panel">
            ⤢ full
          </Btn>
          <Btn
            onClick={() => setAdvanced(!advanced)}
            active={advanced}
            title="show Mol*'s own panels (scene graph, styles & properties, settings, sequence view) next to the viewport"
          >
            ⚙ molstar
          </Btn>
          <Btn onClick={() => setSelection(null)} title="clear the selection (Esc)" disabled={!selection}>
            ✕ clear
          </Btn>
        </div>
      </div>

      {/* legend */}
      <Legend />

      {/* footer status */}
      {molErr && (
        <div className="absolute inset-x-2 bottom-14 rounded-lg border border-amber-800 bg-amber-950/70 p-2 text-[11px] leading-snug text-amber-200">
          <span className="font-semibold">3D:</span> {molErr}{' '}
          <span className="text-amber-400/70">
            (console: __orf1.mol.diagnostics.errors)
          </span>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-1.5 left-2 flex items-center gap-2 text-[10.5px] text-slate-500">
        <span>drag · rotate</span>
        <span>scroll · zoom</span>
        <span>right-drag · pan</span>
        {loadMs != null && <span className="tabular text-slate-600">loaded in {Math.round(loadMs)} ms</span>}
      </div>
    </div>
  );
}

function Legend() {
  const colorMode = useStore((s) => s.colorMode);
  const model = useStore((s) => s.model);
  const manifestDomains = useStore((s) => s.manifest?.domains ?? []);
  if (colorMode === 'plddt' || colorMode === 'plddtSmooth') {
    return (
      <div className="pointer-events-none absolute bottom-2 right-2 flex flex-col gap-1 rounded-lg border border-slate-800/80 bg-slate-950/70 p-2 backdrop-blur">
        <div className="label">pLDDT (Å-score)</div>
        {PLDDT_BANDS.map((b) => (
          <div key={b.label} className="flex items-center gap-1.5 text-[10.5px] text-slate-400">
            <span className="h-2.5 w-4 rounded-sm" style={{ background: b.color }} />
            {b.label}
          </div>
        ))}
      </div>
    );
  }
  if (colorMode === 'domain') {
    return (
      <div className="pointer-events-none absolute bottom-2 right-2 flex flex-col gap-1 rounded-lg border border-slate-800/80 bg-slate-950/70 p-2 backdrop-blur">
        <div className="label">domains</div>
        {(model?.domains ?? []).map((d, i) => {
          const swatch = manifestDomains.find((x) => x.name === d.name)?.color ?? d.color;
          return (
            <div key={`${d.name}-${i}`} className="flex items-center gap-1.5 text-[10.5px] text-slate-400">
              <span className="h-2.5 w-4 rounded-sm" style={{ background: swatch }} />
              <span className="w-[68px] truncate">{d.name}</span>
              <span className="tabular text-slate-500">{d.start}–{d.end}</span>
            </div>
          );
        })}
        <div className="flex items-center gap-1.5 text-[10.5px] text-slate-500">
          <span className="h-2.5 w-4 rounded-sm bg-[#8b93a7]" />
          unannotated
        </div>
      </div>
    );
  }
  return null;
}
