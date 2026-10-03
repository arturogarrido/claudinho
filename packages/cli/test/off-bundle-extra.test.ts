/**
 * 0.11 PR 2.1c, added by the coder beside the specification
 * (`off-bundle-surfaces.test.ts`, whose harness this copies): cases its
 * mutation pass showed no test could see. A Libertadores table is named
 * `Group <letter>` here, as the provider names it: a competition the product
 * reads as GROUPS refuses a child named anything else.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EspnAdapter, type ProviderAdapter } from '@claudinho/core';
import { cmdMatch, cmdNext, cmdShare } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';

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

function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return { lang: 'en', tz: 'UTC', json: false, color: false, source: 'espn', competition: 'eng.1', flavor: 'off', markets: false, ...over };
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
const text = () => writes.join('');
const parsed = () => JSON.parse(text()) as Record<string, unknown>;

const LIB = table('Group A', [CARABOBO, ALWAYS_READY]);
const libSeason = () => ({ year: 2026, displayName: '2026 Copa Libertadores', endDate: '2026-11-30T05:00Z' });

describe('next <code> shared by two clubs, against a table read whole', () => {
  const events: Ev[] = [{ id: '20', date: '2026-10-12T22:00Z', home: ALWAYS_READY, away: { id: '7003', abbr: 'BOC', name: 'Boca Juniors' } }];

  it('the candidates are named in text, carried in --json; no fixture is picked', async () => {
    await cmdNext('CAR', ctxFor(feed('conmebol.libertadores', { events, standings: LIB, season: libSeason }).adapter));
    expect(text()).toContain('Carabobo (CAR)');
    expect(text()).toContain('Always Ready (CAR)');
    expect(text()).not.toContain('Boca');
    writes = [];
    await cmdNext('CAR', ctxFor(feed('conmebol.libertadores', { events, standings: LIB, season: libSeason }).adapter, { json: true }));
    const j = parsed();
    expect(j.fixture).toBeNull();
    expect((j.candidates as Array<{ name: string }>).map((c) => c.name).sort()).toEqual(['Always Ready', 'Carabobo']);
  });
});

describe('the next card titles the resolved club by identity, home or away', () => {
  it('`share next "Always Ready"`: the home side is the club asked for', async () => {
    const events: Ev[] = [{ id: '21', date: '2026-10-15T22:00Z', home: ALWAYS_READY, away: CARABOBO }];
    await cmdShare('next', 'Always Ready', {}, ctxFor(feed('conmebol.libertadores', { events, standings: LIB, season: libSeason }).adapter));
    expect(text()).toContain('Next up for Always Ready');
    // A club's name is quoted in the run cue (it has a space).
    expect(text()).toContain('npx @claudinho/cli next "Always Ready"');
  });
});

describe('match <id>: an outage is never "no such match"', () => {
  it('`share <id>` with discovery down: the card says it could not ask', async () => {
    await cmdShare('41', undefined, {}, ctxFor(feed('eng.1', { fail: () => json({}, 503) }).adapter));
    expect(text()).toContain("Couldn't reach the data provider");
    expect(text()).not.toContain('No match found');
  });

  it('a found match whose refresh failed: `--json` keeps the record, attributed, degraded', async () => {
    const inSpan: Ev = { id: '41', date: '2026-10-17T14:00Z', home: LIV, away: ARS };
    await cmdMatch('41', ctxFor(feed('eng.1', { events: [inSpan], fail: (d) => (d.length === 8 ? json({}, 503) : undefined) }).adapter, { json: true }));
    expect(parsed()).toMatchObject({ degraded: true, match: { id: '41' }, source: 'espn' });
  });
});
