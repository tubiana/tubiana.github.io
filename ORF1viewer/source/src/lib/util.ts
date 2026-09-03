/** Small shared helpers: gzip, fetch, formatting, caches. */

export const GZIP_MAGIC = [0x1f, 0x8b];

export function isGzipped(buf: ArrayBuffer | Uint8Array): boolean {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return b.length > 2 && b[0] === GZIP_MAGIC[0] && b[1] === GZIP_MAGIC[1];
}

/** Inflate gzip using the streaming API (Chrome 80+, Firefox 113+, Safari 16.4+). */
export async function gunzip(buf: ArrayBuffer): Promise<Uint8Array> {
  const anyGlobal = globalThis as any;
  if (typeof anyGlobal.DecompressionStream !== 'function') {
    // Fallback: no gzip support in this browser.  Data can also be served
    // uncompressed (uncompressed artifacts).
    throw new Error(
      'This browser lacks DecompressionStream (gzip). Use Chrome ≥80, Firefox ≥113 or Safari ≥16.4.'
    );
  }
  const ds = new anyGlobal.DecompressionStream('gzip') as unknown as ReadableStream;
  const stream = new Response(buf).body!.pipeThrough(ds as any);
  const out = await new Response(stream).arrayBuffer();
  return new Uint8Array(out);
}

/** fetch → Uint8Array, transparently inflating *.gz (even when the server does not set Content-Encoding). */
export async function fetchBytes(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  const res = await fetch(url, { signal, cache: 'force-cache' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  const buf = await res.arrayBuffer();
  if (isGzipped(buf)) return gunzip(buf);
  return new Uint8Array(buf);
}

export async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const bytes = await fetchBytes(url, signal);
  // `.gz` artifacts are served raw by most static hosts and transparently
  // decompressed by some (Vite, CDNs with Content-Encoding). Sniff the gzip
  // magic so the caller always gets text, whichever happened.
  if (isGzip(bytes)) {
    try {
      const plain = await gunzipBytes(bytes);
      if (plain.length) return bytesToText(plain);
    } catch (e) {
      console.warn(`could not gunzip ${url}`, e);
    }
  }
  return bytesToText(bytes);
}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** Gunzip in memory (returns the input unchanged when the API is missing). */
export async function gunzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const DS = (globalThis as any).DecompressionStream;
  if (!DS) return bytes;
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DS('gzip'));
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  return out.length ? out : bytes;
}

export function bytesToText(bytes: Uint8Array): string {
  // TextDecoder with stream:false handles the whole buffer; latin1 fallback for odd bytes
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function fmt(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  return v.toFixed(digits);
}

/**
 * `HVR` is a hypervariable stretch, not a domain: it stays coloured/annotated in the
 * strips and the 3D, but it is excluded from any domain *count*.
 */
export const NON_DOMAIN_NAME = /^hvr$/i;
export function countDomains(domains: { name: string }[]): number {
  return domains.filter((d) => !NON_DOMAIN_NAME.test(d.name)).length;
}

export function humanBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`;
  return `${n} B`;
}

/** Bounded LRU (Map keeps insertion order). */
export class Lru<K, V> {
  private map = new Map<K, V>();
  constructor(private max = 4) {}
  get(k: K): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  has(k: K) {
    return this.map.has(k);
  }
  set(k: K, v: V) {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.max) {
      const first = this.map.keys().next().value as K;
      this.map.delete(first);
    }
  }
  delete(k: K) {
    this.map.delete(k);
  }
  values(): IterableIterator<V> {
    return this.map.values();
  }
  clear() {
    this.map.clear();
  }
}

/** Coalesce bursts of calls into one trailing call (rAF-friendly). */
export function rafThrottle<A extends unknown[]>(fn: (...args: A) => void) {
  let pending: A | null = null;
  let raf = 0;
  const flush = () => {
    raf = 0;
    if (pending) {
      const args = pending;
      pending = null;
      fn(...args);
    }
  };
  const wrapped = (...args: A) => {
    pending = args;
    if (!raf) raf = requestAnimationFrame(flush);
  };
  wrapped.cancel = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    pending = null;
  };
  wrapped.flush = () => {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    flush();
  };
  return wrapped as ((...args: A) => void) & { cancel: () => void; flush: () => void };
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms = 200) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: A) => {
    if (t !== undefined) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => t !== undefined && clearTimeout(t);
  return wrapped as ((...args: A) => void) & { cancel: () => void };
}

/**
 * gunzip a Blob in the browser so the downloaded PDB opens directly in
 * PyMOL/Coot/Mol* instead of needing `gunzip` first.
 */
export async function gunzipBlob(blob: Blob): Promise<Blob> {
  const DS = (globalThis as any).DecompressionStream;
  if (!DS) return blob; // unsupported browser: hand over the raw .gz
  try {
    const stream = (blob as any).stream().pipeThrough(new DS('gzip'));
    const out = await new Response(stream).blob();
    return out.size > 0 ? out : blob;
  } catch (e) {
    console.warn('gunzip failed, downloading the compressed file as-is', e);
    return blob;
  }
}

/**
 * Composite one or more canvases (e.g. the PAE matrix + its overlay/axis strips)
 * into a single PNG download.
 */
export async function downloadCanvasPng(
  layers: Array<HTMLCanvasElement | null | undefined>,
  filename: string,
  background = '#0b1017',
  scale = 2
): Promise<boolean> {
  const live = layers.filter((l): l is HTMLCanvasElement => !!l);
  if (!live.length) return false;
  const w = Math.max(...live.map((c) => c.clientWidth || c.width));
  const h = Math.max(...live.map((c) => c.clientHeight || c.height));
  if (!w || !h) return false;
  const out = document.createElement('canvas');
  out.width = Math.round(w * scale);
  out.height = Math.round(h * scale);
  const ctx = out.getContext('2d');
  if (!ctx) return false;
  ctx.scale(scale, scale);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, w, h);
  for (const c of live) ctx.drawImage(c, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((res) => out.toBlob((b) => res(b), 'image/png'));
  if (!blob) return false;
  downloadBlob(blob, filename);
  return true;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function hexToInt(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (r << 16) | (g << 8) | b;
}

// ------------------------------------------------------------------ localStorage
export function lsGet(key: string, fallback: string | null = null): string | null {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function lsSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

export function lsRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
