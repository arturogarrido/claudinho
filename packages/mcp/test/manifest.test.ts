import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';

// The .mcpb desktop-extension manifest carries its own version + tool list (the
// `mcpb` packer reads it, not package.json). Both have drifted before — guard
// against silent divergence so a release can't ship a stale extension.
const read = (rel: string) =>
  JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as {
    version: string;
    tools?: { name: string }[];
  };

describe('mcpb manifest', () => {
  const manifest = read('../mcpb/manifest.json');

  it('version matches package.json', () => {
    const pkg = read('../package.json');
    expect(manifest.version).toBe(pkg.version);
  });

  it('lists exactly the tools the server exposes', async () => {
    // Drive the real MCP protocol so the manifest is checked against what
    // clients actually discover — robust to refactors, no SDK internals poked.
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const server = buildServer();
    await server.connect(serverT);
    const client = new Client({ name: 'manifest-test', version: '0.0.0' });
    await client.connect(clientT);
    try {
      const { tools } = await client.listTools();
      const exposed = tools.map((t) => t.name).sort();
      const listed = (manifest.tools ?? []).map((t) => t.name).sort();
      expect(listed).toEqual(exposed);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
