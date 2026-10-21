import { useEffect, useRef, useState } from 'react';
import { useStore } from './state/store';
import { ModelBand, TopBar } from './components/Header';
import { StructurePanel } from './components/StructurePanel';
import { AnalysisTabs } from './components/AnalysisTabs';
import { MsaDrawer } from './components/MsaDrawer';
import { HelpOverlay, SettingsOverlay } from './components/Overlays';
import { SequenceSearchOverlay } from './components/SequenceSearch';
import { ErrorBanner, Spinner } from './components/ui';
import { clamp, lsGet, lsSet } from './lib/util';

export function App() {
  const manifest = useStore((s) => s.manifest);
  const theme = useStore((s) => s.theme);
  const baseUrl = useStore((s) => s.baseUrl);
  const baseUrlHow = useStore((s) => s.baseUrlHow);
  const manifestStatus = useStore((s) => s.manifestStatus);
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

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

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
      else if (e.key === '3') setTab('tree');
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
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-ground text-fg lg:overflow-hidden">
      <TopBar />

      {error && (
        <div className="px-4 pt-2">
          <ErrorBanner message={error} />
        </div>
      )}

      {manifestStatus !== 'ready' && (
        <div className="grid flex-1 place-items-center px-6">
          <div className="flex max-w-[36rem] flex-col items-center gap-3 text-center">
            {manifestStatus === 'error' ? (
              <>
                <div className="text-[14px] font-semibold">The model catalogue could not be loaded</div>
                <div className="text-muted">
                  Check your connection, or point the viewer at another copy of the data in Settings.
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 text-muted">
                <Spinner size={16} /> Loading the model catalogue…
              </div>
            )}
            <div className="break-all text-[12px] text-faint">
              {baseUrl || new URL('data/', document.baseURI).toString()}
              {baseUrlHow ? ` (via ${baseUrlHow})` : ''}
            </div>
          </div>
        </div>
      )}

      {manifest && (
        <>
          <ModelBand />
          <main ref={mainRef} className="flex flex-col p-3 lg:min-h-0 lg:flex-1 lg:flex-row">
            <div
              className="flex min-h-[320px] min-w-0 flex-col lg:min-h-0 lg:basis-[var(--split)] lg:grow-0 lg:shrink"
              style={{ ['--split' as string]: `${ratio}%` }}
            >
              <StructurePanel />
            </div>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize panels"
              onPointerDown={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDoubleClick={() => {
                setRatio(60);
                lsSet('orf1.split', '60');
              }}
              title="Drag to resize, double-click to reset"
              className="group hidden w-3 shrink-0 cursor-col-resize items-center justify-center lg:flex"
            >
              <span
                className={`h-10 w-[3px] rounded-full transition-colors ${
                  dragging ? 'bg-fg' : 'bg-line group-hover:bg-line-strong'
                }`}
              />
            </div>
            <div
              className="mt-3 flex min-h-[420px] min-w-0 flex-col lg:mt-0 lg:min-h-0 lg:basis-[calc(100%-var(--split)-12px)] lg:grow-0 lg:shrink"
              style={{ ['--split' as string]: `${ratio}%` }}
            >
              <AnalysisTabs />
            </div>
          </main>
          <MsaDrawer />
        </>
      )}

      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
      {settingsOpen && <SettingsOverlay onClose={() => setSettingsOpen(false)} />}
      {sequenceSearchOpen && <SequenceSearchOverlay onClose={() => setSequenceSearchOpen(false)} />}
    </div>
  );
}
