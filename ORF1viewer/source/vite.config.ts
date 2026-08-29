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
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
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
