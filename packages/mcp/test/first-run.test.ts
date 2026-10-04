/**
 * First run on MCP (0.11 · 2.5b, D1): a tool called with no `competition`,
 * no server environment and no saved choice answers, before any adapter is
 * built and with no request, the verdict `noCompetition` (the sixth replacing
 * verdict, first in order): its text is the one sentence, and its `data` is
 * that tool's empty healthy shape plus `noCompetition: true` and
 * `competition: null`, valid against ITS strict schema, through the server.
 * `standings://` answers the sentence; `list_competitions` `current: null`;
 * `get_team` answers. The saved choice is the third source, read at the edge
 * through core's reader, and `get_next_fixture` takes the saved pin when its
 * `team` is omitted (a tool error naming the pin's absence when there is
 * none). No "World Cup by default" sentence is left in the instructions.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { attachFetchMeta, type Match, type ProviderAdapter } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v3';
import { buildServer, INSTRUCTIONS, OUTPUT_SCHEMAS } from '../src/server';
import { keptAdapterCount, toolGetNextFixture, toolGetToday } from '../src/tools';

let tmp: string;
const ENV = ['XDG_CONFIG_HOME', 'CLAUDINHO_COMPETITION', 'CLAUDINHO_TEAM'] as const;
const saved: Record<string, string | undefined> = {};
let fetched = 0;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'claudinho-mcp-first-run-'));
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.XDG_CONFIG_HOME = tmp;
  fetched = 0;
  vi.stubGlobal('fetch', async () => {
    fetched++;
    return new Response('{}', { status: 200 });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(tmp, { recursive: true, force: true });
});

type Rec = Record<string, unknown>;
type CallResult = { isError?: boolean; content: Array<{ type: string; text?: string }>; structuredContent?: Rec };
async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = buildServer();
  await server.connect(serverT);
  const client = new Client({ name: 'first-run', version: '0.0.0' });
  await client.connect(clientT);
  try {
    return await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}
const strict = (tool: keyof typeof OUTPUT_SCHEMAS, data: unknown) => {
  const res = z.object(OUTPUT_SCHEMAS[tool]).strict().safeParse(data);
  if (!res.success) throw new Error(`${tool}: ${JSON.stringify(res.error.issues)}`);
};
const textOf = (r: CallResult) => r.content.map((c) => c.text ?? '').join('\n');

describe('a tool with nothing chosen', () => {
  const calls: Array<[keyof typeof OUTPUT_SCHEMAS, Rec, Rec]> = [
    ['get_today', { date: '2026-10-10' }, { date: '2026-10-10', degraded: false, source: null, count: 0, truncated: false, matches: [] }],
    ['get_live', {}, { degraded: false, source: null, count: 0, truncated: false, matches: [] }],
    ['get_match', { id: '760415' }, { match: null, source: null }],
    ['get_next_fixture', { team: 'Arsenal' }, { team: 'Arsenal', fixture: null, degraded: false, source: null }],
    ['get_standings', {}, { degraded: false, source: null, tables: [] }],
    ['get_bracket', {}, { view: null }],
    ['get_market_signal', { date: '2026-10-10' }, { informationalOnly: true, signal: null }],
    ['get_share_snippet', { live: true }, { kind: 'live' }],
  ];

  it('answers the verdict through the server: the sentence first, the empty healthy shape plus the two keys, schema-valid, no adapter built, no request', async () => {
    const before = keptAdapterCount();
    await withClient(async (client) => {
      for (const [tool, args, shape] of calls) {
        const r = (await client.callTool({ name: tool, arguments: args })) as CallResult;
        expect(r.isError ?? false, tool).toBe(false);
        const text = textOf(r);
        expect(text.split('\n')[0], tool).toMatch(/No competition chosen/);
        expect(text, tool).toMatch(/list_competitions/);
        expect(text, tool).toMatch(/claudinho follow/);
        const data = r.structuredContent as Rec;
        expect(data, tool).toMatchObject({ ...shape, noCompetition: true, competition: null });
        if (tool === 'get_share_snippet') expect(data.snippet, tool).toMatch(/No competition chosen/);
        // Nothing beyond the tool's shape and the two keys.
        const extra = Object.keys(data).filter((k) => !(k in shape) && k !== 'noCompetition' && k !== 'competition' && k !== 'snippet');
        expect(extra, tool).toEqual([]);
        strict(tool, data);
      }
    });
    expect(keptAdapterCount()).toBe(before);
    expect(fetched).toBe(0);
  });

  it('`standings://A` answers the sentence; `list_competitions` current null; `get_team` answers', async () => {
    const before = keptAdapterCount();
    await withClient(async (client) => {
      const res = (await client.readResource({ uri: 'standings://A' })) as { contents: Array<{ text?: string }> };
      expect(res.contents.map((c) => c.text ?? '').join('\n')).toMatch(/No competition chosen/);
      const list = (await client.callTool({ name: 'list_competitions', arguments: {} })) as CallResult;
      expect((list.structuredContent as Rec).current).toBeNull();
      const team = (await client.callTool({ name: 'get_team', arguments: { query: 'Mexico' } })) as CallResult;
      expect(textOf(team)).toContain('MEX');
    });
    expect(keptAdapterCount()).toBe(before);
    expect(fetched).toBe(0);
  });

  it('in the request\'s language, through the handler', async () => {
    const es = await toolGetToday({ date: '2026-10-10', lang: 'es' });
    expect(es.text.split('\n')[0]).toMatch(/Ninguna competición/);
    expect((es.data as Rec).noCompetition).toBe(true);
    const fr = await toolGetToday({ date: '2026-10-10', lang: 'fr' });
    expect(fr.text.split('\n')[0]).toMatch(/Aucune compétition/);
  });

  it('the instructions no longer say the World Cup is the default', () => {
    expect(INSTRUCTIONS).not.toMatch(/by default/i);
    expect(INSTRUCTIONS).toMatch(/claudinho follow/);
  });
});

describe('the saved choice and the pin', () => {
  const NOW = new Date('2026-10-10T15:00:00Z');
  const fixture: Match = {
    id: '800000001',
    stage: 'REGULAR',
    kickoff: '2026-10-11T14:00:00.000Z',
    venue: 'Emirates Stadium',
    home: { code: 'AFC', name: 'Arsenal FC', id: 'espn:359' },
    away: { code: 'CHE', name: 'Chelsea', id: 'espn:363' },
    status: 'SCHEDULED',
    updatedAt: NOW.toISOString(),
  };
  const whole = (ms: Match[]) => attachFetchMeta(ms, { complete: true, omitted: 0, seasons: [] });
  const adapter: ProviderAdapter = {
    name: 'espn',
    competition: 'eng.1',
    capabilities: { push: false, latencyHintSec: 0 },
    async fetchByDate() {
      return whole([fixture]);
    },
    async fetchLive() {
      return [];
    },
    async fetchWindow() {
      return whole([fixture]);
    },
  };
  const follow = (competition: string, team?: Rec) => {
    mkdirSync(join(tmp, 'claudinho'), { recursive: true });
    writeFileSync(join(tmp, 'claudinho', 'config.json'), JSON.stringify({ version: 1, competition, ...(team ? { team } : {}) }));
  };

  it('the saved choice is the third source: `chosenBy: saved`, the name alone in the text', async () => {
    follow('premier-league');
    const r = await toolGetToday({ date: '2026-10-10', adapter, now: NOW });
    expect(r.text.split('\n')[0]).toBe('Premier League');
    expect((r.data as Rec).competition).toEqual({ slug: 'eng.1', alias: 'premier-league', name: 'Premier League', chosenBy: 'saved' });
  });

  it('`get_next_fixture` with no `team` takes the saved pin as a resolved team (by id, no roster read); with none, a tool error naming the pin\'s absence', async () => {
    follow('premier-league', { id: 'espn:359', code: 'ARS', name: 'Arsenal' });
    const r = await toolGetNextFixture({ adapter, now: NOW });
    expect((r.data as Rec).fixture).toMatchObject({ id: '800000001' });
    expect((r.data as Rec).team).toMatchObject({ id: 'espn:359' });
    follow('premier-league');
    await expect(toolGetNextFixture({ adapter, now: NOW })).rejects.toThrow(/team|pin/i);
    await expect(toolGetNextFixture({ adapter, now: NOW })).rejects.toThrow(/claudinho follow/);
    // Under a request's own competition the pin does not apply: the argument is required.
    follow('premier-league', { id: 'espn:359', code: 'ARS', name: 'Arsenal' });
    await expect(toolGetNextFixture({ competition: 'laliga', adapter: { ...adapter, competition: 'esp.1' }, now: NOW })).rejects.toThrow(/team|pin/i);
  });

  it('the contract: `team` is optional on get_next_fixture; `noCompetition` declared on every competition-answering output schema', async () => {
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      const next = tools.find((t) => t.name === 'get_next_fixture');
      const required = ((next?.inputSchema as { required?: string[] } | undefined)?.required ?? []) as string[];
      expect(required).not.toContain('team');
      for (const t of tools) {
        if (t.name === 'get_team' || t.name === 'list_competitions') continue;
        expect(JSON.stringify(t.outputSchema ?? {}), t.name).toContain('"noCompetition"');
      }
    });
  });
});
