/** Help + data-source/settings overlays (modal dialogs). */
import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { loadDataBaseUrlOverride, paeCacheInfo, currentDataUrl } from '../lib/dataSource';
import { Btn, ErrorBanner, GhostBtn } from './ui';
import { fmt, humanBytes } from '../lib/util';

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
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`card my-8 w-full ${wide ? 'max-w-4xl' : 'max-w-2xl'} shrink-0 shadow-2xl shadow-black/60`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/95 px-4 py-2.5 backdrop-blur">
          <h2 className="text-[14px] font-semibold text-slate-100">{title}</h2>
          <GhostBtn onClick={onClose} title="close (Esc)">
            ✕
          </GhostBtn>
        </header>
        <div className="px-4 py-3 text-[12.5px] leading-relaxed text-slate-300">{children}</div>
      </div>
    </div>
  );
}

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Hepatitis E ORF1 model viewer — guide" onClose={onClose} wide>
      <div className="grid gap-5 md:grid-cols-2">
        <section>
          <h3 className="mb-1 text-[13px] font-semibold text-sky-300">What this is</h3>
          <p>
            A static, client-only browser for <b>AlphaFold2 predictions of the HEV ORF1 polyprotein</b>: one
            3D model, its <b>predicted aligned error (PAE)</b> map, per-residue <b>pLDDT</b>, annotated{' '}
            <b>domains</b> (MetY · FABD-like · HVR · domX · Hel · RdRp) and a <b>Clustal Omega</b> multiple sequence
            alignment of every ORF1 in the set. No server, no database: the whole payload is static files, so the app
            runs straight from GitHub Pages — or from any host you point it at (⚙).
          </p>
          <h3 className="mt-4 mb-1 text-[13px] font-semibold text-sky-300">Layout</h3>
          <ul className="list-disc pl-5">
            <li>
              <b>Left</b> — Mol* viewport (cartoon, coloured by domain or pLDDT), with the quick-action bar in its
              <b> bottom-left</b> corner. Drag the splitter to re-balance the 60/40 split. The floating bar gives shortcuts (camera, focus, spin, PNG, fullscreen) and{' '}
              <b>⚙ molstar</b>, which reveals Mol*'s own UI — scene graph, styles &amp; properties, settings, sequence
              view, timeline — beside the viewport for full control.
            </li>
            <li>
              <b>Right</b> — tabs: interactive <b>PAE matrix</b>, <b>pLDDT & domains</b>, and the original{' '}
              <b>accentuated PAE</b> figure.
            </li>
            <li>
              <b>Bottom</b> — collapsible <b>MSA</b> drawer (drag its top edge to resize).
            </li>
            <li>
              The header keeps <b>entry</b> information (model, length, host, genotype, organism, isolate,
              domain count — HVR excluded) separate from the <b>scores</b> (pLDDT, %&lt;50, pTM, ⟨PAE⟩,
              max PAE, decode check).
            </li>
          </ul>
        </section>

        <section>
          <h3 className="mb-1 text-[13px] font-semibold text-sky-300">PAE matrix ⇄ 3D</h3>
          <ul className="list-disc pl-5">
            <li>
              <b>Hover</b> — crosshair, both residue numbers, <code>PAE(i,j)</code> and the transposed{' '}
              <code>PAE(j,i)</code> (the raw matrix is asymmetric), and the two residues light up in 3D.
            </li>
            <li>
              <b>Click a cell</b> — selects the pair, draws the connecting distance in the cartoon and frames the
              camera on it.
            </li>
            <li>
              <b>Drag a box</b> — selects a row span × column span; the footer reports mean PAE, the fraction &lt;5 Å
              and &lt;12 Å, and the pair count. <b>zoom sel</b> magnifies the span.
            </li>
            <li>
              Colour map, upper/lower triangle, axis direction and the domain strips are all switchable in the tab
              toolbar; <b>domain×domain PAE</b> copies the 6×6 mean matrix as TSV; <b>◍ PNG</b> saves the current view
              (matrix, domain strips and guides) as an image.
            </li>
          </ul>
          <h3 className="mt-4 mb-1 text-[13px] font-semibold text-sky-300">Reading the numbers</h3>
          <p>
            pLDDT bands: <span className="text-[#7cc8f5]">&gt;90</span> very high confidence,{' '}
            <span className="text-[#7cc8f5]">70–90</span> confident,{' '}
            <span className="text-[#facc41]">50–70</span> low, <span className="text-[#ff7d45]">&lt;50</span> very low
            (often disordered — e.g. the HVR). PAE &lt;5 Å means the two residues are expected to be placed correctly
            <i> relative to each other</i>; &gt;20–30 Å means their relative position is essentially undefined — which
            is why the RdRp domain of a multi-domain ORF1 usually sits in a blank of high PAE with respect to the
            methyltransferase.
          </p>
        </section>

        <section>
          <h3 className="mb-1 text-[13px] font-semibold text-sky-300">Keyboard</h3>
          <table className="w-full text-[12px]">
            <tbody>
              {[
                ['/', 'focus the model search (fuzzy: prefix, substring, subsequence)'],
                ['1 / 2 / 3', 'switch to PAE · pLDDT · accentuated PAE'],
                ['M', 'toggle the MSA drawer'],
                ['F', 'frame the current selection (or hovered residues)'],
                ['R', 'reset the camera'],
                ['Esc', 'clear selection / close dialogs'],
                ['?', 'this help'],
              ].map(([k, v]) => (
                <tr key={k} className="border-t border-slate-800">
                  <td className="w-24 py-1 pr-2 align-top">
                    <kbd>{k}</kbd>
                  </td>
                  <td className="py-1 text-slate-400">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 className="mt-4 mb-1 text-[13px] font-semibold text-sky-300">Sharing</h3>
          <p>
            Every model is addressable: <code>?model=&lt;id&gt;</code> (plus <code>&tab=</code>, <code>&color=</code>,{' '}
            <code>&msa=1</code>, <code>&dataBaseUrl=</code>). Use <b>⧉ link</b> in the header to copy the current URL.
          </p>
        </section>

        <section>
          <h3 className="mb-1 text-[13px] font-semibold text-sky-300">How the data is packed</h3>
          <p>
            Each PAE matrix is a <b>1700×1700 float table</b>. Shipping those as JSON would need ~15 GB, so{' '}
            <code>scripts/update_dataset.py</code> quantises every matrix into an 8-bit index and stores it as a{' '}
            <b>lossless single-channel image</b> (pixel = LUT index, the LUT lives in the manifest). WebP ≈ 500 KB per
            model with a worst-case error of <b>≤1.5 Å</b> (finer/coarser ladders: <code>--preset lean|hifi|archive</code>).
          </p>
          <p className="mt-2">
            To make sure nothing silently drifts, each model carries 24 random{' '}
            <code>(i, j, Å)</code> <b>integrity checkpoints</b>; the app re-checks them after decoding and shows the
            result in the header badge. A red badge means the payload you are looking at was not produced by the
            pipeline that wrote the manifest.
          </p>
          <p className="mt-2 text-slate-400">
            Structures are backbone-only atoms (N, CA, C, O, OXT) — enough for cartoons and distance read-outs, 3–5×
            smaller than the full-atom file. pLDDT is one byte per residue.
          </p>
          <p className="mt-2 text-slate-400">
            Structures come from the AlphaFold2 prediction pipeline (unrelaxed rank-1 models); the domain limits come
            from the curated ORF1 CSV; the alignment is Clustal Omega over the same set.
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
  const error = useStore((s) => s.error);
  const applyDataBaseUrl = useStore((s) => s.applyDataBaseUrl);
  const [draft, setDraft] = useState(baseUrl);
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  useEffect(() => setDraft(baseUrl), [baseUrl]);

  const diag = useMemo(
    () => ({
      dataBaseUrl: baseUrl,
      resolvedVia: baseUrlHow,
      storedOverride: loadDataBaseUrlOverride(),
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
    [baseUrl, baseUrlHow, manifest, model, status, pae, paeTiming]
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

  return (
    <Modal title="Data source & diagnostics" onClose={onClose} wide>
      <p className="mb-3 text-slate-400">
        The app is pure client-side: it fetches a manifest and per-model artifacts from a <b>data root</b>. By default
        that is <code>data/</code> next to the page — point it at any folder, another GitHub Pages site, Zenodo, or a
        Hugging Face dataset to browse a bigger payload without deploying anything.
      </p>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="https://…/data/ or leave empty for same-origin ./data/"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900/85 px-2 py-1.5 text-[12px] text-slate-100 outline-none focus:border-sky-600"
        />
        <Btn onClick={() => void apply()} disabled={busy} active>
          {busy ? 'applying…' : 'apply & reload'}
        </Btn>
        <GhostBtn
          onClick={() => {
            setDraft('');
            void applyDataBaseUrl(null);
            onClose();
          }}
          title="forget the override and use ./data/ next to the page"
        >
          reset
        </GhostBtn>
        <GhostBtn onClick={() => void navigator.clipboard?.writeText(JSON.stringify(diag, null, 2))}>
          ⧉ copy diagnostics
        </GhostBtn>
      </div>
      <div className="mb-3 text-[11px] text-slate-500">
        resolved via <code>{baseUrlHow || 'default'}</code> · override kept in{' '}
        <code>localStorage['orf1.dataBaseUrl']</code> · also settable with{' '}
        <code>?dataBaseUrl=…</code>, <code>VITE_DATA_BASE_URL</code> or a <code>data/base-url.txt</code> pointer.
      </div>
      {localErr && <ErrorBanner message={localErr} onClose={() => setLocalErr(null)} />}
      {error && (
        <div className="mt-2">
          <ErrorBanner message={error} />
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div>
          <h3 className="mb-1 text-[12px] font-semibold text-slate-200">Payload</h3>
          <pre className="max-h-64 overflow-auto rounded-md bg-slate-950/70 p-2 text-[10.5px] leading-relaxed text-slate-400">
            {JSON.stringify(diag.manifest ?? {}, null, 2)}
          </pre>
          {manifest && (
            <div className="mt-2 text-[11px] text-slate-500">
              on-disk sizes are reported by <code>update_dataset.py</code>; LUT has {manifest.pae.lut.length} levels from{' '}
              {manifest.pae.lut[0]} Å to {manifest.pae.lut[manifest.pae.lut.length - 1]} Å.
            </div>
          )}
          <h3 className="mb-1 mt-3 text-[12px] font-semibold text-slate-200">Runtime</h3>
          <pre className="max-h-48 overflow-auto rounded-md bg-slate-950/70 p-2 text-[10.5px] leading-relaxed text-slate-400">
            {JSON.stringify({ phases: diag.phases, decode: diag.decode, cache: diag.cache, browser: diag.browser }, null, 2)}
          </pre>
        </div>
        <div>
          <h3 className="mb-1 text-[12px] font-semibold text-slate-200">Current model artifacts</h3>
          {model ? (
            <ul className="space-y-1 text-[11.5px]">
              {(
                [
                  ['structure (full-atom)', currentDataUrl(model.pdbPath)],
                  ['PAE image', currentDataUrl(model.paePath)],
                  ['pLDDT', currentDataUrl(model.plddtPath)],
                  ['accentuated PAE', model.accentuatedPaePath ? currentDataUrl(model.accentuatedPaePath) : '—'],
                  ['AF2 source file', model.pdbSourcePath],
                ] as [string, string][]
              ).map(([k, v]) => (
                <li key={k} className="flex gap-2">
                  <span className="w-[112px] shrink-0 text-slate-500">{k}</span>
                  <a
                    className="min-w-0 flex-1 break-all text-sky-300/90 underline decoration-slate-700 hover:text-sky-200"
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
            <div className="text-[11.5px] text-slate-500">no model loaded</div>
          )}
          {pae && (
            <div className="mt-3 rounded-md border border-slate-800 bg-slate-950/50 p-2 text-[11px] text-slate-400">
              <div className="mb-1 font-semibold text-slate-300">Integrity</div>
              {pae.checks.n} checkpoints · max |Δ| = {pae.checks.maxAbsErr.toFixed(3)} Å ·{' '}
              {pae.checks.ok ? <span className="text-emerald-400">OK</span> : <span className="text-rose-400">MISMATCH</span>}
              <div className="mt-1">
                matrix {pae.w}×{pae.h} = {humanBytes(pae.index.byteLength)} of indices (≈
              {humanBytes(pae.w * pae.h * 4)} as float32), colourised in {fmt(paeTiming?.color ?? 0, 0)} ms
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
