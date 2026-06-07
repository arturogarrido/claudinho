import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

// Single source of truth for the version: read from this package's package.json
// and inlined into the bundle via `define` below (so src needn't re-declare it).
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

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
  define: { 'process.env.CLAUDINHO_VERSION': JSON.stringify(version) },
});
