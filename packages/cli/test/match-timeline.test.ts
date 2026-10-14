/**
 * `claudinho match <id>`: the match's goals and cards (from ESPN's `details`), and `--json`'s three new keys, `lines`
 * (the rows the text prints, built by the same function), `attribution` (the text's attribution line, or null) and
 * `disclaimer` (the text's localized disclaimer line). And the cache file never holds events.
 *
 * The adapter is the real one over a fake feed (as off-bundle-surfaces.test.ts): a Premier League month with the
 * finished match 401879286 (Newcastle 2–2 Bournemouth, its details as ESPN sends them).
 *
 * The match rows (4a-ii): the timeline's rows carry a marker before the kind word (the ball for a goal, an own goal
 * and a penalty, a yellow or a red card), and the answer is built as rows of parts, `{ role, parts }`, which
 * `--json` carries as `rows` right after `lines` and the text paints (strong bold, dim dim, accent and flair green,
 * quote dim; plain when colour is off). Picocolors is forced on in this file (it detects no colour in a test run);
 * every case but the colour ones runs with colour off, whose painter never calls it.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EspnAdapter, FakeMarketProvider, formatKickoff, type Match, type MarketProvider, type MatchEvent, type ProviderAdapter } from '@claudinho/core';
import { cmdToday } from '../src/commands';
import { cachePath, readState, writeState, type CacheState } from '../src/cache';
import { cmdMatch } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';
import { described } from './config-of';

vi.mock('picocolors', async () => {
  // A CommonJS module: its namespace carries the colours object as `default`.
  const actual = (await vi.importActual('picocolors')) as { default: { createColors: (enabled?: boolean) => unknown } };
  return { default: actual.default.createColors(true) };
});

const ESC = String.fromCharCode(27);
/** The text as the terminal shows it: every SGR sequence (ESC, `[`, digits and `;`, `m`) removed. */
const visible = (s: string) =>
  s
    .split(ESC)
    .map((part, i) => (i === 0 ? part : part.replace(/^\[[0-9;]*m/, '')))
    .join('');

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
  "  9'     ⚽ Goal         BOU  Marcus Tavernier",
  "  28'    🟨 Yellow card  NEW  Anthony Elanga",
  "  35'    ⚽ Own goal     BOU  Malick Thiaw",
  "  37'    ⚽ Goal         NEW  Harvey Barnes",
  "  71'    🟨 Yellow card  NEW",
  "  88'    ⚽ Goal         NEW  Jacob Ramsey",
  "  90+4'  🟨 Yellow card  BOU  Adam Smith",
];
/** The players of ROWS_EN, in order (undefined where the provider named none). */
const PLAYERS = ['Marcus Tavernier', 'Anthony Elanga', 'Malick Thiaw', 'Harvey Barnes', undefined, 'Jacob Ramsey', 'Adam Smith'];
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

type Part = { text: string; style?: string };
type Row = { role: string; parts: Part[] };
const ROLES = ['qualifier', 'title', 'mode', 'meta', 'status', 'flair', 'market', 'event', 'note', 'blank', 'text'];
const STYLES = ['strong', 'dim', 'accent', 'quote', 'flair'];
const joined = (r: Row) => r.parts.map((p) => p.text).join('');

/** Runs one branch twice (text, then `--json`) and checks the JSON's keys against the text: `lines`, then `rows`
 *  (the same body rows as parts: one per line, each joined equal to its line, roles and styles from the design's
 *  vocabulary), `attribution`, `disclaimer`. */
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
  const rows = j.rows as Row[];
  expect(Array.isArray(rows)).toBe(true);
  expect(rows.map(joined)).toEqual(j.lines);
  for (const r of rows) {
    expect(ROLES).toContain(r.role);
    for (const p of r.parts) {
      expect(typeof p.text).toBe('string');
      if (p.style !== undefined) expect(STYLES).toContain(p.style);
    }
  }
  // The keys after the existing ones and before `competition`: `rows` right after `lines`.
  const keys = Object.keys(j);
  expect(keys.slice(-5)).toEqual(['lines', 'rows', 'attribution', 'disclaimer', 'competition']);
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
    expect(stdout()).toContain("  35'    ⚽ Gol en contra     BOU  Malick Thiaw");
    expect(stdout()).toContain("  90+4'  🟨 Tarjeta amarilla  BOU  Adam Smith");
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
    expect(stdout()).toMatch(/ {2}10' +\u{1F7E8} Yellow card +\u{1F1F2}\u{1F1FD} MEX/u);
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
    expect(t.search(/\n {2}\d+' +(?:\u{1F7E8} )?Yellow card/u)).toBeGreaterThan(market);
  });
  it('the market-incomplete note stays after the timeline (an uncut text keeps its notes after the body)', async () => {
    const dead = { name: 'dead', findSignal: async () => undefined, findSignals: async () => ({ results: new Map(), complete: false }) } as unknown as MarketProvider;
    await cmdMatch('760415', wcCtx({ markets: true }, dead));
    const t = stdout();
    expect(t.indexOf('Market data unavailable')).toBeGreaterThan(t.search(/\n {2}\d+' +(?:\u{1F7E8} )?Yellow card/u));
  });
});

describe('match <id>: the answer as rows of parts (--json rows, the painted text)', () => {
  const PIN_NEW = { id: 'espn:361', code: 'NEW', name: 'Newcastle United' };
  const PIN_BOU = { id: 'espn:349', code: 'BOU', name: 'AFC Bournemouth' };
  const BRE = { id: '337', abbreviation: 'BRE', displayName: 'Brentford' };
  const KICK_EN = formatKickoff(finished.date, { tz: 'UTC', locale: 'en' });
  const KICK_ES = formatKickoff(finished.date, { tz: 'UTC', locale: 'es' });
  /** `match --json`'s rows for one config. */
  async function rowsFor(adapter: ProviderAdapter, over: Partial<CliConfig> = {}, id = MATCH_ID): Promise<{ rows: Row[]; lines: string[] }> {
    writes = [];
    await cmdMatch(id, ctxFor(adapter, { ...over, json: true }));
    const j = JSON.parse(stdout()) as { rows: Row[]; lines: string[] };
    return { rows: j.rows, lines: j.lines };
  }
  const ofRole = (rows: Row[], role: string) => rows.filter((r) => r.role === role);
  const styled = (rows: Row[], style: string) => rows.flatMap((r) => r.parts.filter((p) => p.style === style));
  const TEAM_ENV = process.env.CLAUDINHO_TEAM;
  afterEach(() => {
    if (TEAM_ENV === undefined) delete process.env.CLAUDINHO_TEAM;
    else process.env.CLAUDINHO_TEAM = TEAM_ENV;
  });

  it('a finished match: the roles in today\'s order (title, mode, stage and venue, status, blank, the events)', async () => {
    const { rows, lines } = await rowsFor(feed());
    expect(rows.map((r) => r.role)).toEqual(['title', 'mode', 'meta', 'status', 'blank', ...ROWS_EN.map(() => 'event')]);
    expect(rows.map(joined)).toEqual(lines);
  });
  it('the title: its text unchanged, the score one strong part', async () => {
    const { rows } = await rowsFor(feed());
    const [title] = ofRole(rows, 'title');
    expect(joined(title!)).toBe('Newcastle United 2–2 AFC Bournemouth');
    expect(title!.parts).toContainEqual({ text: '2–2', style: 'strong' });
  });
  it('a saved pin on the home side: its name is the one accent part', async () => {
    const { rows } = await rowsFor(feed(), { pin: PIN_NEW });
    const [title] = ofRole(rows, 'title');
    expect(title!.parts).toContainEqual({ text: 'Newcastle United', style: 'accent' });
    expect(styled(rows, 'accent')).toEqual([{ text: 'Newcastle United', style: 'accent' }]);
  });
  it('a saved pin on the away side: its name is the one accent part', async () => {
    const { rows } = await rowsFor(feed(), { pin: PIN_BOU });
    expect(styled(rows, 'accent')).toEqual([{ text: 'AFC Bournemouth', style: 'accent' }]);
  });
  it('CLAUDINHO_TEAM alone (no saved pin) accents nothing', async () => {
    process.env.CLAUDINHO_TEAM = 'NEW';
    const { rows } = await rowsFor(feed());
    expect(styled(rows, 'accent')).toEqual([]);
  });
  it('the stage and venue row is dim (every part with text in it)', async () => {
    const { rows } = await rowsFor(feed());
    const [meta] = ofRole(rows, 'meta');
    const inked = meta!.parts.filter((p) => p.text.trim() !== '');
    expect(inked.length).toBeGreaterThan(0);
    for (const p of inked) expect(p.style).toBe('dim');
  });
  it('the status row (English): the status token strong, then " · ", then the kickoff word and the kickoff', async () => {
    const { rows } = await rowsFor(feed());
    const [status] = ofRole(rows, 'status');
    expect(joined(status!)).toBe(`  FT · Kickoff ${KICK_EN}`);
    expect(status!.parts).toContainEqual({ text: 'FT', style: 'strong' });
    // Right after the stage and venue, where today's kickoff row is.
    expect(rows.findIndex((r) => r.role === 'status')).toBe(rows.findIndex((r) => r.role === 'meta') + 1);
  });
  it('the status row (Spanish): FIN · Inicio, then the kickoff', async () => {
    const { rows } = await rowsFor(feed(), { lang: 'es' });
    const [status] = ofRole(rows, 'status');
    expect(joined(status!)).toBe(`  FIN · Inicio ${KICK_ES}`);
    expect(status!.parts).toContainEqual({ text: 'FIN', style: 'strong' });
  });
  it('a scheduled match (no status token): the kickoff part alone', async () => {
    const later = { ...finished, id: '401879301', date: '2026-10-11T14:00Z', status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } } };
    const { rows } = await rowsFor(feed({ events: [later] }), {}, '401879301');
    const [status] = ofRole(rows, 'status');
    expect(joined(status!)).toBe(`  Kickoff ${formatKickoff(later.date, { tz: 'UTC', locale: 'en' })}`);
  });
  it("a live match: the minute is the status token, strong", async () => {
    const NOW_WC = new Date('2026-06-11T20:00:00Z');
    const opener: Match = {
      id: '760415',
      stage: 'GROUP',
      group: 'A',
      kickoff: '2026-06-11T19:00:00.000Z',
      venue: 'Estadio Azteca',
      home: { code: 'MEX', name: 'Mexico', flag: '\u{1F1F2}\u{1F1FD}', id: 'espn:203' },
      away: { code: 'RSA', name: 'South Africa', flag: '\u{1F1FF}\u{1F1E6}', id: 'espn:467' },
      score: { home: 1, away: 0 },
      minute: 26,
      status: 'LIVE',
      updatedAt: NOW_WC.toISOString(),
    };
    const wc: ProviderAdapter = {
      name: 'espn',
      competition: 'fifa.world',
      capabilities: { push: false, latencyHintSec: 0 },
      fetchByDate: async () => [opener],
      fetchLive: async () => [opener],
      fetchWindow: async () => [opener],
    };
    writes = [];
    await cmdMatch('760415', { ...ctxFor(wc, { competition: 'fifa.world', json: true }), now: NOW_WC });
    const rows = (JSON.parse(stdout()) as { rows: Row[] }).rows;
    const [status] = ofRole(rows, 'status');
    expect(joined(status!)).toBe(`  26' · Kickoff ${formatKickoff(opener.kickoff, { tz: 'UTC', locale: 'en' })}`);
    expect(status!.parts).toContainEqual({ text: "26'", style: 'strong' });
  });
  it('a rally cry: the flair row right after the status row, the cry one part styled flair', async () => {
    const { rows } = await rowsFor(feed(), { flavor: 'full' });
    const at = rows.findIndex((r) => r.role === 'flair');
    expect(at).toBe(rows.findIndex((r) => r.role === 'status') + 1);
    expect(joined(rows[at]!)).toBe('  Howay the lads!');
    expect(rows[at]!.parts).toContainEqual({ text: 'Howay the lads!', style: 'flair' });
    expect(styled(rows, 'quote')).toEqual([]);
  });
  it('a commentary phrase (no side with a cry): the flair row, the phrase one part styled quote', async () => {
    const plain = {
      ...finished,
      id: '401879302',
      competitions: [
        {
          ...finished.competitions[0]!,
          competitors: [
            { id: BOU.id, homeAway: 'home', score: '1', team: BOU },
            { id: BRE.id, homeAway: 'away', score: '0', team: BRE },
          ],
          details: [],
        },
      ],
    };
    const { rows } = await rowsFor(feed({ events: [plain] }), { flavor: 'full' }, '401879302');
    const flair = ofRole(rows, 'flair');
    expect(flair.length).toBe(1);
    const quoted = flair[0]!.parts.filter((p) => p.style === 'quote');
    expect(quoted.length).toBe(1);
    expect(quoted[0]!.text.trim()).not.toBe('');
    expect(joined(flair[0]!)).toBe(`  ${quoted[0]!.text}`);
    expect(styled(rows, 'flair')).toEqual([]);
  });
  it('the event rows: the timeline rows with the markers, each player one strong part', async () => {
    const { rows } = await rowsFor(feed());
    const events = ofRole(rows, 'event');
    expect(events.map(joined)).toEqual(ROWS_EN);
    events.forEach((r, i) => {
      const strong = r.parts.filter((p) => p.style === 'strong');
      const player = PLAYERS[i];
      expect(strong).toEqual(player === undefined ? [] : [{ text: player, style: 'strong' }]);
    });
  });
  it('a read that was not whole: the qualifier row is the first row', async () => {
    const broken = { ...finished, id: '43', status: { type: { name: 'STATUS_NEW', state: 'limbo' } } };
    const { rows } = await rowsFor(feed({ events: [finished, broken] }));
    expect(rows[0]!.role).toBe('qualifier');
    expect(joined(rows[0]!)).toContain('may be incomplete');
  });
  it.each([
    ['the window (an id not in the span)', () => feed(), '999'],
    ['an outage', () => feed({ fail: true }), MATCH_ID],
  ] as const)('an answer with no match (%s): every row role text, the lines unchanged', async (_label, adapter, id) => {
    const { rows, lines } = await rowsFor(adapter(), {}, id);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.role).toBe('text');
    expect(rows.map(joined)).toEqual(lines);
  });
  it('the market block rows are market, the market-incomplete note is note (text unchanged)', async () => {
    const NOW_WC = new Date('2026-06-11T20:00:00Z');
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
      updatedAt: NOW_WC.toISOString(),
    };
    const wc: ProviderAdapter = {
      name: 'espn',
      competition: 'fifa.world',
      capabilities: { push: false, latencyHintSec: 0 },
      fetchByDate: async () => [opener],
      fetchLive: async () => [opener],
      fetchWindow: async () => [opener],
    };
    const run = async (marketProvider: MarketProvider) => {
      writes = [];
      await cmdMatch('760415', { ...ctxFor(wc, { competition: 'fifa.world', json: true, markets: true }), now: NOW_WC, marketProvider });
      return (JSON.parse(stdout()) as { rows: Row[] }).rows;
    };
    const withSignal = await run(new FakeMarketProvider({ synthesize: true, now: NOW_WC }));
    const market = ofRole(withSignal, 'market');
    expect(market.length).toBeGreaterThan(0);
    expect(market.map(joined).join('\n')).toContain('Prediction markets');
    const dead = { name: 'dead', findSignal: async () => undefined, findSignals: async () => ({ results: new Map(), complete: false }) } as unknown as MarketProvider;
    const notes = ofRole(await run(dead), 'note');
    expect(notes.map(joined)).toContain('  Market data unavailable or incomplete — this match could not be checked.');
  });
  it('colour on: the score painted bold, the status token bold, the pinned side green; the visible text is the plain text', async () => {
    writes = [];
    await cmdMatch(MATCH_ID, ctxFor(feed(), { color: true, pin: PIN_NEW }));
    const painted = stdout();
    expect(painted).toContain(`${ESC}[1m2–2${ESC}[22m`);
    expect(painted).toContain(`${ESC}[1mFT${ESC}[22m`);
    expect(painted).toContain(`${ESC}[32mNewcastle United${ESC}[39m`);
    writes = [];
    await cmdMatch(MATCH_ID, ctxFor(feed(), { color: false, pin: PIN_NEW }));
    const plain = stdout();
    expect(visible(painted)).toBe(plain);
  });
  it('colour off (piped): no escape at all, the rows as plain text', async () => {
    writes = [];
    await cmdMatch(MATCH_ID, ctxFor(feed(), { color: false, pin: PIN_NEW, flavor: 'full' }));
    const plain = stdout();
    expect(plain).not.toContain(ESC);
    expect(plain).toContain(`  FT · Kickoff ${KICK_EN}`);
    expect(plain).toContain(ROWS_EN[0]!);
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
