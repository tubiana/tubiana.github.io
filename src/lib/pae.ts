/**
 * PAE matrix decoding + colouring.
 *
 * The payload is an 8-bit single-channel lossless image whose pixel value is an
 * index into a quantisation look-up table (Å) baked into the manifest.  Decoding
 * is exact (PNG/WebP lossless), which we double-check against the (i, j, Å)
 * checkpoints stored by prepare_data.py.
 */
import { bandTable, colormapTable } from './colormap';
import { clamp } from './util';

export interface PaeMatrix {
  id: string;
  url: string;
  w: number;
  h: number;
  /** lut index per cell, row-major (h × w) */
  index: Uint8Array;
  /** display buffer (w*h*4), refreshed by colorize() */
  rgba: Uint8ClampedArray;
  /** integrity result vs. the manifest checkpoints */
  checks: { n: number; maxAbsErr: number; ok: boolean };
  format: string;
}

export interface PaeColorOptions {
  lut: Float32Array;
  /** colormap name (PAE_COLORMAPS) or 'bands' */
  mode: string;
  scaleMax: number;
  /** hide the background (values ≥ scaleMax) → transparent-ish flat tone */
  muteHigh: boolean;
}

export async function decodePaeImage(
  bytes: Uint8Array,
  format: string,
  id: string,
  url: string
): Promise<PaeMatrix> {
  const mime =
    format === 'webp' || format === 'x-webp'
      ? 'image/webp'
      : format === 'png'
        ? 'image/png'
        : bytes[0] === 0x89
          ? 'image/png'
          : 'image/webp';
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([copy], { type: mime });
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  } catch {
    bmp = await createImageBitmap(blob);
  }
  const w = bmp.width;
  const h = bmp.height;
  const off = typeof OffscreenCanvas !== 'undefined';
  const canvas: HTMLCanvasElement | OffscreenCanvas = off
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d', {
    willReadFrequently: true,
    alpha: false,
  }) as unknown as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  const img = ctx.getImageData(0, 0, w, h);
  const src = img.data as unknown as Uint8Array;
  const n = w * h;
  const index = new Uint8Array(n);
  // grayscale → r=g=b; take the red channel
  for (let p = 0, q = 0; p < n; p++, q += 4) index[p] = src[q];
  return {
    id,
    url,
    w,
    h,
    index,
    rgba: new Uint8ClampedArray(n * 4),
    checks: { n: 0, maxAbsErr: 0, ok: true },
    format: mime,
  };
}

/** Validate the decoded matrix against the manifest checkpoints. */
export function verifyPae(
  m: PaeMatrix,
  lut: Float32Array,
  points: [number, number, number][],
  decoded: number[]
): PaeMatrix['checks'] {
  let maxErr = 0;
  let n = 0;
  for (let k = 0; k < points.length; k++) {
    const [i, j, original] = points[k];
    if (i >= m.h || j >= m.w) continue;
    const got = lut[m.index[i * m.w + j]];
    const ref = decoded[k] ?? original;
    maxErr = Math.max(maxErr, Math.abs(got - ref));
    n++;
  }
  return { n, maxAbsErr: maxErr, ok: n === 0 || maxErr < 1e-6 };
}

/** Flat tone used for “muted” cells (relative placement undefined, PAE ≥ scaleMax). */
export const PAE_MUTED_RGB: [number, number, number] = [15, 21, 31];

/** Rebuild the RGBA display buffer from the index buffer. */
export function colorize(m: PaeMatrix, o: PaeColorOptions): void {
  const { index, w, h } = m;
  const n = w * h;
  if (m.rgba.length !== n * 4) m.rgba = new Uint8ClampedArray(n * 4);
  const rgba = m.rgba;
  const table = o.mode === 'bands' ? bandTable(o.scaleMax) : colormapTable(o.mode);
  const lut = o.lut;
  // t is normalised to 0..1 over scaleMax; the 255 conversion happens below.
  const inv = o.scaleMax > 0 ? 1 / o.scaleMax : 0;
  for (let p = 0; p < n; p++) {
    const v = lut[index[p]];
    let t = v * inv;
    if (t > 1) t = 1;
    else if (t < 0) t = 0;
    const ti = (t * 255) | 0;
    const o0 = ti * 3;
    const q = p * 4;
    if (o.muteHigh && v >= o.scaleMax) {
      // AlphaFold convention: where the relative placement is undefined the
      // background stays flat, so the confident blocks are what stands out.
      rgba[q] = PAE_MUTED_RGB[0];
      rgba[q + 1] = PAE_MUTED_RGB[1];
      rgba[q + 2] = PAE_MUTED_RGB[2];
      rgba[q + 3] = 255;
      continue;
    }
    rgba[q] = table[o0];
    rgba[q + 1] = table[o0 + 1];
    rgba[q + 2] = table[o0 + 2];
    rgba[q + 3] = 255;
  }
}

export function valueAt(m: PaeMatrix, lut: Float32Array, i: number, j: number): number {
  if (i < 0 || j < 0 || i >= m.h || j >= m.w) return NaN;
  return lut[m.index[i * m.w + j]];
}

export interface Range {
  s: number; // 1-based inclusive
  e: number; // 1-based inclusive
}

export interface RegionStats {
  n: number;
  mean: number;
  min: number;
  max: number;
  fracLt5: number;
  fracLt12: number;
}

/** statistics of PAE[i∈a, j∈b] (0-based conversion happens here) */
export function regionStats(
  m: PaeMatrix,
  lut: Float32Array,
  a: Range,
  b: Range
): RegionStats {
  const i0 = clamp(a.s - 1, 0, m.h - 1);
  const i1 = clamp(a.e - 1, 0, m.h - 1);
  const j0 = clamp(b.s - 1, 0, m.w - 1);
  const j1 = clamp(b.e - 1, 0, m.w - 1);
  let n = 0;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  let lt5 = 0;
  let lt12 = 0;
  for (let i = i0; i <= i1; i++) {
    const row = i * m.w;
    for (let j = j0; j <= j1; j++) {
      const v = lut[m.index[row + j]];
      n++;
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
      if (v < 5) lt5++;
      if (v < 12) lt12++;
    }
  }
  if (!n) return { n: 0, mean: NaN, min: NaN, max: NaN, fracLt5: NaN, fracLt12: NaN };
  return { n, mean: sum / n, min, max, fracLt5: lt5 / n, fracLt12: lt12 / n };
}

/** mean PAE of residue i against a range of reference residues */
export function rowProfile(
  m: PaeMatrix,
  lut: Float32Array,
  i: number,
  range: Range
): number {
  const r = clamp(i - 1, 0, m.h - 1);
  const j0 = clamp(range.s - 1, 0, m.w - 1);
  const j1 = clamp(range.e - 1, 0, m.w - 1);
  let sum = 0;
  let n = 0;
  for (let j = j0; j <= j1; j++) {
    sum += lut[m.index[r * m.w + j]];
    n++;
  }
  return n ? sum / n : NaN;
}

export function meanPlddtRange(plddt: Uint8Array, a: Range): number {
  const s = clamp(a.s - 1, 0, plddt.length - 1);
  const e = clamp(a.e - 1, 0, plddt.length - 1);
  let sum = 0;
  let n = 0;
  for (let i = s; i <= e; i++) {
    sum += plddt[i];
    n++;
  }
  return n ? sum / n : NaN;
}
