import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Static build for GitHub Pages (also fine on any plain static host).
 * `base: './'` keeps every asset URL relative, so the app works on
 * https://user.github.io/repo/ and on a custom domain without reconfiguration.
 * The 780 MB payload in public/data is copied verbatim by Vite — see README for
 * how to keep it out of git and serve it from another host instead.
 */
/**
 * Asset file names. Vite appends a content hash (`index-DRRQNJz5.js`) by default, and that
 * is the production default for a reason: a returning visitor's cached bundle is invalidated
 * exactly when its bytes change, so the HTML and the scripts of a page can never come from
 * two different builds (the classic "half-updated SPA" bug), and assets can be served with a
 * long `max-age`. `index.html` is rewritten by the build, so no name is ever maintained by
 * hand, and `scripts/sync-site.mjs` clears the previous copy, so a rebuild is simply
 * `npm run build:site && git add -A ..` — the renames come along by themselves.
 *
 * Set `STABLE_ASSET_NAMES=1` to emit plain names (`assets/index.js`) instead: fewer new
 * filenames per build, at the cost of visitors potentially keeping a cached bundle (and of
 * two builds never being distinguishable in a cache or a CDN).
 */
const stableAssetNames = !!process.env.STABLE_ASSET_NAMES;

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  // workers are emitted by their own bundle, so the name scheme has to be repeated there
  worker: {
    format: 'es',
    rollupOptions: {
      output: stableAssetNames
        ? {
            entryFileNames: 'assets/[name].js',
            chunkFileNames: 'assets/[name].js',
            assetFileNames: 'assets/[name][extname]',
          }
        : {},
    },
  },
  resolve: { dedupe: ['molstar', 'react', 'react-dom'] },
  build: {
    target: 'es2022',
    reportCompressedSize: false,
    chunkSizeWarningLimit: 6000,
    assetsInlineLimit: 3072,
    rollupOptions: {
      output: {
        // keep the ~2 MB Mol* bundle separate so app edits don't re-download it
        manualChunks: (id: string) => {
          if (id.includes('molstar')) return 'molstar';
          if (id.includes('react-dom') || id.includes('/react/')) return 'react';
          return undefined;
        },
        ...(stableAssetNames
          ? {
              entryFileNames: 'assets/[name].js',
              chunkFileNames: 'assets/[name].js',
              assetFileNames: 'assets/[name][extname]',
            }
          : {}),
      },
    },
  },
  server: {
    port: 5173,
    headers: {
      // the payload is immutable per build; keep dev close to production
      'Cache-Control': 'no-cache',
    },
  },
  preview: { port: 4173 },
});
