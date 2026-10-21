/**
 * Tab “Domains”: per-domain confidence (table), how confidently the domains are
 * placed relative to each other (domain × domain mean PAE), and the per-residue
 * pLDDT profile. Everything here selects residues; hovering highlights them in 3D.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { bandTable, colormapTable, plddtHex } from '../lib/colormap';
import { regionStats } from '../lib/pae';
import { fmt, clamp, downloadCanvasPng, rafThrottle } from '../lib/util';
import { CANVAS_FONT, canvasPalette } from '../lib/theme';
import { IconBtn, Spinner, Toggle } from './ui';

const M = { l: 34, r: 10, t: 10, b: 22 };

export function PlddtTab() {
  return (
    <div className="h-full overflow-y-auto">
      <Section title="Per domain" hint="Click a row to select the domain">
        <DomainTable />
      </Section>
      <Section title="Domain × domain PAE" hint="Mean error, in Å, of each domain’s placement relative to another" right={<CopyDomainMatrix />}>
        <DomainPaeGrid />
      </Section>
      <PlddtProfile />
    </div>
  );
}

function Section({
  title,
  hint,
  right,
  children,
}: {
  title: string;
  hint?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-line px-4 py-3">
      <header className="mb-2 flex items-baseline gap-3">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        {hint && <span className="min-w-0 truncate text-[12px] text-muted">{hint}</span>}
        <span className="ml-auto">{right}</span>
      </header>
      {children}
    </section>
  );
}

// ------------------------------------------------------------- pLDDT profile
function PlddtProfile() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ a: number; b: number } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [showSmooth, setShowSmooth] = useState(false);

  const plddt = useStore((s) => s.plddt);
  const model = useStore((s) => s.model);
  const status = useStore((s) => s.status.plddt);
  const selection = useStore((s) => s.selection);
  const hover = useStore((s) => s.hover);
  const setSelection = useStore((s) => s.setSelection);
  const setHover = useStore((s) => s.setHover);
  const theme = useStore((s) => s.theme);
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
    const pal = canvasPalette();
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

    // domain shading
    if (model) {
      for (const d of model.domains) {
        ctx.fillStyle = hexA(d.color, theme === 'light' ? 0.12 : 0.1);
        ctx.fillRect(x(d.start), M.t, Math.max(1, x(d.end) - x(d.start)), plotH);
      }
    }
    // band thresholds
    ctx.strokeStyle = pal.line;
    ctx.lineWidth = 1;
    for (const v of [50, 70, 90]) {
      ctx.beginPath();
      ctx.moveTo(M.l, Math.round(y(v)) + 0.5);
      ctx.lineTo(M.l + plotW, Math.round(y(v)) + 0.5);
      ctx.stroke();
    }
    // axes
    ctx.strokeStyle = pal.lineStrong;
    ctx.beginPath();
    ctx.moveTo(M.l + 0.5, M.t);
    ctx.lineTo(M.l + 0.5, M.t + plotH + 0.5);
    ctx.lineTo(M.l + plotW, M.t + plotH + 0.5);
    ctx.stroke();
    ctx.fillStyle = pal.muted;
    ctx.font = `11px ${CANVAS_FONT}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const v of [0, 50, 70, 90]) ctx.fillText(String(v), M.l - 6, y(v));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const step = niceStep(length, Math.floor(plotW / 62));
    for (let v = step; v <= length; v += step) ctx.fillText(String(v), x(v), M.t + plotH + 5);

    // selection
    if (selection) {
      ctx.fillStyle = pal.selFill;
      for (const r of selection.ranges) ctx.fillRect(x(r.s), M.t, Math.max(1.5, x(r.e) - x(r.s)), plotH);
    }

    // per-residue points in their band colour: the curve and its meaning in one mark
    const bar = Math.max(1, plotW / length);
    for (let i = 0; i < plddt.length; i++) {
      ctx.fillStyle = plddtHex(plddt[i]);
      ctx.fillRect(x(i + 1) - bar / 2, y(plddt[i]) - 1.25, bar, 2.5);
    }
    if (smooth) {
      ctx.beginPath();
      for (let i = 0; i < smooth.length; i++) {
        const px = x(i + 1);
        const py = y(smooth[i]);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = pal.fg;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // hover from any linked panel
    ctx.strokeStyle = pal.hoverLine;
    ctx.lineWidth = 1;
    for (const r of hover.slice(0, 2)) {
      ctx.beginPath();
      ctx.moveTo(Math.round(x(r)) + 0.5, M.t);
      ctx.lineTo(Math.round(x(r)) + 0.5, M.t + plotH);
      ctx.stroke();
    }
    const drag = dragRef.current;
    if (drag) {
      ctx.strokeStyle = pal.selLine;
      ctx.strokeRect(Math.min(x(drag.a), x(drag.b)), M.t, Math.max(2, Math.abs(x(drag.b) - x(drag.a))), plotH);
    }
  }, [plddt, smooth, size.w, size.h, length, model, selection, hover, theme]);

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
    await downloadCanvasPng([canvasRef.current], `ORF1_${model?.id ?? 'model'}_pLDDT.png`, canvasPalette().bg);
  };

  return (
    <section className="px-4 py-3">
      <header className="mb-2 flex items-center gap-3">
        <h2 className="text-[13px] font-semibold">pLDDT along the sequence</h2>
        <span className="ml-auto flex items-center gap-2">
          <Toggle checked={showSmooth} onChange={setShowSmooth} label="15-residue average" />
          <IconBtn icon="download" label="Save the plot as PNG" onClick={() => void exportPng()} />
        </span>
      </header>
      <div ref={hostRef} className="relative h-[200px] select-none">
        {status === 'loading' && (
          <div className="absolute inset-0 grid place-items-center text-muted">
            <span className="flex items-center gap-2">
              <Spinner size={14} /> Loading pLDDT…
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
            setSelection({ ranges: [{ s, e }], label: `Residues ${s}–${e}`, source: 'plddt' });
          }}
          onPointerLeave={() => setHover([])}
        />
      </div>
    </section>
  );
}

// --------------------------------------------------------------- domain table
export function DomainTable() {
  const model = useStore((s) => s.model);
  const plddt = useStore((s) => s.plddt);
  const setSelection = useStore((s) => s.setSelection);
  const setHover = useStore((s) => s.setHover);
  const selection = useStore((s) => s.selection);
  if (!model) return null;
  if (!model.domains.length)
    return <p className="text-muted">This entry has no domain annotation in the curated table.</p>;

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
    <table className="w-full border-collapse whitespace-nowrap text-[12.5px]">
      <thead className="text-left text-[12px] text-muted">
        <tr>
          <th className="py-1 pr-2 font-normal">Domain</th>
          <th className="py-1 pr-2 text-right font-normal">Residues</th>
          <th className="py-1 pr-2 text-right font-normal">Length</th>
          <th className="w-[38%] py-1 pr-2 font-normal">Mean pLDDT</th>
          <th className="py-1 text-right font-normal" title="Mean PAE inside the domain’s own block">
            Internal PAE
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const isSel = selection?.ranges.length === 1 && selection.ranges[0].s === r.start && selection.ranges[0].e === r.end;
          return (
            <tr
              key={r.name + r.start}
              onClick={() => setSelection({ ranges: [{ s: r.start, e: r.end }], label: r.name, source: 'domain' })}
              onMouseEnter={() => setHover([r.start, r.end])}
              onMouseLeave={() => setHover([])}
              className={`cursor-pointer border-t border-line ${isSel ? 'bg-[var(--sel-fill)]' : 'hover:bg-[var(--hover)]'}`}
            >
              <td className="py-1.5 pr-2">
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 shrink-0 rounded-[3px]" style={{ background: r.color }} />
                  <span className="truncate font-semibold">{r.name}</span>
                </span>
              </td>
              <td className="py-1.5 pr-2 text-right">
                {r.start}–{r.end}
              </td>
              <td className="py-1.5 pr-2 text-right text-muted">{r.end - r.start + 1}</td>
              <td className="py-1.5 pr-2">
                <span className="flex items-center gap-2">
                  <span className="w-8 text-right">{fmt(r.mean, 0)}</span>
                  <span className="relative h-[6px] flex-1 rounded-full bg-[var(--raised)]">
                    {r.mean != null && (
                      <span
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{ width: `${clamp(r.mean, 0, 100)}%`, background: plddtHex(r.mean) }}
                      />
                    )}
                  </span>
                </span>
              </td>
              <td className="py-1.5 text-right">{r.meanPae == null ? '—' : `${fmt(r.meanPae, 1)} Å`}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------- domain × domain PAE grid
function useDomainMatrix() {
  const pae = useStore((s) => s.pae);
  const lut = useStore((s) => s.lut);
  const model = useStore((s) => s.model);
  return useMemo(() => {
    if (!pae || !lut || !model || pae.id !== model.id) return null;
    const doms = model.domains;
    return doms.map((a) =>
      doms.map((b) => {
        const st = regionStats(pae, lut, { s: a.start, e: a.end }, { s: b.start, e: b.end });
        return Number.isFinite(st.mean) ? st.mean : null;
      })
    );
  }, [pae, lut, model]);
}

function DomainPaeGrid() {
  const model = useStore((s) => s.model);
  const status = useStore((s) => s.status.pae);
  const colormap = useStore((s) => s.paeColormap);
  const scaleMax = useStore((s) => s.paeScaleMax);
  const setSelection = useStore((s) => s.setSelection);
  const setHover = useStore((s) => s.setHover);
  const selection = useStore((s) => s.selection);
  const matrix = useDomainMatrix();

  const table = useMemo(() => (colormap === 'bands' ? bandTable(scaleMax) : colormapTable(colormap)), [colormap, scaleMax]);
  if (!model?.domains.length) return null;
  if (!matrix)
    return (
      <p className="flex items-center gap-2 text-muted">
        {status === 'loading' ? <Spinner size={12} /> : null} Waiting for the PAE matrix…
      </p>
    );

  const colorOf = (v: number) => {
    const ti = Math.round(clamp(v / scaleMax, 0, 1) * 255) * 3;
    const [r, g, b] = [table[ti], table[ti + 1], table[ti + 2]];
    const ink = 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#14191f' : '#ffffff';
    return { bg: `rgb(${r},${g},${b})`, ink };
  };
  const doms = model.domains;

  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-[2px] text-[12px]">
        <thead>
          <tr>
            <th className="pr-1 text-right text-[11.5px] font-normal text-muted">scored ↓ aligned →</th>
            {doms.map((d) => (
              <th key={d.name} className="min-w-[3.25rem] px-1 pb-1 text-center font-semibold">
                <span className="mx-auto mb-1 block h-[3px] w-6 rounded-full" style={{ background: d.color }} />
                {d.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {doms.map((a, i) => (
            <tr key={a.name}>
              <th className="pr-2 text-right font-semibold">
                <span className="inline-flex items-center gap-1.5">
                  {a.name}
                  <span className="inline-block h-3 w-[3px] rounded-full" style={{ background: a.color }} />
                </span>
              </th>
              {doms.map((b, j) => {
                const v = matrix[i][j];
                const c = v == null ? null : colorOf(v);
                const sel =
                  selection?.cross &&
                  selection.cross.a.s === a.start &&
                  selection.cross.a.e === a.end &&
                  selection.cross.b.s === b.start &&
                  selection.cross.b.e === b.end;
                return (
                  <td key={b.name} className="p-0">
                    <button
                      type="button"
                      title={`${a.name} scored against ${b.name}: ${fmt(v, 1)} Å`}
                      onClick={() =>
                        setSelection({
                          ranges: i === j ? [{ s: a.start, e: a.end }] : [{ s: a.start, e: a.end }, { s: b.start, e: b.end }],
                          cross: { a: { s: a.start, e: a.end }, b: { s: b.start, e: b.end } },
                          label: i === j ? a.name : `${a.name} × ${b.name}`,
                          source: i === j ? 'domain' : 'pae',
                        })
                      }
                      onMouseEnter={() => setHover([a.start, b.start])}
                      onMouseLeave={() => setHover([])}
                      className="block h-8 w-full min-w-[3.25rem] rounded-[4px] text-center font-semibold outline-offset-1"
                      style={{
                        background: c?.bg ?? 'var(--raised)',
                        color: c?.ink ?? 'var(--muted)',
                        outline: sel ? '2px solid var(--fg)' : undefined,
                      }}
                    >
                      {fmt(v, 1)}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CopyDomainMatrix() {
  const model = useStore((s) => s.model);
  const matrix = useDomainMatrix();
  const [done, setDone] = useState(false);
  if (!model || !matrix) return null;
  const copy = async () => {
    const doms = model.domains;
    const lines = ['\t' + doms.map((d) => d.name).join('\t')];
    doms.forEach((a, i) => lines.push([a.name, ...matrix[i].map((v) => (v == null ? '' : v.toFixed(2)))].join('\t')));
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setDone(true);
      window.setTimeout(() => setDone(false), 1600);
    } catch {
      console.warn('clipboard unavailable');
    }
  };
  return <IconBtn icon={done ? 'check' : 'copy'} label={done ? 'Copied' : 'Copy as a table (TSV)'} onClick={() => void copy()} />;
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
