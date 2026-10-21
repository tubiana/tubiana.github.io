/** Help + data-source/settings overlays (modal dialogs). */
import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { loadDataBaseUrlOverride, paeCacheInfo, currentDataUrl } from '../lib/dataSource';
import { Btn, ErrorBanner, GhostBtn, IconBtn } from './ui';
import { fmt, humanBytes } from '../lib/util';
import { PLDDT_BANDS } from '../lib/colormap';

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const el = document.body;
    el.style.overflow = 'hidden';
    return () => {
      el.style.overflow = '';
    };
  }, []);
  // Esc closes the dialog — and only the dialog: caught in the capture phase so it
  // doesn't also reach the global shortcuts (where Esc clears the selection)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className={`popover my-[6vh] w-full ${wide ? 'max-w-4xl' : 'max-w-xl'} shrink-0 !rounded-[10px]`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line py-2 pl-5 pr-2">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <IconBtn icon="x" label="Close (Esc)" onClick={onClose} />
        </header>
        <div className="px-5 py-4 text-[13px] leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-1.5 mt-5 text-[13.5px] font-semibold first:mt-0">{children}</h3>;
}

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Guide" onClose={onClose} wide>
      <div className="grid gap-x-10 md:grid-cols-2">
        <section>
          <H>What you are looking at</H>
          <p className="text-muted">
            AlphaFold2 models of the hepatitis E virus ORF1 polyprotein, one per sequence. For each model you get the 3D
            structure, its predicted aligned error (PAE), per-residue confidence (pLDDT) and the curated domain limits,
            next to an alignment of every ORF1 in the set and the ICTV reference tree.
          </p>

          <H>Selecting residues</H>
          <p className="text-muted">
            Every panel shares one selection. Make it wherever is convenient and the others follow:
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
            <li>Domain map: click a domain, or drag along it for any span.</li>
            <li>PAE matrix: click a cell for a residue pair, drag for a block.</li>
            <li>Domains tab: click a table row or a domain × domain cell.</li>
            <li>Alignment: click a column.</li>
          </ul>
          <p className="mt-1.5 text-muted">
            The line under the domain map says what is selected, and can frame it in 3D or zoom the PAE matrix to it.
          </p>

          <H>Reading the numbers</H>
          <p className="text-muted">pLDDT is AlphaFold’s per-residue confidence:</p>
          <ul className="mt-1 space-y-0.5 text-muted">
            {PLDDT_BANDS.map((b) => (
              <li key={b.min} className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-4 rounded-[2px]" style={{ background: b.color }} />
                {b.label}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-muted">
            PAE(i, j) is the expected error, in Å, of residue i’s position when the model is aligned on residue j. Under
            5 Å the two are placed confidently relative to each other; above 20 Å their relative position is
            essentially undefined. The domain × domain table averages it per pair of domains, which tells you which
            domains AlphaFold packs together with confidence.
          </p>
        </section>

        <section>
          <H>Keyboard</H>
          <table className="w-full">
            <tbody>
              {[
                ['/', 'Find a model'],
                ['1  2  3', 'PAE, Domains or Phylogeny tab'],
                ['M', 'Show or hide the alignment'],
                ['F', 'Frame the selection in 3D'],
                ['R', 'Reset the 3D camera'],
                ['Esc', 'Clear the selection, close a dialog'],
                ['?', 'This guide'],
              ].map(([k, v]) => (
                <tr key={k} className="border-t border-line first:border-0">
                  <td className="w-24 py-1.5 pr-2 align-top">
                    {k.split('  ').map((x) => (
                      <kbd key={x} className="mr-1">
                        {x}
                      </kbd>
                    ))}
                  </td>
                  <td className="py-1.5 text-muted">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <H>Finding a model</H>
          <p className="text-muted">
            The search box matches accessions, hosts and isolates, and can be narrowed to one host. Paste a protein
            sequence into it to find the closest model by alignment.
          </p>

          <H>Sharing</H>
          <p className="text-muted">
            The address bar always describes what you see: <code>?model=</code>, <code>&amp;tab=</code>,{' '}
            <code>&amp;color=</code> and <code>&amp;msa=1</code>. The link button in the top bar copies it.
          </p>

          <H>Where the data comes from</H>
          <p className="text-muted">
            Rank-1 unrelaxed AlphaFold2 models, full atom. Domain limits come from the curated annotation table and are
            never computed. PAE matrices are stored as lossless 8-bit images with a stated worst-case error, checked
            against reference values after decoding; Settings shows the details.
          </p>
        </section>
      </div>
    </Modal>
  );
}

export function SettingsOverlay({ onClose }: { onClose: () => void }) {
  const manifest = useStore((s) => s.manifest);
  const model = useStore((s) => s.model);
  const baseUrl = useStore((s) => s.baseUrl);
  const baseUrlHow = useStore((s) => s.baseUrlHow);
  const status = useStore((s) => s.status);
  const pae = useStore((s) => s.pae);
  const paeTiming = useStore((s) => s.paeTiming);
  const annotations = useStore((s) => s.annotations);
  const error = useStore((s) => s.error);
  const applyDataBaseUrl = useStore((s) => s.applyDataBaseUrl);
  const [draft, setDraft] = useState(baseUrl);
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => setDraft(baseUrl), [baseUrl]);

  const diag = useMemo(
    () => ({
      dataBaseUrl: baseUrl,
      resolvedVia: baseUrlHow,
      storedOverride: loadDataBaseUrlOverride(),
      annotations,
      manifest: manifest
        ? {
            models: manifest.models.length,
            schema: manifest.schema,
            generatedAt: manifest.generatedAt,
            pae: manifest.pae.format,
            lut: manifest.pae.lutName,
            lutLevels: manifest.pae.lut.length,
            maxErrorA: manifest.pae.maxErrorA,
            msa: manifest.msa,
          }
        : null,
      phases: status,
      currentModel: model
        ? {
            id: model.id,
            length: model.length,
            pae: currentDataUrl(model.paePath),
            structure: currentDataUrl(model.pdbPath),
            plddt: currentDataUrl(model.plddtPath),
            figure: model.accentuatedPaePath ? currentDataUrl(model.accentuatedPaePath) : null,
            fullPdb: model.pdbFullPath ? currentDataUrl(model.pdbFullPath) : null,
          }
        : null,
      decode: pae
        ? {
            w: pae.w,
            h: pae.h,
            bytesIndex: pae.index.byteLength,
            checks: pae.checks,
            ms: paeTiming,
          }
        : null,
      cache: paeCacheInfo(),
      browser: {
        webgl2: (() => {
          try {
            const c = document.createElement('canvas');
            return !!c.getContext('webgl2');
          } catch {
            return false;
          }
        })(),
        dpr: window.devicePixelRatio,
        cores: navigator.hardwareConcurrency ?? 0,
        ua: navigator.userAgent,
      },
    }),
    [baseUrl, baseUrlHow, manifest, model, status, pae, paeTiming, annotations]
  );

  const apply = async () => {
    setBusy(true);
    setLocalErr(null);
    try {
      await applyDataBaseUrl(draft.trim() || null);
      onClose();
    } catch (e) {
      setLocalErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const facts: [string, React.ReactNode][] = [];
  if (manifest) {
    facts.push(['Catalogue', `${manifest.models.length.toLocaleString()} models, built ${manifest.generatedAt.slice(0, 10)}`]);
    facts.push([
      'Annotations',
      annotations.source
        ? `${annotations.patched} of ${annotations.total} entries from ${annotations.source.split('/').pop()}`
        : 'Copy embedded in the catalogue (the live table was not reachable)',
    ]);
    facts.push(['PAE encoding', `${manifest.pae.lutName} table, worst-case error ${manifest.pae.maxErrorA ?? '—'} Å`]);
  }
  if (pae)
    facts.push([
      'PAE check',
      pae.checks.ok ? (
        <span className="text-good">
          {pae.checks.n} reference values match after decoding
        </span>
      ) : (
        <span className="text-danger">Mismatch: up to {pae.checks.maxAbsErr.toFixed(2)} Å off the reference values</span>
      ),
    ]);

  return (
    <Modal title="Data source and diagnostics" onClose={onClose} wide>
      <dl className="mb-5 grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      <h3 className="mb-1 font-semibold">Data location</h3>
      <p className="mb-2 text-muted">
        Everything is fetched from one folder. Point the viewer at another copy, such as a local folder or a Hugging Face
        dataset, to browse a different payload.
      </p>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="https://…/data/ (empty = ./data/ next to the page)"
          spellCheck={false}
          className="field h-8 min-w-0 flex-1"
        />
        <Btn onClick={() => void apply()} disabled={busy} active>
          {busy ? 'Applying…' : 'Apply and reload'}
        </Btn>
        <GhostBtn
          onClick={() => {
            setDraft('');
            void applyDataBaseUrl(null);
            onClose();
          }}
          title="Forget the override and use ./data/ next to the page"
        >
          Reset
        </GhostBtn>
      </div>
      <p className="text-[12px] text-muted">
        Currently resolved via <code>{baseUrlHow || 'default'}</code>. Also settable with <code>?dataBaseUrl=…</code>,{' '}
        <code>VITE_DATA_BASE_URL</code> or a <code>data/base-url.txt</code> pointer.
      </p>
      {localErr && (
        <div className="mt-2">
          <ErrorBanner message={localErr} onClose={() => setLocalErr(null)} />
        </div>
      )}
      {error && (
        <div className="mt-2">
          <ErrorBanner message={error} />
        </div>
      )}

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <div>
          <h3 className="mb-1 font-semibold">Files for this model</h3>
          {model ? (
            <ul className="space-y-1 text-[12.5px]">
              {(
                [
                  ['Structure', currentDataUrl(model.pdbPath)],
                  ['PAE image', currentDataUrl(model.paePath)],
                  ['pLDDT', currentDataUrl(model.plddtPath)],
                  ['PAE figure', model.accentuatedPaePath ? currentDataUrl(model.accentuatedPaePath) : '—'],
                  ['AF2 source', model.pdbSourcePath],
                ] as [string, string][]
              ).map(([k, v]) => (
                <li key={k} className="flex gap-2">
                  <span className="w-[5.5rem] shrink-0 text-muted">{k}</span>
                  <a
                    className="min-w-0 flex-1 break-all underline decoration-line-strong underline-offset-2 hover:decoration-fg"
                    href={v}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {v}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">No model loaded.</p>
          )}
          {pae && (
            <p className="mt-3 text-[12.5px] text-muted">
              Matrix {pae.w}×{pae.h}: {humanBytes(pae.index.byteLength)} of indices (≈{humanBytes(pae.w * pae.h * 4)} as
              float32), coloured in {fmt(paeTiming?.color ?? 0, 0)} ms.
            </p>
          )}
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="font-semibold">Runtime</h3>
            <GhostBtn
              onClick={() =>
                void navigator.clipboard?.writeText(JSON.stringify(diag, null, 2)).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1600);
                })
              }
            >
              {copied ? 'Copied' : 'Copy all diagnostics'}
            </GhostBtn>
          </div>
          <pre className="max-h-64 overflow-auto rounded-md bg-raised p-2.5 font-mono text-[11px] leading-relaxed text-muted">
            {JSON.stringify({ phases: diag.phases, decode: diag.decode, cache: diag.cache, browser: diag.browser }, null, 2)}
          </pre>
        </div>
      </div>
    </Modal>
  );
}
