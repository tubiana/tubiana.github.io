import React from 'react';
import { createRoot } from 'react-dom/client';
import 'molstar/lib/mol-plugin-ui/skin/light.scss';
import './index.css';
import { App } from './App';
import { useStore, ColorMode, ReprKind } from './state/store';
import {
  activeScenePlugin,
  currentStructures,
  molDiagnostics,
  probeStructure,
  registeredThemeNames,
  resetThemeStats,
  setColorMode,
  setRepr,
  themeStatsSnapshot,
} from './mol/scene';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

/**
 * Debug handle. `__orf1.getState()` gives the whole store; `__orf1.mol.*` drives the
 * 3D scene and records what failed there (`__orf1.mol.diagnostics.errors`) — useful
 * when the viewport cannot be exercised (no WebGL in a test environment).
 */
(window as any).__orf1 = {
  getState: () => useStore.getState(),
  version: '1.0.0',
  mol: {
    plugin: () => activeScenePlugin(),
    setColorMode: (m: ColorMode) => {
      const p = activeScenePlugin();
      return p ? setColorMode(p, m) : Promise.reject(new Error('no 3D scene'));
    },
    setRepr: (r: ReprKind) => {
      const p = activeScenePlugin();
      return p ? setRepr(p, r) : Promise.reject(new Error('no 3D scene'));
    },
    themes: () => (activeScenePlugin() ? registeredThemeNames(activeScenePlugin()!) : []),
    components: () => (activeScenePlugin() ? currentStructures(activeScenePlugin()!).length : 0),
    /** residue numbers, B-factors, repr cells + theme call counters */
    probe: () => (activeScenePlugin() ? probeStructure(activeScenePlugin()!) : null),
    themeStats: () => themeStatsSnapshot(),
    resetThemeStats: () => resetThemeStats(),
    diagnostics: molDiagnostics,
  },
};

createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
