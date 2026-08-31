/**
 * Clustal Omega alignment drawer (canvas-rendered, virtualised).
 * ~1.2k sequences × ~2.9k columns → no DOM table: we draw the visible window and
 * sync two slim native scrollbars.  Column ↔ residue mapping comes from the
 * store (`residueMap`), i.e. it follows the *selected model's* own row, so
 * clicking a column highlights the right residue in 3D even across indels.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { DomainRange } from '../lib/types';
import { GhostBtn, Select, Spinner, Toggle } from './ui';
import { clamp } from '../lib/util';

const LABEL_W = 138;
const RULER_H = 20;

type ColorMode = 'plain' | 'identity' | 'domain' | 'hydrophobic' | 'turn';

const HYDROPHOBIC: Record<string, string> = {
  A: '#e8a33d', V: '#e8a33d', L: '#e8a33d', I: '#e8a33d', M: '#e8a33d', F: '#e8a33d', W: '#e8a33d', C: '#e8a33d',
  P: '#c07ce8', G: '#c07ce8',
  S: '#4fc3f7', T: '#4fc3f7', Y: '#4fc3f7', N: '#4fc3f7', Q: '#4fc3f7',
  D: '#ef5350', E: '#ef5350', K: '#66bb6a', R: '#66bb6a', H: '#66bb6a',
};

export function MsaDrawer() {
  const msaOpen = useStore((s) => s.msaOpen);
  const toggleMsa = useStore((s) => s.toggleMsa);
  const msa = useStore((s) => s.msa);
  const statusMsa = useStore((s) => s.status.msa);
  const residueMap = useStore((s) => s.residueMap);
  const model = useStore((s) => s.model);
  const selection = useStore((s) => s.selection);
  const setSelection = useStore((s) => s.setSelection);
  const setHover = useStore((s) => s.setHover);
  const hover = useStore((s) => s.hover);
  const msaRow = useStore((s) => s.msaRow);
  const msaHeight = useStore((s) => s.msaHeight);
  const setMsaHeight = useStore((s) => s.setMsaHeight);

  const [baseW, setBaseW] = useState(6);
  const [rowH, setRowH] = useState(13);
  const [mode, setMode] = useState<ColorMode>('identity');
  const [showQuery, setShowQuery] = useState(true);
  const [pinModel, setPinModel] = useState(true);
  const [onlyConserved, setOnlyConserved] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [hoverCol, setHoverCol] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const vScrollRef = useRef<HTMLDivElement | null>(null);
  const hScrollRef = useRef<HTMLDivElement | null>(null);

  // row of the current model, resolved by the store (it compares the alignment
  // row against the structure sequence, which disambiguates truncated names)
  const queryRow = useMemo(() => {
    if (!msa || !model) return -1;
    if (msaRow >= 0) return msaRow;
    const direct = msa.indexByName[model.msaName];
    if (direct !== undefined) return direct;
    const key = Object.keys(msa.indexByName).find((k) => k.length >= 6 && model.id.startsWith(k.split('#')[0]));
    return key !== undefined ? msa.indexByName[key] : -1;
  }, [msa, model, msaRow]);

  const colToRes = useCallback(
    (c: number): number | null => {
      if (residueMap) {
        const r = residueMap.colToRes[c];
        return r > 0 ? r : null;
      }
      if (!msa || queryRow < 0) return null;
      const row = msa.rows[queryRow];
      let n = 0;
      for (let i = 0; i <= c; i++) if (row[i] && row[i] !== '-' && row[i] !== '.') n++;
      return n || null;
    },
    [residueMap, msa, queryRow]
  );

  /** fixed row at the top showing the loaded model's own sequence (not scrolled) */
  const pinnedH = pinModel && queryRow >= 0 ? rowH : 0;

  /**
   * Per alignment column: the domain of the *model* residue in that column, so the
   * alignment can be coloured by domain annotation exactly like the 3D view. Column ↔
   * residue comes from the same mapping the 3D highlight uses.
   */
  const domainAtCol = useMemo<(DomainRange | null)[] | null>(() => {
    if (!msa) return null;
    const cols: (DomainRange | null)[] = new Array(msa.columns).fill(null);
    const domains = model?.domains ?? [];
    if (!domains.length) return cols;
    const row = queryRow >= 0 ? msa.rows[queryRow] : '';
    let n = 0;
    for (let c = 0; c < msa.columns; c++) {
      let res: number;
      if (residueMap) res = residueMap.colToRes[c];
      else {
        const ch = row[c];
        const ungapped = !!ch && ch !== '-' && ch !== '.' && ch !== '?';
        if (ungapped) n++;
        res = ungapped ? n : -1;
      }
      if (res > 0) cols[c] = domains.find((d) => res >= d.start && res <= d.end) ?? null;
    }
    return cols;
  }, [msa, residueMap, queryRow, model]);

  // viewport size
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !msaOpen) return;
    const measure = () => {
      // Measure the canvas *holder* (the flex item the absolutely positioned canvas fills),
      // and give the canvas exactly that integer size: if the bitmap and the CSS box differ
      // the drawing is scaled, and the column/row hit tests then drift away from the pixels
      // (letters and highlighted column end up one off). Measuring the canvas itself would
      // be self-referential once its size is set from the measurement.
      const target = canvasRef.current?.parentElement ?? el;
      const r = target.getBoundingClientRect();
      setViewport({ w: Math.max(0, Math.floor(r.width)), h: Math.max(0, Math.floor(r.height)) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [msaOpen, msaHeight, msa]);

  const rows = msa?.rows ?? [];
  const nRows = rows.length;
  const nCols = msa?.columns ?? 0;
  const totalH = nRows * rowH;
  const totalW = nCols * baseW;

  // ------------------------------------------------------------ draw
  useEffect(() => {
    if (!msaOpen || !msa) return;
    const canvas = canvasRef.current;
    if (!canvas || viewport.w <= 0 || viewport.h <= 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(viewport.w * dpr);
    canvas.height = Math.floor(viewport.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#080c12';
    ctx.fillRect(0, 0, viewport.w, viewport.h);
    const seqW = viewport.w - LABEL_W;
    const drawH = viewport.h - RULER_H - pinnedH;
    const firstRow = Math.max(0, Math.floor(scrollTop / rowH));
    const lastRow = Math.min(nRows, Math.ceil((scrollTop + drawH) / rowH) + 1);
    const firstCol = Math.max(0, Math.floor(scrollLeft / baseW));
    const lastCol = Math.min(nCols, Math.ceil((scrollLeft + seqW) / baseW) + 1);
    /*
     * A monospace glyph is usually *wider* than one column (e.g. a 17px font with a
     * 6px column), and `fillText` left-aligns it: the letters then drift and overlap,
     * so the letter you point at is not the letter of the column you hit. Centring each
     * glyph in its column — and shrinking the font until it fits — keeps the pixels and
     * the column the hit test returns in agreement.
     */
    const fontFor = (px: number) => `${px}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    let fontPx = Math.max(8, rowH - 3);
    ctx.font = fontFor(fontPx);
    const advance = ctx.measureText('M').width;
    if (advance > baseW && advance > 0) {
      fontPx = Math.max(4, Math.floor((fontPx * baseW) / advance));
      ctx.font = fontFor(fontPx);
    }
    const font = fontFor(fontPx);
    const glyphX = (c: number) => LABEL_W + c * baseW - scrollLeft + baseW / 2;

    // highlighted columns (3D selection + hover). `hover`/`selection` hold *residue
    // numbers* (1-based, the model numbering) — the only way to land on the right column
    // is to convert them through the mapping, never by subtracting one.
    const bands: { s: number; e: number; color: string }[] = [];
    if (selection) for (const r of selection.ranges) bands.push({ s: r.s, e: r.e, color: 'rgba(56,189,248,.20)' });
    for (const h of hover) bands.push({ s: h, e: h, color: 'rgba(253,224,71,.16)' });
    const map = residueMap;
    for (const b of bands) {
      // without a mapping the row is assumed gap-free, so residue n sits on column n-1
      const range = map ? resRangeToCols(map, b.s, b.e) : { c0: b.s - 1, c1: b.e - 1 };
      for (const [s, e] of [[range.c0, range.c1]]) {
        const x0 = LABEL_W + s * baseW - scrollLeft;
        const x1 = LABEL_W + (e + 1) * baseW - scrollLeft;
        if (x1 < LABEL_W || x0 > viewport.w) continue;
        ctx.fillStyle = b.color;
        ctx.fillRect(Math.max(LABEL_W, x0), 0, Math.min(viewport.w, x1) - Math.max(LABEL_W, x0), viewport.h);
      }
    }

    // ruler (its own baseline: it is drawn in the strip above the rows)
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(8,12,18,.96)';
    ctx.fillRect(0, 0, viewport.w, RULER_H);
    ctx.strokeStyle = 'rgba(148,163,184,.25)';
    ctx.beginPath();
    ctx.moveTo(0, RULER_H - 0.5);
    ctx.lineTo(viewport.w, RULER_H - 0.5);
    ctx.stroke();
    ctx.font = '10px ui-monospace, monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const step = Math.max(1, Math.round(58 / baseW)) * (baseW >= 10 ? 5 : 1);
    for (let c = Math.floor(firstCol / step) * step; c <= lastCol; c += step) {
      const x = LABEL_W + c * baseW - scrollLeft;
      if (x < LABEL_W - 24 || x > viewport.w) continue;
      const res = colToRes(c);
      ctx.fillStyle = 'rgba(148,163,184,.85)';
      ctx.fillText(res ? String(res) : `:${c + 1}`, x + baseW / 2, 7);
      ctx.fillRect(x, RULER_H - 3, 1, 3);
    }
    ctx.textAlign = 'left';
    if (queryRow >= 0 && msa.names[queryRow]) {
      ctx.fillStyle = 'rgba(56,189,248,.9)';
      ctx.fillText(`▸ ${msa.names[queryRow]}${residueMap ? ` · ${residueMap.length} aa` : ''}`, 4, 7);
    }

    // sequences
    ctx.font = font;
    ctx.textBaseline = 'middle';
    const drawRow = (row: string | undefined, name: string, y: number, isQuery: boolean) => {
      const base = y + rowH / 2;
      ctx.textAlign = 'left';
      ctx.fillStyle = isQuery ? '#7dd3fc' : 'rgba(203,213,225,.8)';
      const nm = name ?? '';
      ctx.fillText(nm.length > 23 ? nm.slice(0, 22) + '…' : nm, 4, base);
      ctx.strokeStyle = 'rgba(148,163,184,.12)';
      ctx.beginPath();
      ctx.moveTo(LABEL_W - 0.5, y);
      ctx.lineTo(LABEL_W - 0.5, y + rowH);
      ctx.stroke();
      if (!row) return;
      ctx.textAlign = 'center';
      for (let c = firstCol; c < lastCol; c++) {
        const ch = row[c];
        if (!ch) continue;
        const x = glyphX(c);
        if (ch === '-' || ch === '.') {
          if (mode !== 'plain') {
            ctx.fillStyle = 'rgba(100,116,139,.26)';
            ctx.fillText('·', x, base);
          }
          continue;
        }
        const cons = msa.conservation[c];
        if (onlyConserved > 0 && cons * 100 < onlyConserved) {
          ctx.fillStyle = 'rgba(100,116,139,.25)';
          ctx.fillText(ch, x, base);
          continue;
        }
        if (mode === 'identity') {
          const id = cons;
          ctx.fillStyle = `rgba(${Math.round(228 - 148 * id)},${Math.round(236 - 70 * id)},${Math.round(244)},${0.4 + 0.6 * id})`;
        } else if (mode === 'domain') {
          ctx.fillStyle = domainAtCol?.[c]?.color ?? 'rgba(148,163,184,.4)';
        } else if (mode === 'hydrophobic') {
          ctx.fillStyle = HYDROPHOBIC[ch.toUpperCase()] ?? 'rgba(203,213,225,.9)';
        } else if (mode === 'turn') {
          const up = ch.toUpperCase();
          ctx.fillStyle = up === 'P' ? '#f472b6' : up === 'G' ? '#a3e635' : 'rgba(148,163,184,.6)';
        } else {
          ctx.fillStyle = isQuery ? '#bae6fd' : 'rgba(203,213,225,.85)';
        }
        ctx.fillText(ch, x, base);
      }
    };

    for (let r = firstRow; r < lastRow; r++) {
      const y = (r - firstRow) * rowH + RULER_H + pinnedH;
      const isQuery = showQuery && r === queryRow;
      if (isQuery) {
        ctx.fillStyle = 'rgba(56,189,248,.10)';
        ctx.fillRect(0, y, viewport.w, rowH);
      }
      drawRow(rows[r], msa.names[r] ?? '', y, isQuery);
    }

    // the loaded model, pinned under the ruler
    if (pinnedH > 0 && queryRow >= 0) {
      const y = RULER_H;
      ctx.fillStyle = 'rgba(56,189,248,.15)';
      ctx.fillRect(0, y, viewport.w, pinnedH);
      drawRow(rows[queryRow], `★ ${model?.id ?? msa.names[queryRow] ?? 'model'}`, y, true);
      ctx.strokeStyle = 'rgba(56,189,248,.5)';
      ctx.beginPath();
      ctx.moveTo(0, y + pinnedH - 0.5);
      ctx.lineTo(viewport.w, y + pinnedH - 0.5);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(148,163,184,.35)';
    ctx.beginPath();
    ctx.moveTo(LABEL_W + 0.5, 0);
    ctx.lineTo(LABEL_W + 0.5, viewport.h);
    ctx.stroke();
  }, [
    msaOpen, msa, viewport.w, viewport.h, scrollTop, scrollLeft, baseW, rowH, mode,
    showQuery, pinModel, pinnedH, onlyConserved, selection, hover, nRows, nCols, queryRow,
    residueMap, domainAtCol, colToRes, model,
  ]);

  // ------------------------------------------------------- interactions
  const colFromEvent = useCallback(
    (clientX: number) => {
      const el = canvasRef.current;
      if (!el) return null;
      const box = el.getBoundingClientRect();
      const x = clientX - box.left;
      if (x < LABEL_W) return null;
      const c = Math.floor((x - LABEL_W + scrollLeft) / baseW);
      return c >= 0 && c < nCols ? c : null;
    },
    [scrollLeft, baseW, nCols]
  );

  const rowFromEvent = useCallback(
    (clientY: number) => {
      const el = canvasRef.current;
      if (!el) return null;
      const box = el.getBoundingClientRect();
      const y = clientY - box.top - RULER_H - pinnedH;
      if (y < 0) return queryRow >= 0 ? queryRow : null; // the pinned model row
      const r = Math.floor((scrollTop + y) / rowH);
      return r >= 0 && r < nRows ? r : null;
    },
    [scrollTop, rowH, nRows, pinnedH, queryRow]
  );

  const onWheel = (ev: React.WheelEvent) => {
    if (vScrollRef.current) vScrollRef.current.scrollTop += ev.deltaY;
    if (hScrollRef.current && Math.abs(ev.deltaX) > 0) hScrollRef.current.scrollLeft += ev.deltaX;
  };

  if (!msaOpen) {
    return (
      <div className="flex h-[26px] shrink-0 items-center gap-2 border-t border-slate-800 bg-slate-950/80 px-3">
        <button onClick={() => toggleMsa(true)} className="text-[12px] font-medium text-sky-300 hover:text-sky-200">
          ▸ MSA
        </button>
        <span className="truncate text-[11px] text-slate-400">
          Clustal Omega alignment · {msa ? `${msa.names.length} sequences × ${msa.columns} columns` : 'loading…'}
        </span>
        {selection && (
          <span className="hidden truncate text-[11px] text-slate-500 md:inline">
            · selection {selection.ranges.map((r) => `${r.s}${r.e !== r.s ? '–' + r.e : ''}`).join(', ')} (
            {selection.label})
          </span>
        )}
        <span className="ml-auto text-[10.5px] text-slate-600">M</span>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 flex-col border-t border-slate-800 bg-slate-950/80" style={{ height: msaHeight }}>
      {/* height handle */}
      <div
        onPointerDown={(e) => {
          e.preventDefault();
          setResizing(true);
          const startY = e.clientY;
          const startH = msaHeight;
          const onMove = (ev: PointerEvent) => {
            const h = clamp(startH + (startY - ev.clientY), 120, Math.max(160, window.innerHeight - 260));
            setMsaHeight(h);
          };
          const onUp = () => {
            setResizing(false);
            window.removeEventListener('pointermove', onMove);
          };
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp, { once: true });
        }}
        title="drag to resize the alignment panel"
        className={`h-[5px] shrink-0 cursor-row-resize ${resizing ? 'bg-sky-500/50' : 'hover:bg-slate-700'}`}
      />
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1">
        <button onClick={() => toggleMsa(false)} className="text-[12px] font-medium text-sky-300 hover:text-sky-200">
          ▾ MSA
        </button>
        <span className="text-[11px] text-slate-400">
          {msa ? `${msa.names.length} sequences · ${msa.columns} columns` : 'alignment unavailable'}
        </span>
        <span className="label">width</span>
        <input
          type="range" min={3} max={16} step={1} value={baseW}
          onChange={(e) => setBaseW(Number(e.target.value))} className="w-24" title="pixels per alignment column"
        />
        <span className="label">rows</span>
        <input
          type="range" min={10} max={20} step={1} value={rowH}
          onChange={(e) => setRowH(Number(e.target.value))} className="w-20" title="row height (px)"
        />
        <Select
          value={mode}
          options={[
            { value: 'plain', label: 'plain' },
            { value: 'identity', label: 'identity' },
            { value: 'domain', label: 'per domain' },
            { value: 'hydrophobic', label: 'hydrophobic' },
            { value: 'turn', label: 'Pro / Gly' },
          ]}
          onChange={(v) => setMode(v as ColorMode)}
          title="column colouring — per domain uses the CSV annotation ranges, the same colours as the 3D / PASTRIPO bars"
        />
        <label className="flex items-center gap-1 text-[11px] text-slate-400" title="fade columns below this conservation">
          cons ≥
          <input
            type="range" min={0} max={100} step={5} value={onlyConserved}
            onChange={(e) => setOnlyConserved(Number(e.target.value))} className="w-20"
          />
          <span className="tabular w-6 text-slate-300">{onlyConserved}%</span>
        </label>
        <Toggle checked={showQuery} onChange={setShowQuery} label="highlight query" />
        <Toggle
          checked={pinModel}
          onChange={setPinModel}
          label="model seq on top"
          title="pin the loaded model's own sequence in a fixed row under the ruler"
        />
        {residueMap && !residueMap.reliable && (
          <span
            className="rounded border border-amber-600/50 bg-amber-600/10 px-1.5 py-[1px] text-[10.5px] text-amber-300"
            title={`${residueMap.mismatches}/${residueMap.compared} residues differ from the structure sequence`}
          >
            alignment ≠ structure ({residueMap.mismatches}/{residueMap.compared})
          </span>
        )}
        {hoverCol != null && (
          <span className="chip">
            col <b className="tabular ml-1">{hoverCol + 1}</b>
            <span className="ml-2 text-slate-400">res</span>{' '}
            <b className="tabular ml-1">{colToRes(hoverCol) ?? 'gap'}</b>
            {colToRes(hoverCol) != null && (
              <>
                <span className="ml-2 text-slate-400">aa</span>{' '}
                <b className="tabular ml-1">{msa?.rows[queryRow]?.[hoverCol] ?? '–'}</b>
              </>
            )}
            {domainAtCol?.[hoverCol] && (
              <>
                <span className="ml-2 text-slate-400">domain</span>{' '}
                <b className="ml-1" style={{ color: domainAtCol[hoverCol]!.color }}>
                  {domainAtCol[hoverCol]!.name}
                </b>
              </>
            )}
          </span>
        )}
        <GhostBtn
          className="ml-auto"
          disabled={hoverCol == null || colToRes(hoverCol) == null}
          title="select the residue of the current model under the cursor"
          onClick={() => {
            if (hoverCol == null) return;
            const res = colToRes(hoverCol);
            if (res) setSelection({ ranges: [{ s: res, e: res }], label: `MSA column ${hoverCol + 1}`, source: 'msa' });
          }}
        >
          ← select column
        </GhostBtn>
        {model && model.domains.length > 0 && (
          <GhostBtn
            onClick={() =>
              setSelection({ ranges: model.domains.map((d) => ({ s: d.start, e: d.end })), label: 'all domains', source: 'domain' })
            }
            title="select every annotated domain"
          >
            ▦ all domains
          </GhostBtn>
        )}
        {queryRow < 0 && msa && (
          <span className="text-[10.5px] text-amber-400" title="no alignment row matched this model id">
            model not found in the alignment
          </span>
        )}
      </div>

      <div ref={wrapRef} className="relative flex min-h-0 flex-1">
        {statusMsa === 'loading' && !msa && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-slate-950/70 text-[12px] text-slate-300">
            <span className="flex items-center gap-2">
              <Spinner size={14} /> downloading & parsing the alignment…
            </span>
          </div>
        )}
        {statusMsa === 'error' && (
          <div className="absolute inset-0 z-10 grid place-items-center px-6 text-center text-[12px] text-rose-300">
            the alignment could not be loaded
          </div>
        )}
        <div
          ref={vScrollRef}
          onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
          className="canvas-scroll h-full w-[14px] shrink-0 overflow-y-auto overflow-x-hidden"
        >
          <div style={{ height: Math.max(1, totalH), width: 1 }} />
        </div>
        <div className="relative min-w-0 flex-1">
          <canvas
            ref={canvasRef}
            onWheel={onWheel}
            onPointerMove={(ev) => {
              const c = colFromEvent(ev.clientX);
              setHoverCol(c);
              if (c != null) {
                const res = colToRes(c);
                if (res) setHover([res]);
              }
            }}
            onPointerLeave={() => {
              setHoverCol(null);
              setHover([]);
            }}
            onPointerDown={(ev) => {
              const c = colFromEvent(ev.clientX);
              if (c == null) return;
              const res = colToRes(c);
              if (!res) return;
              const r = rowFromEvent(ev.clientY);
              const nm = r != null ? msa?.names[r] : undefined;
              const isQuery = r === queryRow;
              setSelection({
                ranges: [{ s: res, e: res }],
                label:
                  `column ${c + 1} → ${model?.id ?? 'query'}:${res}` +
                  (nm && !isQuery ? ` (clicked ${nm})` : ''),
                source: 'msa',
              });
            }}
            style={{
              position: 'absolute',
              inset: 0,
              /* explicit integer size: the bitmap is sized from this box, so CSS 100% of a
                 fractional parent would scale the drawing and the hit test would disagree
                 with the pixels (letters off by one column, rows off by one row) */
              width: viewport.w || '100%',
              height: viewport.h || '100%',
              cursor: 'crosshair',
            }}
          />
        </div>
      </div>

      <div className="flex h-[16px] shrink-0 items-center gap-2">
        <div className="w-[14px] shrink-0" />
        <div
          ref={hScrollRef}
          onScroll={(e) => setScrollLeft((e.target as HTMLDivElement).scrollLeft)}
          className="canvas-scroll h-[14px] min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
        >
          <div style={{ width: Math.max(1, totalW), height: 1 }} />
        </div>
        <span className="shrink-0 pr-2 text-[10px] text-slate-600">
          click a column → residue in 3D · scroll = pan
        </span>
      </div>
    </div>
  );
}

/**
 * Alignment-column window covering a residue range (1-based model numbering), used for
 * highlighting. Residues absent from the mapping (gap in this row, or not modelled) fall
 * back to the nearest present neighbour instead of collapsing onto `residue - 1`, which
 * would drift by one column per indel.
 */
function resRangeToCols(map: { resToCol: Int32Array; colToRes: Int32Array }, s: number, e: number) {
  const n = map.resToCol.length - 1;
  const find = (res: number, dir: 1 | -1, guard = 64) => {
    for (let k = 0; k <= guard; k++) {
      const r = res + dir * k;
      if (r < 1 || r > n) break;
      const c = map.resToCol[r];
      if (c >= 0) return c;
    }
    return -1;
  };
  let lo = find(Math.max(1, s), 1);
  let hi = find(Math.min(e, n), -1);
  if (lo < 0 && hi < 0) return { c0: s - 1, c1: e - 1 };
  if (lo < 0) lo = hi;
  if (hi < 0) hi = lo;
  return { c0: Math.min(lo, hi), c1: Math.max(lo, hi) };
}
