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
    tools?: { name: string; description?: string }[];
    privacy_policies?: unknown;
  };

describe('mcpb manifest', () => {
  const manifest = read('../mcpb/manifest.json');

  it('version matches package.json', () => {
    const pkg = read('../package.json');
    expect(manifest.version).toBe(pkg.version);
  });

  it('declares an https privacy policy (required for the Claude Desktop Extensions directory)', () => {
    // The extension makes outbound calls (ESPN/Polymarket), so Anthropic's directory
    // requires a privacy_policies array of HTTPS URLs. Guard it so a manifest edit
    // can't silently drop the field and fail review.
    const policies = manifest.privacy_policies;
    expect(Array.isArray(policies)).toBe(true);
    expect((policies as string[]).length).toBeGreaterThan(0);
    for (const url of policies as string[]) {
      expect(typeof url).toBe('string');
      expect(url).toMatch(/^https:\/\//);
    }
  });

  it('its blurbs do not contradict the tools: an empty live list may be a read that was not whole (0.11 2.1d)', () => {
    // Found in review: the manifest is a second copy of the descriptions, and `get_live`'s said "empty when none
    // are live" after the tool learned to answer an empty list with `partial` ("no match in play was read").
    const blurb = (name: string) => (manifest.tools ?? []).find((t) => t.name === name)?.description ?? '';
    expect(blurb('get_live')).not.toMatch(/none are live|nothing is live/);
    for (const name of ['get_live', 'get_today', 'get_share_snippet']) expect(blurb(name), name).toMatch(/partial/);
    // The "none read" reading of an empty day holds exactly where no bundled schedule was merged: a club
    // competition, or the World Cup slug answering for another edition. On a World Cup rest day whose window was
    // not whole the day is still "none scheduled". A blurb that says "none read" scopes it by the schedule, not by
    // the competition (two reviews: the first rewording claimed it for every empty day, the second said "off the
    // World Cup", which leaves the other-edition case out).
    for (const name of ['get_today', 'get_share_snippet']) {
      if (/none read/.test(blurb(name))) {
        expect(blurb(name), name).toMatch(/bundled schedule/);
        expect(blurb(name), name).not.toMatch(/off the World Cup/);
      }
    }
  });

  it('the server’s get_live description does not read an outage as "nothing in play" (0.11 2.1d)', async () => {
    // Found in review: "an empty list means nothing is in play unless partial says the read was not whole" forgot
    // the failed read (`degraded`, no `partial`).
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const server = buildServer();
    await server.connect(serverT);
    const client = new Client({ name: 'manifest-test', version: '0.0.0' });
    await client.connect(clientT);
    try {
      const { tools } = await client.listTools();
      const live = tools.find((t) => t.name === 'get_live')?.description ?? '';
      expect(live).toMatch(/partial/);
      expect(live).toMatch(/degraded/);
      expect(live).not.toMatch(/nothing is in play unless partial says/);
    } finally {
      await client.close();
      await server.close();
    }
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
