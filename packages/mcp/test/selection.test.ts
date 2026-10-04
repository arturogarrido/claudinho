/**
 * The selection on MCP (0.11 · 2.5a): every competition-answering tool takes
 * `competition` (an alias or a slug), its `data` carries the selection and its
 * text names it first; an unknown value is a tool error naming the aliases,
 * never a request; `get_team` takes none (the World Cup's roster, offline);
 * `list_competitions` lists the table with its capabilities and the current
 * selection, offline, and fits a strict schema.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Match, ProviderAdapter } from '@claudinho/core';
import { FakeMarketProvider } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod/v3';
import { buildServer, OUTPUT_SCHEMAS } from '../src/server';
import {
  toolGetBracket,
  toolGetLive,
  toolGetMarketSignal,
  toolGetMatch,
  toolGetNextFixture,
  toolGetShareSnippet,
  toolGetStandings,
  toolGetTeam,
  toolGetToday,
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
  if (ORIG === undefined) delete process.env.CLAUDINHO_COMPETITION;
  else process.env.CLAUDINHO_COMPETITION = ORIG;
});
type Rec = Record<string, unknown>;
const strict = (tool: keyof typeof OUTPUT_SCHEMAS, data: unknown) => {
  const res = z.object(OUTPUT_SCHEMAS[tool]).strict().safeParse(data);
  if (!res.success) throw new Error(`${tool}: ${JSON.stringify(res.error.issues)}`);
};
const PL = { slug: 'eng.1', alias: 'premier-league', name: 'Premier League', chosenBy: 'flag' };

describe('every competition-answering tool takes `competition`, says it first, and carries it in data', () => {
  it('get_today, get_live, get_match, get_next_fixture, get_standings, get_bracket, get_market_signal, get_share_snippet', async () => {
    const a = adapterFor('eng.1');
    const calls: Array<[keyof typeof OUTPUT_SCHEMAS, () => Promise<{ text: string; data: unknown }>]> = [
      ['get_today', () => toolGetToday({ date: '2026-10-04', competition: 'premier-league', adapter: a, now: NOW })],
      ['get_live', () => toolGetLive({ competition: 'premier-league', adapter: a, now: NOW })],
      ['get_match', () => toolGetMatch({ id: '800000001', competition: 'premier-league', adapter: a, now: NOW })],
      ['get_next_fixture', () => toolGetNextFixture({ team: 'Arsenal', competition: 'premier-league', adapter: a, now: NOW })],
      ['get_standings', () => toolGetStandings({ competition: 'premier-league', adapter: a })],
      ['get_bracket', () => toolGetBracket({ competition: 'premier-league', adapter: a })],
      ['get_market_signal', () => toolGetMarketSignal({ date: '2026-10-04', competition: 'premier-league', adapter: a, marketProvider: new FakeMarketProvider(), now: NOW })],
      ['get_share_snippet', () => toolGetShareSnippet({ live: true, competition: 'premier-league', adapter: a, marketProvider: new FakeMarketProvider(), now: NOW })],
    ];
    for (const [tool, call] of calls) {
      const r = await call();
      expect((r.data as Rec).competition, tool).toEqual(PL);
      strict(tool, r.data);
      if (tool === 'get_share_snippet') {
        // The card is the artifact: its title names the competition, no mode line is prepended.
        expect(r.text.split('\n').find((l) => l.trim() !== ''), tool).toContain('Premier League');
        expect(r.text, tool).not.toContain('from the request');
      } else {
        expect(r.text.split('\n')[0], tool).toBe('Premier League · from the request');
      }
    }
  });

  it('the environment, and the default: the source in the text, the key in the data', async () => {
    process.env.CLAUDINHO_COMPETITION = 'laliga';
    const env = await toolGetLive({ adapter: adapterFor('esp.1'), now: NOW });
    expect(env.text.split('\n')[0]).toBe('LALIGA · from the environment');
    expect((env.data as Rec).competition).toEqual({ slug: 'esp.1', alias: 'laliga', name: 'LALIGA', chosenBy: 'env' });
    delete process.env.CLAUDINHO_COMPETITION;
    const def = await toolGetLive({ adapter: adapterFor('fifa.world'), now: NOW });
    expect(def.text.split('\n')[0]).toBe('World Cup');
    expect((def.data as Rec).competition).toEqual({ slug: 'fifa.world', alias: 'world-cup', name: 'World Cup', chosenBy: 'default' });
    const raw = await toolGetLive({ competition: 'fifa.friendly', adapter: adapterFor('fifa.friendly'), now: NOW });
    expect(raw.text.split('\n')[0]).toBe('fifa.friendly · from the request · experimental');
    expect((raw.data as Rec).competition).toEqual({ slug: 'fifa.friendly', name: 'fifa.friendly', chosenBy: 'flag', experimental: true });
  });

  it('an unknown value is a tool error naming the aliases, and no request', async () => {
    let fetched = 0;
    const counting: ProviderAdapter = { ...adapterFor('eng.1'), async fetchByDate() { fetched++; return [fixture]; }, async fetchWindow() { fetched++; return [fixture]; } };
    for (const bad of ['foo', 'ENG.1', 'premier league']) {
      await expect(toolGetToday({ date: '2026-10-04', competition: bad, adapter: counting, now: NOW }), bad).rejects.toThrow(/premier-league/);
    }
    expect(fetched).toBe(0);
  });

  it('get_team takes no competition and names the World Cup roster; it carries no selection', async () => {
    const r = await toolGetTeam({ query: 'Mexico' });
    expect(r.text).toMatch(/World Cup/);
    expect((r.data as Rec).competition).toBeUndefined();
    strict('get_team', r.data);
  });
});

describe('list_competitions', () => {
  it('lists the fifteen with their capabilities and the current selection, offline, within its strict schema', async () => {
    const r = await toolListCompetitions({ competition: 'premier-league' });
    const data = r.data as { competitions: Array<Rec>; current: Rec | null };
    expect(data.competitions).toHaveLength(15);
    expect(data.competitions[0]).toMatchObject({ slug: 'fifa.world', alias: 'world-cup', name: 'World Cup', teams: 'nation', kind: 'cup', capabilities: { scores: 'offered', next: 'offered', standings: 'offered', bracket: 'offered', markets: 'offered' } });
    expect(data.competitions.find((c) => c.slug === 'eng.1')).toMatchObject({ alias: 'premier-league', teams: 'club', kind: 'league', capabilities: { bracket: 'not-applicable', markets: 'not-offered-yet' } });
    expect(data.current).toEqual(PL);
    strict('list_competitions', r.data);
    expect(r.text).toContain('premier-league');
    expect(r.text).toContain('world-cup');
    expect(r.text).toMatch(/Premier League/);
    const def = await toolListCompetitions({});
    expect((def.data as Rec).current).toEqual({ slug: 'fifa.world', alias: 'world-cup', name: 'World Cup', chosenBy: 'default' });
  });
});

describe('the contract, through a client', () => {
  it('ten tools; `competition` on the eight competition-answering ones and not on get_team; list_competitions offline; selection declared on every competition-answering output schema', async () => {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const server = buildServer();
    await server.connect(serverT);
    const client = new Client({ name: 'selection-test', version: '0.0.0' });
    await client.connect(clientT);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(['get_bracket', 'get_live', 'get_market_signal', 'get_match', 'get_next_fixture', 'get_share_snippet', 'get_standings', 'get_team', 'get_today', 'list_competitions']);
      for (const t of tools) {
        const props = Object.keys((t.inputSchema as { properties?: Record<string, unknown> }).properties ?? {});
        const out = JSON.stringify(t.outputSchema ?? {});
        if (t.name === 'get_team') {
          expect(props, t.name).not.toContain('competition');
          expect(out, t.name).not.toContain('"competition"');
        } else if (t.name === 'list_competitions') {
          expect(props, t.name).toContain('competition');
          expect(t.annotations?.openWorldHint, t.name).toBe(false);
          expect(t.annotations?.readOnlyHint, t.name).toBe(true);
          expect(out, t.name).toContain('"competitions"');
          expect(out, t.name).toContain('"current"');
        } else {
          expect(props, t.name).toContain('competition');
          expect(out, t.name).toContain('"competition"');
          expect(out, t.name).toContain('"chosenBy"');
        }
      }
      const desc = tools.find((t) => t.name === 'get_today')?.inputSchema as { properties?: Record<string, { description?: string }> };
      expect(desc.properties?.competition?.description ?? '').toMatch(/premier-league/);
      expect(desc.properties?.competition?.description ?? '').toMatch(/eng\.1/);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('OUTPUT_SCHEMAS covers the ten tools', () => {
    expect(Object.keys(OUTPUT_SCHEMAS).sort()).toEqual(['get_bracket', 'get_live', 'get_market_signal', 'get_match', 'get_next_fixture', 'get_share_snippet', 'get_standings', 'get_team', 'get_today', 'list_competitions']);
  });
});
