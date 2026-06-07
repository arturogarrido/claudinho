import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The .mcpb desktop-extension manifest carries its own version field (the
// `mcpb` packer reads it, not package.json). It has drifted before — guard
// against silent divergence so a release can't ship a stale extension version.
const read = (rel: string) =>
  JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as { version: string };

describe('mcpb manifest', () => {
  it('version matches package.json', () => {
    const pkg = read('../package.json');
    const manifest = read('../mcpb/manifest.json');
    expect(manifest.version).toBe(pkg.version);
  });
});
