import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { buildDocs, search, SearchHit } from '../lib/search';
import { ModelEntry } from '../lib/types';
import { fmt } from '../lib/util';
import { Icon, Spinner } from './ui';

/** `genbank | genbank_nucl` for a result row — blank identifiers are simply dropped. */
function idParts(m: ModelEntry): string {
  const meta = m.meta ?? {};
  return [m.accession, meta.genbank_nucl]
    .map((v) => (v ?? '').trim())
    .filter(Boolean)
    .join(', ');
}

/** A FASTA record, or a long run of amino-acid letters with no spaces: not a model name. */
function looksLikeSequence(text: string): boolean {
  const t = text.trim();
  if (t.startsWith('>')) return true;
  const flat = t.replace(/\s+/g, '');
  return flat.length >= 30 && /^[ACDEFGHIKLMNPQRSTVWYXBZUO*-]+$/i.test(flat);
}

/**
 * The one way to find a model: type an accession, host or isolate (prefix,
 * substring and fuzzy matching), narrow by host, paste a sequence, or jump to a
 * random entry — all from the same box.
 */
export function ModelSearch() {
  const manifest = useStore((s) => s.manifest);
  const current = useStore((s) => s.model);
  const setModel = useStore((s) => s.setModel);
  const setSequenceSearchOpen = useStore((s) => s.setSequenceSearchOpen);
  const [query, setQuery] = useState('');
  const [host, setHost] = useState<string>('all');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const docs = useMemo(() => (manifest ? buildDocs(manifest.models) : []), [manifest]);
  const results: SearchHit[] = useMemo(() => {
    if (!manifest) return [];
    let hits: SearchHit[];
    if (!query.trim()) hits = docs.map((doc) => ({ doc, score: 0 }));
    else hits = search(docs, query, 200);
    if (host !== 'all') hits = hits.filter((h) => (manifest.models[h.doc.index]?.host ?? '') === host);
    return hits.slice(0, 60);
  }, [docs, query, host, manifest]);

  useEffect(() => setCursor(0), [query, host]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const pick = (id: string) => {
    setOpen(false);
    setQuery('');
    if (id !== current?.id) void setModel(id);
    inputRef.current?.blur();
  };

  const bySequence = (draft = '') => {
    setOpen(false);
    setQuery('');
    setSequenceSearchOpen(true, draft);
  };

  const random = () => {
    const ms = manifest?.models ?? [];
    if (!ms.length) return;
    const other = ms.filter((m) => m.id !== current?.id);
    pick((other[Math.floor(Math.random() * other.length)] ?? ms[0]).id);
  };

  return (
    <div ref={boxRef} className="relative w-full max-w-[40rem]">
      <div className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted">
          {manifest ? <Icon name="search" size={15} /> : <Spinner size={12} />}
        </span>
        <input
          ref={inputRef}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text');
            if (looksLikeSequence(text)) {
              e.preventDefault();
              bySequence(text);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setCursor((c) => Math.min(results.length - 1, c + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor((c) => Math.max(0, c - 1));
            } else if (e.key === 'Enter') {
              if (results[cursor]) pick(results[cursor].doc.id);
            } else if (e.key === 'Escape') {
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
          placeholder={manifest ? 'Find a model by accession, host or isolate, or paste a sequence' : 'Loading the catalogue…'}
          spellCheck={false}
          autoComplete="off"
          data-search="model"
          aria-label="Find a model"
          className="h-9 w-full truncate rounded-lg border border-line bg-raised pl-8 pr-10 text-[13px] text-fg outline-none placeholder:text-muted focus:border-fg"
        />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">/</kbd>
      </div>

      {open && manifest && (
        <div className="popover absolute left-0 right-0 top-[calc(100%+6px)] z-40 flex max-h-[min(70vh,34rem)] flex-col overflow-hidden">
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
            <label className="flex items-center gap-2 text-[12px] text-muted">
              Host
              <select value={host} onChange={(e) => setHost(e.target.value)} className="field h-6 text-[12px]">
                <option value="all">All hosts</option>
                {(manifest.hosts ?? []).map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
            <span className="ml-auto text-[12px] text-muted">
              {results.length === 60 ? 'First 60 matches' : `${results.length} match${results.length === 1 ? '' : 'es'}`}
            </span>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto py-1" role="listbox">
            {results.length === 0 && (
              <li className="px-3 py-3 text-[12.5px] text-muted">
                No model matches “{query}”. Try part of an accession, or paste the protein sequence instead.
              </li>
            )}
            {results.map((h, i) => {
              const m = manifest.models[h.doc.index];
              if (!m) return null;
              const p = m.meanPlddt ?? 0;
              return (
                <li key={m.id} role="option" aria-selected={i === cursor}>
                  <button
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => pick(m.id)}
                    className={`flex w-full items-baseline gap-3 px-3 py-1.5 text-left text-[12.5px] ${
                      i === cursor ? 'bg-[var(--hover)]' : ''
                    }`}
                  >
                    <span className="w-3 shrink-0 text-fg">{current?.id === m.id ? <Icon name="check" size={13} /> : null}</span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-semibold">{idParts(m) || m.id}</span>
                      <span className="text-muted"> · {m.host}</span>
                    </span>
                    <span className="shrink-0 text-[12px] text-muted">{m.length} aa</span>
                    <span className="flex w-14 shrink-0 items-center justify-end gap-1.5 text-[12px]" title="mean pLDDT">
                      <span
                        className={`inline-block h-[7px] w-[7px] rounded-full ${p >= 70 ? 'bg-good' : p >= 50 ? 'bg-warn' : 'bg-danger'}`}
                      />
                      {fmt(m.meanPlddt, 1)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex shrink-0 items-center gap-1 border-t border-line px-1.5 py-1.5">
            <button className="btn-ghost" onClick={() => bySequence()}>
              <Icon name="sequence" size={15} /> Search by sequence
            </button>
            <button className="btn-ghost" onClick={random}>
              <Icon name="shuffle" size={15} /> Random model
            </button>
            <span className="ml-auto hidden pr-1.5 text-[11.5px] text-muted sm:inline">
              <kbd>↑</kbd> <kbd>↓</kbd> to move, <kbd>Enter</kbd> to open
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
