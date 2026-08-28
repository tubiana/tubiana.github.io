/**
 * Right-hand analysis panel: interactive PAE matrix · 1D pLDDT + domain table ·
 * the original “accentuated PAE” figure.
 */
import { useEffect, useRef, useState } from 'react';
import { useStore, type TabId } from '../state/store';
import { PaeMatrixTab } from './PaeMatrixTab';
import { PlddtTab } from './PlddtTab';
import { Badge, Btn, Select, Spinner, Tabs } from './ui';
import { fmt } from '../lib/util';
import { currentDataUrl } from '../lib/dataSource';

export function AnalysisTabs() {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const model = useStore((s) => s.model);
  return (
    <div className="card flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-end justify-between gap-2 border-b border-slate-800 px-2 pt-1">
        <Tabs<TabId>
          value={tab}
          onChange={setTab}
          items={[
            { id: 'pae', label: 'PAE matrix' },
            { id: 'plddt', label: 'pLDDT & domains' },
            { id: 'accent', label: 'Accentuated PAE' },
          ]}
        />
        {model && (
          <span
            className="hidden shrink-0 pb-1 text-[10.5px] text-slate-500 xl:block"
            title={model.pdbSourcePath}
          >
            {model.pdbSourcePath.split('/').pop()}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'pae' && <PaeMatrixTab />}
        {tab === 'plddt' && <PlddtTab />}
        {tab === 'accent' && <AccentuatedTab />}
      </div>
    </div>
  );
}

function AccentuatedTab() {
  const model = useStore((s) => s.model);
  const downloadCurrent = useStore((s) => s.downloadCurrent);
  const [fit, setFit] = useState<'contain' | 'actual' | 'width'>('contain');
  const [zoom, setZoom] = useState(1);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [err, setErr] = useState(false);
  const resolvedSrc = model?.accentuatedPaePath ? currentDataUrl(model.accentuatedPaePath) : null;
  useEffect(() => {
    setErr(false);
    setNatural(null);
  }, [resolvedSrc]);

  if (!model) return null;
  // artifact paths in the manifest are relative to the data root, which may be
  // another host entirely — always resolve them
  const src = model.accentuatedPaePath ? currentDataUrl(model.accentuatedPaePath) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-2 py-1.5">
        <Select
          value={fit}
          options={[
            { value: 'contain', label: 'fit' },
            { value: 'width', label: 'page width' },
            { value: 'actual', label: '100 %' },
          ]}
          onChange={(v) => setFit(v as any)}
        />
        <input
          type="range"
          min={0.3}
          max={5}
          step={0.05}
          value={zoom}
          onChange={(e) => {
            setFit('actual');
            setZoom(Number(e.target.value));
          }}
          className="w-28"
          title="zoom"
        />
        <Btn onClick={() => void downloadCurrent('paeImage')} title="download the original WebP figure">
          ↓ figure
        </Btn>
        <span className="ml-auto flex items-center gap-1.5">
          <Badge label="⟨PAE⟩" value={fmt(model.meanPae, 2)} title="mean predicted aligned error, whole matrix" />
          <Badge label="pTM" value={model.pTM != null ? model.pTM.toFixed(3) : '—'} />
          {natural && (
            <span className="text-[10.5px] text-slate-500">
              {natural.w}×{natural.h} px
            </span>
          )}
        </span>
      </div>
      <div className="canvas-scroll min-h-0 flex-1 overflow-auto bg-[#0a0e14] p-3">
        {!src ? (
          <div className="grid h-full place-items-center text-[12px] text-slate-500">
            this model has no accentuated PAE figure
          </div>
        ) : err ? (
          <div className="grid h-full place-items-center text-[12px] text-rose-300">
            could not load the figure — the data root may be unreachable (⚙ settings)
          </div>
        ) : (
          <img
            ref={imgRef}
            key={src}
            src={src}
            alt={`accentuated PAE for ${model.id}`}
            onLoad={(e) => {
              const t = e.currentTarget;
              setNatural({ w: t.naturalWidth, h: t.naturalHeight });
            }}
            onError={() => setErr(true)}
            style={
              fit === 'contain' ?
                { width: '100%', height: '100%', objectFit: 'contain', imageRendering: 'auto' }
              : fit === 'width' ?
                { width: '100%', height: 'auto', imageRendering: 'auto' }
              : { width: `${(zoom * 100).toFixed(0)}%`, height: 'auto', imageRendering: 'auto' }
            }
            className="mx-auto rounded-md bg-white shadow-lg shadow-black/40"
            loading="lazy"
            draggable={false}
          />
        )}
      </div>
      <div className="shrink-0 border-t border-slate-800 px-2 py-1.5 text-[10.5px] leading-relaxed text-slate-500">
        Figure as produced by the AlphaFold pipeline (<span className="text-slate-400">accentuated_pae.svg</span>,
        re-encoded to WebP: same geometry, lossy colours, ~48× smaller than the PNG). Axes are residue indices;
        background = inter-residue PAE, black crosshairs mark each residue’s PAE toward its immediate neighbours.
      </div>
    </div>
  );
}

/** Small overlay used while the panel data is still arriving. */
export function PanelLoading({ label }: { label: string }) {
  return (
    <div className="grid h-full place-items-center text-[12px] text-slate-400">
      <span className="flex items-center gap-2">
        <Spinner size={14} /> {label}
      </span>
    </div>
  );
}
