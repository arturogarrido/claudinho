import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  sourcemap: true,
  target: 'node20',
  // Bundle @claudinho/core (and its inlined schedule) into the CLI so the
  // published binary is self-contained.
  noExternal: ['@claudinho/core'],
  banner: { js: '#!/usr/bin/env node' },
});
