/**
 * 0.11 PR 2.1d — the partial-read verdict on every surface; the omitted
 * counts everywhere.
 *
 * The verdict a read states about itself (`complete: false`, a count of the
 * provider records left out) reached `next`, `bracket` and the off-bundle
 * `match` in 2.1b and 2.1c. Here it reaches the live read, the dated read, the
 * bundled match read and the market reads, with two more honesties: a day's
 * attribution on a partial read says which displayed fixtures the overlay
 * served, and an EMPTY body on a partial read says nothing was READ, never
 * that nothing exists.
 *
 * The feed below files a fixture under its US/Eastern day and refuses ranges;
 * the World Cup's bundled fixtures are used by their real ids.
 */
import { describe, expect, it } from 'vitest';
import { EspnAdapter } from '../src/adapters/espn';
import { attachFetchMeta } from '../src/adapters/meta';
import type { ProviderAdapter } from '../src/adapters/types';
import { getLiveMatches, getLiveRead, getMatchById, getMatchesForDate, marketFixtureForTeam } from '../src/live';
import type { Match } from '../src/types';

const WC_SEASON = { year: 2026, startDate: '2026-06-11T04:00Z', endDate: '2026-12-31T04:59Z', displayName: '2026 FIFA World Cup' };
type Side = { id: string; abbr: string; name: string };
type Ev = { id: string; date: string; home: Side; away: Side; state?: 'pre' | 'in' | 'post'; raw?: Record<string, unknown> };
const MEX: Side = { id: '203', abbr: 'MEX', name: 'Mexico' };
const RSA: Side = { id: '467', abbr: 'RSA', name: 'South Africa' };
const KOR: Side = { id: '451', abbr: 'KOR', name: 'South Korea' };
const CZE: Side = { id: '478', abbr: 'CZE', name: 'Czechia' };
const CAN: Side = { id: '206', abbr: 'CAN', name: 'Canada' };
const BIH: Side = { id: '2452', abbr: 'BIH', name: 'Bosnia and Herzegovina' };
function event(e: Ev) {
  const state = e.state ?? 'pre';
  const type = state === 'in' ? { name: 'STATUS_IN_PROGRESS', state: 'in' } : state === 'post' ? { name: 'STATUS_FULL_TIME', state: 'post' } : { name: 'STATUS_SCHEDULED', state: 'pre' };
  const side = (s: Side, homeAway: string, score: string) => ({ homeAway, score, team: { id: s.id, abbreviation: s.abbr, displayName: s.name } });
  return { id: e.id, date: e.date, season: { slug: 'group-stage' }, status: { type, displayClock: state === 'in' ? "55'" : undefined, period: state === 'in' ? 2 : 0 }, competitions: [{ competitors: [side(e.home, 'home', '1'), side(e.away, 'away', '0')] }], ...e.raw };
}
/** The refused shape: a status the parser does not know. */
const REFUSED = { status: { type: { name: 'STATUS_NEW', state: 'limbo' } } };
const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const easternDay = (iso: string) => eastern.format(new Date(iso)).replace(/-/g, '');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
interface FeedOpts { events?: Ev[]; season?: unknown; fail?: (dates: string) => Response | undefined }
function feed(competition: string, opts: FeedOpts = {}) {
  const urls: string[] = [];
  const events = opts.events ?? [];
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('/standings')) return json({});
    const asked = new URL(url).searchParams.get('dates') ?? '';
    const failure = opts.fail?.(asked);
    if (failure) return failure;
    if (asked.includes('-')) return json({ code: 400 }, 400);
    const inBucket = (e: Ev) => (asked.length === 8 ? easternDay(e.date) === asked : asked.length === 6 ? easternDay(e.date).startsWith(asked) : false);
    return json({ leagues: [{ season: opts.season ?? WC_SEASON }], events: events.filter(inBucket).map(event) });
  }) as unknown as typeof fetch;
  return { adapter: new EspnAdapter({ competition, enrichGroups: false, fetchImpl }) as ProviderAdapter, urls };
}
/** The World Cup's opener (a real bundled id) and the next day's first match. */
const OPENER: Ev = { id: '760415', date: '2026-06-11T19:00Z', home: MEX, away: RSA };
const KOR_CZE: Ev = { id: '760414', date: '2026-06-12T02:00Z', home: KOR, away: CZE };
const OPENER_DAY = new Date('2026-06-11T20:00:00Z');

/** An adapter with no window: a single read whose account is what it says. */
function singleRead(matches: Match[], meta: { complete?: boolean; omitted?: number } | undefined): ProviderAdapter {
  const answer = meta ? attachFetchMeta(matches, meta) : matches;
  return {
    name: 'espn',
    competition: 'fifa.world',
    capabilities: { push: false, latencyHintSec: 0 },
    async fetchByDate() { return answer; },
    async fetchLive() { return answer; },
  };
}
const live = (id: string, kickoff: string): Match => ({
  id, stage: 'GROUP', kickoff, venue: 'Estadio Azteca', home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' }, away: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' },
  status: 'LIVE', minute: 55, score: { home: 1, away: 0 }, updatedAt: '2026-06-11T20:00Z',
});

describe('the live read states its verdict (0.11 2.1d)', () => {
  it('counted: a refused record beside a match in play', async () => {
    const f = feed('fifa.world', { events: [{ ...OPENER, state: 'in' }, { ...KOR_CZE, raw: REFUSED }] });
    const r = await getLiveMatches(f.adapter, OPENER_DAY);
    expect(r.degraded).toBe(false);
    expect(r.matches.map((m) => m.id)).toEqual(['760415']);
    expect(r.partial).toEqual({ omitted: 1 });
    expect(r.source).toBe('espn');
    // The refresher's read keeps its boolean too.
    const read = await getLiveRead(f.adapter, OPENER_DAY);
    expect(read.complete).toBe(false);
    expect(read.partial).toEqual({ omitted: 1 });
  });

  it('whole: no key; silent (an adapter that attaches no account): no key; failed: degraded, no key', async () => {
    const whole = await getLiveMatches(feed('fifa.world', { events: [{ ...OPENER, state: 'in' }] }).adapter, OPENER_DAY);
    expect(whole.partial).toBeUndefined();
    const silent = await getLiveMatches(singleRead([live('760415', '2026-06-11T19:00Z')], undefined), OPENER_DAY);
    expect(silent.matches).toHaveLength(1);
    expect(silent.partial).toBeUndefined();
    const failed = await getLiveMatches(feed('fifa.world', { events: [OPENER], fail: () => json({}, 503) }).adapter, OPENER_DAY);
    expect(failed.degraded).toBe(true);
    expect(failed.partial).toBeUndefined();
  });

  it('uncounted: a single read that came back not whole with no count states `partial: {}`', async () => {
    const r = await getLiveMatches(singleRead([live('760415', '2026-06-11T19:00Z')], { complete: false }), OPENER_DAY);
    expect(r.matches).toHaveLength(1);
    expect(r.partial).toEqual({});
  });

  it('the only in-play record refused beside a readable finished one: an empty body that is partial, not "none in play"', async () => {
    const r = await getLiveMatches(feed('fifa.world', { events: [{ ...OPENER, state: 'post' }, { ...KOR_CZE, state: 'in', raw: REFUSED }] }).adapter, OPENER_DAY);
    expect(r.matches).toEqual([]);
    expect(r.degraded).toBe(false);
    expect(r.partial).toEqual({ omitted: 1 });
  });
});

describe('the dated read states its verdict, whether it merged the skeleton, and what the overlay served (0.11 2.1d)', () => {
  it('on the bundle, this edition: the skeleton is merged (the day stays whole), the refused fixture shows without live state, `served` names the ids the overlay held', async () => {
    const f = feed('fifa.world', { events: [{ ...OPENER, raw: REFUSED }, { ...KOR_CZE, state: 'in' }] });
    const r = await getMatchesForDate(f.adapter, '2026-06-11', 'UTC');
    expect(r.degraded).toBe(false);
    expect(r.partial).toEqual({ omitted: 1 });
    expect(r.skeleton).toBe(true);
    expect(r.matches.find((m) => m.id === '760415')?.status).toBe('SCHEDULED'); // the bundle's row
    expect(r.matches.find((m) => m.id === '760414')?.status).toBe('LIVE');
    expect([...(r.served ?? [])].sort()).toEqual(['760414']);
    expect(r.source).toBe('espn');
  });

  it('a whole read: no verdict, `served` lists what the overlay held, the skeleton merged as today', async () => {
    const r = await getMatchesForDate(feed('fifa.world', { events: [OPENER] }).adapter, '2026-06-11', 'UTC');
    expect(r.partial).toBeUndefined();
    expect(r.skeleton).toBe(true);
    expect(r.served).toEqual(['760415']);
  });

  it('the bundle’s slug stating ANOTHER year: no skeleton (the result says so), a refused record is absent', async () => {
    const other = { ...WC_SEASON, year: 2022, displayName: '2022 FIFA World Cup' };
    const f = feed('fifa.world', { season: other, events: [{ ...OPENER, raw: REFUSED }, { ...KOR_CZE }] });
    const r = await getMatchesForDate(f.adapter, '2026-06-11', 'UTC');
    expect(r.skeleton).toBeUndefined();
    expect(r.matches.map((m) => m.id)).toEqual(['760414']);
    expect(r.partial).toEqual({ omitted: 1 });
  });

  it('off the bundle: no skeleton, the refused record absent, the verdict stated', async () => {
    const S = { year: 2026, displayName: '2026-27 English Premier League', startDate: '2026-08-01T04:00Z', endDate: '2027-06-01T03:59Z' };
    const ARS: Side = { id: '359', abbr: 'ARS', name: 'Arsenal' }; const CHE: Side = { id: '363', abbr: 'CHE', name: 'Chelsea' };
    // The readable record on the adjacent day keeps the window a PARTIAL read (a window whose only record is
    // refused is a failed read); the dated read returns the window's records, the surface files them by day.
    const f = feed('eng.1', { season: S, events: [{ id: '41', date: '2026-10-17T14:00Z', home: ARS, away: CHE, raw: REFUSED }, { id: '42', date: '2026-10-18T14:00Z', home: CHE, away: ARS }] });
    const r = await getMatchesForDate(f.adapter, '2026-10-17', 'UTC');
    expect(r.skeleton).toBeUndefined();
    expect(r.matches.map((m) => m.id)).toEqual(['42']);
    expect(r.partial).toEqual({ omitted: 1 });
    expect(r.degraded).toBe(false);
  });
});

describe('the bundled match read states its verdict; attribution unchanged (0.11 2.1d)', () => {
  it('a refused sibling in the match’s window: the match with partial, attributed because the read held it', async () => {
    const f = feed('fifa.world', { events: [{ ...OPENER, state: 'in' }, { ...KOR_CZE, raw: REFUSED }] });
    const r = await getMatchById(f.adapter, '760415');
    expect(r.match?.status).toBe('LIVE');
    expect(r.source).toBe('espn');
    expect(r.partial).toEqual({ omitted: 1 });
  });

  it('the match itself refused: the bundle’s row, no attribution, partial', async () => {
    const f = feed('fifa.world', { events: [{ ...OPENER, raw: REFUSED }, { ...KOR_CZE }] });
    const r = await getMatchById(f.adapter, '760415');
    expect(r.match?.id).toBe('760415');
    expect(r.source).toBeUndefined();
    expect(r.degraded).toBe(false);
    expect(r.partial).toEqual({ omitted: 1 });
  });
});

describe('the market fixture read keeps both accounts (0.11 2.1d)', () => {
  // The knockout window (two months) and the candidate's own day are two reads; the verdict is theirs together.
  // The own-day refresh is made only for a candidate IN PLAY, so the clock sits inside the final.
  const KO_NOW = new Date('2026-07-19T19:30:00Z');
  const FINAL: Ev = { id: '760517', date: '2026-07-19T19:00Z', home: { id: '164', abbr: 'ESP', name: 'Spain' }, away: { id: '202', abbr: 'ARG', name: 'Argentina' } };
  const broken = (id: string, date: string): Ev => ({ id, date, home: CAN, away: BIH, raw: REFUSED });

  it('a refused record in the knockout window: partial with its count on the answer', async () => {
    const f = feed('fifa.world', { events: [FINAL, broken('760516', '2026-07-18T19:00Z')] });
    const r = await marketFixtureForTeam(f.adapter, 'ESP', KO_NOW);
    expect(r.match?.id).toBe('760517');
    expect(r.partial).toEqual({ omitted: 2 }); // the month's refused record, and the day refresh's (the same record on Jul 18)
  });

  it('whole reads: no key; a refused record only in the candidate’s day: partial', async () => {
    const whole = await marketFixtureForTeam(feed('fifa.world', { events: [FINAL] }).adapter, 'ESP', KO_NOW);
    expect(whole.partial).toBeUndefined();
    const f = feed('fifa.world', {
      events: [FINAL],
      fail: (d) => (d === '20260719' ? json({ leagues: [{ season: WC_SEASON }], events: [event(FINAL), event(broken('760599', '2026-07-19T15:00Z'))] }) : undefined),
    });
    const r = await marketFixtureForTeam(f.adapter, 'ESP', KO_NOW);
    expect(r.match?.id).toBe('760517');
    expect(r.partial).toEqual({ omitted: 1 });
  });
});
