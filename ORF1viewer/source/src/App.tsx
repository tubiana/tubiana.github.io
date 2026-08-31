import { useEffect, useRef, useState } from 'react';
import { useStore } from './state/store';
import { Header } from './components/Header';
import { StructurePanel } from './components/StructurePanel';
import { AnalysisTabs } from './components/AnalysisTabs';
import { MsaDrawer } from './components/MsaDrawer';
import { HelpOverlay, SettingsOverlay } from './components/Overlays';
import { SequenceSearchOverlay } from './components/SequenceSearch';
import { Btn, ErrorBanner } from './components/ui';
import { clamp, lsGet, lsSet } from './lib/util';

export function App() {
  const manifest = useStore((s) => s.manifest);
  const baseUrl = useStore((s) => s.baseUrl);
  const baseUrlHow = useStore((s) => s.baseUrlHow);
  const manifestStatus = useStore((s) => s.manifestStatus);
  const annotations = useStore((s) => s.annotations);
  const error = useStore((s) => s.error);
  const init = useStore((s) => s.init);
  const helpOpen = useStore((s) => s.helpOpen);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const sequenceSearchOpen = useStore((s) => s.sequenceSearchOpen);
  const setSequenceSearchOpen = useStore((s) => s.setSequenceSearchOpen);
  const setHelpOpen = useStore((s) => s.setHelpOpen);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const toggleMsa = useStore((s) => s.toggleMsa);
  const setTab = useStore((s) => s.setTab);

  const [ratio, setRatio] = useState(() => clamp(Number(lsGet('orf1.split', '60')) || 60, 32, 76));
  const [dragging, setDragging] = useState(false);
  const mainRef = useRef<HTMLDivElement | null>(null);
  const booted = useRef(false);

  // boot: manifest + URL state (?model= …) live in the store's init()
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void init();
  }, [init]);

  // keep the URL in sync with the current model / tab / colour mode
  useEffect(() => {
    const onNav = () => {
      const p = new URLSearchParams(location.search);
      const id = p.get('model');
      if (id) {
        const st = useStore.getState();
        if (id !== st.model?.id && st.manifest?.models.some((m) => m.id === id)) void st.setModel(id);
      }
    };
    window.addEventListener('popstate', onNav);
    return () => window.removeEventListener('popstate', onNav);
  }, []);

  // global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
      if (e.key === 'Escape') {
        if (helpOpen) setHelpOpen(false);
        else if (settingsOpen) setSettingsOpen(false);
        else if (sequenceSearchOpen) setSequenceSearchOpen(false);
        return;
      }
      if (typing) return;
      if (e.key === '/') {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('input[data-search="model"]')?.focus();
      } else if (e.key === '?') {
        setHelpOpen(true);
      } else if (e.key === 'm' || e.key === 'M') {
        toggleMsa();
      } else if (e.key === '1') setTab('pae');
      else if (e.key === '2') setTab('plddt');
      else if (e.key === '3') setTab('accent');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [helpOpen, settingsOpen, sequenceSearchOpen, setHelpOpen, setSettingsOpen, setSequenceSearchOpen, toggleMsa, setTab]);

  // split-pane drag
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const box = mainRef.current?.getBoundingClientRect();
      if (!box) return;
      setRatio(clamp(((e.clientX - box.left) / box.width) * 100, 32, 76));
    };
    const stop = () => {
      setDragging(false);
      setRatio((r) => {
        lsSet('orf1.split', String(Math.round(r)));
        return r;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
    };
  }, [dragging]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#070b11] text-slate-200">
      <Header />

      {error && (
        <div className="px-2 pt-2">
          <ErrorBanner message={error} />
        </div>
      )}

      {manifestStatus !== 'ready' && (
        <div className="grid flex-1 place-items-center px-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="h-8 w-8 animate-pulse rounded-full border-2 border-sky-500/30 border-t-sky-400" />
            <div className="text-[13px] text-slate-400">
              {manifestStatus === 'error' ? 'the data payload could not be loaded' : 'loading the model catalogue…'}
            </div>
            <div className="max-w-[42rem] break-all text-[11px] leading-relaxed text-slate-600">
              {baseUrl || new URL('data/', document.baseURI).toString()}
              {baseUrlHow ? ` · via ${baseUrlHow}` : ''}
            </div>
          </div>
        </div>
      )}

      {manifest && (
        <>
          <main ref={mainRef} className="flex min-h-0 flex-1 flex-col p-2 lg:flex-row">
            <div
              className="flex min-h-0 min-w-0 flex-col lg:basis-[var(--split)] lg:grow-0 lg:shrink"
              style={{ ['--split' as string]: `${ratio}%` }}
            >
              <StructurePanel />
            </div>
            <div
              role="separator"
              aria-orientation="vertical"
              onPointerDown={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDoubleClick={() => {
                setRatio(60);
                lsSet('orf1.split', '60');
              }}
              title="drag to resize · double-click to reset the 60/40 split"
              className={`hidden w-[6px] shrink-0 cursor-col-resize items-center justify-center lg:flex ${
                dragging ? 'bg-sky-500/50' : 'hover:bg-slate-700'
              }`}
            >
              <span className="h-9 w-[2px] rounded-full bg-slate-600 group-hover:bg-sky-400" />
            </div>
            <div
              className="flex min-h-0 min-w-0 flex-col lg:basis-[calc(100%-var(--split)-6px)] lg:grow-0 lg:shrink"
              style={{ ['--split' as string]: `${ratio}%` }}
            >
              <AnalysisTabs />
            </div>
          </main>
          <MsaDrawer />
          <footer className="hidden h-[22px] shrink-0 items-center gap-3 border-t border-slate-800 px-3 text-[10.5px] text-slate-600 lg:flex">
            <span>
              {manifest.counts.models} AlphaFold2 ORF1 models · {manifest.hosts.length} hosts · payload built{' '}
              {manifest.generatedAt.slice(0, 10)}
            </span>
            <span title={annotations.source ? annotations.source : 'annotation table not reachable'}>
              {annotations.source
                ? `annotation table ${annotations.patched}/${annotations.total} (${annotations.source.split('/').pop()})`
                : 'annotations from manifest copy (?annotations=… to point elsewhere)'}
            </span>
            <span>
              PAE = lossless 8-bit image + manifest LUT (<span className="text-slate-500">{manifest.pae.lutName}</span>, ≤
              {manifest.pae.maxErrorA ?? '—'} Å) — decoded in the browser
            </span>
            <span className="ml-auto flex items-center gap-2">
              <kbd>/</kbd> search <kbd>M</kbd> MSA <kbd>1</kbd>
              <kbd>2</kbd>
              <kbd>3</kbd> tabs <kbd>F</kbd> focus <kbd>R</kbd> camera <kbd>?</kbd> help
              <Btn className="!py-0" onClick={() => setHelpOpen(true)}>
                open help
              </Btn>
            </span>
          </footer>
        </>
      )}

      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
      {settingsOpen && <SettingsOverlay onClose={() => setSettingsOpen(false)} />}
      {sequenceSearchOpen && <SequenceSearchOverlay onClose={() => setSequenceSearchOpen(false)} />}
    </div>
  );
}
