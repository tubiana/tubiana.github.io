/**
 * "Search model from sequence": paste a FASTA/plain protein sequence and jump to
 * the closest of the 1178 reference ORF1 models (metadata/ORF1s_1178.fasta on
 * Hugging Face). Matching runs entirely client-side (see lib/fastaSearch.ts).
 */
import { useState } from 'react';
import { useStore } from '../state/store';
import { Modal } from './Overlays';
import { Btn, ErrorBanner, Spinner } from './ui';
import { cleanQuerySequence } from '../lib/fastaSearch';

export function SequenceSearchOverlay({ onClose }: { onClose: () => void }) {
  const findModelFromSequence = useStore((s) => s.findModelFromSequence);
  const setModel = useStore((s) => s.setModel);
  const fastaLibraryStatus = useStore((s) => s.fastaLibraryStatus);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; pctIdentity: number } | null>(null);

  const cleaned = cleanQuerySequence(input);

  const run = async () => {
    setErr(null);
    setResult(null);
    if (cleaned.length < 20) {
      setErr('paste at least 20 amino acids (FASTA header optional)');
      return;
    }
    setBusy(true);
    try {
      const match = await findModelFromSequence(cleaned);
      if (!match) setErr('no match found');
      else setResult(match);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const openMatch = () => {
    if (!result) return;
    void setModel(result.id);
    onClose();
  };

  return (
    <Modal title="Search model from sequence" onClose={onClose}>
      <p className="mb-2 text-slate-400">
        Paste a protein sequence (FASTA or plain text) below. It is compared against the{' '}
        {fastaLibraryStatus === 'loading' ? <Spinner size={11} /> : '1178'} reference ORF1 sequences to find the
        closest model.
      </p>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={'>my_sequence\nMEAHQFIKAPGITTAIEQAALAAANSALANAVVVRPFLSHQ…'}
        spellCheck={false}
        rows={8}
        className="w-full resize-y rounded-md border border-slate-700 bg-slate-900/85 p-2 font-mono text-[11.5px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-600"
      />
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-500">
        <span>{cleaned.length} aa parsed</span>
      </div>

      {err && (
        <div className="mt-2">
          <ErrorBanner message={err} />
        </div>
      )}

      {result && (
        <div className="mt-3 rounded-md border border-sky-800 bg-sky-950/40 px-3 py-2">
          <div className="text-[12.5px] text-slate-200">
            closest model: <b className="text-sky-300">{result.id}</b>
          </div>
          <div className="text-[11px] text-slate-400">{result.pctIdentity.toFixed(1)}% identity (global alignment)</div>
        </div>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <Btn onClick={run} disabled={busy || cleaned.length < 20}>
          {busy ? <Spinner size={12} /> : 'find closest model'}
        </Btn>
        {result && (
          <Btn className="!bg-sky-600 hover:!bg-sky-500" onClick={openMatch}>
            open {result.id}
          </Btn>
        )}
      </div>
    </Modal>
  );
}
