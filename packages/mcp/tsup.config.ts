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
  // No sourcemaps in the published server (smaller tarball; sources on GitHub).
  sourcemap: false,
  target: 'node20',
  // Bundle our own core (with the inlined schedule) so the published server is
  // self-contained. Keep the MCP SDK + zod external (normal npm deps).
  noExternal: ['@claudinho/core'],
  external: ['@modelcontextprotocol/sdk', 'zod'],
  banner: { js: '#!/usr/bin/env node' },
  define: { 'process.env.CLAUDINHO_VERSION': JSON.stringify(version) },
});
