/**
 * A command whose context carries NO clock takes the adapter's read clock
 * (core's `clockOf`: the one a test injects, the wall clock in production)
 * for the read AND the rendering: one instant per request, the same rule as
 * the MCP tools' (`packages/mcp/test/countdown-clock.test.ts`). The adapter
 * clock below is Sep 20, 2026, a day every wall clock has left behind, so a
 * lookup or a countdown that reads the wall clock answers for the wrong span
 * on every day this file runs.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  allFixtures,
  definitiveNone,
  EspnAdapter,
  FakeMarketProvider,
  type Match,
  type MarketProvider,
  type MarketSignal,
  type ProviderAdapter,
  valid,
} from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdFollow, cmdLive, cmdMarkets, cmdMatch, cmdNext, cmdShare, cmdToday } from '../src/commands';
import { type CliConfig, resolveConfig } from '../src/config';
import { makeT } from '../src/i18n';
import { described } from './config-of';

const ADAPTER_CLOCK = new Date('2026-09-20T15:00:00.000Z');
const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const easternDay = (iso: string) => eastern.format(new Date(iso)).replace(/-/g, '');
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
type Ev = { id: string; date: string; inPlay?: boolean };
function feed(events: Ev[]): ProviderAdapter {
  const side = (homeAway: string, id: string, abbreviation: string, displayName: string) => ({ homeAway, score: '0', team: { id, abbreviation, displayName } });
  const event = (e: Ev) => ({
    id: e.id,
    date: e.date,
    season: { slug: 'regular-season' },
    status: e.inPlay
      ? { type: { name: 'STATUS_IN_PROGRESS', state: 'in', completed: false }, displayClock: "30'", period: 1 }
      : { type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
    competitions: [{ competitors: [side('home', '364', 'LIV', 'Liverpool'), side('away', '359', 'ARS', 'Arsenal')] }],
  });
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    if (url.includes('/standings')) return json({ name: 'x', season: { year: 2026 } });
    const asked = new URL(url).searchParams.get('dates') ?? '';
    const held = (e: Ev) => (asked.length === 8 ? easternDay(e.date) === asked : asked.length === 6 ? easternDay(e.date).startsWith(asked) : false);
    return json({ leagues: [{ season: { year: 2026, displayName: '2026-27 English Premier League' } }], events: events.filter(held).map(event) });
  }) as unknown as typeof fetch;
  return new EspnAdapter({ competition: 'eng.1', fetchImpl, now: () => ADAPTER_CLOCK.getTime() }) as ProviderAdapter;
}
const IN_SPAN: Ev = { id: '41', date: '2026-09-27T14:00:00Z' }; // Sep 20 15:00Z to Sep 27 14:00Z: six days and twenty-three hours
const ON_THE_DAY: Ev = { id: '43', date: '2026-09-20T19:00:00Z' }; // the adapter clock's own day, later
const IN_PLAY: Ev = { id: '44', date: '2026-09-20T14:30:00Z', inPlay: true }; // kicked off half an hour before it
const cfg = (over: Partial<CliConfig> = {}): CliConfig => described({ lang: 'en', tz: 'UTC', json: false, color: false, source: 'espn', competition: 'eng.1', flavor: 'off', markets: false, ...over });
// No `now` on the context: the command takes the adapter's.
const ctx = (adapter: ProviderAdapter, over: Partial<CliConfig> = {}) => ({ cfg: cfg(over), t: makeT('en'), adapter, marketProvider: new FakeMarketProvider() });

const outSpy = vi.spyOn(process.stdout, 'write');
let writes: string[] = [];
const TEAM_ENV = process.env.CLAUDINHO_TEAM;
beforeEach(() => {
  writes = [];
  delete process.env.CLAUDINHO_TEAM; // the pin case asks for the pin: the environment must name no team
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
});
afterEach(() => {
  outSpy.mockReset();
  if (TEAM_ENV === undefined) delete process.env.CLAUDINHO_TEAM;
  else process.env.CLAUDINHO_TEAM = TEAM_ENV;
});
const text = () => writes.join('');

describe("a command whose context carries no clock takes the adapter's read clock", () => {
  it("next: the fixture is found in the adapter clock's span and its countdown counts from that clock", async () => {
    await cmdNext('Arsenal', ctx(feed([IN_SPAN])));
    expect(text()).toContain('Liverpool');
    expect(text()).toContain('in 6d23h');
  });

  it("next with no argument, the pinned team: the pin's branch takes the adapter's clock too", async () => {
    await cmdNext(undefined, ctx(feed([IN_SPAN]), { pin: { id: 'espn:359', code: 'ARS', name: 'Arsenal' } }));
    expect(text()).toContain('Liverpool');
    expect(text()).toContain('in 6d23h');
  });

  it("match <id>: the record is found in the adapter clock's span (the rule `match` kept all along)", async () => {
    await cmdMatch('41', ctx(feed([IN_SPAN])));
    expect(text()).toContain('Liverpool vs Arsenal');
  });
});

describe("the CLI's other edges take the adapter's read clock too (no context clock)", () => {
  it("today with no date: the adapter clock's day is the day listed", async () => {
    await cmdToday(undefined, ctx(feed([ON_THE_DAY])));
    expect(text()).toContain('Liverpool');
  });

  it("live: the window read is the adapter clock's", async () => {
    await cmdLive(ctx(feed([IN_PLAY])));
    expect(text()).toContain('Liverpool');
  });

  it("share live: the window read is the adapter clock's", async () => {
    await cmdShare('live', undefined, {}, ctx(feed([IN_PLAY])));
    expect(text()).toContain('Liverpool');
  });

  it("share with no date: the adapter clock's day is the card's", async () => {
    await cmdShare(undefined, undefined, {}, ctx(feed([ON_THE_DAY])));
    expect(text()).toContain('Liverpool');
  });
});

describe("follow --team resolves a club against the adapter clock's span", () => {
  const ENV = ['XDG_CONFIG_HOME', 'CLAUDINHO_COMPETITION', 'CLAUDINHO_TEAM'] as const;
  const saved: Record<string, string | undefined> = {};
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'claudinho-clock-follow-'));
    for (const k of ENV) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.XDG_CONFIG_HOME = tmp;
  });
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  it("a club the competition knows only from its schedule ahead (no table) is pinned from the adapter clock's span", async () => {
    // The Concacaf Champions Cup has no table: the schedule ahead is the only roster, so the span decides.
    const fetchImpl = (async (input: unknown) => {
      const url = String(input);
      if (url.includes('/standings')) return json({ name: 'Concacaf Champions Cup', season: { year: 2026 }, seasons: [{ year: 2016 }] });
      const asked = new URL(url).searchParams.get('dates') ?? '';
      const date = '2026-09-23T02:00:00Z';
      const held = asked.length === 8 ? easternDay(date) === asked : asked.length === 6 ? easternDay(date).startsWith(asked) : false;
      const events = held
        ? [{
            id: '51',
            date,
            season: { slug: 'round-of-16' },
            status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
            competitions: [{ competitors: [
              { homeAway: 'home', score: '0', team: { id: '227', abbreviation: 'AME', displayName: 'Club América' } },
              { homeAway: 'away', score: '0', team: { id: '228', abbreviation: 'TOL', displayName: 'Toluca' } },
            ] }],
          }]
        : [];
      return json({ leagues: [{ season: { year: 2026, displayName: '2026 Concacaf Champions Cup', startDate: '2026-02-01T05:00Z', endDate: '2026-12-31T04:59Z' } }], events });
    }) as unknown as typeof fetch;
    const adapter = new EspnAdapter({ competition: 'concacaf.champions', fetchImpl, now: () => ADAPTER_CLOCK.getTime() }) as ProviderAdapter;
    const config = resolveConfig({ tz: 'UTC', color: false, source: 'espn', flavor: 'off', markets: false });
    await cmdFollow('concacaf-champions-cup', { team: 'Club América' }, { cfg: config, t: makeT('en'), adapter });
    expect(JSON.parse(readFileSync(join(tmp, 'claudinho', 'config.json'), 'utf8'))).toEqual({
      version: 1,
      competition: 'concacaf.champions',
      team: { id: 'espn:227', code: 'AME', name: 'Club América' },
    });
  });
});

/**
 * The market gates of a request judge relevance and freshness by the request's clock: the World Cup (the one
 * competition markets are read for), an adapter that serves nothing (the bundled schedule answers), its clock an
 * hour before a bundled kickoff, and a fresh signal stamped at that clock. Every wall clock has passed every
 * bundled kickoff, so a gate that reads the wall clock omits the signal (finished) on every day this file runs.
 */
describe("the market gates take the adapter's read clock (no context clock)", () => {
  const fixture = allFixtures().find(
    (m) => m.status === 'SCHEDULED' && Date.parse(m.kickoff) > Date.parse('2026-06-13T12:00:00Z') && new Date(m.kickoff).getUTCHours() >= 2,
  )!;
  const before = new Date(Date.parse(fixture.kickoff) - 3_600_000);
  const wc: ProviderAdapter = {
    name: 'fake',
    competition: 'fifa.world',
    capabilities: { push: false, latencyHintSec: 0 },
    now: () => before.getTime(),
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
  const sig = (m: Match): MarketSignal => ({
    matchId: m.id,
    source: 'polymarket',
    asOf: before.toISOString(),
    fetchedAt: before.toISOString(),
    outcomes: [
      { kind: 'home', teamCode: m.home.code, label: m.home.name, probability: 0.56 },
      { kind: 'draw', label: 'Draw', probability: 0.25 },
      { kind: 'away', teamCode: m.away.code, label: m.away.name, probability: 0.19 },
    ],
    favorite: { kind: 'home', teamCode: m.home.code, probability: 0.56, strength: 'slight' },
    stale: false,
    ambiguous: false,
  });
  const markets: MarketProvider = {
    name: 'fixed',
    findSignal: async (m) => (m.id === fixture.id ? sig(m) : undefined),
    findSignals: async (ms) => ({
      results: new Map(ms.map((m) => [m.id, m.id === fixture.id ? valid(sig(m)) : definitiveNone('no signal for this fixture')] as const)),
      complete: true,
    }),
  };
  const wcCtx = () => ({ cfg: cfg({ competition: 'fifa.world', markets: true }), t: makeT('en'), adapter: wc, marketProvider: markets });

  it("today with no date: the adapter clock's day, and its fixture's market line", async () => {
    await cmdToday(undefined, wcCtx());
    expect(text()).toContain('56%');
  });

  it("markets next <team>: the fixture and its market by the adapter clock", async () => {
    await cmdMarkets('next', fixture.home.code, wcCtx());
    expect(text()).toContain('56%');
  });

  it("markets with no date: the adapter clock's day, and its fixture's signal", async () => {
    await cmdMarkets(undefined, undefined, wcCtx());
    expect(text()).toContain('56%');
  });

  it("match <id>: the record and its market line on the adapter clock", async () => {
    await cmdMatch(fixture.id, wcCtx());
    expect(text()).toContain('56%');
  });

  it("share with no date: the adapter clock's day, and its fixture's market block", async () => {
    await cmdShare(undefined, undefined, {}, wcCtx());
    expect(text()).toContain('56%');
  });
});
