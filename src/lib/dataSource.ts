/**
 * Data source: resolves where the payload lives (same-origin ./data/ by default,
 * any remote host — Zenodo / Hugging Face / S3 — configurable at build time, at
 * runtime through ?dataBaseUrl=… or in the UI), loads the manifest and the
 * per-model artifacts with small LRU caches.
 */
import { Manifest, ModelEntry } from './types';
import { bytesToText, fetchBytes, fetchText, Lru } from './util';
import { decodePaeImage, PaeMatrix } from './pae';

const LS_KEY = 'orf1.dataBaseUrl';

export interface DataEndpoints {
  manifest: string;
  base: string;
}

let resolvedBase: string | null = null;
let resolvedHow = '';

function normalizeBase(u: string): string {
  const s = u.trim();
  if (!s) return s;
  return s.endsWith('/') ? s : `${s}/`;
}

/** Same-origin default: resolve `data/` relative to the document (works on GH Pages sub-paths). */
function defaultBase(): string {
  return new URL('data/', document.baseURI).toString();
}

export async function resolveDataBaseUrl(): Promise<{ base: string; how: string }> {
  if (resolvedBase) return { base: resolvedBase, how: resolvedHow };
  try {
    const q = new URLSearchParams(location.search).get('dataBaseUrl');
    if (q) {
      resolvedBase = normalizeBase(q);
      resolvedHow = '?dataBaseUrl=';
      try {
        localStorage.setItem(LS_KEY, resolvedBase);
      } catch {
        /* ignore */
      }
      return { base: resolvedBase, how: resolvedHow };
    }
  } catch {
    /* ignore */
  }
  const injected = (window as any).__ORF1_DATA_BASE_URL__;
  if (typeof injected === 'string' && injected.trim()) {
    resolvedBase = normalizeBase(injected);
    resolvedHow = 'window.__ORF1_DATA_BASE_URL__';
    return { base: resolvedBase, how: resolvedHow };
  }
  const env = (import.meta as any).env?.VITE_DATA_BASE_URL as string | undefined;
  if (env && env.trim()) {
    resolvedBase = normalizeBase(env);
    resolvedHow = 'VITE_DATA_BASE_URL';
    return { base: resolvedBase, how: resolvedHow };
  }
  // optional pointer file next to the app (written by prepare_data.py --base-url)
  try {
    const txt = await fetchText(new URL('data/base-url.txt', document.baseURI).toString());
    const t = txt.trim();
    if (t && /^https?:/i.test(t)) {
      resolvedBase = normalizeBase(t);
      resolvedHow = 'data/base-url.txt';
      return { base: resolvedBase, how: resolvedHow };
    }
  } catch {
    /* not present — fine */
  }
  resolvedBase = defaultBase();
  resolvedHow = 'same-origin ./data/';
  return { base: resolvedBase, how: resolvedHow };
}

export function setDataBaseUrl(base: string | null) {
  if (base === null || !base.trim()) {
    localStorage.removeItem(LS_KEY);
    resolvedBase = null;
  } else {
    localStorage.setItem(LS_KEY, normalizeBase(base));
    resolvedBase = normalizeBase(base);
    resolvedHow = 'localStorage';
  }
  manifestCache = null;
}

export function loadDataBaseUrlOverride(): string | null {
  try {
    return localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}

async function base(): Promise<string> {
  const stored = loadDataBaseUrlOverride();
  if (stored) {
    resolvedBase = normalizeBase(stored);
    resolvedHow = 'localStorage';
    return resolvedBase;
  }
  const { base: b } = await resolveDataBaseUrl();
  return b;
}

export function currentDataUrl(path: string): string {
  return new URL(path, resolvedBase ?? defaultBase()).toString();
}

// ---------------------------------------------------------------- manifest
let manifestCache: Manifest | null = null;
let manifestPromise: Promise<Manifest> | null = null;

export async function loadManifest(signal?: AbortSignal): Promise<Manifest> {
  if (manifestCache) return manifestCache;
  if (manifestPromise) return manifestPromise;
  manifestPromise = (async () => {
    const b = await base();
    const tryUrls = [`${b}manifest.json.gz`, `${b}manifest.json`];
    let lastErr: unknown;
    for (const url of tryUrls) {
      try {
        const bytes = await fetchBytes(url, signal);
        const text = bytesToText(bytes);
        const m = JSON.parse(text) as Manifest;
        if (!m || !Array.isArray(m.models)) throw new Error(`bad manifest at ${url}`);
        resolvedBase = b;
        manifestCache = m;
        return m;
      } catch (e) {
        lastErr = e;
      }
    }
    throw new Error(
      `Could not load the data manifest.  Tried:\n  ${tryUrls.join('\n  ')}\n` +
        `Reason: ${String(lastErr)}.  Run "python3 scripts/prepare_data.py" or set a data host with ?dataBaseUrl=…`
    );
  })();
  return manifestPromise;
}

export function manifestOrNull(): Manifest | null {
  return manifestCache;
}

export function setManifestCache(m: Manifest | null) {
  manifestCache = m;
  manifestPromise = null;
}

// ------------------------------------------------------------- model caches
const STRUCTURE_CACHE = 3;
const PAE_CACHE = 2; // each decoded matrix is ~3–12 MB

const structureCache = new Lru<string, { text: string; entry: ModelEntry }>(STRUCTURE_CACHE);
const plddtCache = new Lru<string, Uint8Array>(12);
const paeCache = new Lru<string, PaeMatrix>(PAE_CACHE);

export function cachedStructure(id: string) {
  return structureCache.get(id)?.text;
}
export function cachedPlddt(id: string) {
  return plddtCache.get(id);
}
export function cachedPae(id: string) {
  return paeCache.get(id);
}
export function paeCacheInfo() {
  return [...paeCache.values()].map((m) => ({ id: m.id, w: m.w, bytes: m.index.byteLength }));
}

/**
 * PDB text for the 3D view.
 *
 * `which` defaults to **full**: the viewer shows the complete model (side chains
 * included), not the backbone-only reduction — ball-and-stick / licorice would
 * otherwise only ever show the backbone because that is all the file contains.
 * The backbone file stays available for downloads and for `which: 'backbone'`.
 */
export async function loadStructure(
  entry: ModelEntry,
  signal?: AbortSignal,
  which: 'full' | 'backbone' = 'full',
): Promise<string> {
  const key = `${entry.id}::${which}`;
  const hit = structureCache.get(key);
  if (hit) return hit.text;
  const rel = which === 'full' ? entry.pdbFullPath ?? entry.pdbPath : entry.pdbPath;
  const text = await fetchText(currentDataUrl(rel), signal);
  structureCache.set(key, { text, entry });
  return text;
}

export async function loadPlddt(entry: ModelEntry, signal?: AbortSignal): Promise<Uint8Array> {
  const hit = plddtCache.get(entry.id);
  if (hit) return hit;
  const url = currentDataUrl(entry.plddtPath);
  const bytes = await fetchBytes(url, signal);
  const arr = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  plddtCache.set(entry.id, arr);
  return arr;
}

export async function loadPae(entry: ModelEntry, signal?: AbortSignal): Promise<PaeMatrix> {
  const hit = paeCache.get(entry.id);
  if (hit) return hit;
  const url = currentDataUrl(entry.paePath);
  const bytes = await fetchBytes(url, signal);
  const matrix = await decodePaeImage(bytes, entry.paeFormat, entry.id, url);
  paeCache.set(entry.id, matrix);
  return matrix;
}

export async function loadBinaryForDownload(pathOrUrl: string, signal?: AbortSignal): Promise<Blob> {
  const url = /^https?:/i.test(pathOrUrl) ? pathOrUrl : currentDataUrl(pathOrUrl);
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.blob();
}
