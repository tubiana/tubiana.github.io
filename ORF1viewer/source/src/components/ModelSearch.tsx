import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { buildDocs, search, SearchHit } from '../lib/search';
import { fmt } from '../lib/util';
import { Spinner } from './ui';

/** Search combobox over all models: prefix / substring / fuzzy + host filter. */
export function ModelSearch() {
  const manifest = useStore((s) => s.manifest);
  const current = useStore((s) => s.model);
  const setModel = useStore((s) => s.setModel);
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

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1">
      <div className="flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-500">
            {manifest ? '⌕' : <Spinner size={12} />}
          </span>
          <input
            ref={inputRef}
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
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
            placeholder={
              current ? current.id : manifest ? `search ${manifest.models.length} models…` : 'loading manifest…'
            }
            spellCheck={false}
            autoComplete="off"
            data-search="model"
            aria-label="search models"
            className="w-full rounded-md border border-slate-700 bg-slate-900/85 py-1.5 pl-7 pr-16 text-[13px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-600"
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">
            {results.length > 0 && query ? `${results.length} hit${results.length > 1 ? 's' : ''}` : 'press /'}
          </span>
        </div>
        <select
          value={host}
          title="filter by host"
          onChange={(e) => setHost(e.target.value)}
          className="max-w-[8.5rem] rounded-md border border-slate-700 bg-slate-900/85 px-1.5 py-[7px] text-[12px] text-slate-300 outline-none"
        >
          <option value="all">all hosts</option>
          {(manifest?.hosts ?? []).map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 max-h-[62vh] overflow-y-auto rounded-lg border border-slate-700 bg-slate-950/97 shadow-2xl shadow-black/60 backdrop-blur">
          {!manifest && <div className="px-3 py-2 text-[12px] text-slate-400">loading…</div>}
          {manifest && results.length === 0 && (
            <div className="px-3 py-2 text-[12px] text-slate-400">no model matches “{query}”</div>
          )}
          <ul>
            {results.map((h, i) => {
              const m = manifest!.models[h.doc.index];
              if (!m) return null;
              return (
                <li key={m.id}>
                  <button
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => pick(m.id)}
                    className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-[12px] ${
                      i === cursor ? 'bg-sky-600/20 text-sky-100' : 'text-slate-300 hover:bg-slate-800/60'
                    } ${current?.id === m.id ? 'border-l-2 border-sky-400' : ''}`}
                  >
                    <span className="tabular truncate font-medium">{m.id}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-2 text-[10.5px] text-slate-400">
                      <span>{m.host}</span>
                      <span className="tabular">{m.length} aa</span>
                      <span
                        className={`tabular ${
                          (m.meanPlddt ?? 0) >= 70 ? 'text-emerald-400' : (m.meanPlddt ?? 0) >= 50 ? 'text-amber-400' : 'text-rose-400'
                        }`}
                      >
                        {fmt(m.meanPlddt, 1)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {manifest && results.length > 0 && (
            <div className="border-t border-slate-800 px-3 py-1.5 text-[10.5px] text-slate-500">
              {results.length} shown · ↑↓ navigate · Enter open
              {query.trim().length > 0 && ' · prefix, substring and fuzzy matching'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
