/**
 * Interactive 2D predicted-aligned-error matrix.
 *
 * Canvas renderer (no charting library): the decoded matrix is blitted from a
 * lossless source bitmap, an overlay canvas draws the crosshair / rubber band /
 * selection, and every interaction maps back to residue indices that are pushed
 * to the store — which drives the Mol* highlight and camera.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { Btn, Select, Spinner, Toggle } from './ui';
import { PAE_COLORMAPS, bandTable, colormapTable } from '../lib/colormap';
import { Range, regionStats } from '../lib/pae';
import { clamp, downloadCanvasPng, fmt, rafThrottle } from '../lib/util';

const MARGIN = { l: 54, r: 10, t: 10, b: 34 };

function useSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

function plotRect(w: number, h: number) {
  const availW = Math.max(64, w - MARGIN.l - MARGIN.r);
  const availH = Math.max(64, h - MARGIN.t - MARGIN.b);
  const side = Math.min(availW, availH);
  return { x: MARGIN.l, y: MARGIN.t, size: side };
}

export function PaeMatrixTab() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const bitmapRef = useRef<{ id: string; rgba: Uint8ClampedArray; canvas: HTMLCanvasElement } | null>(null);
  const dragRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [dragTick, setDragTick] = useState(0);

  const pae = useStore((s) => s.pae);
  const lut = useStore((s) => s.lut);
  const model = useStore((s) => s.model);
  const status = useStore((s) => s.status.pae);
  const colormap = useStore((s) => s.paeColormap);
  const scaleMax = useStore((s) => s.paeScaleMax);
  const invertY = useStore((s) => s.paeInvertY);
  const symmetry = useStore((s) => s.paeSymmetry);
  const showDomains = useStore((s) => s.paeShowDomains);
  const muteHigh = useStore((s) => s.paeMuteHigh);
  const setPaeView = useStore((s) => s.setPaeView);
  const selection = useStore((s) => s.selection);
  const cursor = useStore((s) => s.cursor);
  const setSelection = useStore((s) => s.setSelection);
  const setCursor = useStore((s) => s.setCursor);
  const setHover = useStore((s) => s.setHover);
  const length = model?.length ?? 0;

  const view = useStore((s) => s.paeWindow);
  const setView = useStore((s) => s.setPaeWindow);
  const resetView = useStore((s) => s.resetPaeWindow);
  const size = useSize(hostRef);

  // The zoom window `view` is normalised (0..1) over the whole matrix, while
  // every interaction speaks residue indices — `geo` converts between the two.
  const geo = useMemo(() => {
    const rect = plotRect(size.w, size.h);
    const n = Math.max(1, pae?.w ?? 1);
    const m = Math.max(1, pae?.h ?? 1);
    const spanX = view.x1 - view.x0 || 1;
    const spanY = view.y1 - view.y0 || 1;
    /** residue index (0-based, may be fractional) → canvas pixel */
    const toPx = (j: number, i: number) => ({
      x: rect.x + ((j / n - view.x0) / spanX) * rect.size,
      y:
        invertY ?
          rect.y + ((i / m - view.y0) / spanY) * rect.size
        : rect.y + rect.size - ((i / m - view.y0) / spanY) * rect.size,
    });
    /** canvas pixel → residue index (0-based, floor) */
    const toIdx = (px: number, py: number) => {
      const fj = view.x0 + ((px - rect.x) / rect.size) * spanX;
      const fi =
        invertY ?
          view.y0 + ((py - rect.y) / rect.size) * spanY
        : view.y0 + ((rect.y + rect.size - py) / rect.size) * spanY;
      return { i: Math.floor(fi * m), j: Math.floor(fj * n) };
    };
    return { rect, toPx, toIdx, n, m };
  }, [size.w, size.h, view, invertY, pae?.w, pae?.h]);

  // ------------------------------------------------------- source bitmap
  /** Cached canvas holding the decoded matrix pixels; refreshed when the RGBA
   *  buffer identity changes (new model, or a re-colour request). */
  const getSource = useCallback((): HTMLCanvasElement | null => {
    if (!pae || !pae.rgba || pae.rgba.length !== pae.w * pae.h * 4) return null;
    const cached = bitmapRef.current;
    if (cached && cached.id === pae.id && cached.rgba === pae.rgba) return cached.canvas;
    let canvas = cached && cached.id === pae.id && cached.canvas.width === pae.w ? cached.canvas : null;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = pae.w;
      canvas.height = pae.h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(pae.rgba) as any, pae.w, pae.h), 0, 0);
    bitmapRef.current = { id: pae.id, rgba: pae.rgba, canvas };
    return canvas;
  }, [pae]);

  // ---------------------------------------------------------- matrix paint
  useEffect(() => {
    const canvas = plotRef.current;
    if (!canvas || !pae) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(size.w * dpr));
    canvas.height = Math.max(1, Math.floor(size.h * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const src = getSource();
    if (!src) return;
    const { rect } = geo;
    const sx = view.x0 * pae.w;
    const sw = (view.x1 - view.x0) * pae.w;
    const sy = view.y0 * pae.h;
    const sh = (view.y1 - view.y0) * pae.h;
    ctx.imageSmoothingEnabled = sw > rect.size || sh > rect.size;
    ctx.imageSmoothingQuality = 'high';

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.size, rect.size);
    ctx.clip();
    // `geo` already maps residue 1 → top when invertY is set (row 1 on top), and
    // the bitmap's row 0 *is* residue 1 — so flip the bitmap only in the other
    // case. Flipping in both places mirrored the picture against the axis strips.
    if (!invertY) {
      ctx.translate(0, 2 * rect.y + rect.size);
      ctx.scale(1, -1);
    }
    ctx.drawImage(src, sx, sy, sw, sh, rect.x, rect.y, rect.size, rect.size);
    ctx.restore();

    // symmetry mode: erase one half of the (asymmetric) matrix. the diagonal is
    // an affine line in screen space, so build the polygon in index space.
    if (symmetry !== 'full') {
      const tri: [number, number][] =
        symmetry === 'upper' ? [[0, 0], [1, 0], [1, 1]] : [[0, 0], [0, 1], [1, 1]]; // [i, j]
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      tri.forEach(([ti, tj], k) => {
        const p = geo.toPx(tj, ti);
        if (k === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }, [pae, size.w, size.h, geo, view, invertY, symmetry, getSource, colormap, scaleMax]);

  // ---------------------------------------------------------- overlay paint
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(size.w * dpr));
    canvas.height = Math.max(1, Math.floor(size.h * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const { rect, toPx } = geo;
    const w = size.w;
    const h = size.h;

    // frame
    ctx.strokeStyle = 'rgba(148,163,184,.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.x - .5, rect.y - .5, rect.size + 1, rect.size + 1);

    // domain strips along top and left
    if (showDomains && model) {
      const strip = 6;
      for (const d of model.domains) {
        const xs = toPx(d.start - 1, 0);
        const xe = toPx(d.end, 0);
        const ys = toPx(0, d.start - 1);
        const ye = toPx(0, d.end);
        // top strip
        ctx.fillStyle = d.color;
        const tx = Math.min(xs.x, xe.x);
        const tw = Math.abs(xe.x - xs.x);
        if (tw > 0 && xe.x > rect.x - tw && tx < rect.x + rect.size) {
          ctx.fillRect(Math.max(rect.x, tx), rect.y - strip - 2, Math.min(rect.x + rect.size, tx + tw) - Math.max(rect.x, tx), strip);
        }
        // left strip
        const ty = Math.min(ys.y, ye.y);
        const th = Math.abs(ye.y - ys.y);
        if (th > 0 && ye.y > rect.y - th && ty < rect.y + rect.size) {
          ctx.fillRect(rect.x - strip - 2, Math.max(rect.y, ty), strip, Math.min(rect.y + rect.size, ty + th) - Math.max(rect.y, ty));
        }
        // grid lines at borders
        ctx.strokeStyle = 'rgba(226,232,240,.14)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        for (const px of [xs.x, xe.x]) {
          if (px > rect.x && px < rect.x + rect.size) {
            ctx.moveTo(px, rect.y);
            ctx.lineTo(px, rect.y + rect.size);
          }
        }
        for (const py of [ys.y, ye.y]) {
          if (py > rect.y && py < rect.y + rect.size) {
            ctx.moveTo(rect.x, py);
            ctx.lineTo(rect.x + rect.size, py);
          }
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // axis ticks
    ctx.fillStyle = 'rgba(148,163,184,.9)';
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const n = pae?.w ?? 1;
    const span = (view.x1 - view.x0) * n;
    const step = niceStep(span, Math.max(1, Math.floor(rect.size / 62)));
    for (let v = Math.ceil((view.x0 * n) / step) * step; v <= view.x1 * n; v += step) {
      const p = toPx(v, 0);
      if (p.x < rect.x - 1 || p.x > rect.x + rect.size + 1) continue;
      ctx.fillText(String(Math.round(v)), p.x, rect.y + rect.size + 4);
      ctx.strokeStyle = 'rgba(148,163,184,.25)';
      ctx.beginPath();
      ctx.moveTo(p.x, rect.y + rect.size);
      ctx.lineTo(p.x, rect.y + rect.size + 3);
      ctx.stroke();
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const spanY = (view.y1 - view.y0) * (pae?.h ?? 1);
    const stepY = niceStep(spanY, Math.max(1, Math.floor(rect.size / 52)));
    for (let v = Math.ceil((view.y0 * (pae?.h ?? 1)) / stepY) * stepY; v <= view.y1 * (pae?.h ?? 1); v += stepY) {
      const p = toPx(0, v);
      if (p.y < rect.y - 1 || p.y > rect.y + rect.size + 1) continue;
      ctx.fillText(String(Math.round(v)), rect.x - 12, p.y);
      ctx.strokeStyle = 'rgba(148,163,184,.25)';
      ctx.beginPath();
      ctx.moveTo(rect.x - 3, p.y);
      ctx.lineTo(rect.x, p.y);
      ctx.stroke();
    }
    // axis titles
    ctx.fillStyle = 'rgba(100,116,139,.95)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('residue j — frame of reference', rect.x + rect.size / 2, h - 2);
    ctx.save();
    ctx.translate(9, rect.y + rect.size / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('residue i — position', 0, 0);
    ctx.restore();

    // selection rectangles
    if (selection) {
      for (const r of selection.ranges) {
        drawAxisBand(ctx, rect, toPx, r, 'rgba(56,189,248,.4)');
      }
      if (selection.cross) {
        const a = selection.cross.a;
        const b = selection.cross.b;
        const p0 = toPx(b.s - 1, a.s - 1);
        const p1 = toPx(b.e, a.e);
        ctx.strokeStyle = 'rgba(250,204,21,.95)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(
          Math.min(p0.x, p1.x),
          Math.min(p0.y, p1.y),
          Math.max(2, Math.abs(p1.x - p0.x)),
          Math.max(2, Math.abs(p1.y - p0.y))
        );
      }
    }

    // crosshair + hovered cell
    if (cursor) {
      const cx = toPx(cursor.j + 0.5, cursor.i + 0.5);
      ctx.strokeStyle = 'rgba(226,232,240,.55)';
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(rect.x, cx.y);
      ctx.lineTo(rect.x + rect.size, cx.y);
      ctx.moveTo(cx.x, rect.y);
      ctx.lineTo(cx.x, rect.y + rect.size);
      ctx.stroke();
      ctx.setLineDash([]);
      const cw = rect.size / ((view.x1 - view.x0) * (pae?.w ?? 1));
      const chh = rect.size / ((view.y1 - view.y0) * (pae?.h ?? 1));
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(cx.x - cw / 2, cx.y - chh / 2, Math.max(3, cw), Math.max(3, chh));
    }

    // rubber band while dragging
    const drag = dragRef.current;
    if (drag) {
      const x0 = Math.min(drag.x0, drag.x1);
      const y0 = Math.min(drag.y0, drag.y1);
      ctx.strokeStyle = '#38bdf8';
      ctx.fillStyle = 'rgba(56,189,248,.12)';
      ctx.lineWidth = 1;
      ctx.fillRect(x0, y0, drag.x1 - x0, drag.y1 - y0);
      ctx.strokeRect(x0, y0, drag.x1 - x0, drag.y1 - y0);
    }
    void w;
  }, [size.w, size.h, geo, selection, cursor, pae, view, model, showDomains, dragTick]);

  // ------------------------------------------------------------- pointer
  const onMove = useCallback(
    (ev: React.PointerEvent) => {
      if (!pae) return;
      const box = (ev.currentTarget as HTMLElement).getBoundingClientRect();
      const px = ev.clientX - box.left;
      const py = ev.clientY - box.top;
      const { rect, toIdx } = geo;
      if (dragRef.current) {
        dragRef.current.x1 = clamp(px, rect.x, rect.x + rect.size);
        dragRef.current.y1 = clamp(py, rect.y, rect.y + rect.size);
        setDragTick((t) => t + 1);
        return;
      }
      if (px < rect.x || px > rect.x + rect.size || py < rect.y || py > rect.y + rect.size) {
        if (cursor) setCursor(null);
        setHover([]);
        return;
      }
      const { i, j } = toIdx(px, py);
      if (i < 0 || j < 0 || i >= pae.h || j >= pae.w) {
        setCursor(null);
        return;
      }
      hoverThrottle(i, j, pae.w, pae.index, lut ?? new Float32Array([0]), setCursor, setHover);
    },
    [pae, lut, geo, setCursor, setHover, cursor]
  );

  const onDown = useCallback(
    (ev: React.PointerEvent) => {
      if (!pae) return;
      const box = (ev.currentTarget as HTMLElement).getBoundingClientRect();
      const px = clamp(ev.clientX - box.left, geo.rect.x, geo.rect.x + geo.rect.size);
      const py = clamp(ev.clientY - box.top, geo.rect.y, geo.rect.y + geo.rect.size);
      dragRef.current = { x0: px, y0: py, x1: px, y1: py };
      (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
      setDragTick((t) => t + 1);
    },
    [pae, geo]
  );

  const onUp = useCallback(
    (ev: React.PointerEvent) => {
      if (!pae) return;
      const drag = dragRef.current;
      dragRef.current = null;
      (ev.currentTarget as HTMLElement).releasePointerCapture?.(ev.pointerId);
      if (!drag) return;
      const { toIdx } = geo;
      const moved = Math.abs(drag.x1 - drag.x0) + Math.abs(drag.y1 - drag.y0);
      if (moved < 4) {
        const { i, j } = toIdx(drag.x0, drag.y0);
        if (i >= 0 && j >= 0 && i < pae.h && j < pae.w) {
          setSelection({
            ranges: [
              { s: i + 1, e: i + 1 },
              { s: j + 1, e: j + 1 },
            ],
            cross: { a: { s: i + 1, e: i + 1 }, b: { s: j + 1, e: j + 1 } },
            label: `pair ${i + 1} ↔ ${j + 1}`,
            source: 'pair',
          });
        }
        return;
      }
      const a = toIdx(Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1));
      const b = toIdx(Math.max(drag.x0, drag.x1), Math.max(drag.y0, drag.y1));
      const iLo = clamp(Math.min(a.i, b.i) + 1, 1, pae.h);
      const iHi = clamp(Math.max(a.i, b.i) + 1, 1, pae.h);
      const jLo = clamp(Math.min(a.j, b.j) + 1, 1, pae.w);
      const jHi = clamp(Math.max(a.j, b.j) + 1, 1, pae.w);
      setSelection({
        ranges: [
          { s: iLo, e: iHi },
          { s: jLo, e: jHi },
        ],
        cross: { a: { s: iLo, e: iHi }, b: { s: jLo, e: jHi } },
        label: `box rows ${iLo}–${iHi} × cols ${jLo}–${jHi}`,
        source: 'pae',
      });
    },
    [pae, geo, setSelection]
  );

  const zoomToSelection = () => {
    if (!selection || !pae) return;
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of selection.ranges) {
      lo = Math.min(lo, r.s);
      hi = Math.max(hi, r.e);
    }
    if (!Number.isFinite(lo)) return;
    const pad = Math.max(8, (hi - lo) * 0.15);
    const s = clamp(lo - pad, 1, pae.w);
    const e = clamp(hi + pad, 1, pae.w);
    setView({ x0: (s - 1) / pae.w, x1: e / pae.w, y0: (s - 1) / pae.h, y1: e / pae.h });
  };
  // keep the window valid when the chain length changes (model switch)
  useEffect(() => {
    if (view.x1 - view.x0 > 1 || view.x0 < 0 || view.x1 > 1.0001) resetView();
  }, [view, resetView]);

  const exportPng = async () => {
    await downloadCanvasPng([plotRef.current, overlayRef.current], `ORF1_${model?.id ?? 'model'}_PAE.png`);
  };

  const copyDomainMatrix = async () => {
    if (!pae || !lut || !model) return;
    const doms = model.domains;
    const lines = ['\t' + doms.map((d) => d.name).join('\t')];
    for (const a of doms) {
      const row = [a.name];
      for (const b of doms) {
        const st = regionStats(pae, lut, { s: a.start, e: a.end }, { s: b.start, e: b.end });
        row.push(Number.isFinite(st.mean) ? st.mean.toFixed(2) : '');
      }
      lines.push(row.join('\t'));
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
    } catch {
      console.warn('clipboard unavailable');
    }
  };

  // selection stats
  const stats = useMemo(() => {
    if (!pae || !lut || !selection?.cross) return null;
    return regionStats(pae, lut, selection.cross.a, selection.cross.b);
  }, [pae, lut, selection]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-800 px-2 py-1.5">
        <Select
          value={colormap as any}
          options={[
            ...PAE_COLORMAPS.map((m) => ({ value: m.name as any, label: m.label })),
            { value: 'bands' as any, label: 'Bands 5/12/20 Å' },
          ]}
          onChange={(v) => setPaeView({ paeColormap: v as string })}
          title="colour map"
        />
        <label className="flex items-center gap-1 text-[11px] text-slate-400">
          max
          <input
            type="range"
            min={5}
            max={32}
            step={1}
            value={scaleMax}
            onChange={(e) => setPaeView({ paeScaleMax: Number(e.target.value) })}
            className="w-24"
          />
          <span className="tabular w-8 text-slate-300">{scaleMax}Å</span>
        </label>
        <ColorBar mode={colormap} scaleMax={scaleMax} />
        <Toggle
          checked={muteHigh}
          onChange={(v) => setPaeView({ paeMuteHigh: v })}
          label="mute background"
          title="draw cells with PAE above the scale limit flat — the convention of the AlphaFold PAE figures"
        />
        <Select
          value={symmetry}
          options={[
            { value: 'full', label: 'full matrix' },
            { value: 'upper', label: 'upper ▵' },
            { value: 'lower', label: 'lower ▿' },
          ]}
          onChange={(v) => setPaeView({ paeSymmetry: v as any })}
          title="which half to display (the matrix is asymmetric)"
        />
        <Toggle
          checked={invertY}
          onChange={(v) => setPaeView({ paeInvertY: v })}
          label="y↑ top"
          title="row 1 at the top (default, matches the static figures)"
        />
        <Toggle
          checked={showDomains}
          onChange={(v) => setPaeView({ paeShowDomains: v })}
          label="domains"
          title="domain strips + boundary guides"
        />
        <span className="ml-auto flex items-center gap-1">
          <Btn onClick={resetView} title="show the whole matrix">
            ⤢ all
          </Btn>
          <Btn onClick={zoomToSelection} disabled={!selection} title="zoom into the selected residue span">
            ⌕ zoom sel
          </Btn>
          <Btn onClick={() => void copyDomainMatrix()} title="copy the domain × domain mean-PAE table (TSV)">
            ⧉ domain×domain PAE
          </Btn>
          <Btn onClick={() => void exportPng()} title="save this view (matrix + domain strips + guides) as a PNG">
            ◍ PNG
          </Btn>
        </span>
      </div>

      <div ref={hostRef} className="relative min-h-0 flex-1 select-none">
        {status === 'loading' && (
          <div className="absolute inset-0 grid place-items-center text-[12px] text-slate-400">
            <span className="flex items-center gap-2">
              <Spinner size={14} /> decoding the PAE matrix…
            </span>
          </div>
        )}
        {status === 'error' && (
          <div className="absolute inset-0 grid place-items-center px-6 text-center text-[12px] text-rose-300">
            the PAE matrix for this model could not be loaded
          </div>
        )}
        {pae && (
          <>
            <canvas
              ref={plotRef}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
            />
            <canvas
              ref={overlayRef}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'crosshair' }}
              onPointerMove={onMove}
              onPointerDown={onDown}
              onPointerUp={onUp}
              onPointerLeave={() => {
                setCursor(null);
                setHover([]);
              }}
            />
          </>
        )}
      </div>

      <Readout stats={stats} length={length} />
    </div>
  );
}

function ColorBar({ mode, scaleMax }: { mode: string; scaleMax: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const w = 128;
    const h = 9;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const table = mode === 'bands' ? bandTable(scaleMax) : colormapTable(mode);
    for (let x = 0; x < w; x++) {
      const ti = ((x / (w - 1)) * 255) | 0;
      const o = ti * 3;
      ctx.fillStyle = `rgb(${table[o]},${table[o + 1]},${table[o + 2]})`;
      ctx.fillRect(x, 0, 1, h);
    }
  }, [mode, scaleMax]);
  return (
    <span className="flex items-center gap-1" title="colour scale">
      <span className="text-[10px] tabular text-slate-500">0</span>
      <canvas ref={ref} style={{ width: 128, height: 9, borderRadius: 3, border: '1px solid rgba(100,116,139,.4)' }} />
      <span className="text-[10px] tabular text-slate-400">{scaleMax}Å</span>
    </span>
  );
}

// ------------------------------------------------------------ hover plumbing
const hoverThrottle = rafThrottle(
  (
    i: number,
    j: number,
    w: number,
    index: Uint8Array,
    lut: Float32Array,
    setCursor: (c: { i: number; j: number; v: number; vt: number }) => void,
    setHover: (r: number[]) => void
  ) => {
    const v = lut[index[i * w + j]] ?? NaN;
    const vt = lut[index[j * w + i]] ?? NaN;
    setCursor({ i, j, v, vt });
    setHover([i + 1, j + 1]);
  }
);

function Readout({
  stats,
  length,
}: {
  stats: ReturnType<typeof regionStats> | null;
  length: number;
}) {
  const cursor = useStore((s) => s.cursor);
  const selection = useStore((s) => s.selection);
  const lut = useStore((s) => s.lut);
  void lut;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-800 px-2 py-1.5 text-[11px]">
      {cursor ?
        <>
          <span className="chip">
            i <b className="tabular ml-1">{cursor.i + 1}</b>
          </span>
          <span className="chip">
            j <b className="tabular ml-1">{cursor.j + 1}</b>
          </span>
          <span className="chip">
            PAE(i,j) <b className="tabular ml-1">{fmt(cursor.v, 2)} Å</b>
          </span>
          <span className="chip" title="the raw matrix is asymmetric — value for the transposed pair">
            PAE(j,i) <b className="tabular ml-1">{fmt(cursor.vt, 2)} Å</b>
          </span>
        </>
      : <span className="text-slate-500">hover the matrix for residue / PAE readout</span>}
      {selection && (
        <span className="chip" title={selection.label}>
          sel <b className="ml-1">{selection.ranges.map((r) => (r.s === r.e ? r.s : `${r.s}–${r.e}`)).join(' , ')}</b>
        </span>
      )}
      {stats && stats.n > 0 && (
        <>
          <span className="chip">
            mean <b className="tabular ml-1">{fmt(stats.mean, 2)} Å</b>
          </span>
          <span className="chip">
            &lt;5 Å <b className="tabular ml-1">{(stats.fracLt5 * 100).toFixed(1)}%</b>
          </span>
          <span className="chip">
            &lt;12 Å <b className="tabular ml-1">{(stats.fracLt12 * 100).toFixed(1)}%</b>
          </span>
          <span className="chip">
            pairs <b className="tabular ml-1">{stats.n.toLocaleString()}</b>
          </span>
        </>
      )}
      <span className="ml-auto text-slate-600">{length} residues · click a cell = pair, drag = region</span>
    </div>
  );
}

// ------------------------------------------------------------------- helpers
function niceStep(span: number, maxTicks: number): number {
  const target = Math.max(1, maxTicks);
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  const mult = [1, 2, 5, 10];
  for (const m of mult) if (raw <= m * pow) return Math.max(1, m * pow);
  return Math.max(1, 10 * pow);
}

function drawAxisBand(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; size: number },
  toPx: (j: number, i: number) => { x: number; y: number },
  r: Range,
  color: string
) {
  const a = toPx(r.s - 1, 0);
  const b = toPx(r.e, 0);
  const c = toPx(0, r.s - 1);
  const d = toPx(0, r.e);
  ctx.fillStyle = color;
  const x0 = Math.max(rect.x, Math.min(a.x, b.x));
  const x1 = Math.min(rect.x + rect.size, Math.max(a.x, b.x));
  const y0 = Math.max(rect.y, Math.min(c.y, d.y));
  const y1 = Math.min(rect.y + rect.size, Math.max(c.y, d.y));
  if (x1 > x0) ctx.fillRect(x0, rect.y - 1, x1 - x0, 3);
  if (y1 > y0) ctx.fillRect(rect.x - 1, y0, 3, y1 - y0);
}
