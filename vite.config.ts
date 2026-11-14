import { voidReact } from '@void/react/plugin';
import { defineConfig } from 'vite';
import { voidPlugin } from 'void';

export default defineConfig({
  plugins: [voidPlugin(), voidReact()],
  // MapLibre's worker (maplibre-gl-worker.mjs) is a separate entry that
  // Vite's dep optimizer doesn't pre-bundle, so in dev the worker URL
  // 404s and the map stays blank. Excluding maplibre-gl makes Vite
  // serve the package raw and resolve the worker itself. (Production
  // build bundles the worker fine either way.)
  optimizeDeps: { exclude: ['maplibre-gl'] },
});
