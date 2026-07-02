import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

// Single source of truth for the version: read from this package's package.json
// and inlined via `define` (the ESPN User-Agent is versioned per release).
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  // No sourcemap in the published package (smaller tarball; sources on GitHub).
  sourcemap: false,
  target: 'node20',
  // The static schedule JSON is inlined into the bundle so it ships with the package.
  loader: { '.json': 'json' },
  define: { 'process.env.CLAUDINHO_VERSION': JSON.stringify(version) },
});
