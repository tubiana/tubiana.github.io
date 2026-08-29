import { useState } from 'react';
import { useStore, ColorMode, ReprKind } from '../state/store';
import { ModelSearch } from './ModelSearch';
import { Badge, Btn, GhostBtn, PhaseIcon, Select } from './ui';
import { countDomains, fmt } from '../lib/util';

const COLOR_MODES: { id: ColorMode; label: string; hint: string }[] = [
  { id: 'domain', label: 'Domains', hint: 'Colour by the annotated domain ranges (CSV) — grey = unannotated' },
  { id: 'plddt', label: 'pLDDT', hint: 'AlphaFold confidence bands: >90 dark blue, 70–90 light blue, 50–70 yellow, <50 orange' },
  { id: 'plddtSmooth', label: 'pLDDT ~', hint: 'Smooth pLDDT ramp' },
  { id: 'chain', label: 'Chain', hint: 'Colour by chain (single chain → one colour)' },
  { id: 'uniform', label: 'Plain', hint: 'Uniform colour' },
];

/*
 * Styles are kept here (and not only in Mol*'s Structure Tools panel) because the
 * model is full-atom: `Licorice` = Mol* `line` (thin bonds for every bond, side
 * chains included), `Ball & stick` = spheres + cylinders, `Sphere`/`Spacefill`
 * = vdW, and the two surface types for the molecular surface. Ligands/ions never
 * use cartoon/surface — `reprTypeFor()` in src/mol/scene.ts keeps them visible.
 */
const REPRS: { value: ReprKind; label: string }[] = [
  { value: 'cartoon', label: 'Cartoon' },
  { value: 'backbone', label: 'Backbone' },
  { value: 'licorice', label: 'Licorice (lines)' },
  { value: 'ballStick', label: 'Ball & stick' },
  { value: 'sphere', label: 'Sphere' },
  { value: 'spacefill', label: 'Spacefill' },
  { value: 'surface', label: 'Surface (slow)' },
  { value: 'molecularSurface', label: 'Molecular surface (slow)' },
];

export function Header() {
  const model = useStore((s) => s.model);
  const manifest = useStore((s) => s.manifest);
  const colorMode = useStore((s) => s.colorMode);
  const setColorMode = useStore((s) => s.setColorMode);
  const repr = useStore((s) => s.repr);
  const setRepr = useStore((s) => s.setRepr);
  const status = useStore((s) => s.status);
  const pae = useStore((s) => s.pae);
  const setHelpOpen = useStore((s) => s.setHelpOpen);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const downloadCurrent = useStore((s) => s.downloadCurrent);
  const setModel = useStore((s) => s.setModel);
  const [dlErr, setDlErr] = useState<string | null>(null);

  const dl = (kind: 'pdb' | 'pdbFull' | 'paeImage') => {
    void downloadCurrent(kind).catch((e) => {
      const msg = String(e instanceof Error ? e.message : e);
      setDlErr(msg);
      window.setTimeout(() => setDlErr(null), 5000);
    });
  };

  const copyLink = () => {
    const url = new URL(location.href);
    if (model) url.searchParams.set('model', model.id);
    navigator.clipboard?.writeText(url.toString()).catch(() => {});
  };

  const randomModel = () => {
    const ms = manifest?.models ?? [];
    if (!ms.length) return;
    const other = ms.filter((m) => m.id !== model?.id);
    const pick = other[Math.floor(Math.random() * other.length)] ?? ms[0];
    void setModel(pick.id);
  };

  return (
    <header className="z-30 flex shrink-0 flex-col gap-1.5 border-b border-slate-800 bg-slate-950/90 px-3 py-2 backdrop-blur">
      <div className="flex items-center gap-2">
        <div className="flex shrink-0 items-baseline gap-2">
          <span className="text-[15px] font-semibold tracking-tight text-slate-100">Hepatitis E ORF1 model viewer</span>
          <span className="hidden text-[11px] text-slate-500 lg:inline">
            AlphaFold2 structures · PAE · MSA
          </span>
        </div>
        <ModelSearch />
        <div className="flex shrink-0 items-center gap-1">
          <GhostBtn onClick={randomModel} title="jump to a random model">
            ⤨ random
          </GhostBtn>
          <GhostBtn onClick={copyLink} title="copy a shareable link to this model/view">
            ⧉ link
          </GhostBtn>
          <GhostBtn onClick={() => setSettingsOpen(true)} title="data source & diagnostics">
            ⚙
          </GhostBtn>
          <GhostBtn onClick={() => setHelpOpen(true)} title="help / shortcuts (?)">
            ?
          </GhostBtn>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {/* ---- what this entry is ---- */}
        <span className="label shrink-0">entry</span>
        <Badge
          label="model"
          value={model ? model.id : '—'}
          title={model ? `${model.name || model.accession} · protein ${model.accession}${model.meta?.genbank_nucl ? ` · nucleotide ${model.meta.genbank_nucl}` : ''}` : ''}
        />
        <Badge
          label="len"
          value={model ? `${model.length} aa` : '—'}
          title={
            model
              ? `residues in the model file; the reference sequence is ${model.csvLength} aa${
                  model.length !== model.csvLength ? ` (${Math.abs(model.length - model.csvLength)} not modelled)` : ''
                }`
              : ''
          }
        />
        {(model?.meta?.host || model?.host) && (
          <Badge label="host" value={model.meta?.host || model.host} title={`generic host tag: ${model.meta?.generic_hostname || '—'}`} />
        )}
        {model?.meta?.Genogroupe && <Badge label="genotype" value={model.meta.Genogroupe} title="Genogroupe column of the annotation CSV" />}
        {model?.meta?.organism && (
          <Badge label="organism" value={model.meta.organism} title={model.meta.species_y ? `species_y: ${model.meta.species_y}` : ''} />
        )}
        {(model?.meta?.strain || model?.meta?.isolate) && (
          <Badge
            label="isolate"
            value={model.meta.strain || model.meta.isolate}
            title={`strain: ${model.meta.strain || '—'} · isolate: ${model.meta.isolate || '—'}`}
          />
        )}
        <Badge
          label="domains"
          value={model ? `${countDomains(model.domains)}` : '—'}
          title="annotated ranges from the domain CSV, HVR excluded (hypervariable stretch, not a domain). Still shown in the strips and the 3D colouring."
        />

        <span className="mx-1 h-4 w-px shrink-0 bg-slate-800" />

        {/* ---- how good it is ---- */}
        <span className="label shrink-0">scores</span>
        <Badge
          label="pLDDT"
          value={fmt(model?.meanPlddt ?? null, 1)}
          tone={(model?.meanPlddt ?? 0) >= 70 ? 'good' : (model?.meanPlddt ?? 0) >= 50 ? 'warn' : 'bad'}
          title="mean pLDDT over all residues"
        />
        <Badge
          label="%<50"
          value={fmt(model?.pctPlddtLt50 ?? null, 1)}
          title="fraction of residues with pLDDT below 50 (very low confidence)"
        />
        <Badge label="pTM" value={model?.pTM != null ? model.pTM.toFixed(3) : '—'} title="predicted Template Modeling score" />
        <Badge
          label="⟨PAE⟩"
          value={fmt(model?.meanPae ?? null, 1)}
          title="mean predicted aligned error (Å) over the whole matrix"
        />
        <Badge
          label="max PAE"
          value={fmt(model?.maxPae ?? null, 1)}
          title="largest predicted aligned error in the matrix (Å)"
        />
        {pae && (
          <Badge
            label="decode"
            value={pae.checks.ok ? `ok · ${pae.w}²` : `Δ ${pae.checks.maxAbsErr.toFixed(2)} Å`}
            tone={pae.checks.ok ? 'good' : 'bad'}
            title="lossless-decode integrity check against the manifest checkpoints"
          />
        )}
        <span className="ml-auto flex items-center gap-2 text-[11px] text-slate-500">
          <span className="flex items-center gap-1">
            <PhaseIcon phase={status.structure} /> structure
          </span>
          <span className="flex items-center gap-1">
            <PhaseIcon phase={status.pae} /> PAE
          </span>
          <span className="flex items-center gap-1">
            <PhaseIcon phase={status.plddt} /> pLDDT
          </span>
          <span className="flex items-center gap-1">
            <PhaseIcon phase={status.msa} /> MSA
          </span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="label">colour</span>
        <div className="flex items-center gap-1">
          {COLOR_MODES.map((m) => (
            <Btn key={m.id} active={colorMode === m.id} title={m.hint} onClick={() => setColorMode(m.id)}>
              {m.label}
            </Btn>
          ))}
        </div>
        <span className="label">style</span>
        <Select value={repr} options={REPRS} onChange={(v) => setRepr(v)} title="representation" />
        <Btn
          onClick={() => void dl(model?.pdbFullPath ? 'pdbFull' : 'pdb')}
          title={
            model?.pdbFullPath
              ? 'download the full-atom PDB (decompressed, opens directly in PyMOL/Coot/Mol*)'
              : 'download the model the viewer uses (backbone atoms — this payload has no full-atom archive; see the README)'
          }
        >
          ↓ PDB{model?.pdbFullPath ? '' : ' (bb)'}
        </Btn>
        {model?.pdbFullPath && (
          <Btn onClick={() => void dl('pdb')} title="download the backbone-only model the viewer displays">
            ↓ bb
          </Btn>
        )}
        {dlErr && <span className="text-[10.5px] text-rose-400">download failed: {dlErr}</span>}
        {manifest && (
          <span className="text-[10.5px] text-slate-600">
            {manifest.models.length} models · built {manifest.generatedAt.slice(0, 10)} ·{' '}
            {manifest.pae.lutName} lut ≤{manifest.pae.maxErrorA ?? '—'} Å
          </span>
        )}
      </div>
    </header>
  );
}
