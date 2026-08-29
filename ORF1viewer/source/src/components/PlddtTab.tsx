/**
 * Tab “pLDDT & domains”: 1D confidence plot (canvas) + annotated domain table.
 * Click / drag on the plot selects residues; hovering highlights them in 3D.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { PLDDT_BANDS, plddtHex } from '../lib/colormap';
import { fmt, clamp, downloadCanvasPng, rafThrottle } from '../lib/util';
import { Badge, Btn, Spinner, Toggle } from './ui';

const M = { l: 34, r: 8, t: 8, b: 20 };

export function PlddtTab() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ a: number; b: number } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [showSmooth, setShowSmooth] = useState(false);

  const plddt = useStore((s) => s.plddt);
  const model = useStore((s) => s.model);
  const status = useStore((s) => s.status.plddt);
  const selection = useStore((s) => s.selection);
  const setSelection = useStore((s) => s.setSelection);
  const setHover = useStore((s) => s.setHover);
  const length = model?.length ?? 0;

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    return () => ro.disconnect();
  }, []);

  const smooth = useMemo(() => {
    if (!plddt || !showSmooth) return null;
    const w = 15;
    const half = w >> 1;
    const out = new Float32Array(plddt.length);
    let acc = 0;
    for (let i = 0; i < plddt.length; i++) {
      acc += plddt[i];
      if (i >= w) acc -= plddt[i - w];
      const n = Math.min(i + 1, w);
      out[i] = acc / n;
    }
    for (let i = half; i < plddt.length - half; i++) {
      let s2 = 0;
      for (let k = -half; k <= half; k++) s2 += out[i + k];
      out[i] = s2 / w;
    }
    return out;
  }, [plddt, showSmooth]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !plddt || size.w < 24) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(size.w * dpr);
    canvas.height = Math.floor(size.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const plotW = size.w - M.l - M.r;
    const plotH = size.h - M.t - M.b;
    const x = (res: number) => M.l + ((res - 1) / Math.max(1, length - 1)) * plotW;
    const y = (v: number) => M.t + plotH - (clamp(v, 0, 100) / 100) * plotH;

    // confidence bands
    const bands: [number, number, string][] = [
      [0, 50, 'rgba(255,125,69,.10)'],
      [50, 70, 'rgba(250,204,65,.10)'],
      [70, 90, 'rgba(124,200,245,.10)'],
      [90, 100, 'rgba(30,93,166,.16)'],
    ];
    for (const [a, b, c] of bands) {
      ctx.fillStyle = c;
      ctx.fillRect(M.l, y(b), plotW, y(a) - y(b));
    }
    ctx.strokeStyle = 'rgba(148,163,184,.22)';
    ctx.lineWidth = 1;
    for (const v of [50, 70, 90]) {
      ctx.beginPath();
      ctx.moveTo(M.l, y(v));
      ctx.lineTo(M.l + plotW, y(v));
      ctx.stroke();
    }
    // axes
    ctx.strokeStyle = 'rgba(148,163,184,.5)';
    ctx.beginPath();
    ctx.moveTo(M.l, M.t);
    ctx.lineTo(M.l, M.t + plotH);
    ctx.lineTo(M.l + plotW, M.t + plotH);
    ctx.stroke();
    ctx.fillStyle = 'rgba(148,163,184,.85)';
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const v of [0, 50, 70, 90, 100]) ctx.fillText(String(v), M.l - 5, y(v));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const step = niceStep(length, Math.floor(plotW / 62));
    for (let v = step; v <= length; v += step) ctx.fillText(String(v), x(v), M.t + plotH + 3);

    // domain shading + separators
    if (model) {
      for (const d of model.domains) {
        ctx.fillStyle = hexA(d.color, 0.10);
        ctx.fillRect(x(d.start), M.t, Math.max(1, x(d.end) - x(d.start)), plotH);
        ctx.strokeStyle = hexA(d.color, 0.55);
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x(d.start), M.t);
        ctx.lineTo(x(d.start), M.t + plotH);
        ctx.moveTo(x(d.end), M.t);
        ctx.lineTo(x(d.end), M.t + plotH);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = hexA(d.color, 0.95);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const label = d.name.replace('border_', 'b/');
        if (x(d.end) - x(d.start) > 18) ctx.fillText(label, x(d.start) + 2, M.t + 1);
      }
    }

    // selection
    if (selection) {
      for (const r of selection.ranges) {
        ctx.fillStyle = 'rgba(56,189,248,.20)';
        ctx.fillRect(x(r.s), M.t, Math.max(1.5, x(r.e) - x(r.s)), plotH);
      }
    }

    // pLDDT curve, drawn as per-residue coloured segments
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < plddt.length; i++) {
      const px = x(i + 1);
      const py = y(plddt[i]);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = 'rgba(226,232,240,.75)';
    ctx.stroke();
    // confidence colour ticks
    for (let i = 0; i < plddt.length; i++) {
      ctx.fillStyle = plddtHex(plddt[i]);
      ctx.fillRect(x(i + 1) - 0.5, y(plddt[i]) - 1.5, Math.max(1, plotW / length), 3);
    }
    if (smooth) {
      ctx.beginPath();
      for (let i = 0; i < smooth.length; i++) {
        const px = x(i + 1);
        const py = y(smooth[i]);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    const drag = dragRef.current;
    if (drag) {
      ctx.strokeStyle = '#38bdf8';
      ctx.strokeRect(
        Math.min(x(drag.a), x(drag.b)),
        M.t,
        Math.max(2, Math.abs(x(drag.b) - x(drag.a))),
        plotH
      );
    }
  }, [plddt, smooth, size.w, size.h, length, model, selection]);

  const idxFromEvent = useCallback(
    (ev: React.PointerEvent) => {
      const box = (ev.currentTarget as HTMLElement).getBoundingClientRect();
      const px = ev.clientX - box.left;
      const plotW = size.w - M.l - M.r;
      const t = (px - M.l) / plotW;
      return clamp(Math.round(t * (length - 1)) + 1, 1, length);
    },
    [size.w, length]
  );

  const onMove = useCallback(
    (ev: React.PointerEvent) => {
      const res = idxFromEvent(ev);
      if (dragRef.current) dragRef.current.b = res;
      hoverSet(res, setHover);
    },
    [idxFromEvent, setHover]
  );

  const exportPng = async () => {
    await downloadCanvasPng([canvasRef.current], `ORF1_${model?.id ?? 'model'}_pLDDT.png`);
  };

  const stats = useMemo(() => {
    if (!plddt || !model) return null;
    let mn = Infinity;
    let mx = -Infinity;
    let sum = 0;
    let lt50 = 0;
    for (const v of plddt) {
      mn = Math.min(mn, v);
      mx = Math.max(mx, v);
      sum += v;
      if (v < 50) lt50++;
    }
    return { min: mn, max: mx, mean: sum / plddt.length, pctLt50: (100 * lt50) / plddt.length };
  }, [plddt, model]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-2 py-1.5">
        <Toggle checked={showSmooth} onChange={setShowSmooth} label="smoothed (15 aa)" />
        {PLDDT_BANDS.map((b) => (
          <span key={b.label} className="flex items-center gap-1 text-[10.5px] text-slate-400">
            <span className="h-2.5 w-3 rounded-sm" style={{ background: b.color }} />
            {b.label}
          </span>
        ))}
        <span className="ml-auto">
          <Btn onClick={() => void exportPng()} title="save this plot (pLDDT + domains) as a PNG">◍ PNG</Btn>
        </span>
        {stats && (
          <span className="flex items-center gap-1.5">
            <Badge label="min" value={fmt(stats.min, 1)} />
            <Badge label="mean" value={fmt(stats.mean, 1)} />
            <Badge label="max" value={fmt(stats.max, 1)} />
          </span>
        )}
      </div>
      <div ref={hostRef} className="relative min-h-[140px] flex-1 select-none">
        {status === 'loading' && (
          <div className="absolute inset-0 grid place-items-center text-[12px] text-slate-400">
            <span className="flex items-center gap-2">
              <Spinner size={14} /> loading pLDDT…
            </span>
          </div>
        )}
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'crosshair' }}
          onPointerDown={(ev) => {
            const res = idxFromEvent(ev);
            dragRef.current = { a: res, b: res };
            (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
          }}
          onPointerMove={onMove}
          onPointerUp={(ev) => {
            const drag = dragRef.current;
            dragRef.current = null;
            (ev.currentTarget as HTMLElement).releasePointerCapture?.(ev.pointerId);
            if (!drag) return;
            const s = Math.min(drag.a, drag.b);
            const e = Math.max(drag.a, drag.b);
            setSelection({ ranges: [{ s, e }], label: `pLDDT range ${s}–${e}`, source: 'plddt' });
          }}
          onPointerLeave={() => setHover([])}
        />
      </div>
      <DomainTable />
    </div>
  );
}

export function DomainTable() {
  const model = useStore((s) => s.model);
  const plddt = useStore((s) => s.plddt);
  const setSelection = useStore((s) => s.setSelection);
  const setHover = useStore((s) => s.setHover);
  const selection = useStore((s) => s.selection);
  if (!model) return null;

  const rows = model.domains.map((d) => {
    const stat = model.domainStats?.find((s) => s.name === d.name);
    let mean: number | null = stat?.meanPlddt ?? null;
    const meanPae = stat?.meanPae ?? null;
    if (mean == null && plddt) {
      let acc = 0;
      let n = 0;
      for (let i = d.start - 1; i < Math.min(d.end, plddt.length); i++) {
        acc += plddt[i];
        n++;
      }
      mean = n ? acc / n : null;
    }
    return { ...d, mean, meanPae };
  });

  return (
    <div className="max-h-[38%] shrink-0 overflow-auto border-t border-slate-800">
      <table className="w-full border-collapse text-[11.5px]">
        <thead className="sticky top-0 bg-slate-900/95 text-slate-400">
          <tr>
            <th className="px-2 py-1 text-left font-medium">domain</th>
            <th className="px-2 py-1 text-right font-medium">range</th>
            <th className="px-2 py-1 text-right font-medium">len</th>
            <th className="px-2 py-1 text-right font-medium">⟨pLDDT⟩</th>
            <th className="px-2 py-1 text-right font-medium">⟨PAE⟩</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isSel = selection?.ranges.some((x) => x.s === r.start && x.e === r.end);
            return (
              <tr
                key={r.name + r.start}
                onClick={() => setSelection({ ranges: [{ s: r.start, e: r.end }], label: r.name, source: 'domain' })}
                onMouseEnter={() => setHover([r.start, r.end])}
                onMouseLeave={() => setHover([])}
                className={`cursor-pointer border-t border-slate-800/70 hover:bg-slate-800/40 ${
                  isSel ? 'bg-sky-600/10' : ''
                }`}
              >
                <td className="px-2 py-1">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: r.color }} />
                    <span className="truncate text-slate-200">{r.name}</span>
                  </span>
                </td>
                <td className="tabular px-2 py-1 text-right text-slate-300">
                  {r.start}–{r.end}
                </td>
                <td className="tabular px-2 py-1 text-right text-slate-400">{r.end - r.start + 1}</td>
                <td className="tabular px-2 py-1 text-right text-slate-300">{fmt(r.mean, 1)}</td>
                <td className="tabular px-2 py-1 text-right text-slate-400">
                  {r.meanPae == null ? '—' : fmt(r.meanPae, 1)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="px-2 py-1 text-[10.5px] text-slate-500">
        click a row to select its residues in 3D · ⟨PAE⟩ = mean over the domain’s own square
      </div>
    </div>
  );
}

const hoverSet = rafThrottle((res: number, setHover: (r: number[]) => void) => setHover([res]));

function niceStep(span: number, maxTicks: number): number {
  const raw = span / Math.max(1, maxTicks);
  const pow = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  for (const m of [1, 2, 5, 10]) if (raw <= m * pow) return Math.max(1, m * pow);
  return Math.max(1, 10 * pow);
}

function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
