import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  setViewerTheme,
} from '../mol/scene';
import { useStore, type ColorMode, type ReprKind } from '../state/store';
import { IconBtn, MenuLabel, Popover, Segmented, Spinner, Icon } from './ui';
import { rafThrottle } from '../lib/util';
import { viewerBackground } from '../lib/theme';

const COLOR_MODES: { value: ColorMode; label: string; hint: string }[] = [
  { value: 'domain', label: 'Domains', hint: 'Annotated domain ranges, as on the map above. Grey = unannotated.' },
  { value: 'plddt', label: 'pLDDT', hint: 'AlphaFold confidence bands, as on the ribbon above.' },
  { value: 'plddtSmooth', label: 'pLDDT gradient', hint: 'Continuous pLDDT colour ramp' },
  { value: 'chain', label: 'Chain', hint: 'One colour per chain' },
  { value: 'uniform', label: 'Plain', hint: 'A single colour' },
];

/*
 * The model is full-atom: `Licorice` = Mol* `line` (thin bonds, side chains
 * included), `Ball & stick` = spheres + cylinders, `Sphere`/`Spacefill` = vdW,
 * and the two surface types for the molecular surface. Ligands/ions never use
 * cartoon/surface — `reprTypeFor()` in src/mol/scene.ts keeps them visible.
 */
const REPRS: { value: ReprKind; label: string }[] = [
  { value: 'cartoon', label: 'Cartoon' },
  { value: 'backbone', label: 'Backbone' },
  { value: 'licorice', label: 'Licorice' },
  { value: 'ballStick', label: 'Ball and stick' },
  { value: 'sphere', label: 'Sphere' },
  { value: 'spacefill', label: 'Spacefill' },
  { value: 'surface', label: 'Surface (slow)' },
  { value: 'molecularSurface', label: 'Molecular surface (slow)' },
];

export function StructurePanel() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const pluginRef = useRef<PluginUIContext | null>(null);
  const structRef = useRef<Structure | null>(null);
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [spin, setSpinOn] = useState(false);
  const [molErr, setMolErr] = useState<string | null>(null);
  const advanced = useStore((s) => s.molstarAdvanced);

  const model = useStore((s) => s.model);
  const structureText = useStore((s) => s.structureText);
  const plddt = useStore((s) => s.plddt);
  const statusStructure = useStore((s) => s.status.structure);
  const statusPlddt = useStore((s) => s.status.plddt);
  const selection = useStore((s) => s.selection);
  const setSelection = useStore((s) => s.setSelection);
  const setAdvanced = useStore((s) => s.setMolstarAdvanced);
  const highlightVisual = useStore((s) => s.highlightSelectionVisual);
  const theme = useStore((s) => s.theme);
  const colorMode = useStore((s) => s.colorMode);
  const setColorMode = useStore((s) => s.setColorMode);
  const repr = useStore((s) => s.repr);
  const setRepr = useStore((s) => s.setRepr);
  const focusRequest = useStore((s) => s.focusRequest);

  // ---------------------------------------------------------------- create
  useEffect(() => {
    let disposed = false;
    let scene: { plugin: PluginUIContext; dispose: () => void } | null = null;
    const host = hostRef.current;
    if (!host) return;
    (async () => {
      try {
        const ctx = await createScene(host, { advanced, background: viewerBackground(useStore.getState().theme) });
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
  }, [advanced]);

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
        // the previous structure is gone: re-apply highlight + selection to the new one
        if (struct) {
          const st = useStore.getState();
          const sel = st.selection ? residuesFromRanges(st.selection.ranges) : new Set<number>(st.hover);
          if (sel.size) {
            if (st.highlightSelectionVisual) setSelectionVisual(plugin, struct, sel);
            else highlightResidues(plugin, struct, sel);
          }
        }
      } catch (e) {
        console.error(e);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, structureText, plddt, statusPlddt, modelId]);

  useEffect(() => {
    if (ready && pluginRef.current) setViewerTheme(pluginRef.current, viewerBackground(theme), theme === 'light');
  }, [theme, ready]);

  // "Focus in 3D" from the selection line
  useEffect(() => {
    if (!focusRequest || !pluginRef.current) return;
    const st = useStore.getState();
    const sel = st.selection ? residuesFromRanges(st.selection.ranges) : new Set<number>(st.hover);
    focusResidues(pluginRef.current, structRef.current, sel);
  }, [focusRequest]);

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
      // the selection has its own visual (neutral tint + outline); the yellow hover
      // highlight on top of it would shift the domain colours. Only fall back to
      // highlighting it when that visual is off.
      const sel = new Set<number>();
      if (st.selection && !st.highlightSelectionVisual)
        for (const r of st.selection.ranges) for (let i = r.s; i <= r.e; i++) sel.add(i);
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

  const focusSel = () => {
    const st = useStore.getState();
    const sel = st.selection ? residuesFromRanges(st.selection.ranges) : new Set<number>(st.hover);
    if (pluginRef.current) focusResidues(pluginRef.current, structRef.current, sel);
  };

  return (
    <div
      ref={wrapRef}
      className={`panel relative min-h-0 flex-1 overflow-hidden${advanced ? ' viewer-advanced' : ''}`}
    >
      <div ref={hostRef} className={`mol-host${advanced ? ' advanced' : ''}`} />

      {statusStructure === 'loading' && !ready && (
        <div className="absolute inset-0 grid place-items-center text-muted">
          <div className="flex items-center gap-2">
            <Spinner size={16} /> Starting the 3D viewer…
          </div>
        </div>
      )}
      {statusStructure === 'loading' && ready && (
        <div className="popover absolute bottom-3 left-3 flex items-center gap-2 px-2.5 py-1.5 text-[12px] text-muted">
          <Spinner size={11} /> Loading {model?.accession || model?.id}
        </div>
      )}
      {initError && (
        <div className="absolute inset-x-3 top-14 rounded-md border border-danger/40 bg-surface p-3 text-[12.5px] text-danger">
          {initError}
        </div>
      )}

      {/* appearance: what the colours mean is one click away, on the viewer itself */}
      {!advanced && (
        <div className="absolute left-3 top-3 flex items-center gap-1.5">
          <Segmented
            label="Colour by"
            value={colorMode}
            options={COLOR_MODES.slice(0, 2)}
            onChange={setColorMode}
          />
          <Popover
            trigger={({ open, toggle }) => (
              <button type="button" className="btn" data-active={open ? 'true' : 'false'} onClick={toggle} aria-expanded={open}>
                {REPRS.find((r) => r.value === repr)?.label ?? 'Style'}
                {colorMode !== 'domain' && colorMode !== 'plddt' && (
                  <span className="text-muted">, {COLOR_MODES.find((c) => c.value === colorMode)?.label}</span>
                )}
                <Icon name="chevronDown" size={14} />
              </button>
            )}
            panelClassName="w-[15rem]"
          >
            {(close) => (
              <>
                <MenuLabel>Representation</MenuLabel>
                {REPRS.map((r) => (
                  <Choice key={r.value} on={repr === r.value} onClick={() => { setRepr(r.value); close(); }}>
                    {r.label}
                  </Choice>
                ))}
                <MenuLabel>Colour</MenuLabel>
                {COLOR_MODES.map((c) => (
                  <Choice key={c.value} on={colorMode === c.value} title={c.hint} onClick={() => { setColorMode(c.value); close(); }}>
                    {c.label}
                  </Choice>
                ))}
              </>
            )}
          </Popover>
        </div>
      )}

      <div className="absolute right-2 top-2 flex flex-col gap-0.5 rounded-lg bg-surface/80 p-0.5 backdrop-blur-sm">
        <IconBtn icon="reset" label="Reset the camera (R)" onClick={() => pluginRef.current && resetCamera(pluginRef.current)} />
        <IconBtn icon="focus" label="Frame the selection (F)" onClick={focusSel} disabled={!selection} />
        <IconBtn icon="spin" label={spin ? 'Stop rotating' : 'Rotate slowly'} active={spin} onClick={toggleSpin} />
        <IconBtn icon="camera" label="Save the view as PNG" onClick={() => void doScreenshot()} />
        <IconBtn icon="expand" label="Full screen" onClick={toggleFullscreen} />
        <IconBtn
          icon="panels"
          label={advanced ? 'Hide the Mol* panels' : 'Show the Mol* panels (scene, styles, components)'}
          active={advanced}
          onClick={() => setAdvanced(!advanced)}
        />
      </div>

      {molErr && (
        <div className="absolute inset-x-3 bottom-3 rounded-md border border-warn/40 bg-surface p-2 text-[12px] text-warn">
          3D view: {molErr}
        </div>
      )}
    </div>
  );
}

function Choice({
  on,
  onClick,
  title,
  children,
}: {
  on: boolean;
  onClick: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-[var(--hover)]"
    >
      <span className="w-4 text-fg">{on ? <Icon name="check" size={14} /> : null}</span>
      {children}
    </button>
  );
}
