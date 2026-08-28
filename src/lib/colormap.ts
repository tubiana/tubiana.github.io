/** Colour maps + the AlphaFold pLDDT bands. 256-entry byte tables, allocation-free at render time. */
import { hexToRgb } from './util';

export type Stop = [number, string]; // position 0..1, hex colour

export interface NamedMap {
  name: string;
  label: string;
  stops: Stop[];
  lightBg: boolean; // recommended plot background
}

export const PAE_COLORMAPS: NamedMap[] = [
  {
    // Matches the project's own `accentuated_PAE.png` figures: blue (reliable) → violet → red (unreliable).
    name: 'accent',
    label: 'Accentuated (blue→red)',
    lightBg: false,
    stops: [
      [0.0, '#1014ff'],
      [0.3, '#3f7bff'],
      [0.5, '#8f5cf0'],
      [0.68, '#e0489c'],
      [0.85, '#ff5a3c'],
      [1.0, '#ff2412'],
    ],
  },
  {
    // Sequential, colour-blind friendly.
    name: 'viridis',
    label: 'Viridis',
    lightBg: false,
    stops: [
      [0.0, '#440154'],
      [0.25, '#3b528b'],
      [0.5, '#21918c'],
      [0.75, '#5ec962'],
      [1.0, '#fde725'],
    ],
  },
  {
    name: 'turbo',
    label: 'Turbo',
    lightBg: false,
    stops: [
      [0.0, '#30123b'],
      [0.2, '#3b9ff8'],
      [0.4, '#35e87a'],
      [0.6, '#f8c93e'],
      [0.8, '#f26a1f'],
      [1.0, '#7a0200'],
    ],
  },
  {
    name: 'grey',
    label: 'Greyscale (dark = reliable)',
    lightBg: true,
    stops: [
      [0.0, '#0b0e14'],
      [0.5, '#7c8698'],
      [1.0, '#f6f8fb'],
    ],
  },
];

export const PAE_BAND_THRESHOLDS = [5, 12, 20]; // Å — AlphaFold's conventional cut-offs
export const PAE_BAND_COLORS = ['#1e63d0', '#2ec9c0', '#f5c518', '#ff5b3a', '#b3271a'];

export function buildTable(stops: Stop[], out?: Uint8Array): Uint8Array {
  const table = out ?? new Uint8Array(256 * 3);
  const s = stops.slice().sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < s.length - 2 && t > s[k + 1][0]) k++;
    const [t0, c0] = s[k];
    const [t1, c1] = s[k + 1];
    const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
    const a = hexToRgb(c0);
    const b = hexToRgb(c1);
    table[i * 3] = Math.round(a[0] + (b[0] - a[0]) * f);
    table[i * 3 + 1] = Math.round(a[1] + (b[1] - a[1]) * f);
    table[i * 3 + 2] = Math.round(a[2] + (b[2] - a[2]) * f);
  }
  return table;
}

const tableCache = new Map<string, Uint8Array>();
export function colormapTable(name: string): Uint8Array {
  const hit = tableCache.get(name);
  if (hit) return hit;
  const map = PAE_COLORMAPS.find((m) => m.name === name) ?? PAE_COLORMAPS[0];
  const t = buildTable(map.stops);
  tableCache.set(name, t);
  return t;
}

/** table of 256 rgb entries for the discrete 5/12/20 Å banding */
export function bandTable(scaleMax: number, thresholds = PAE_BAND_THRESHOLDS, colors = PAE_BAND_COLORS): Uint8Array {
  const table = new Uint8Array(256 * 3);
  const cuts = thresholds.filter((t) => t > 0 && t < scaleMax);
  const palette = colors.slice(0, cuts.length + 1);
  for (let i = 0; i < 256; i++) {
    const v = (i / 255) * scaleMax;
    let bi = 0;
    while (bi < cuts.length && v >= cuts[bi]) bi++;
    const rgb = hexToRgb(palette[Math.min(bi, palette.length - 1)]);
    table[i * 3] = rgb[0];
    table[i * 3 + 1] = rgb[1];
    table[i * 3 + 2] = rgb[2];
  }
  return table;
}

// ---------------------------------------------------------------- pLDDT
/** AlphaFold confidence bands. */
export const PLDDT_BANDS = [
  { min: 90, label: 'Very high (90–100)', color: '#1e5da6', hex: '#1e5da6' },
  { min: 70, label: 'Confident (70–90)', color: '#7cc8f5', hex: '#7cc8f5' },
  { min: 50, label: 'Low (50–70)', color: '#facc41', hex: '#facc41' },
  { min: 0, label: 'Very low (<50)', color: '#ff7d45', hex: '#ff7d45' },
];

export function plddtHex(v: number): string {
  for (const b of PLDDT_BANDS) if (v >= b.min) return b.color;
  return '#ff7d45';
}

/** smooth ramp (used for the optional gradient pLDDT colouring) */
const PLDDT_RAMP: Stop[] = [
  [0.0, '#d7191c'],
  [0.35, '#fdae61'],
  [0.5, '#facc41'],
  [0.7, '#8fd0f7'],
  [0.9, '#2b6cb0'],
  [1.0, '#08306b'],
];
let plddtTable: Uint8Array | null = null;
export function plddtTableBytes(): Uint8Array {
  if (!plddtTable) plddtTable = buildTable(PLDDT_RAMP);
  return plddtTable;
}
