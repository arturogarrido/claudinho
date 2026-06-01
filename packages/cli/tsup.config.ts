import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  // No sourcemaps in the published CLI: they ~4x the tarball and aren't useful
  // to end users (sources are on GitHub under MIT).
  sourcemap: false,
  target: 'node20',
  // Bundle @claudinho/core (and its inlined schedule) into the CLI so the
  // published binary is self-contained.
  noExternal: ['@claudinho/core'],
  banner: { js: '#!/usr/bin/env node' },
});
