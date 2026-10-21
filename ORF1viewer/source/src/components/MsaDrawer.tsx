/**
 * Clustal Omega alignment drawer (canvas-rendered, virtualised).
 * ~1.2k sequences × ~2.9k columns → no DOM table: we draw the visible window and
 * sync two slim native scrollbars.  Column ↔ residue mapping comes from the
 * store (`residueMap`), i.e. it follows the *selected model's* own row, so
 * clicking a column highlights the right residue in 3D even across indels.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { DomainRange, ModelEntry } from '../lib/types';
import { Icon, Popover, Select, Spinner, Toggle } from './ui';
import { CANVAS_MONO, canvasPalette } from '../lib/theme';
import { clamp, lsGet, lsSet } from '../lib/util';
import { plddtHex } from '../lib/colormap';

const LABEL_W = 176;
const RULER_H = 20;

type ColorMode = 'plain' | 'identity' | 'domain' | 'plddt' | 'hydrophobic' | 'turn';

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
  const manifest = useStore((s) => s.manifest);
  const setModel = useStore((s) => s.setModel);
  const plddt = useStore((s) => s.plddt);
  const selection = useStore((s) => s.selection);
  const setSelection = useStore((s) => s.setSelection);
  const setHover = useStore((s) => s.setHover);
  const hover = useStore((s) => s.hover);
  const msaRow = useStore((s) => s.msaRow);
  const msaHeight = useStore((s) => s.msaHeight);
  const setMsaHeight = useStore((s) => s.setMsaHeight);
  const theme = useStore((s) => s.theme);

  const [baseW, setBaseW] = useState(6);
  const [rowH, setRowH] = useState(13);
  const [mode, setMode] = useState<ColorMode>('domain');
  const [showQuery, setShowQuery] = useState(true);
  const [pinModel, setPinModel] = useState(true);
  const [onlyConserved, setOnlyConserved] = useState(0);
  const [clickOpensModel, setClickOpensModel] = useState(() => lsGet('orf1.msaClickOpens', '0') === '1');
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
   * Each alignment row -> the catalogue entry it belongs to, resolved the same way the
   * store resolves the loaded model's own row (name prefix, "#k" collision suffix). This
   * lets every row be coloured/named from *its own* model, not just the pinned one.
   */
  const entryByRow = useMemo<(ModelEntry | null)[]>(() => {
    if (!msa || !manifest) return [];
    const out: (ModelEntry | null)[] = new Array(msa.names.length).fill(null);
    for (const m of manifest.models) {
      let idx: number | undefined = msa.indexByName[m.msaName];
      if (idx === undefined) {
        const key = Object.keys(msa.indexByName).find((k) => k.length >= 6 && m.id.startsWith(k.split('#')[0]));
        idx = key !== undefined ? msa.indexByName[key] : undefined;
      }
      if (idx !== undefined && !out[idx]) out[idx] = m;
    }
    return out;
  }, [msa, manifest]);

  /**
   * Per row, per alignment column: the domain of *that row's own model* residue in that
   * column — each sequence keeps its own domain annotation, so switching the loaded model
   * only moves the highlighted/pinned row, it never recolours the rest of the alignment.
   * Column -> residue for a row is just the count of non-gap characters up to that column
   * in the row itself (no indel correction needed: it is the row's own numbering).
   */
  const domainForRow = useCallback(
    (r: number): ((c: number) => DomainRange | null) => {
      const entry = r === queryRow ? model : entryByRow[r];
      const domains = entry?.domains ?? [];
      if (!domains.length) return () => null;
      if (r === queryRow && residueMap) {
        return (c: number) => {
          const res = residueMap.colToRes[c];
          return res > 0 ? domains.find((d) => res >= d.start && res <= d.end) ?? null : null;
        };
      }
      const row = msa?.rows[r] ?? '';
      let n = 0;
      let lastC = -1;
      return (c: number) => {
        // columns are asked in increasing order while drawing a row, so this running
        // counter stays O(columns) instead of O(columns²)
        if (c <= lastC) n = 0;
        for (let i = Math.max(0, lastC + 1); i <= c; i++) {
          const ch = row[i];
          if (ch && ch !== '-' && ch !== '.' && ch !== '?') n++;
        }
        lastC = c;
        return n > 0 ? domains.find((d) => n >= d.start && n <= d.end) ?? null : null;
      };
    },
    [entryByRow, msa, model, queryRow, residueMap]
  );

  /** hover-chip readout only, always for the pinned/query row (what 3D highlights) */
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
    const pal = canvasPalette();
    ctx.fillStyle = pal.bg;
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
    const fontFor = (px: number) => `${px}px ${CANVAS_MONO}`;
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
    if (selection) for (const r of selection.ranges) bands.push({ s: r.s, e: r.e, color: pal.selFill });
    for (const h of hover) bands.push({ s: h, e: h, color: pal.selFill });
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
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, viewport.w, RULER_H);
    ctx.strokeStyle = pal.line;
    ctx.beginPath();
    ctx.moveTo(0, RULER_H - 0.5);
    ctx.lineTo(viewport.w, RULER_H - 0.5);
    ctx.stroke();
    ctx.font = `11px ${CANVAS_MONO}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const step = Math.max(1, Math.round(58 / baseW)) * (baseW >= 10 ? 5 : 1);
    for (let c = Math.floor(firstCol / step) * step; c <= lastCol; c += step) {
      const x = LABEL_W + c * baseW - scrollLeft;
      if (x < LABEL_W - 24 || x > viewport.w) continue;
      const res = colToRes(c);
      ctx.fillStyle = pal.muted;
      ctx.fillText(res ? String(res) : `:${c + 1}`, x + baseW / 2, 5);
      ctx.fillRect(x, RULER_H - 3, 1, 3);
    }
    ctx.textAlign = 'left';
    if (queryRow >= 0 && msa.names[queryRow]) {
      ctx.fillStyle = pal.muted;
      ctx.fillText('Residue', 8, 5);
    }

    // sequences
    ctx.font = font;
    ctx.textBaseline = 'middle';
    const nameFor = (r: number, fallback: string): string => {
      const entry = r === queryRow ? model : entryByRow[r];
      const host = entry?.host;
      // model ids already carry the host (ACCESSION-host-length): don't repeat it
      return host && !fallback.toLowerCase().includes(host.toLowerCase()) ? `${fallback} · ${host}` : fallback;
    };
    const drawRow = (r: number, row: string | undefined, name: string, y: number, isQuery: boolean) => {
      const base = y + rowH / 2;
      ctx.textAlign = 'left';
      ctx.fillStyle = isQuery ? pal.fg : pal.muted;
      const nm = name ?? '';
      // trim to the label column by measured width, so names never run into the residues
      let label = nm;
      const room = LABEL_W - 16;
      if (ctx.measureText(label).width > room) {
        while (label.length > 1 && ctx.measureText(label + '…').width > room) label = label.slice(0, -1);
        label += '…';
      }
      ctx.fillText(label, 8, base);
      ctx.strokeStyle = pal.line;
      ctx.beginPath();
      ctx.moveTo(LABEL_W - 0.5, y);
      ctx.lineTo(LABEL_W - 0.5, y + rowH);
      ctx.stroke();
      if (!row) return;
      ctx.textAlign = 'center';
      const domainAt = mode === 'domain' ? domainForRow(r) : null;
      let plddtN = isQuery ? 0 : -1; // ungapped residue counter, only tracked when needed
      for (let c = firstCol; c < lastCol; c++) {
        const ch = row[c];
        if (!ch) continue;
        const x = glyphX(c);
        if (ch === '-' || ch === '.') {
          if (mode !== 'plain') {
            ctx.fillStyle = pal.line;
            ctx.fillText('·', x, base);
          }
          continue;
        }
        if (isQuery) plddtN++;
        const cons = msa.conservation[c];
        if (onlyConserved > 0 && cons * 100 < onlyConserved) {
          ctx.fillStyle = pal.line;
          ctx.fillText(ch, x, base);
          continue;
        }
        if (mode === 'identity') {
          // conservation as ink weight: faint letters vary, full-ink letters are conserved
          ctx.fillStyle = cons > 0.66 ? pal.fg : cons > 0.33 ? pal.muted : pal.faint;
        } else if (mode === 'domain') {
          ctx.fillStyle = domainAt?.(c)?.color ?? pal.faint;
        } else if (mode === 'plddt') {
          // only the pinned/loaded model carries a per-residue pLDDT array; other rows
          // fall back to a neutral colour rather than a made-up value
          if (isQuery && plddt && plddtN >= 1 && plddtN <= plddt.length) ctx.fillStyle = plddtHex(plddt[plddtN - 1]);
          else ctx.fillStyle = pal.faint;
        } else if (mode === 'hydrophobic') {
          ctx.fillStyle = HYDROPHOBIC[ch.toUpperCase()] ?? pal.fg;
        } else if (mode === 'turn') {
          const up = ch.toUpperCase();
          ctx.fillStyle = up === 'P' ? '#e0489c' : up === 'G' ? '#3fa34d' : pal.faint;
        } else {
          ctx.fillStyle = isQuery ? pal.fg : pal.muted;
        }
        ctx.fillText(ch, x, base);
      }
    };

    for (let r = firstRow; r < lastRow; r++) {
      const y = (r - firstRow) * rowH + RULER_H + pinnedH;
      const isQuery = showQuery && r === queryRow;
      if (isQuery) {
        ctx.fillStyle = pal.selFill;
        ctx.fillRect(0, y, viewport.w, rowH);
      }
      drawRow(r, rows[r], nameFor(r, msa.names[r] ?? ''), y, isQuery);
    }

    // the loaded model, pinned under the ruler
    if (pinnedH > 0 && queryRow >= 0) {
      const y = RULER_H;
      ctx.fillStyle = pal.raised;
      ctx.fillRect(0, y, viewport.w, pinnedH);
      drawRow(queryRow, rows[queryRow], nameFor(queryRow, model?.accession || model?.id || msa.names[queryRow] || 'model'), y, true);
      ctx.strokeStyle = pal.lineStrong;
      ctx.beginPath();
      ctx.moveTo(0, y + pinnedH - 0.5);
      ctx.lineTo(viewport.w, y + pinnedH - 0.5);
      ctx.stroke();
    }
    ctx.strokeStyle = pal.lineStrong;
    ctx.beginPath();
    ctx.moveTo(LABEL_W + 0.5, 0);
    ctx.lineTo(LABEL_W + 0.5, viewport.h);
    ctx.stroke();
  }, [
    msaOpen, msa, viewport.w, viewport.h, scrollTop, scrollLeft, baseW, rowH, mode,
    showQuery, pinModel, pinnedH, onlyConserved, selection, hover, nRows, nCols, queryRow,
    residueMap, domainAtCol, domainForRow, entryByRow, colToRes, model, plddt, theme,
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

  const summary = msa
    ? `${msa.names.length.toLocaleString()} sequences, ${msa.columns.toLocaleString()} columns`
    : statusMsa === 'error'
      ? 'could not be loaded'
      : 'loading…';

  if (!msaOpen) {
    return (
      <div className="flex h-10 shrink-0 items-center gap-3 border-t border-line bg-surface px-4">
        <button onClick={() => toggleMsa(true)} className="btn-ghost -ml-2 font-semibold text-fg" aria-expanded={false}>
          <Icon name="chevronUp" size={15} /> Alignment
        </button>
        <span className="truncate text-[12px] text-muted">{summary}</span>
        <span className="ml-auto hidden text-[12px] text-muted sm:inline">
          <kbd>M</kbd> to toggle
        </span>
      </div>
    );
  }

  const hoverRes = hoverCol != null ? colToRes(hoverCol) : null;
  const hoverDomain = hoverCol != null ? domainAtCol?.[hoverCol] : null;

  return (
    <div className="flex shrink-0 flex-col border-t border-line bg-surface" style={{ height: msaHeight }}>
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
        title="Drag to resize"
        className="group flex h-2 shrink-0 cursor-row-resize items-center justify-center"
      >
        <span className={`h-[3px] w-10 rounded-full ${resizing ? 'bg-fg' : 'bg-line group-hover:bg-line-strong'}`} />
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-4 pb-2 pt-1">
        <button onClick={() => toggleMsa(false)} className="btn-ghost -ml-2 font-semibold text-fg" aria-expanded>
          <Icon name="chevronDown" size={15} /> Alignment
        </button>
        <span className="text-[12px] text-muted">{summary}</span>
        <Select
          value={mode}
          options={[
            { value: 'domain', label: 'Colour by domain' },
            { value: 'plddt', label: 'Colour by pLDDT' },
            { value: 'identity', label: 'Colour by conservation' },
            { value: 'hydrophobic', label: 'Colour by chemistry' },
            { value: 'turn', label: 'Highlight Pro and Gly' },
            { value: 'plain', label: 'No colour' },
          ]}
          onChange={(v) => setMode(v as ColorMode)}
          title="Residue colours. By domain uses each sequence’s own annotation; by pLDDT only colours the loaded model."
        />
        <label className="flex items-center gap-2 text-[12px] text-muted">
          Zoom
          <input
            type="range" min={3} max={16} step={1} value={baseW}
            onChange={(e) => setBaseW(Number(e.target.value))} className="w-20" aria-label="Column width"
          />
        </label>
        <Popover
          up
          trigger={({ open, toggle }) => (
            <button type="button" className="btn" data-active={open ? 'true' : 'false'} onClick={toggle} aria-expanded={open}>
              Options <Icon name="chevronUp" size={14} />
            </button>
          )}
          panelClassName="w-[17rem]"
        >
          <div className="flex flex-col gap-3 px-2 py-2">
            <label className="flex items-center justify-between gap-2 text-[12.5px]">
              Row height
              <input
                type="range" min={10} max={20} step={1} value={rowH}
                onChange={(e) => setRowH(Number(e.target.value))} className="w-24"
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-[12.5px]" title="Grey out columns below this conservation">
              <span>
                Fade below <b>{onlyConserved}%</b> identity
              </span>
              <input
                type="range" min={0} max={100} step={5} value={onlyConserved}
                onChange={(e) => setOnlyConserved(Number(e.target.value))} className="w-24"
              />
            </label>
            <Toggle checked={pinModel} onChange={setPinModel} label="Keep the loaded model on top" />
            <Toggle checked={showQuery} onChange={setShowQuery} label="Shade the loaded model’s row" />
            <Toggle
              checked={clickOpensModel}
              onChange={(v) => {
                setClickOpensModel(v);
                lsSet('orf1.msaClickOpens', v ? '1' : '0');
              }}
              label="Click a row to open its model"
            />
          </div>
        </Popover>
        {residueMap && !residueMap.reliable && (
          <span
            className="text-[12px] text-warn"
            title={`${residueMap.mismatches}/${residueMap.compared} residues differ from the structure sequence`}
          >
            This alignment row differs from the structure ({residueMap.mismatches} of {residueMap.compared} residues)
          </span>
        )}
        {queryRow < 0 && msa && (
          <span className="text-[12px] text-warn">The loaded model has no row in this alignment</span>
        )}
        <span className="ml-auto truncate text-[12px] text-muted">
          {hoverCol != null ? (
            <>
              Column <b className="text-fg">{hoverCol + 1}</b>
              {hoverRes != null ? (
                <>
                  {' '}
                  · residue <b className="text-fg">{hoverRes}</b> ({msa?.rows[queryRow]?.[hoverCol] ?? '–'})
                </>
              ) : (
                ' · gap in the loaded model'
              )}
              {hoverDomain && (
                <>
                  {' '}
                  in <b style={{ color: hoverDomain.color }}>{hoverDomain.name}</b>
                </>
              )}
            </>
          ) : (
            'Click a column to select that residue'
          )}
        </span>
      </div>

      <div ref={wrapRef} className="relative flex min-h-0 flex-1">
        {statusMsa === 'loading' && !msa && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-surface text-muted">
            <span className="flex items-center gap-2">
              <Spinner size={14} /> Downloading the alignment…
            </span>
          </div>
        )}
        {statusMsa === 'error' && (
          <div className="absolute inset-0 z-10 grid place-items-center px-6 text-center text-danger">
            The alignment could not be loaded. Check the data source in Settings.
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
              if (clickOpensModel && r != null && !isQuery) {
                const entry = entryByRow[r];
                if (entry) {
                  void setModel(entry.id);
                  return;
                }
              }
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
