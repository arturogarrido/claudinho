/**
 * The selection on MCP, where the acceptance tests do not reach (0.11 · 2.5a):
 * a refused value through the server is a tool error naming the aliases, with
 * no request; the argument beats the server's environment; an injected
 * adapter serves the reads while the ARGUMENT is what the text and the data
 * say the answer is for; the mode line in the reader's language; the server's
 * adapter is the selection's (an alias resolved), reused per competition;
 * `list_competitions` refuses what every tool refuses; the error branches of a
 * competition-answering tool carry the key too; the standings resource goes
 * through the same edge.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Match, ProviderAdapter } from '@claudinho/core';
import { FakeMarketProvider } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildServer, INSTRUCTIONS } from '../src/server';
import {
  resolveAdapter,
  toolGetBracket,
  toolGetLive,
  toolGetShareSnippet,
  toolListCompetitions,
} from '../src/tools';

const NOW = new Date('2026-10-04T12:00:00Z');
const fixture: Match = {
  id: '800000001',
  stage: 'REGULAR',
  kickoff: '2026-10-04T14:00:00.000Z',
  venue: 'Emirates Stadium',
  home: { code: 'ARS', name: 'Arsenal', id: 'espn:359' },
  away: { code: 'CHE', name: 'Chelsea', id: 'espn:363' },
  status: 'SCHEDULED',
  updatedAt: NOW.toISOString(),
};
const adapterFor = (competition: string): ProviderAdapter => ({
  name: 'espn',
  competition,
  capabilities: { push: false, latencyHintSec: 0 },
  async fetchByDate() {
    return [fixture];
  },
  async fetchLive() {
    return [];
  },
  async fetchWindow() {
    return [fixture];
  },
});
const ORIG = process.env.CLAUDINHO_COMPETITION;
beforeEach(() => {
  delete process.env.CLAUDINHO_COMPETITION;
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIG === undefined) delete process.env.CLAUDINHO_COMPETITION;
  else process.env.CLAUDINHO_COMPETITION = ORIG;
});
type Rec = Record<string, unknown>;

describe('through the server', () => {
  it('a refused value is a tool error naming the value and the aliases, and nothing is fetched', async () => {
    let fetched = 0;
    vi.stubGlobal('fetch', async () => {
      fetched++;
      return new Response('{}', { status: 200 });
    });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const server = buildServer();
    await server.connect(serverT);
    const client = new Client({ name: 'selection-edges', version: '0.0.0' });
    await client.connect(clientT);
    try {
      for (const name of ['get_live', 'get_today', 'get_standings', 'list_competitions']) {
        const r = (await client.callTool({ name, arguments: { competition: 'foo' } })) as { isError?: boolean; content: Array<{ text?: string }> };
        expect(r.isError, name).toBe(true);
        const said = r.content.map((c) => c.text ?? '').join('\n');
        expect(said, name).toContain('foo');
        expect(said, name).toContain('premier-league');
      }
      expect(fetched).toBe(0);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('list_competitions answers offline, with the request\'s selection as current', async () => {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const server = buildServer();
    await server.connect(serverT);
    const client = new Client({ name: 'selection-edges', version: '0.0.0' });
    await client.connect(clientT);
    try {
      const r = (await client.callTool({ name: 'list_competitions', arguments: { competition: 'laliga' } })) as { isError?: boolean; structuredContent?: Rec };
      expect(r.isError).toBeFalsy();
      expect(r.structuredContent?.current).toEqual({ slug: 'esp.1', alias: 'laliga', name: 'LALIGA', chosenBy: 'flag' });
      expect(r.structuredContent?.competitions).toHaveLength(15);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe('the prompts', () => {
  it('tournament_today is listed as the selected competition\'s, not the 2026 tournament\'s', async () => {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const server = buildServer();
    await server.connect(serverT);
    const client = new Client({ name: 'selection-edges', version: '0.0.0' });
    await client.connect(clientT);
    try {
      const { prompts } = await client.listPrompts();
      const today = prompts.find((p) => p.name === 'tournament_today');
      expect(today?.title).toBe("Today's matches");
      expect(today?.description).toMatch(/selected competition/);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe('the server instructions', () => {
  it('name list_competitions and the competition argument', () => {
    expect(INSTRUCTIONS).toContain('list_competitions');
    expect(INSTRUCTIONS).toMatch(/competition argument/);
    expect(INSTRUCTIONS).toMatch(/premier-league/);
  });
});

describe('the request decides', () => {
  it('the argument beats the server\'s environment', async () => {
    process.env.CLAUDINHO_COMPETITION = 'laliga';
    const r = await toolGetLive({ competition: 'premier-league', adapter: adapterFor('eng.1'), now: NOW });
    expect(r.text.split('\n')[0]).toBe('Premier League · from the request');
    expect((r.data as Rec).competition).toMatchObject({ slug: 'eng.1', chosenBy: 'flag' });
  });

  it('a card is said for the request\'s competition: its key, its title and its cue (the adapter serves the same one)', async () => {
    const r = await toolGetShareSnippet({ live: true, competition: 'serie-a', adapter: adapterFor('ita.1'), marketProvider: new FakeMarketProvider(), now: NOW });
    expect((r.data as Rec).competition).toMatchObject({ slug: 'ita.1', alias: 'serie-a' });
    expect(r.text.split('\n')[0]).toBe('Live match pulse · Serie A');
    expect(r.text).toContain('npx @claudinho/cli --competition serie-a live');
  });

  it('the mode line speaks the reader\'s language', async () => {
    const r = await toolGetLive({ competition: 'premier-league', lang: 'es', adapter: adapterFor('eng.1'), now: NOW });
    expect(r.text.split('\n')[0]).toBe('Premier League · desde la solicitud');
  });

  it('the server\'s adapter is the selection\'s: an alias resolved to its slug, one adapter per competition', () => {
    process.env.CLAUDINHO_COMPETITION = 'premier-league';
    const a = resolveAdapter({});
    expect(a.competition).toBe('eng.1');
    expect(resolveAdapter({})).toBe(a);
    expect(resolveAdapter({ competition: 'eng.1' })).toBe(a);
    expect(resolveAdapter({ competition: 'laliga' }).competition).toBe('esp.1');
  });

  it('a refused value builds no adapter, the injected one included', () => {
    expect(() => resolveAdapter({ competition: 'foo' })).toThrow(/premier-league/);
    expect(() => resolveAdapter({ competition: 'foo', adapter: adapterFor('eng.1') })).toThrow(/foo/);
    expect(() => toolListCompetitions({ competition: 'ENG.1' })).toThrow(/premier-league/);
  });
});

describe('every branch of a competition-answering tool carries the key', () => {
  it('a bracket stage that is no stage', async () => {
    const r = await toolGetBracket({ stage: 'X', competition: 'world-cup', adapter: adapterFor('fifa.world') });
    expect(r.text.split('\n')[0]).toBe('World Cup · from the request');
    expect((r.data as Rec).competition).toMatchObject({ slug: 'fifa.world' });
    const s = await toolGetShareSnippet({ bracket: true, knockoutStage: 'X', competition: 'world-cup', adapter: adapterFor('fifa.world') });
    expect((s.data as Rec).competition).toMatchObject({ slug: 'fifa.world' });
  });
});

describe('the standings resource goes through the same edge', () => {
  it('under a refused server environment, no adapter and no request', async () => {
    let fetched = 0;
    vi.stubGlobal('fetch', async () => {
      fetched++;
      return new Response('{}', { status: 200 });
    });
    process.env.CLAUDINHO_COMPETITION = 'foo';
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const server = buildServer();
    await server.connect(serverT);
    const client = new Client({ name: 'selection-edges', version: '0.0.0' });
    await client.connect(clientT);
    try {
      await expect(client.readResource({ uri: 'standings://A' })).rejects.toThrow(/premier-league/);
      expect(fetched).toBe(0);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
