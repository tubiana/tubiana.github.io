/**
 * "Search by sequence": paste a FASTA/plain protein sequence and jump to the
 * closest of the reference ORF1 models (metadata/ORF1s_1178.fasta on Hugging
 * Face). Matching runs entirely client-side (see lib/fastaSearch.ts).
 */
import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { Modal } from './Overlays';
import { Btn, ErrorBanner, Spinner } from './ui';
import { cleanQuerySequence } from '../lib/fastaSearch';

export function SequenceSearchOverlay({ onClose }: { onClose: () => void }) {
  const findModelFromSequence = useStore((s) => s.findModelFromSequence);
  const setModel = useStore((s) => s.setModel);
  const draft = useStore((s) => s.sequenceDraft);
  const nModels = useStore((s) => s.manifest?.models.length ?? 0);
  const [input, setInput] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; pctIdentity: number } | null>(null);

  const cleaned = cleanQuerySequence(input);

  const run = async () => {
    setErr(null);
    setResult(null);
    if (cleaned.length < 20) {
      setErr('Paste at least 20 amino acids. A FASTA header is optional.');
      return;
    }
    setBusy(true);
    try {
      const match = await findModelFromSequence(cleaned);
      if (!match) setErr('No reference sequence aligned to this one.');
      else setResult(match);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  // a sequence pasted into the search box arrives here ready to go
  useEffect(() => {
    if (draft && cleanQuerySequence(draft).length >= 20) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openMatch = () => {
    if (!result) return;
    void setModel(result.id);
    onClose();
  };

  return (
    <Modal title="Search by sequence" onClose={onClose}>
      <p className="mb-3 text-muted">
        Paste a protein sequence, as FASTA or plain text. It is aligned against the {nModels.toLocaleString()} reference ORF1
        sequences and the closest model is proposed.
      </p>
      <textarea
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          setResult(null);
        }}
        placeholder={'>my_sequence\nMEAHQFIKAPGITTAIEQAALAAANSALANAVVVRPFLSHQ…'}
        spellCheck={false}
        rows={8}
        autoFocus
        className="w-full resize-y rounded-md border border-line bg-raised p-2.5 font-mono text-[12px] text-fg outline-none placeholder:text-faint focus:border-fg"
      />
      <div className="mt-1.5 text-[12px] text-muted">{cleaned.length.toLocaleString()} amino acids read</div>

      {err && (
        <div className="mt-3">
          <ErrorBanner message={err} />
        </div>
      )}

      {result && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-line bg-raised px-3 py-2.5">
          <div>
            <div className="font-semibold">{result.id}</div>
            <div className="text-[12px] text-muted">{result.pctIdentity.toFixed(1)}% identity over a global alignment</div>
          </div>
          <Btn active onClick={openMatch}>
            Open this model
          </Btn>
        </div>
      )}

      {!result && (
        <div className="mt-4 flex justify-end">
          <Btn active onClick={run} disabled={busy || cleaned.length < 20}>
            {busy ? (
              <>
                <Spinner size={12} /> Searching…
              </>
            ) : (
              'Find closest model'
            )}
          </Btn>
        </div>
      )}
    </Modal>
  );
}
