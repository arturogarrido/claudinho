/**
 * 0.11 PR 2.1c, added by the coder beside the specification
 * (`off-bundle-surfaces.test.ts`, whose harness this copies): cases its
 * mutation pass showed no test could see. A Libertadores table is named
 * `Group <letter>` here, as the provider names it.
 */
import { describe, expect, it } from 'vitest';
import { EspnAdapter, type ProviderAdapter } from '@claudinho/core';
import { z } from 'zod/v3';
import { OUTPUT_SCHEMAS } from '../src/server';
import { toolGetMatch, toolGetNextFixture, toolGetShareSnippet } from '../src/tools';

const STATS = ['gamesPlayed', 'wins', 'ties', 'losses', 'pointsFor', 'pointsAgainst', 'pointDifferential', 'points', 'rank'];
const NOW = new Date('2026-10-10T15:00:00.000Z');
type Season = { year: number; displayName: string; startDate?: string; endDate?: string };
const S2026: Season = { year: 2026, displayName: '2026-27 English Premier League', startDate: '2026-08-01T04:00Z', endDate: '2027-05-30T03:59Z' };
type Side = { id?: string; abbr: string; name: string };
type Ev = { id: string; date: string; home: Side; away: Side; state?: 'pre' | 'in' | 'post'; raw?: Record<string, unknown> };
const ARS: Side = { id: '359', abbr: 'ARS', name: 'Arsenal' };
const CHE: Side = { id: '363', abbr: 'CHE', name: 'Chelsea' };
const LIV: Side = { id: '364', abbr: 'LIV', name: 'Liverpool' };
const CARABOBO: Side = { id: '7001', abbr: 'CAR', name: 'Carabobo' };
const ALWAYS_READY: Side = { id: '7002', abbr: 'CAR', name: 'Always Ready' };
function event(e: Ev) {
  const state = e.state ?? 'pre';
  const type = state === 'in' ? { name: 'STATUS_IN_PROGRESS', state: 'in' } : state === 'post' ? { name: 'STATUS_FULL_TIME', state: 'post' } : { name: 'STATUS_SCHEDULED', state: 'pre' };
  const side = (s: Side, homeAway: string, score: string) => ({ homeAway, score, team: { ...(s.id ? { id: s.id } : {}), abbreviation: s.abbr, displayName: s.name } });
  return { id: e.id, date: e.date, season: { slug: 'regular-season' }, status: { type, displayClock: state === 'in' ? "55'" : undefined, period: state === 'in' ? 2 : 0 }, competitions: [{ competitors: [side(e.home, 'home', '1'), side(e.away, 'away', '0')] }], ...e.raw };
}
function table(name: string, sides: Side[]) {
  return { children: [{ name, standings: { entries: sides.map((s, i) => ({ team: { ...(s.id ? { id: s.id } : {}), abbreviation: s.abbr, displayName: s.name }, stats: STATS.map((n) => ({ name: n, value: n === 'rank' ? i + 1 : 0 })) })) } }] };
}
const PL_TABLE = table('2026-27 English Premier League', [ARS, CHE, LIV]);
const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const easternDay = (iso: string) => eastern.format(new Date(iso)).replace(/-/g, '');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
interface FeedOpts { events?: Ev[]; season?: (dates: string) => Season | undefined; standings?: unknown; fail?: (dates: string) => Response | undefined }
function feed(competition: string, opts: FeedOpts = {}) {
  const urls: string[] = [];
  const events = opts.events ?? [];
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('/standings')) return json(opts.standings ?? PL_TABLE);
    const asked = new URL(url).searchParams.get('dates') ?? '';
    const failure = opts.fail?.(asked);
    if (failure) return failure;
    if (asked.includes('-')) return json({ code: 400 }, 400);
    const season = opts.season ? opts.season(asked) : S2026;
    const inBucket = (e: Ev) => (asked.length === 8 ? easternDay(e.date) === asked : asked.length === 6 ? easternDay(e.date).startsWith(asked) : false);
    return json({ leagues: [{ season }], events: events.filter(inBucket).map(event) });
  }) as unknown as typeof fetch;
  return { adapter: new EspnAdapter({ competition, fetchImpl, now: () => NOW.getTime() }) as ProviderAdapter, urls };
}
const strict = (tool: keyof typeof OUTPUT_SCHEMAS, data: unknown) => {
  const res = z.object(OUTPUT_SCHEMAS[tool]).strict().safeParse(data);
  expect(res.success, `${tool}: ${res.success ? '' : JSON.stringify(res.error.issues)}`).toBe(true);
};
const LIB = table('Group A', [CARABOBO, ALWAYS_READY]);
const libSeason = () => ({ year: 2026, displayName: '2026 Copa Libertadores', endDate: '2026-11-30T05:00Z' });

describe('get_next_fixture: a code two clubs share, against a table read whole', () => {
  it('the candidates in text and data, no fixture; the schema holds', async () => {
    const events: Ev[] = [{ id: '20', date: '2026-10-12T22:00Z', home: ALWAYS_READY, away: { id: '7003', abbr: 'BOC', name: 'Boca Juniors' } }];
    const r = await toolGetNextFixture({ team: 'CAR', now: NOW, adapter: feed('conmebol.libertadores', { events, standings: LIB, season: libSeason }).adapter });
    expect(r.text).toContain('Carabobo (CAR)');
    expect(r.text).toContain('Always Ready (CAR)');
    expect(r.text).not.toContain('Boca');
    expect((r.data as { candidates: Array<{ name: string }> }).candidates.map((c) => c.name).sort()).toEqual(['Always Ready', 'Carabobo']);
    expect((r.data as { fixture: unknown }).fixture).toBeNull();
    strict('get_next_fixture', r.data);
  });
});

describe('get_match: the provider\u2019s earlier record, said as such', () => {
  it('a found match whose refresh failed: text names the earlier record, data keeps it attributed and degraded', async () => {
    const inSpan: Ev = { id: '41', date: '2026-10-17T14:00Z', home: LIV, away: ARS };
    const r = await toolGetMatch({ id: '41', adapter: feed('eng.1', { events: [inSpan], fail: (d) => (d.length === 8 ? json({}, 503) : undefined) }).adapter });
    expect(r.text).toContain('earlier record');
    expect(r.data).toMatchObject({ degraded: true, match: { id: '41' }, source: 'espn' });
    strict('get_match', r.data);
  });

  it('a match card with discovery down says it could not ask, and carries degraded', async () => {
    const r = await toolGetShareSnippet({ matchId: '41', now: NOW, adapter: feed('eng.1', { fail: () => json({}, 503) }).adapter });
    expect(r.text).toContain("Couldn't reach the data provider");
    expect(r.data).toMatchObject({ degraded: true });
    strict('get_share_snippet', r.data);
  });
});

describe('the share card’s structured twin carries the span it says it searched', () => {
  it('next: horizon; a match id: window; the schema holds', async () => {
    const next = await toolGetShareSnippet({ team: 'Arsenal', now: NOW, adapter: feed('eng.1', { events: [{ id: '13', date: '2026-10-11T15:00Z', home: CHE, away: LIV }] }).adapter });
    expect(next.data).toMatchObject({ horizon: { days: 14 } });
    strict('get_share_snippet', next.data);
    const match = await toolGetShareSnippet({ matchId: '41', now: NOW, adapter: feed('eng.1').adapter });
    expect(match.data).toMatchObject({ window: { from: '2026-10-09', to: '2026-10-24' } });
    strict('get_share_snippet', match.data);
  });
});

describe('the advertised input: a team-taking tool that resolves a club takes a name', () => {
  it('get_next_fixture and get_share_snippet take a bounded label; get_market_signal keeps the 3-letter code', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const { buildServer } = await import('../src/server');
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const server = buildServer();
    const client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    try {
      const { tools } = await client.listTools();
      type Prop = { pattern?: string; maxLength?: number; minLength?: number };
      const team = (name: string): Prop | undefined => {
        const schema = tools.find((t) => t.name === name)?.inputSchema as { properties?: Record<string, Prop> } | undefined;
        return schema?.properties?.team;
      };
      for (const name of ['get_next_fixture', 'get_share_snippet']) {
        expect(team(name)?.pattern, name).toBeUndefined();
        expect(team(name)?.maxLength, name).toBe(40);
        expect(team(name)?.minLength, name).toBe(1);
      }
      expect(team('get_market_signal')?.pattern).toBe('^[A-Za-z]{3}$');
    } finally {
      await client.close();
    }
  });
});

describe('the date card judges "nothing on this date" in the viewer’s zone, as get_today does', () => {
  const ENDED = { year: 2026, displayName: '2026 Concacaf Champions Cup', startDate: '2026-02-01T05:00Z', endDate: '2026-10-09T03:59Z' };
  const NONE = { name: 'Concacaf Champions Cup', season: { year: 2026 }, seasons: [{ year: 2016 }] };
  const finalFT: Ev = { id: '50', date: '2026-10-09T02:00Z', home: { id: '8001', abbr: 'TOL', name: 'Toluca' }, away: { id: '8002', abbr: 'LAFC', name: 'Los Angeles FC' }, state: 'post' };
  const cup = () => feed('concacaf.champions', { events: [finalFT], standings: NONE, season: () => ENDED }).adapter;

  it('a UTC viewer: the final’s UTC date is the final, with no key; the day after, the key', async () => {
    const day9 = await toolGetShareSnippet({ date: '2026-10-09', tz: 'UTC', now: NOW, adapter: cup() });
    expect(day9.text).toContain('Toluca');
    expect((day9.data as { betweenEditions?: unknown }).betweenEditions).toBeUndefined();
    const day10 = await toolGetShareSnippet({ date: '2026-10-10', tz: 'UTC', now: NOW, adapter: cup() });
    expect(day10.data).toMatchObject({ betweenEditions: { label: '2026 Concacaf Champions Cup' } });
    strict('get_share_snippet', day10.data);
  });
});

describe('review round 1 (coder): get_next_fixture on the World Cup resolves a name as the share card does, with no request', () => {
  it('an ambiguous name is the candidates; an unknown one is "no team called"; neither asks the provider', async () => {
    const f = feed('fifa.world');
    const amb = await toolGetNextFixture({ team: 'South', now: new Date('2026-06-13T12:00:00Z'), adapter: f.adapter });
    expect(amb.text).toContain('South Africa (RSA)');
    expect((amb.data as { candidates: Array<{ code: string }> }).candidates.map((c) => c.code).sort()).toEqual(['KOR', 'RSA']);
    strict('get_next_fixture', amb.data);
    const unknown = await toolGetNextFixture({ team: 'Narnia', now: new Date('2026-06-13T12:00:00Z'), adapter: f.adapter });
    expect(unknown.text).toContain('No team called Narnia');
    expect(unknown.data).toMatchObject({ unknownTeam: true, fixture: null, team: 'Narnia' });
    strict('get_next_fixture', unknown.data);
    expect(f.urls).toEqual([]);
  });

  it('a share card with a whole name resolves to the nation’s code', async () => {
    const f = feed('fifa.world');
    const r = await toolGetShareSnippet({ team: 'Mexico', now: new Date('2026-06-13T12:00:00Z'), adapter: f.adapter });
    expect((r.data as { team?: unknown }).team).toBe('MEX');
  });
});

describe('review round 2 (coder): every card’s run cue names the competition off the bundle', () => {
  it('the table, bracket, match and date cards too', async () => {
    const table = await toolGetShareSnippet({ group: 'LEAGUE', now: NOW, adapter: feed('eng.1').adapter });
    expect(table.text).toMatch(/CLAUDINHO_COMPETITION=eng\.1 npx @claudinho\/cli table LEAGUE/);
    const bracket = await toolGetShareSnippet({ bracket: true, now: NOW, adapter: feed('eng.1').adapter });
    expect(bracket.text).toMatch(/CLAUDINHO_COMPETITION=eng\.1 npx @claudinho\/cli bracket/);
    const match = await toolGetShareSnippet({ matchId: '41', now: NOW, adapter: feed('eng.1').adapter });
    expect(match.text).toMatch(/CLAUDINHO_COMPETITION=eng\.1 npx @claudinho\/cli match 41/);
    const day = await toolGetShareSnippet({ date: '2026-10-11', now: NOW, adapter: feed('eng.1').adapter });
    expect(day.text).toMatch(/CLAUDINHO_COMPETITION=eng\.1 npx @claudinho\/cli today/);
  });
});
