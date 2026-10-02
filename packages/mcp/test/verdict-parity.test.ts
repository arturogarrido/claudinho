/**
 * 0.11 PR 2.0b — a verdict in a tool's text is in its `data` too.
 *
 * Off the bundle, `get_next_fixture`, `get_match`, `get_market_signal` and
 * `get_share_snippet` said "Not available for this competition yet" in their
 * text and returned `data` identical to a World Cup team with no fixture, or
 * to an id that does not exist. A model reads the text; an agent that reads
 * only `structuredContent` could not tell "unsupported" from "empty". The CLI's
 * `--json` has carried `unsupported: true` since 0.10.1; MCP could not without
 * a schema change. This is that change.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { FakeMarketProvider, type Match, type ProviderAdapter } from '@claudinho/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v3';
import { buildServer, OUTPUT_SCHEMAS } from '../src/server';
import {
  toolGetBracket,
  toolGetMarketSignal,
  toolGetMatch,
  toolGetNextFixture,
  toolGetShareSnippet,
  type ToolResult,
} from '../src/tools';

const NOW = new Date('2026-09-15T00:00:00Z');
const NOTICE = 'Not available for this competition yet.';

function adapter(competition: string): ProviderAdapter {
  return {
    name: 'espn',
    competition,
    capabilities: { push: false, latencyHintSec: 0 },
    async fetchByDate(): Promise<Match[]> {
      return [];
    },
    async fetchLive(): Promise<Match[]> {
      return [];
    },
    async fetchWindow(): Promise<Match[]> {
      return [];
    },
  };
}
const common = (competition: string) => ({
  adapter: adapter(competition),
  marketProvider: new FakeMarketProvider(),
  now: NOW,
});

type Case = [label: string, schema: keyof typeof OUTPUT_SCHEMAS, call: (competition: string) => Promise<ToolResult>];
const CASES: Case[] = [
  ['get_next_fixture', 'get_next_fixture', (c) => toolGetNextFixture({ team: 'ARS', ...common(c) })],
  ['get_match', 'get_match', (c) => toolGetMatch({ id: '760415', ...common(c) })],
  ['get_market_signal by team', 'get_market_signal', (c) => toolGetMarketSignal({ team: 'ARS', ...common(c) })],
  ['get_market_signal by id', 'get_market_signal', (c) => toolGetMarketSignal({ matchId: '760415', ...common(c) })],
  ['get_share_snippet next', 'get_share_snippet', (c) => toolGetShareSnippet({ team: 'ARS', ...common(c) })],
  ['get_share_snippet match', 'get_share_snippet', (c) => toolGetShareSnippet({ matchId: '760415', ...common(c) })],
  ['get_share_snippet bracket', 'get_share_snippet', (c) => toolGetShareSnippet({ bracket: true, ...common(c) })],
  ['get_bracket', 'get_bracket', (c) => toolGetBracket(common(c))],
];

describe('off the bundle: the "not available" verdict is in the structured output', () => {
  it.each(CASES)('%s says it in text AND in data, and the advertised schema accepts it', async (_label, schema, call) => {
    const r = await call('eng.1');
    expect(r.text).toContain(NOTICE);
    expect((r.data as { unsupported?: unknown }).unsupported).toBe(true);
    // `.strict()`: the schema must DECLARE the key, or structuredContent drops it.
    expect(() => z.object(OUTPUT_SCHEMAS[schema]).strict().parse(r.data)).not.toThrow();
  });
});

describe('on the bundle: no verdict is invented', () => {
  it.each(CASES)('%s carries no `unsupported` key', async (_label, _schema, call) => {
    const r = await call('fifa.world');
    expect(r.text).not.toContain(NOTICE);
    expect('unsupported' in (r.data as object)).toBe(false);
  });
});

describe('the contract says so', () => {
  it('every tool that can answer "not available" declares the marker in its output schema', async () => {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const server = buildServer();
    const client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    try {
      const { tools } = await client.listTools();
      for (const name of ['get_next_fixture', 'get_match', 'get_market_signal', 'get_share_snippet', 'get_bracket']) {
        const schema = tools.find((t) => t.name === name)?.outputSchema as
          | { properties?: Record<string, { type?: string; const?: unknown; description?: string }> }
          | undefined;
        const marker = schema?.properties?.unsupported;
        expect(marker, name).toBeDefined();
        expect(marker?.const, name).toBe(true);
        expect(marker?.description, name).toMatch(/not available for this competition/i);
      }
    } finally {
      await client.close();
    }
  });
});
