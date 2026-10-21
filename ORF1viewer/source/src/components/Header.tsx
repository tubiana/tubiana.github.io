import { useState } from 'react';
import { useStore } from '../state/store';
import { ModelSearch } from './ModelSearch';
import { DomainMap, SelectionLine } from './DomainMap';
import { IconBtn, Icon, MenuDivider, MenuItem, MenuLabel, Popover, Stat } from './ui';
import { countDomains, fmt } from '../lib/util';
import type { ModelEntry } from '../lib/types';

/* NCBI record pages for the two identifiers of an entry (protein = the `genbank`
 * accession the manifest is keyed on, nuccore = the `genbank_nucl` CSV column). */
const ncbiProteinUrl = (id: string) => `https://www.ncbi.nlm.nih.gov/protein/${encodeURIComponent(id)}`;
const ncbiNuccoreUrl = (id: string) => `https://www.ncbi.nlm.nih.gov/nuccore/${encodeURIComponent(id)}`;

/* Values in the annotation CSV that carry no information. */
const BLANK_META = /^(unknown|unspecified|n\/a|na|none|null|-|—)$/i;
export function known(...values: (string | number | undefined | null)[]): string | null {
  for (const v of values) {
    const s = v === null || v === undefined ? '' : String(v).trim();
    if (s && !BLANK_META.test(s)) return s;
  }
  return null;
}

export function TopBar() {
  const manifest = useStore((s) => s.manifest);
  const model = useStore((s) => s.model);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const setHelpOpen = useStore((s) => s.setHelpOpen);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const [copied, setCopied] = useState(false);

  const copyLink = () => {
    const url = new URL(location.href);
    if (model) url.searchParams.set('model', model.id);
    navigator.clipboard
      ?.writeText(url.toString())
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {});
  };

  return (
    <header className="z-30 flex h-[52px] shrink-0 items-center gap-4 border-b border-line bg-surface px-4">
      <div className="flex shrink-0 items-baseline gap-2">
        <span className="text-[15px] font-bold tracking-[-0.01em]">HEV ORF1 viewer</span>
        {manifest && (
          <span className="hidden text-[12px] text-muted md:inline">
            {manifest.models.length.toLocaleString()} AlphaFold2 models
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 justify-center">
        <ModelSearch />
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <IconBtn
          icon={copied ? 'check' : 'link'}
          label={copied ? 'Link copied' : 'Copy a link to this model'}
          onClick={copyLink}
        />
        <IconBtn
          icon={theme === 'dark' ? 'sun' : 'moon'}
          label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        />
        <IconBtn icon="help" label="Guide and shortcuts (?)" onClick={() => setHelpOpen(true)} />
        <IconBtn icon="settings" label="Data source and diagnostics" onClick={() => setSettingsOpen(true)} />
      </div>
    </header>
  );
}

/** Who this model is, how good it is, and its domain map. */
export function ModelBand() {
  const model = useStore((s) => s.model);
  if (!model) return null;
  const meta = model.meta ?? {};
  const host = known(meta.host, model.host, meta.generic_hostname);
  const facts = [
    host,
    known(meta.organism),
    known(meta.strain, meta.isolate) ? `isolate ${known(meta.strain, meta.isolate)}` : null,
    `${model.length.toLocaleString()} aa`,
  ].filter(Boolean) as string[];
  const p = model.meanPlddt;

  return (
    <section className="shrink-0 border-b border-line bg-surface px-4 pt-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex min-w-0 flex-1 items-baseline gap-3">
          <h1 className="shrink-0 text-[18px] font-bold tracking-[-0.01em]">{model.accession || model.id}</h1>
          <p className="min-w-0 truncate text-[13px] text-muted" title={facts.join(', ')}>
            {facts.join(', ')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-5">
          <Stat
            label="pLDDT"
            value={fmt(p, 1)}
            tone={p == null ? undefined : p >= 70 ? 'good' : p >= 50 ? 'warn' : 'bad'}
            title="Mean pLDDT over all residues (AlphaFold confidence, 0–100)"
          />
          <Stat label="pTM" value={model.pTM != null ? model.pTM.toFixed(2) : '—'} title="Predicted TM-score" />
          <Stat label="Mean PAE" value={`${fmt(model.meanPae, 1)} Å`} title="Mean predicted aligned error over the whole matrix" />
          <DetailsMenu model={model} />
        </div>
      </div>
      <div className="mt-3">
        <DomainMap />
      </div>
      <SelectionLine />
    </section>
  );
}

function DetailsMenu({ model }: { model: ModelEntry }) {
  const downloadCurrent = useStore((s) => s.downloadCurrent);
  const [err, setErr] = useState<string | null>(null);
  const meta = model.meta ?? {};
  const dl = (kind: 'pdbFull' | 'paeImage') => {
    setErr(null);
    void downloadCurrent(kind).catch((e) => setErr(String(e instanceof Error ? e.message : e)));
  };
  const rows: [string, string | null][] = [
    ['Model', model.id],
    ['Genus', known(meta.Genogroupe)],
    ['Species', known(meta.species_y)],
    ['Strain', known(meta.strain)],
    ['Isolate', known(meta.isolate)],
    [
      'Length',
      model.length !== model.csvLength
        ? `${model.length} aa modelled of ${model.csvLength}`
        : `${model.length} aa`,
    ],
    ['Domains', `${countDomains(model.domains)} annotated (HVR not counted)`],
    ['pLDDT < 50', model.pctPlddtLt50 != null ? `${fmt(model.pctPlddtLt50, 1)}% of residues` : null],
    ['Max PAE', `${fmt(model.maxPae, 1)} Å`],
  ];

  return (
    <Popover
      align="right"
      panelClassName="w-[20rem]"
      trigger={({ open, toggle }) => (
        <button type="button" className="btn" data-active={open ? 'true' : 'false'} onClick={toggle} aria-expanded={open}>
          Details <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} />
        </button>
      )}
    >
      <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1 px-2 py-1.5 text-[12.5px]">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="min-w-0 break-words">{v}</dd>
            </div>
          ))}
      </dl>
      <MenuDivider />
      <MenuLabel>NCBI records</MenuLabel>
      {model.accession && (
        <MenuItem icon="external" href={ncbiProteinUrl(model.accession)} hint={model.accession}>
          Protein
        </MenuItem>
      )}
      {meta.genbank_nucl && (
        <MenuItem icon="external" href={ncbiNuccoreUrl(meta.genbank_nucl)} hint={meta.genbank_nucl}>
          Nucleotide
        </MenuItem>
      )}
      <MenuDivider />
      <MenuLabel>Download</MenuLabel>
      <MenuItem icon="download" onClick={() => dl('pdbFull')} hint=".pdb">
        Structure, full atom
      </MenuItem>
      <MenuItem icon="download" onClick={() => dl('paeImage')} disabled={!model.accentuatedPaePath} hint=".webp">
        Original PAE figure
      </MenuItem>
      {err && <div className="px-2 py-1 text-[12px] text-danger">Download failed: {err}</div>}
    </Popover>
  );
}
