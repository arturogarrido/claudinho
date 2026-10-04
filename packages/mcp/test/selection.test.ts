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
import { readFileSync } from 'node:fs';
import type { Match, ProviderAdapter } from '@claudinho/core';
import { FakeMarketProvider, t as coreT } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v3';
import { buildServer, INSTRUCTIONS, OUTPUT_SCHEMAS } from '../src/server';
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
    // ONE roster sentence, core's, the same the CLI prints (English here: the tool takes no language).
    expect(r.text.split('\n')[0]).toBe(coreT('en', 'team.roster'));
    expect(coreT('en', 'team.roster')).toBe('World Cup roster');
  });

  it('an injected adapter for another competition is refused before any read: the body and the label never disagree', async () => {
    let reads = 0;
    const counting: ProviderAdapter = { ...adapterFor('eng.1'), async fetchByDate() { reads++; return [fixture]; }, async fetchLive() { reads++; return [fixture]; }, async fetchWindow() { reads++; return [fixture]; } };
    await expect(toolGetLive({ competition: 'serie-a', adapter: counting, now: NOW })).rejects.toThrow(/ita\.1|serie-a/);
    await expect(toolGetShareSnippet({ live: true, competition: 'serie-a', adapter: counting, marketProvider: new FakeMarketProvider(), now: NOW })).rejects.toThrow(/eng\.1/);
    process.env.CLAUDINHO_COMPETITION = 'laliga';
    await expect(toolGetToday({ date: '2026-10-04', adapter: counting, now: NOW })).rejects.toThrow(/esp\.1|laliga/);
    delete process.env.CLAUDINHO_COMPETITION;
    // The default selection is the World Cup: an eng.1 adapter under it is a mismatch too.
    await expect(toolGetLive({ adapter: counting, now: NOW })).rejects.toThrow(/fifa\.world|world-cup/);
    expect(reads).toBe(0);
    // The same adapter under its own competition answers.
    const ok = await toolGetLive({ competition: 'premier-league', adapter: counting, now: NOW });
    expect((ok.data as Rec).competition).toEqual(PL);
  });
});

describe('the server instructions say which answers name the competition first', () => {
  it('the sentence names its exceptions: get_team, get_share_snippet and list_competitions', () => {
    // One sentence: the claim and its three exceptions, so a reader of the instructions is not told that
    // get_team's roster line, a card's title or the listing's `Current:` are mode lines.
    const sentence = INSTRUCTIONS.split(/(?<=\.)\s/).find((x) => /starts with the competition/.test(x)) ?? '';
    expect(sentence).toMatch(/get_team/);
    expect(sentence).toMatch(/get_share_snippet/);
    expect(sentence).toMatch(/list_competitions/);
    expect(sentence).not.toMatch(/^Every answer's text starts/);
  });
});

describe('the resources name their competition', () => {
  const recorded = (slug: string) => readFileSync(new URL(`../../core/test/fixtures/standings/${slug}.json`, import.meta.url), 'utf8');
  const withClient = async <T,>(fn: (client: Client) => Promise<T>): Promise<T> => {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const server = buildServer();
    await server.connect(serverT);
    const client = new Client({ name: 'selection-resources', version: '0.0.0' });
    await client.connect(clientT);
    try {
      return await fn(client);
    } finally {
      await client.close();
      await server.close();
    }
  };
  // A resource's contents are text or blob items; both carry `uri` (the SDK's union), so the helper takes that shape.
  const textOf = (res: { contents: Array<{ uri: string; text?: unknown }> }) =>
    res.contents.map((c) => (typeof c.text === 'string' ? c.text : '')).join('\n');
  afterEach(() => vi.unstubAllGlobals());

  it('standings://{key} begins with the mode line, like a tool\'s text: populated, empty and degraded', async () => {
    vi.stubGlobal('fetch', async () => new Response(recorded('uefa.euro'), { status: 200 }));
    process.env.CLAUDINHO_COMPETITION = 'euro';
    await withClient(async (client) => {
      const populated = textOf(await client.readResource({ uri: 'standings://A' }));
      expect(populated.split('\n')[0]).toBe('EURO · from the environment');
      expect(populated).toContain('Group A');
      const empty = textOf(await client.readResource({ uri: 'standings://Z' }));
      expect(empty.split('\n')[0]).toBe('EURO · from the environment');
    });
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 500 }));
    process.env.CLAUDINHO_COMPETITION = 'premier-league';
    await withClient(async (client) => {
      const degraded = textOf(await client.readResource({ uri: 'standings://LEAGUE' }));
      expect(degraded.split('\n')[0]).toBe('Premier League · from the environment');
      expect(degraded).toContain('Live standings unavailable');
    });
  });

  it('fixtures://{date} names the bundled World Cup schedule first, whatever the server\'s selection', async () => {
    process.env.CLAUDINHO_COMPETITION = 'euro';
    await withClient(async (client) => {
      const text = textOf(await client.readResource({ uri: 'fixtures://2026-06-11' }));
      expect(text.split('\n')[0]).toBe('World Cup');
      expect(text).toMatch(/MEX|Mexico/);
      const none = textOf(await client.readResource({ uri: 'fixtures://2026-01-01' }));
      expect(none.split('\n')[0]).toBe('World Cup');
      expect(none).toContain('No matches on 2026-01-01.');
    });
  });

  it('the tournament_today prompt sends the model to the selected competition, not to "the 2026 tournament"', async () => {
    await withClient(async (client) => {
      const res = await client.getPrompt({ name: 'tournament_today' });
      const text = res.messages.map((m) => (m.content.type === 'text' ? (m.content.text as string) : '')).join('\n');
      expect(text).not.toMatch(/2026 tournament/);
      expect(text).toMatch(/competition/);
      expect(text).toContain('get_today');
    });
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
