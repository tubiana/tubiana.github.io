# ORF1viewer

The published viewer is available at <https://tubiana.github.io/ORF1viewer/>.

Its editable React/Vite source is in [`source/`](source/). To update the app:

```bash
cd ORF1viewer/source
npm ci
npm run dev
npm run build:site
```

`npm run build:site` type-checks and rebuilds the app, then updates only the
generated files in this folder. Model data remains hosted on Hugging Face.
