/**
 * Right-hand analysis panel: interactive PAE matrix · domains (pLDDT profile,
 * per-domain table, domain × domain PAE) · reference phylogeny.
 */
import { useEffect, useState } from 'react';
import { useStore, type TabId } from '../state/store';
import { PaeMatrixTab } from './PaeMatrixTab';
import { PlddtTab } from './PlddtTab';
import { PhylogenyTab } from './PhylogenyTab';
import { Modal } from './Overlays';
import { Btn, Icon, Spinner, Tabs } from './ui';
import { currentDataUrl } from '../lib/dataSource';

export function AnalysisTabs() {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  return (
    <div className="panel flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-end border-b border-line px-4">
        <Tabs<TabId>
          value={tab}
          onChange={setTab}
          items={[
            { id: 'pae', label: 'PAE', hint: 'Predicted aligned error matrix (1)' },
            { id: 'plddt', label: 'Domains', hint: 'pLDDT profile and per-domain confidence (2)' },
            { id: 'tree', label: 'Phylogeny', hint: 'ICTV Hepeviridae reference tree (3)' },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'pae' && <PaeMatrixTab />}
        {tab === 'plddt' && <PlddtTab />}
        {tab === 'tree' && <PhylogenyTab />}
      </div>
    </div>
  );
}

/** The accentuated PAE figure produced by the AlphaFold pipeline, as shipped. */
export function OriginalFigureDialog({ onClose }: { onClose: () => void }) {
  const model = useStore((s) => s.model);
  const downloadCurrent = useStore((s) => s.downloadCurrent);
  const [err, setErr] = useState(false);
  const src = model?.accentuatedPaePath ? currentDataUrl(model.accentuatedPaePath) : null;
  useEffect(() => setErr(false), [src]);
  if (!model) return null;

  return (
    <Modal title="Original PAE figure" onClose={onClose} wide>
      <p className="mb-3 text-muted">
        The accentuated PAE figure written by the AlphaFold pipeline for {model.accession || model.id}. Axes are residue
        numbers; black crosshairs mark each residue’s error toward its immediate neighbours.
      </p>
      <div className="grid min-h-[16rem] place-items-center rounded-md bg-white p-2">
        {!src ? (
          <span className="text-[#56616e]">This model has no original figure.</span>
        ) : err ? (
          <span className="text-[#b3261e]">The figure could not be loaded. Check the data source in Settings.</span>
        ) : (
          <img
            key={src}
            src={src}
            alt={`Accentuated PAE figure for ${model.id}`}
            onError={() => setErr(true)}
            className="max-h-[70vh] w-auto max-w-full"
            draggable={false}
          />
        )}
      </div>
      <div className="mt-3 flex justify-end">
        <Btn onClick={() => void downloadCurrent('paeImage')} disabled={!src}>
          <Icon name="download" size={15} /> Download figure
        </Btn>
      </div>
    </Modal>
  );
}

/** Small overlay used while the panel data is still arriving. */
export function PanelLoading({ label }: { label: string }) {
  return (
    <div className="grid h-full place-items-center text-muted">
      <span className="flex items-center gap-2">
        <Spinner size={14} /> {label}
      </span>
    </div>
  );
}
