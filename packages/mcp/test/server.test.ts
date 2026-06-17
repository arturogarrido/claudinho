import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The MCP Registry server.json carries its own version + npm package pin (the
// registry reads it, not package.json). Both have drifted before — guard against
// silent divergence so a release can't ship a stale registry entry.
const read = (rel: string) =>
  JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as {
    version: string;
    packages?: { registryType: string; identifier: string; version: string }[];
  };

describe('MCP Registry server.json', () => {
  const server = read('../server.json');
  const pkg = read('../package.json');

  it('top-level version matches package.json', () => {
    expect(server.version).toBe(pkg.version);
  });

  it('npm package pin matches package.json', () => {
    const npm = server.packages?.find((p) => p.registryType === 'npm');
    expect(npm?.identifier).toBe('@claudinho/mcp');
    expect(npm?.version).toBe(pkg.version);
  });
});
