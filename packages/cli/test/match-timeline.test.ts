/**
 * `claudinho match <id>`: the match's goals and cards (from ESPN's `details`), and `--json`'s three new keys, `lines`
 * (the rows the text prints, built by the same function), `attribution` (the text's attribution line, or null) and
 * `disclaimer` (the text's localized disclaimer line). And the cache file never holds events.
 *
 * The adapter is the real one over a fake feed (as off-bundle-surfaces.test.ts): a Premier League month with the
 * finished match 401879286 (Newcastle 2–2 Bournemouth, its details as ESPN sends them).
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EspnAdapter, FakeMarketProvider, type Match, type MarketProvider, type MatchEvent, type ProviderAdapter } from '@claudinho/core';
import { cmdToday } from '../src/commands';
import { cachePath, readState, writeState, type CacheState } from '../src/cache';
import { cmdMatch } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';
import { described } from './config-of';

const NOW = new Date('2026-10-10T15:00:00.000Z');
const S2026 = { year: 2026, displayName: '2026-27 English Premier League', startDate: '2026-08-01T04:00Z', endDate: '2027-05-30T03:59Z' };
const ENDED = { year: 2026, displayName: '2026 Concacaf Champions Cup', startDate: '2026-02-01T05:00Z', endDate: '2026-10-09T03:59Z' };
const NEW = { id: '361', abbreviation: 'NEW', displayName: 'Newcastle United' };
const BOU = { id: '349', abbreviation: 'BOU', displayName: 'AFC Bournemouth' };
const FLAGS = { scoringPlay: false, yellowCard: false, redCard: false, penaltyKick: false, ownGoal: false, shootout: false };
const det = (dv: string, team: { id: string }, flags: Partial<typeof FLAGS>, athlete?: { name: string; team: { id: string } }) => ({
  type: { id: '0', text: 'x' },
  clock: { value: 0, displayValue: dv },
  team: { id: team.id },
  scoreValue: 0,
  ...FLAGS,
  ...flags,
  ...(athlete ? { athletesInvolved: [{ id: '1', displayName: athlete.name, team: athlete.team }] } : {}),
});
const DETAILS = [
  det("9'", BOU, { scoringPlay: true }, { name: 'Marcus Tavernier', team: BOU }),
  det("28'", NEW, { yellowCard: true }, { name: 'Anthony Elanga', team: NEW }),
  det("35'", BOU, { scoringPlay: true, ownGoal: true }, { name: 'Malick Thiaw', team: NEW }),
  det("37'", NEW, { scoringPlay: true }, { name: 'Harvey Barnes', team: NEW }),
  det("71'", NEW, { yellowCard: true }),
  det("88'", NEW, { scoringPlay: true }, { name: 'Jacob Ramsey', team: NEW }),
  det("90'+4'", BOU, { yellowCard: true }, { name: 'Adam Smith', team: BOU }),
];
const ROWS_EN = [
  "  9'     Goal         BOU  Marcus Tavernier",
  "  28'    Yellow card  NEW  Anthony Elanga",
  "  35'    Own goal     BOU  Malick Thiaw",
  "  37'    Goal         NEW  Harvey Barnes",
  "  71'    Yellow card  NEW",
  "  88'    Goal         NEW  Jacob Ramsey",
  "  90+4'  Yellow card  BOU  Adam Smith",
];
const MATCH_ID = '401879286';
const finished = {
  id: MATCH_ID,
  date: '2026-10-10T11:30Z',
  season: { slug: 'regular-season' },
  status: { type: { name: 'STATUS_FULL_TIME', state: 'post', completed: true } },
  competitions: [
    {
      venue: { fullName: "St. James' Park", address: { city: 'Newcastle-upon-Tyne', country: 'England' } },
      competitors: [
        { id: NEW.id, homeAway: 'home', score: '2', team: NEW },
        { id: BOU.id, homeAway: 'away', score: '2', team: BOU },
      ],
      details: DETAILS,
    },
  ],
};
const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const easternDay = (iso: string) => eastern.format(new Date(iso)).replace(/-/g, '');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const STATS = ['gamesPlayed', 'wins', 'ties', 'losses', 'pointsFor', 'pointsAgainst', 'pointDifferential', 'points', 'rank'];
const TABLE = { children: [{ name: '2026-27 English Premier League', standings: { entries: [NEW, BOU].map((t, i) => ({ team: t, stats: STATS.map((n) => ({ name: n, value: n === 'rank' ? i + 1 : 0 })) })) } }] };

/** The feed: the finished match filed under its US/Eastern day; `fail` answers every scoreboard request with a 500. */
function feed(opts: { events?: unknown[]; fail?: boolean; competition?: string; season?: unknown; standings?: unknown } = {}): ProviderAdapter {
  const events = opts.events ?? [finished];
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    if (url.includes('/standings')) return json(opts.standings ?? TABLE);
    if (opts.fail) return json({ error: 'down' }, 500);
    const asked = new URL(url).searchParams.get('dates') ?? '';
    if (asked.includes('-')) return json({ code: 400 }, 400);
    const inBucket = (e: { date: string }) => (asked.length === 8 ? easternDay(e.date) === asked : asked.length === 6 ? easternDay(e.date).startsWith(asked) : false);
    return json({ leagues: [{ season: opts.season ?? S2026 }], events: (events as Array<{ date: string }>).filter(inBucket) });
  }) as unknown as typeof fetch;
  return new EspnAdapter({ competition: opts.competition ?? 'eng.1', fetchImpl, now: () => NOW.getTime() }) as ProviderAdapter;
}
function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return described({ lang: 'en', tz: 'UTC', json: false, color: false, source: 'espn', competition: 'eng.1', flavor: 'off', markets: false, ...over });
}
const ctxFor = (adapter: ProviderAdapter, over: Partial<CliConfig> = {}) => ({
  cfg: cfg({ competition: adapter.competition, ...over }),
  t: makeT(over.lang ?? 'en'),
  adapter,
  now: NOW,
  marketProvider: undefined,
});

const outSpy = vi.spyOn(process.stdout, 'write');
let writes: string[] = [];
beforeEach(() => {
  writes = [];
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
});
afterEach(() => outSpy.mockReset());
const stdout = () => writes.join('');

/** What `lines` must be for a text answer: its rows, less the leading blank, the attribution and the disclaimer at the
 *  end, and any blank row left trailing. */
function rowsOf(text: string, attribution: string | null, disclaimer: string): string[] {
  const rows = text.split('\n');
  if (rows.at(-1) === '') rows.pop();
  expect(rows.pop()).toBe(disclaimer);
  if (attribution !== null) expect(rows.pop()).toBe(attribution);
  expect(rows.shift()).toBe('');
  while (rows.length && rows.at(-1) === '') rows.pop();
  return rows;
}

/** Runs one branch twice (text, then `--json`) and checks the JSON's three keys against the text. */
async function both(adapter: () => ProviderAdapter, id: string, over: Partial<CliConfig>, attribution: string | null, disclaimer: string) {
  writes = [];
  await cmdMatch(id, ctxFor(adapter(), over));
  const text = stdout();
  writes = [];
  await cmdMatch(id, ctxFor(adapter(), { ...over, json: true }));
  const j = JSON.parse(stdout()) as Record<string, unknown>;
  expect(j.lines).toEqual(rowsOf(text, attribution, disclaimer));
  expect(j.attribution).toBe(attribution);
  expect(j.disclaimer).toBe(disclaimer);
  // The three keys after the existing ones and before `competition`.
  const keys = Object.keys(j);
  expect(keys.slice(-4)).toEqual(['lines', 'attribution', 'disclaimer', 'competition']);
  return { text, j };
}

const DISCLAIMER_EN = 'Not affiliated with FIFA, any confederation, league or club, or Anthropic.';
const DISCLAIMER_ES = 'Sin afiliación con la FIFA, con ninguna confederación, liga o club, ni con Anthropic.';

describe('match <id>: the timeline in the text', () => {
  it('the rows after the kickoff line, before the attribution, aligned (English)', async () => {
    await cmdMatch(MATCH_ID, ctxFor(feed()));
    const rows = stdout().split('\n');
    const first = rows.indexOf(ROWS_EN[0]!);
    expect(first).toBeGreaterThan(0);
    expect(rows.slice(first, first + ROWS_EN.length)).toEqual(ROWS_EN);
    expect(rows.findIndex((r) => r.includes('FT'))).toBeLessThan(first);
    expect(rows.indexOf('Live data: ESPN')).toBeGreaterThan(first + ROWS_EN.length - 1);
  });
  it('Spanish kind words', async () => {
    await cmdMatch(MATCH_ID, ctxFor(feed(), { lang: 'es' }));
    expect(stdout()).toContain("  35'    Gol en contra     BOU  Malick Thiaw");
    expect(stdout()).toContain("  90+4'  Tarjeta amarilla  BOU  Adam Smith");
  });
});

describe('match <id> --json: lines, attribution, disclaimer on every answer', () => {
  it('a found match (English): lines are the text rows, the attribution and the disclaimer the footer', async () => {
    const { j } = await both(() => feed(), MATCH_ID, {}, 'Live data: ESPN', DISCLAIMER_EN);
    expect(j.lines).toEqual(expect.arrayContaining(ROWS_EN));
    expect((j.match as Match).events?.[2]).toEqual({ type: 'OWN_GOAL', minute: 35, side: 'away', teamCode: 'BOU', player: 'Malick Thiaw' });
  });
  it('a found match (Spanish): the rows and the footer in the reader’s language', async () => {
    const { j } = await both(() => feed(), MATCH_ID, { lang: 'es' }, 'Datos en vivo: ESPN', DISCLAIMER_ES);
    expect((j.lines as string[]).some((r) => r.includes('Gol en contra'))).toBe(true);
  });
  it('the window: the id not in the span (no attribution line in the text, so null)', async () => {
    const { j } = await both(() => feed(), '999', {}, null, DISCLAIMER_EN);
    expect(j.match).toBeNull();
    expect((j.lines as string[]).join('\n')).toContain('Not found between');
  });
  it('an outage: every scoreboard request fails', async () => {
    const { j } = await both(() => feed({ fail: true }), MATCH_ID, {}, null, DISCLAIMER_EN);
    expect(j.match).toBeNull();
    expect((j.lines as string[]).length).toBeGreaterThan(0);
  });
  it('a read that was not whole: the qualifier is the first row', async () => {
    const broken = { ...finished, id: '43', status: { type: { name: 'STATUS_NEW', state: 'limbo' } } };
    const { j } = await both(() => feed({ events: [finished, broken] }), MATCH_ID, {}, 'Live data: ESPN', DISCLAIMER_EN);
    expect((j.lines as string[])[0]).toContain('may be incomplete');
  });
  it('a verdict: the edition is over (between editions)', async () => {
    const cup = () => feed({ competition: 'concacaf.champions', events: [], season: ENDED, standings: { name: 'Concacaf Champions Cup', season: { year: 2026 }, seasons: [{ year: 2016 }] } });
    const { j } = await both(cup, '999', {}, null, DISCLAIMER_EN);
    expect(j.betweenEditions).toBeDefined();
  });
});

describe('match <id>: the timeline beside the other rows', () => {
  it('a blank row before the first timeline row', async () => {
    await cmdMatch(MATCH_ID, ctxFor(feed()));
    const rows = stdout().split('\n');
    expect(rows[rows.indexOf(ROWS_EN[0]!) - 1]).toBe('');
  });
  it('lines follow --tz (the kickoff row), and still equal the text', async () => {
    const utc = await both(() => feed(), MATCH_ID, { tz: 'UTC' }, 'Live data: ESPN', DISCLAIMER_EN);
    const tokyo = await both(() => feed(), MATCH_ID, { tz: 'Asia/Tokyo' }, 'Live data: ESPN', DISCLAIMER_EN);
    expect(tokyo.j.lines).not.toEqual(utc.j.lines);
  });
  it('the none-read empty answer carries the three keys too', async () => {
    const broken = { ...finished, id: '43', status: { type: { name: 'STATUS_NEW', state: 'limbo' } } };
    const other = { ...finished, id: '44' };
    const { j } = await both(() => feed({ events: [broken, other] }), MATCH_ID, {}, null, DISCLAIMER_EN);
    expect(j.match).toBeNull();
    expect(j.partial).toBeDefined();
    expect((j.lines as string[]).join('\n')).toContain('was read');
  });
  it('today --json carries a finished match\'s events', async () => {
    await cmdToday('2026-10-10', ctxFor(feed(), { json: true }));
    const j = JSON.parse(stdout()) as { matches: Match[] };
    expect(j.matches.find((m) => m.id === MATCH_ID)?.events?.length).toBe(DETAILS.length);
  });
});

describe('match <id> on a nation competition: flags and the market block', () => {
  const NOW_WC = new Date('2026-06-11T20:00:00Z');
  const ev = (n: number): MatchEvent[] =>
    Array.from({ length: n }, (_, i) => ({ type: 'YELLOW', minute: 10 + i, side: i % 2 ? 'away' : 'home', teamCode: i % 2 ? 'RSA' : 'MEX', player: 'A Player' }) as MatchEvent);
  const opener: Match = {
    id: '760415',
    stage: 'GROUP',
    group: 'A',
    kickoff: '2026-06-11T19:00:00.000Z',
    venue: 'Estadio Azteca',
    home: { code: 'MEX', name: 'Mexico', flag: '\u{1F1F2}\u{1F1FD}', id: 'espn:203' },
    away: { code: 'RSA', name: 'South Africa', flag: '\u{1F1FF}\u{1F1E6}', id: 'espn:467' },
    score: { home: 1, away: 0 },
    minute: 60,
    status: 'LIVE',
    events: ev(2),
    updatedAt: NOW_WC.toISOString(),
  };
  const wc = (): ProviderAdapter => ({
    name: 'espn',
    competition: 'fifa.world',
    capabilities: { push: false, latencyHintSec: 0 },
    fetchByDate: async () => [opener],
    fetchLive: async () => [opener],
    fetchWindow: async () => [opener],
  });
  const wcCtx = (over: Partial<CliConfig>, marketProvider?: MarketProvider) => ({ ...ctxFor(wc(), { competition: 'fifa.world', ...over }), now: NOW_WC, marketProvider });
  const FLAGS_ENV = process.env.CLAUDINHO_FLAGS;
  afterEach(() => {
    if (FLAGS_ENV === undefined) delete process.env.CLAUDINHO_FLAGS;
    else process.env.CLAUDINHO_FLAGS = FLAGS_ENV;
  });
  it('CLAUDINHO_FLAGS=on: the side label carries the nation flag', async () => {
    process.env.CLAUDINHO_FLAGS = 'on';
    await cmdMatch('760415', wcCtx({}));
    expect(stdout()).toMatch(/ {2}10' +Yellow card +\u{1F1F2}\u{1F1FD} MEX/u);
  });
  it('CLAUDINHO_FLAGS=off: no flag in the timeline rows', async () => {
    process.env.CLAUDINHO_FLAGS = 'off';
    await cmdMatch('760415', wcCtx({}));
    const rows = stdout().split('\n').filter((r) => /^ {2}\d+' /.test(r));
    expect(rows.length).toBe(2);
    expect(rows.join('\n')).not.toMatch(/\u{1F1F2}\u{1F1FD}|\u{1F1FF}\u{1F1E6}/u);
  });
  it('a reliable market signal: its block before the first timeline row', async () => {
    await cmdMatch('760415', wcCtx({ markets: true }, new FakeMarketProvider({ synthesize: true, now: NOW_WC })));
    const t = stdout();
    const market = t.indexOf('Prediction markets');
    expect(market).toBeGreaterThan(0);
    expect(t.search(/\n {2}\d+' +Yellow card/)).toBeGreaterThan(market);
  });
  it('the market-incomplete note stays after the timeline (an uncut text keeps its notes after the body)', async () => {
    const dead = { name: 'dead', findSignal: async () => undefined, findSignals: async () => ({ results: new Map(), complete: false }) } as unknown as MarketProvider;
    await cmdMatch('760415', wcCtx({ markets: true }, dead));
    const t = stdout();
    expect(t.indexOf('Market data unavailable')).toBeGreaterThan(t.search(/\n {2}\d+' +Yellow card/));
  });
});

describe('the cache file never holds events', () => {
  let dir: string;
  const ORIG = process.env.XDG_CACHE_HOME;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'claudinho-noevents-'));
    process.env.XDG_CACHE_HOME = dir;
  });
  afterEach(() => {
    if (ORIG === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = ORIG;
    rmSync(dir, { recursive: true, force: true });
  });
  const withEvents = (id: string): Match => ({
    id,
    stage: 'REGULAR',
    kickoff: '2026-10-10T11:30:00.000Z',
    venue: "St. James' Park",
    home: { code: 'NEW', name: 'Newcastle United', id: 'espn:361' },
    away: { code: 'BOU', name: 'AFC Bournemouth', id: 'espn:349' },
    score: { home: 1, away: 0 },
    minute: 40,
    status: 'LIVE',
    events: [{ type: 'GOAL', minute: 37, side: 'home', teamCode: 'NEW', player: 'Harvey Barnes' }],
    updatedAt: '2026-10-10T12:15:00.000Z',
  });
  it('writeState drops events from every match of the live, fixtures and schedule slices; the rest is kept', () => {
    const state: CacheState = {
      updatedAt: '2026-10-10T12:15:00.000Z',
      live: [withEvents('1')],
      degraded: false,
      source: 'espn',
      competition: 'eng.1',
      fixtures: [withEvents('2')],
      schedule: { fixtures: [withEvents('3')] },
    };
    expect(writeState(state, Date.parse(state.updatedAt))).toBe(true);
    const raw = readFileSync(cachePath('espn', 'eng.1'), 'utf8');
    expect(raw).not.toContain('"events"');
    expect(raw).toContain('Newcastle United');
    const back = readState('espn', 'eng.1');
    expect(back?.live[0]?.id).toBe('1');
    expect(back?.live[0]?.score).toEqual({ home: 1, away: 0 });
    // The caller's state is not mutated.
    expect(state.live[0]?.events?.length).toBe(1);
  });
});
