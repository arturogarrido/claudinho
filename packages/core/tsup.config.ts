import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  // The static schedule JSON is inlined into the bundle so it ships with the package.
  loader: { '.json': 'json' },
});
