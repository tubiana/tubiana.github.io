/**
 * Light / dark theme. The CSS tokens live in index.css; canvases cannot use CSS
 * variables directly, so they read the resolved values through `canvasPalette()`
 * and redraw when the store's `theme` changes.
 */
import { lsGet, lsSet } from './util';

export type Theme = 'dark' | 'light';

export function initialTheme(): Theme {
  const stored = lsGet('orf1.theme');
  if (stored === 'dark' || stored === 'light') return stored;
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  lsSet('orf1.theme', theme);
}

export interface CanvasPalette {
  bg: string;
  fg: string;
  muted: string;
  faint: string;
  line: string;
  lineStrong: string;
  selFill: string;
  selLine: string;
  hoverLine: string;
  raised: string;
}

const read = (style: CSSStyleDeclaration, name: string) => style.getPropertyValue(name).trim();

/** Current token values, for canvas drawing (call inside the draw effect). */
export function canvasPalette(): CanvasPalette {
  const s = getComputedStyle(document.documentElement);
  return {
    bg: read(s, '--surface'),
    fg: read(s, '--fg'),
    muted: read(s, '--muted'),
    faint: read(s, '--faint'),
    line: read(s, '--line'),
    lineStrong: read(s, '--line-strong'),
    selFill: read(s, '--sel-fill'),
    selLine: read(s, '--sel-line'),
    hoverLine: read(s, '--hover-line'),
    raised: read(s, '--raised'),
  };
}

/** 0xRRGGBB of the viewer background for Mol*. */
export function viewerBackground(theme: Theme): number {
  return theme === 'light' ? 0xffffff : 0x1a2028;
}

export const CANVAS_FONT = "'Atkinson Hyperlegible Next Variable', ui-sans-serif, system-ui, sans-serif";
export const CANVAS_MONO = "'Atkinson Hyperlegible Mono Variable', ui-monospace, Menlo, monospace";
