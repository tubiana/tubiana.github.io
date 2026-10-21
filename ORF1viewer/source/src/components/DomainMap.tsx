/**
 * The polyprotein map: ORF1 drawn the way virologists draw it — annotated domains
 * as blocks along the residue axis — with the model's pLDDT as a ribbon under it.
 * It doubles as the main residue navigator: click a domain to select it, drag to
 * select any span. Hover and selection are shared with every other panel.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../state/store';
import { PLDDT_BANDS, plddtHex } from '../lib/colormap';
import { clamp, fmt, rafThrottle } from '../lib/util';
import type { DomainRange } from '../lib/types';

const TRACK_H = 24;
const RIBBON_GAP = 4;
const RIBBON_H = 7;
const AXIS_H = 15;
const H = TRACK_H + RIBBON_GAP + RIBBON_H + AXIS_H;

/** dark text on light domain colours, light text on dark ones */
function inkFor(hex: string): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#14191f' : '#ffffff';
}

function niceStep(span: number, maxTicks: number): number {
  const raw = span / Math.max(1, maxTicks);
  const pow = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  for (const m of [1, 2, 5, 10]) if (raw <= m * pow) return Math.max(1, m * pow);
  return 10 * pow;
}

const hoverSet = rafThrottle((res: number[], set: (r: number[]) => void) => set(res));

export function DomainMap() {
  const model = useStore((s) => s.model);
  const plddt = useStore((s) => s.plddt);
  const selection = useStore((s) => s.selection);
  const hover = useStore((s) => s.hover);
  const setSelection = useStore((s) => s.setSelection);
  const setHover = useStore((s) => s.setHover);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(0);
  const [drag, setDrag] = useState<{ a: number; b: number; moved: boolean } | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.floor(el.getBoundingClientRect().width)));
    ro.observe(el);
    setW(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);

  const n = model?.length ?? 0;
  const x = (res: number) => (n > 1 ? ((res - 1) / n) * w : 0);
  const resAt = (clientX: number) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box || n < 1) return 1;
    return clamp(Math.floor(((clientX - box.left) / box.width) * n) + 1, 1, n);
  };
  const domainAt = (res: number): DomainRange | null =>
    model?.domains.find((d) => res >= d.start && res <= d.end) ?? null;

  // pLDDT ribbon as runs of identical bands: a few hundred rects, not one per residue
  const ribbon = useMemo(() => {
    if (!plddt) return [];
    const runs: { s: number; e: number; color: string }[] = [];
    for (let i = 0; i < plddt.length; i++) {
      const c = plddtHex(plddt[i]);
      const last = runs[runs.length - 1];
      if (last && last.color === c) last.e = i + 1;
      else runs.push({ s: i + 1, e: i + 1, color: c });
    }
    return runs;
  }, [plddt]);

  if (!model) return <div className="h-[50px]" />;

  const ticks: number[] = [];
  if (w > 0) {
    const step = niceStep(n, Math.floor(w / 70));
    for (let v = step; v < n - step * 0.3; v += step) ticks.push(v);
  }
  const selRanges = drag
    ? [{ s: Math.min(drag.a, drag.b), e: Math.max(drag.a, drag.b) }]
    : selection?.ranges ?? [];

  return (
    <div
      ref={boxRef}
      className="relative w-full cursor-crosshair select-none touch-none"
      style={{ height: H }}
      onPointerDown={(e) => {
        const r = resAt(e.clientX);
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        setDrag({ a: r, b: r, moved: false });
      }}
      onPointerMove={(e) => {
        const r = resAt(e.clientX);
        if (drag) setDrag({ ...drag, b: r, moved: drag.moved || r !== drag.a });
        hoverSet([r], setHover);
      }}
      onPointerUp={(e) => {
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
        if (!drag) return;
        setDrag(null);
        if (!drag.moved) {
          const d = domainAt(drag.a);
          if (d) setSelection({ ranges: [{ s: d.start, e: d.end }], label: d.name, source: 'domain' });
          else setSelection({ ranges: [{ s: drag.a, e: drag.a }], label: `Residue ${drag.a}`, source: 'plddt' });
          return;
        }
        const s = Math.min(drag.a, drag.b);
        const en = Math.max(drag.a, drag.b);
        setSelection({ ranges: [{ s, e: en }], label: `Residues ${s}–${en}`, source: 'domain' });
      }}
      onPointerLeave={() => {
        if (!drag) setHover([]);
      }}
    >
      <svg width={w} height={H} className="block overflow-visible" role="img" aria-label="Domain map with pLDDT ribbon">
        {/* backbone line: unannotated stretches read as linkers */}
        <line x1={0} x2={w} y1={TRACK_H / 2} y2={TRACK_H / 2} stroke="var(--line-strong)" strokeWidth={2} />

        {model.domains.map((d) => {
          const x0 = x(d.start);
          const x1 = x(d.end + 1);
          const bw = Math.max(1, x1 - x0);
          const label = d.name;
          const fits = bw > label.length * 7 + 8;
          return (
            <g key={`${d.name}-${d.start}`}>
              <title>{`${d.name} · ${d.start}–${d.end} (${d.end - d.start + 1} aa)`}</title>
              <rect x={x0 + 0.5} y={1} width={Math.max(1, bw - 1)} height={TRACK_H - 2} rx={4} fill={d.color} />
              {fits && (
                <text
                  x={x0 + bw / 2}
                  y={TRACK_H / 2 + 0.5}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={inkFor(d.color)}
                  style={{ font: '600 12px var(--font-sans)' }}
                >
                  {label}
                </text>
              )}
            </g>
          );
        })}

        {/* pLDDT ribbon */}
        <g transform={`translate(0, ${TRACK_H + RIBBON_GAP})`}>
          {ribbon.length === 0 && <rect x={0} y={0} width={w} height={RIBBON_H} rx={2} fill="var(--raised)" />}
          {ribbon.map((r) => (
            <rect key={r.s} x={x(r.s)} y={0} width={Math.max(0.6, x(r.e + 1) - x(r.s))} height={RIBBON_H} fill={r.color} />
          ))}
        </g>

        {/* axis */}
        <g transform={`translate(0, ${TRACK_H + RIBBON_GAP + RIBBON_H})`}>
          {ticks.map((t) => (
            <g key={t} transform={`translate(${x(t)}, 0)`}>
              <line y1={0} y2={3} stroke="var(--faint)" />
              <text y={13} textAnchor="middle" fill="var(--muted)" style={{ font: '11px var(--font-sans)' }}>
                {t}
              </text>
            </g>
          ))}
        </g>

        {/* selection */}
        {selRanges.map((r, i) => {
          const x0 = x(r.s);
          const x1 = x(r.e + 1);
          return (
            <g key={i} pointerEvents="none">
              <rect x={x0} y={-3} width={Math.max(2, x1 - x0)} height={TRACK_H + RIBBON_GAP + RIBBON_H + 6} fill="var(--sel-fill)" />
              <path
                d={`M${x0},${TRACK_H + RIBBON_GAP + RIBBON_H + 3} V-3 H${x0 + Math.max(2, x1 - x0)} V${TRACK_H + RIBBON_GAP + RIBBON_H + 3}`}
                fill="none"
                stroke="var(--sel-line)"
                strokeWidth={1.5}
              />
            </g>
          );
        })}

        {/* hover, from this map or any linked panel */}
        {hover.slice(0, 2).map((r, i) => (
          <line
            key={i}
            pointerEvents="none"
            x1={x(r + 0.5)}
            x2={x(r + 0.5)}
            y1={-3}
            y2={TRACK_H + RIBBON_GAP + RIBBON_H + 3}
            stroke="var(--fg)"
            strokeWidth={1.2}
          />
        ))}
      </svg>
    </div>
  );
}

/**
 * One line under the map: what is selected and what can be done with it, or what
 * the pointer is over, or — when nothing is going on — how to start.
 */
export function SelectionLine() {
  const model = useStore((s) => s.model);
  const plddt = useStore((s) => s.plddt);
  const selection = useStore((s) => s.selection);
  const hover = useStore((s) => s.hover);
  const cursor = useStore((s) => s.cursor);
  const setSelection = useStore((s) => s.setSelection);
  const requestFocus = useStore((s) => s.requestFocus);
  const zoomPae = useStore((s) => s.zoomPaeToSelection);

  const meanOf = (ranges: { s: number; e: number }[]) => {
    if (!plddt) return null;
    let acc = 0;
    let k = 0;
    for (const r of ranges) for (let i = r.s; i <= r.e && i <= plddt.length; i++, k++) acc += plddt[i - 1];
    return k ? acc / k : null;
  };

  let body: ReactNode;
  if (hover.length && !selection) {
    const r = hover[0];
    const d = model?.domains.find((x) => r >= x.start && r <= x.end);
    body = (
      <span className="text-muted">
        {cursor ? (
          <>
            Residues <b className="text-fg">{cursor.i + 1}</b> and <b className="text-fg">{cursor.j + 1}</b> · PAE{' '}
            <b className="text-fg">{fmt(cursor.v, 1)} Å</b>
          </>
        ) : (
          <>
            Residue <b className="text-fg">{r}</b>
            {d && <> in {d.name}</>}
            {plddt && r <= plddt.length && (
              <>
                {' '}
                · pLDDT <b className="text-fg">{plddt[r - 1]}</b>
              </>
            )}
          </>
        )}
      </span>
    );
  } else if (selection) {
    const span = selection.ranges.reduce((a, r) => a + r.e - r.s + 1, 0);
    const m = meanOf(selection.ranges);
    const where = selection.ranges.map((r) => (r.s === r.e ? `${r.s}` : `${r.s}–${r.e}`)).join(' and ');
    body = (
      <>
        <span className="min-w-0 truncate">
          <span className="text-muted">Selected </span>
          <b>{selection.source === 'domain' && !selection.label.startsWith('Residues') ? selection.label : where}</b>
          {selection.source === 'domain' && !selection.label.startsWith('Residues') && <span className="text-muted"> · {where}</span>}
          <span className="text-muted">
            {' '}
            · {span} aa{m != null && <> · mean pLDDT {fmt(m, 1)}</>}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          <button className="btn-ghost" onClick={requestFocus} title="Frame the selection in the 3D view (F)">
            Focus in 3D
          </button>
          <button className="btn-ghost" onClick={zoomPae} title="Zoom the PAE matrix to the selection">
            Zoom PAE
          </button>
          <button className="btn-ghost" onClick={() => setSelection(null)} title="Clear the selection (Esc)">
            Clear
          </button>
        </span>
      </>
    );
  } else {
    body = (
      <span className="truncate text-muted">
        Click a domain or drag along the map to select residues. The 3D view, PAE matrix and alignment follow.
      </span>
    );
  }

  return (
    <div className="flex h-8 min-w-0 items-center justify-between gap-3 text-[12.5px]">
      {body}
      <PlddtKey />
    </div>
  );
}

function PlddtKey() {
  return (
    <span className="hidden shrink-0 items-center gap-2.5 text-[11.5px] text-muted xl:flex" title="pLDDT ribbon colours">
      pLDDT
      {[...PLDDT_BANDS].reverse().map((b) => (
        <span key={b.min} className="flex items-center gap-1">
          <span className="inline-block h-[7px] w-3 rounded-[2px]" style={{ background: b.color }} />
          {b.min === 0 ? '<50' : b.min === 90 ? '>90' : `${b.min}–${b.min + 20}`}
        </span>
      ))}
    </span>
  );
}
