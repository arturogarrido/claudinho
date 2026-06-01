import { defineConfig } from 'tsup';

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
});
