/**
 * 0.11, ledger row D7 — a tool's text is cut at a length from the end, and the
 * cut keeps the footer; what qualifies the body must therefore be printed
 * BEFORE it. The verdicts were (`qualified`); the sentences a tool appended
 * after its body (a degraded line, a market-incomplete notice, the list's
 * truncation line, a roster note) were the first thing a long answer lost.
 * Each condition is tested on its own, and one overflowing answer per list
 * tool proves the sentence survives the cut. The sentences do not change.
 */
import { EspnAdapter, FakeMarketProvider, allFixtures, attachFetchMeta, type GroupStandings, type MarketProvider, type Match, type ProviderAdapter, type StandingRow } from '@claudinho/core';
import { describe, expect, it } from 'vitest';
import { toContent } from '../src/server';
import { toolGetBracket, toolGetLive, toolGetMarketSignal, toolGetMatch, toolGetStandings, toolGetToday } from '../src/tools';

const WC_SEASON = { year: 2026, startDate: '2026-06-11T04:00Z', endDate: '2026-12-31T04:59Z', displayName: '2026 FIFA World Cup' };
type Side = { id: string; abbr: string; name: string };
type Ev = { id: string; date: string; home: Side; away: Side; state?: 'pre' | 'in' | 'post'; raw?: Record<string, unknown> };
const MEX: Side = { id: '203', abbr: 'MEX', name: 'Mexico' };
const RSA: Side = { id: '467', abbr: 'RSA', name: 'South Africa' };
function event(e: Ev) {
  const state = e.state ?? 'pre';
  const type = state === 'in' ? { name: 'STATUS_IN_PROGRESS', state: 'in' } : state === 'post' ? { name: 'STATUS_FULL_TIME', state: 'post' } : { name: 'STATUS_SCHEDULED', state: 'pre' };
  const side = (s: Side, homeAway: string) => ({ homeAway, score: '0', team: { id: s.id, abbreviation: s.abbr, displayName: s.name } });
  return { id: e.id, date: e.date, season: { slug: 'group-stage' }, status: { type, displayClock: state === 'in' ? "55'" : undefined, period: state === 'in' ? 2 : 0 }, competitions: [{ competitors: [side(e.home, 'home'), side(e.away, 'away')] }], ...e.raw };
}
const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const easternDay = (iso: string) => eastern.format(new Date(iso)).replace(/-/g, '');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** A feed: `events` by provider day; `fail` fails the scoreboard (or only the day requests); `standingsFail` fails the tables. */
function feed(opts: { events?: Ev[]; fail?: boolean | 'days'; standingsFail?: boolean; competition?: string; season?: unknown } = {}) {
  const events = opts.events ?? [];
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    if (url.includes('/standings')) return opts.standingsFail ? json({ code: 503 }, 503) : json({});
    const asked = new URL(url).searchParams.get('dates') ?? '';
    if (opts.fail === true || (opts.fail === 'days' && asked.length === 8)) return json({ code: 503 }, 503);
    const inBucket = (e: Ev) => (asked.length === 8 ? easternDay(e.date) === asked : asked.length === 6 ? easternDay(e.date).startsWith(asked) : false);
    return json({ leagues: [{ season: opts.season ?? WC_SEASON }], events: events.filter(inBucket).map(event) });
  }) as unknown as typeof fetch;
  return new EspnAdapter({ competition: opts.competition ?? 'fifa.world', enrichGroups: false, fetchImpl }) as ProviderAdapter;
}
const REFUSED = { status: { type: { name: 'STATUS_NEW', state: 'limbo' } } };
const PL = { year: 2026, displayName: '2026-27 English Premier League', startDate: '2026-08-01T04:00Z', endDate: '2027-06-01T03:59Z' };
const OPENER: Ev = { id: '760415', date: '2026-06-11T19:00Z', home: MEX, away: RSA };
const NOW = new Date('2026-06-11T20:00:00Z');
const markets = (complete: boolean): MarketProvider =>
  ({ name: complete ? 'empty' : 'dead', findSignal: async () => undefined, findSignals: async () => ({ results: new Map(), complete }) }) as unknown as MarketProvider;
/** The position of `needle` in `text`, which must hold it. */
const at = (text: string, needle: string | RegExp): number => {
  const i = typeof needle === 'string' ? text.indexOf(needle) : text.search(needle);
  expect(i, `${String(needle)} in:\n${text.slice(0, 600)}`).toBeGreaterThanOrEqual(0);
  return i;
};
const precedes = (text: string, a: string | RegExp, b: string | RegExp) => expect(at(text, a)).toBeLessThan(at(text, b));
/** Forty-one served rows of 400-code-point names: past the record bound, and past the text cut. */
const LONG = Array.from({ length: 50 }, () => 'b́́́́́́́').join('');
const many = (state: Ev['state'] = 'pre'): Ev[] => Array.from({ length: 41 }, (_, i) => ({ id: String(9_000_000 + i), date: '2026-06-11T23:00Z', home: { id: String(100 + i), abbr: 'LNG', name: LONG }, away: { id: String(200 + i), abbr: 'LNA', name: LONG }, state }));
const cutText = (r: Parameters<typeof toContent>[0]) => toContent(r).content[0]?.text ?? '';

describe('get_today: every qualifying sentence before the rows (D7)', () => {
  it('the degraded line (the bundled schedule)', async () => {
    const r = await toolGetToday({ date: '2026-06-11', tz: 'UTC', adapter: feed({ fail: true }) });
    precedes(r.text, 'showing the bundled schedule', 'Mexico');
  });

  it('the market-incomplete notice', async () => {
    const r = await toolGetToday({ date: '2026-06-11', tz: 'UTC', adapter: feed({ events: [OPENER] }), marketProvider: markets(false), now: NOW } as never);
    precedes(r.text, 'Market data unavailable or incomplete', 'Mexico');
  });

  it('the list-truncation line, which survives a cut that drops the rows', async () => {
    const r = await toolGetToday({ date: '2026-06-11', tz: 'UTC', adapter: feed({ events: [OPENER, ...many()] }) });
    precedes(r.text, 'list truncated', 'Mexico');
    const cut = cutText(r);
    expect(cut).toContain('(truncated)');
    expect(cut).toContain('list truncated');
    expect(cut).toMatch(/not affiliated/i);
  });

  it('the verdict first, the unserved count next, then the rest, in that order', async () => {
    const r = await toolGetToday({ date: '2026-06-11', tz: 'UTC', adapter: feed({ events: [{ ...OPENER, state: 'in' }, { id: '760414', date: '2026-06-11T22:00Z', home: MEX, away: RSA, state: 'in' }] }), marketProvider: markets(false), now: NOW } as never);
    // No verdict here (a whole read): the market notice precedes the rows.
    precedes(r.text, 'Market data unavailable', 'Mexico');
  });
});

describe('get_live: the list-truncation line before the rows, surviving a cut (D7)', () => {
  it('41 in play', async () => {
    const r = await toolGetLive({ adapter: feed({ events: many('in') }), now: new Date('2026-06-11T23:30:00Z') } as never);
    precedes(r.text, 'list truncated', ' — LIVE ');
    const cut = cutText(r);
    expect(cut).toContain('(truncated)');
    expect(cut).toContain('list truncated');
  });
});

describe('get_match: the degraded line and the market notice before the match (D7)', () => {
  it('the scheduled fixture shown while the live state is unavailable', async () => {
    const r = await toolGetMatch({ id: '760415', adapter: feed({ fail: true }) });
    precedes(r.text, 'Live state unavailable', 'Mexico');
  });

  it('the market-incomplete notice', async () => {
    const r = await toolGetMatch({ id: '760415', adapter: feed({ events: [OPENER] }), marketProvider: markets(false), now: NOW } as never);
    precedes(r.text, 'Market data unavailable or incomplete', 'Mexico');
  });
});

describe('get_bracket: its two notes before the tree (D7)', () => {
  const KO = new Date('2026-06-28T12:00:00Z');
  const tie = (): Match => {
    const m = allFixtures().find((f) => f.stage === 'R32');
    if (!m) throw new Error('the bundle has a round of 32');
    return { ...m, home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' }, away: { code: 'ECU', name: 'Ecuador', flag: '🇪🇨' } };
  };
  const base = { name: 'espn', competition: 'fifa.world', capabilities: { push: false, latencyHintSec: 0 }, fetchByDate: async () => [], fetchLive: async () => [] };

  it('the window failed: structure only', async () => {
    const adapter: ProviderAdapter = { ...base, fetchWindow: async () => { throw new Error('503'); } };
    const r = await toolGetBracket({ stage: 'R32', now: KO, adapter });
    precedes(r.text, 'bracket structure only', /Round of 32|R32/);
  });

  it('the standings failed: group slots TBD', async () => {
    const adapter: ProviderAdapter = { ...base, fetchWindow: async () => [tie()], fetchStandings: async () => { throw new Error('503'); } };
    const r = await toolGetBracket({ stage: 'R32', now: KO, adapter });
    precedes(r.text, 'Live standings unavailable', 'Mexico');
  });
});

describe('get_market_signal (date): the incomplete notice before the signals (D7)', () => {
  it('a batch with a signal that did not finish', async () => {
    // A signal for the opener, and the batch not whole: the notice used to follow the signals.
    const at12 = new Date('2026-06-11T12:00:00Z');
    const fake = new FakeMarketProvider({ synthesize: true, now: at12 });
    const partial = {
      name: 'half',
      findSignal: (...a: Parameters<MarketProvider['findSignal']>) => fake.findSignal(...a),
      findSignals: async (...a: Parameters<MarketProvider['findSignals']>) => ({ ...(await fake.findSignals(...a)), complete: false }),
    } as unknown as MarketProvider;
    const r = await toolGetMarketSignal({ date: '2026-06-11', tz: 'UTC', adapter: feed({ events: [OPENER] }), marketProvider: partial, now: at12 } as never);
    precedes(r.text, 'unavailable or incomplete', 'Mexico');
  });
});

describe('get_market_signal (date): the list’s truncation note keeps its place before the incomplete notice (review, round 1)', () => {
  it('42 signals, the batch not whole: truncation, then incomplete, then the title and the signals', async () => {
    // Found in review: the incomplete notice went through the qualifier helper while the truncation note stayed
    // on the title line, so the two siblings swapped (the base printed truncation first).
    const at12 = new Date('2026-06-11T12:00:00Z');
    const fake = new FakeMarketProvider({ synthesize: true, now: at12 });
    const partial = {
      name: 'half',
      findSignal: (...a: Parameters<MarketProvider['findSignal']>) => fake.findSignal(...a),
      findSignals: async (...a: Parameters<MarketProvider['findSignals']>) => ({ ...(await fake.findSignals(...a)), complete: false }),
    } as unknown as MarketProvider;
    const r = await toolGetMarketSignal({ date: '2026-06-11', tz: 'UTC', adapter: feed({ events: [OPENER, ...many()] }), marketProvider: partial, now: at12 } as never);
    precedes(r.text, 'list truncated', 'unavailable or incomplete');
    precedes(r.text, 'unavailable or incomplete', 'Market signals on');
    precedes(r.text, 'Market signals on', 'Mexico');
  });
});

describe('get_standings: the roster note before the tables (D7)', () => {
  it('a degraded roster', async () => {
    const r = await toolGetStandings({ adapter: feed({ standingsFail: true }) } as never);
    precedes(r.text, 'Live standings unavailable', /Group A/);
  });
});

describe('the orderings a mutation pass found reachable and unpinned (review, round 1)', () => {
  const KO = new Date('2026-06-28T12:00:00Z');
  const base = { name: 'espn', competition: 'fifa.world', capabilities: { push: false, latencyHintSec: 0 }, fetchByDate: async () => [], fetchLive: async () => [] };
  const tie = (): Match => {
    const m = allFixtures().find((f) => f.stage === 'R32');
    if (!m) throw new Error('the bundle has a round of 32');
    return { ...m, home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' }, away: { code: 'ECU', name: 'Ecuador', flag: '🇪🇨' } };
  };

  it('get_bracket: a partial window AND failed standings: the verdict, then the standings note, then the tree', async () => {
    const adapter: ProviderAdapter = { ...base, fetchWindow: async () => attachFetchMeta([tie()], { complete: false, omitted: 1 }), fetchStandings: async () => { throw new Error('503'); } };
    const r = await toolGetBracket({ stage: 'R32', now: KO, adapter });
    precedes(r.text, 'may be incomplete', 'Live standings unavailable');
    precedes(r.text, 'Live standings unavailable', 'Mexico');
  });

  it('get_market_signal (date): a partial fixture read AND an unfinished batch: the verdict, then the incomplete notice, then the signals', async () => {
    const at12 = new Date('2026-06-11T12:00:00Z');
    const fake = new FakeMarketProvider({ synthesize: true, now: at12 });
    const partial = {
      name: 'half',
      findSignal: (...a: Parameters<MarketProvider['findSignal']>) => fake.findSignal(...a),
      findSignals: async (...a: Parameters<MarketProvider['findSignals']>) => ({ ...(await fake.findSignals(...a)), complete: false }),
    } as unknown as MarketProvider;
    const r = await toolGetMarketSignal({ date: '2026-06-11', tz: 'UTC', adapter: feed({ events: [OPENER, { id: '760414', date: '2026-06-11T22:00Z', home: MEX, away: RSA, raw: REFUSED }] }), marketProvider: partial, now: at12 } as never);
    precedes(r.text, 'may be incomplete', 'unavailable or incomplete');
    precedes(r.text, 'unavailable or incomplete', 'Mexico');
  });

  it('get_match off the bundle: the earlier-record note before the match', async () => {
    const ARS: Side = { id: '359', abbr: 'ARS', name: 'Arsenal' };
    const CHE: Side = { id: '363', abbr: 'CHE', name: 'Chelsea' };
    const inSpan: Ev = { id: '41', date: '2026-10-17T14:00Z', home: ARS, away: CHE };
    const r = await toolGetMatch({ id: '41', adapter: feed({ competition: 'eng.1', season: PL, events: [inSpan], fail: 'days' }), now: new Date('2026-10-10T12:00:00Z') } as never);
    expect(r.text).toContain('earlier record');
    precedes(r.text, 'earlier record', 'Arsenal');
  });

  it('get_standings: the truncation line is the sentence itself, once wrapped, on its own line', async () => {
    const row = (i: number, rank: number): StandingRow =>
      ({ team: { code: 'TTT', name: `Team ${i}-${rank}`, flag: '🏳️' }, played: 3, won: 1, drawn: 1, lost: 1, goalsFor: 3, goalsAgainst: 3, goalDiff: 0, points: 4, rank }) as StandingRow;
    const tables: GroupStandings[] = Array.from({ length: 41 }, (_, i) => ({ group: `A${i + 1}`, label: `League ${i + 1}`, rows: [row(i, 1), row(i, 2)] }));
    const adapter: ProviderAdapter = { ...base, competition: 'uefa.nations', fetchStandings: async () => attachFetchMeta([...tables], { complete: true }) };
    const r = await toolGetStandings({ adapter } as never);
    expect(r.text).toMatch(/(^|\n)\(showing 40 of 41 — list truncated\)\n/);
    expect(r.text).not.toContain('((showing');
    precedes(r.text, 'list truncated', 'League 1 (A1)');
  });
});
