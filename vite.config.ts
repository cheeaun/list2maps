import { voidReact } from '@void/react/plugin';
import { defineConfig } from 'vite';
import { voidPlugin } from 'void';

export default defineConfig({
  plugins: [voidPlugin(), voidReact()],
  // MapLibre's worker (maplibre-gl-worker.mjs) is a separate entry that
  // Vite's dep optimizer doesn't pre-bundle, so in dev the worker URL
  // 404s and the map stays blank. Excluding maplibre-gl makes Vite
  // serve the package raw and resolve the worker itself. The production
  // build does NOT bundle the worker either: MapLibre computes its
  // worker URL at runtime, which Vite cannot analyse, so the file was
  // never emitted and the live map failed with "Worker failed to load".
  // The fix is in pages/index.tsx: the worker is imported with `?url`
  // and handed to MapLibre via setWorkerUrl, so Vite emits it as an
  // asset in both dev and production.
  optimizeDeps: { exclude: ['maplibre-gl'] },
});
