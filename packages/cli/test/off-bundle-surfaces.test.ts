/**
 * 0.11 PR 2.1c — the CLI surfaces off the bundle: `next <club>`, `match <id>`,
 * `bracket`, `today`, `live`, their share cards, text and `--json`.
 *
 * Every answer here is one the base refuses ("not available for this
 * competition yet") or does not know how to say (between editions, the horizon,
 * the window, "no bracket"). The adapter is the real one over a fake feed that
 * files a fixture under its US/Eastern day, serves one league table with the
 * teams' ids, and refuses ranges.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EspnAdapter, type ProviderAdapter } from '@claudinho/core';
import { cmdBracket, cmdLive, cmdMarkets, cmdMatch, cmdNext, cmdShare, cmdToday } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';

const STATS = ['gamesPlayed', 'wins', 'ties', 'losses', 'pointsFor', 'pointsAgainst', 'pointDifferential', 'points', 'rank'];
const NOW = new Date('2026-10-10T15:00:00.000Z');
type Season = { year: number; displayName: string; startDate?: string; endDate?: string };
const S2026: Season = { year: 2026, displayName: '2026-27 English Premier League', startDate: '2026-08-01T04:00Z', endDate: '2027-05-30T03:59Z' };
const ENDED: Season = { year: 2026, displayName: '2026 Concacaf Champions Cup', startDate: '2026-02-01T05:00Z', endDate: '2026-10-09T03:59Z' };
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
const NO_TABLE = { name: 'Concacaf Champions Cup', season: { year: 2026 }, seasons: [{ year: 2016 }] };
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

const upcoming: Ev[] = [
  { id: '11', date: '2026-10-17T14:00Z', home: LIV, away: ARS },
  { id: '13', date: '2026-10-11T15:00Z', home: CHE, away: LIV },
];
const NOT_YET = 'Not available for this competition yet';

describe('next <club> off the bundle (0.11 2.1c)', () => {
  it('by code and by name: the fixture, attributed; `--json` carries the resolved team', async () => {
    for (const q of ['ARS', 'Arsenal']) {
      writes = [];
      await cmdNext(q, ctxFor(feed('eng.1', { events: upcoming }).adapter));
      const t = text();
      expect(t, q).toContain('Liverpool');
      expect(t, q).not.toContain(NOT_YET);
      expect(t, q).toContain('ESPN');
    }
    writes = [];
    await cmdNext('Arsenal', ctxFor(feed('eng.1', { events: upcoming }).adapter, { json: true }));
    const j = parsed();
    expect(j).toMatchObject({ degraded: false, fixture: { id: '11' }, team: { id: 'espn:359', code: 'ARS', name: 'Arsenal' } });
    expect(j.unsupported).toBeUndefined();
  });

  it('the header and the horizon sentence name the resolved club, not the query or the code; a club in play has its score and no countdown', async () => {
    await cmdNext('arsen', ctxFor(feed('eng.1', { events: upcoming }).adapter));
    expect(text()).toContain('Next up for Arsenal');
    expect(text()).not.toMatch(/for (arsen|ARSEN|ARS)\b/);
    writes = [];
    await cmdNext('arsen', ctxFor(feed('eng.1', { events: [upcoming[1] as Ev] }).adapter));
    const t = text();
    expect(t).toContain('Arsenal within the next 14 days');
    expect(t).not.toMatch(/(arsen|ARSEN|ARS) within/);
    writes = [];
    const live: Ev = { id: '14', date: '2026-10-10T14:30Z', home: ARS, away: CHE, state: 'in' };
    await cmdNext('Arsenal', ctxFor(feed('eng.1', { events: [live, ...upcoming] }).adapter));
    const u = text();
    expect(u).toContain('1–0');
    expect(u).not.toMatch(/\bin \d+[dhm]/);
  });

  it('two clubs with one code: the candidates are listed and no fixture is picked; `--json` carries them', async () => {
    const LIB = table('Group A', [CARABOBO, ALWAYS_READY]);
    const events: Ev[] = [{ id: '20', date: '2026-10-12T22:00Z', home: ALWAYS_READY, away: { id: '7003', abbr: 'BOC', name: 'Boca Juniors' } }];
    const season = () => ({ year: 2026, displayName: '2026 Copa Libertadores', endDate: '2026-11-30T05:00Z' });
    await cmdNext('CAR', ctxFor(feed('conmebol.libertadores', { events, standings: LIB, season }).adapter));
    const t = text();
    expect(t).toContain('Carabobo');
    expect(t).toContain('Always Ready');
    expect(t).not.toContain('Boca');
    writes = [];
    await cmdNext('CAR', ctxFor(feed('conmebol.libertadores', { events, standings: LIB, season }).adapter, { json: true }));
    const j = parsed();
    expect(j.fixture).toBeNull();
    expect((j.candidates as Array<{ name: string }>).map((c) => c.name).sort()).toEqual(['Always Ready', 'Carabobo']);
  });

  it('an unknown name with a complete roster: "no team called", the key in `--json`', async () => {
    await cmdNext('Everton', ctxFor(feed('eng.1', { events: upcoming }).adapter));
    expect(text()).toContain('No team called');
    expect(text()).toContain('Everton');
    writes = [];
    await cmdNext('Everton', ctxFor(feed('eng.1', { events: upcoming }).adapter, { json: true }));
    expect(parsed()).toMatchObject({ unknownTeam: true, fixture: null });
  });

  it('the share cards’ run cue carries the competition off the bundle (review round 2)', async () => {
    await cmdShare('next', 'Arsenal', {}, ctxFor(feed('eng.1', { events: upcoming }).adapter));
    expect(text()).toMatch(/CLAUDINHO_COMPETITION=eng\.1 npx @claudinho\/cli next/);
    writes = [];
    await cmdShare('41', undefined, {}, ctxFor(feed('eng.1', { events: [{ id: '41', date: '2026-10-17T14:00Z', home: LIV, away: ARS }] }).adapter));
    expect(text()).toMatch(/CLAUDINHO_COMPETITION=eng\.1 npx @claudinho\/cli match 41/);
    writes = [];
    await cmdShare('live', undefined, {}, ctxFor(feed('eng.1', { events: upcoming }).adapter));
    expect(text()).toMatch(/CLAUDINHO_COMPETITION=eng\.1 npx @claudinho\/cli live/);
  });

  it('a roster that could not be read whole is its own sentence, not an outage; a code hit then needs the full name (review round 2)', async () => {
    await cmdNext('ARS', ctxFor(feed('eng.1', { events: upcoming, standings: () => json({}, 503) }).adapter));
    expect(text()).not.toContain('reach the data provider');
    expect(text()).toMatch(/roster/i);
    writes = [];
    await cmdNext('ARS', ctxFor(feed('eng.1', { events: upcoming, standings: () => json({}, 503) }).adapter, { json: true }));
    expect(parsed()).toMatchObject({ rosterIncomplete: true, degraded: false, fixture: null });
    writes = [];
    await cmdNext('Arsenal', ctxFor(feed('eng.1', { events: upcoming, standings: () => json({}, 503) }).adapter));
    expect(text()).toContain('Liverpool');
  });

  it('the between-editions sentence prints the provider’s end day (review round 2)', async () => {
    const cupAdapter = feed('concacaf.champions', { standings: NO_TABLE, season: () => ENDED }).adapter;
    await cmdLive(ctxFor(cupAdapter, { tz: 'America/New_York' }));
    expect(text()).toContain('ended on 2026-10-08');
    expect(text()).not.toContain('2026-10-09');
  });

  it('a known club with nothing in a whole span: the horizon sentence names the days; `--json` carries `horizon`, never a verdict', async () => {
    await cmdNext('Arsenal', ctxFor(feed('eng.1', { events: [upcoming[1] as Ev] }).adapter));
    expect(text()).toContain('14 days');
    expect(text()).toContain('Arsenal');
    expect(text()).not.toContain('No team called');
    writes = [];
    await cmdNext('Arsenal', ctxFor(feed('eng.1', { events: [upcoming[1] as Ev] }).adapter, { json: true }));
    expect(parsed()).toMatchObject({ fixture: null, horizon: { days: 14 }, degraded: false });
    expect(parsed().unknownTeam).toBeUndefined();
  });

  it('an incomplete discovery: the partial sentence beside the fixture, or beside an empty body with no horizon sentence', async () => {
    const broken: Ev = { id: '16', date: '2026-10-14T19:00Z', home: CHE, away: LIV, raw: { status: { type: { name: 'STATUS_NEW', state: 'limbo' } } } };
    await cmdNext('Arsenal', ctxFor(feed('eng.1', { events: [broken, upcoming[0] as Ev] }).adapter));
    expect(text()).toContain('Liverpool');
    expect(text()).toContain('may be incomplete');
    writes = [];
    await cmdNext('Arsenal', ctxFor(feed('eng.1', { events: [broken, upcoming[1] as Ev] }).adapter));
    expect(text()).toContain('may be incomplete');
    expect(text()).not.toContain('14 days');
    writes = [];
    await cmdNext('Arsenal', ctxFor(feed('eng.1', { events: [broken, upcoming[1] as Ev] }).adapter, { json: true }));
    expect(parsed()).toMatchObject({ fixture: null, partial: { omitted: 1 } });
    expect(parsed().horizon).toBeUndefined();
  });

  it('a failed discovery is the degraded sentence, never "no fixture"', async () => {
    await cmdNext('Arsenal', ctxFor(feed('eng.1', { events: upcoming, fail: () => json({}, 503) }).adapter));
    expect(text()).not.toContain('14 days');
    expect(text()).not.toContain('No team called');
    writes = [];
    await cmdNext('Arsenal', ctxFor(feed('eng.1', { events: upcoming, fail: () => json({}, 503) }).adapter, { json: true }));
    expect(parsed()).toMatchObject({ degraded: true, fixture: null });
  });

  it('the sentences are localized (es, pt, fr): the horizon and "no team called"', async () => {
    for (const lang of ['es', 'pt', 'fr'] as const) {
      writes = [];
      await cmdNext('Arsenal', ctxFor(feed('eng.1', { events: [upcoming[1] as Ev] }).adapter, { lang }));
      expect(text(), lang).not.toContain('within the next 14 days');
      expect(text(), lang).toContain('14');
      writes = [];
      await cmdNext('Everton', ctxFor(feed('eng.1', { events: upcoming }).adapter, { lang }));
      expect(text(), lang).not.toContain('No team called');
      expect(text(), lang).toContain('Everton');
    }
  });

  it('an incomplete empty `next`: the "none read" sentence, never "no upcoming fixture" (review round 1)', async () => {
    const broken: Ev = { id: '16', date: '2026-10-14T19:00Z', home: CHE, away: LIV, raw: { status: { type: { name: 'STATUS_NEW', state: 'limbo' } } } };
    await cmdNext('Arsenal', ctxFor(feed('eng.1', { events: [broken, upcoming[1] as Ev] }).adapter));
    expect(text()).toContain('may be incomplete');
    expect(text()).not.toContain('No upcoming fixture');
    expect(text()).toContain('Arsenal');
    writes = [];
    await cmdShare('next', 'Arsenal', {}, ctxFor(feed('eng.1', { events: [broken, upcoming[1] as Ev] }).adapter));
    expect(text()).toContain('may be incomplete');
    expect(text()).not.toContain('No upcoming fixture');
  });

  it('`share next` carries the resolved team and the candidates in `--json` (review round 1)', async () => {
    await cmdShare('next', 'arsen', {}, ctxFor(feed('eng.1', { events: [upcoming[1] as Ev] }).adapter, { json: true }));
    expect(parsed()).toMatchObject({ team: { id: 'espn:359', name: 'Arsenal' }, horizon: { days: 14 } });
    const LIB = table('Group A', [CARABOBO, ALWAYS_READY]);
    const events: Ev[] = [{ id: '20', date: '2026-10-12T22:00Z', home: ALWAYS_READY, away: { id: '7003', abbr: 'BOC', name: 'Boca Juniors' } }];
    const season = () => ({ year: 2026, displayName: '2026 Copa Libertadores', endDate: '2026-11-30T05:00Z' });
    writes = [];
    await cmdShare('next', 'CAR', {}, ctxFor(feed('conmebol.libertadores', { events, standings: LIB, season }).adapter, { json: true }));
    expect((parsed().candidates as Array<{ name: string }>).map((c) => c.name).sort()).toEqual(['Always Ready', 'Carabobo']);
    expect((parsed().matches as unknown[]).length).toBe(0);
  });

  it('`share next <name>`: the card titles the resolved side and carries the key in `--json`', async () => {
    const LIB = table('Group A', [CARABOBO, ALWAYS_READY]);
    // Carabobo at HOME: a card that labels the side by code (the query is a name, not a code) would title Always Ready.
    const events: Ev[] = [{ id: '21', date: '2026-10-15T22:00Z', home: CARABOBO, away: ALWAYS_READY }];
    const season = () => ({ year: 2026, displayName: '2026 Copa Libertadores', endDate: '2026-11-30T05:00Z' });
    await cmdShare('next', 'Carabobo', {}, ctxFor(feed('conmebol.libertadores', { events, standings: LIB, season }).adapter));
    const t = text();
    expect(t).toContain('Next up for Carabobo');
    expect(t).not.toContain('Next up for Always Ready');
    writes = [];
    await cmdShare('next', 'Arsenal', {}, ctxFor(feed('eng.1', { events: [upcoming[1] as Ev] }).adapter));
    expect(text()).toContain('14 days');
    writes = [];
    await cmdShare('next', 'Arsenal', {}, ctxFor(feed('eng.1', { events: [upcoming[1] as Ev] }).adapter, { json: true }));
    expect(parsed()).toMatchObject({ horizon: { days: 14 } });
  });
});

describe('match <id> off the bundle (0.11 2.1c)', () => {
  const inSpan: Ev = { id: '41', date: '2026-10-17T14:00Z', home: LIV, away: ARS };
  const other: Ev = { id: '42', date: '2026-10-11T15:00Z', home: CHE, away: LIV };

  it('found, the refresh not whole: the partial sentence beside the record, text and `--json` (review round 2)', async () => {
    const broken: Ev = { id: '43', date: '2026-10-17T16:00Z', home: CHE, away: { id: '4501', abbr: 'O&M', name: 'Oriente y Mar' }, raw: { status: { type: { name: 'STATUS_NEW', state: 'limbo' } } } };
    await cmdMatch('41', ctxFor(feed('eng.1', { events: [inSpan, broken] }).adapter));
    expect(text()).toContain('Arsenal');
    expect(text()).toContain('may be incomplete');
    writes = [];
    await cmdMatch('41', ctxFor(feed('eng.1', { events: [inSpan, broken] }).adapter, { json: true }));
    expect(parsed()).toMatchObject({ match: { id: '41' }, partial: { omitted: 1 } });
  });

  it('found: the match, attributed, no "not available"', async () => {
    await cmdMatch('41', ctxFor(feed('eng.1', { events: [inSpan, other] }).adapter));
    expect(text()).toContain('Arsenal');
    expect(text()).not.toContain(NOT_YET);
    writes = [];
    await cmdMatch('41', ctxFor(feed('eng.1', { events: [inSpan, other] }).adapter, { json: true }));
    expect(parsed()).toMatchObject({ degraded: false, match: { id: '41' }, source: 'espn' });
  });

  it('a whole discovery without the id: "not found between" the window’s days, as a plain field in `--json`', async () => {
    await cmdMatch('41', ctxFor(feed('eng.1', { events: [other] }).adapter));
    expect(text()).toContain('2026-10-09');
    expect(text()).toContain('2026-10-24');
    expect(text()).not.toContain('No match found');
    writes = [];
    await cmdMatch('41', ctxFor(feed('eng.1', { events: [other] }).adapter, { json: true }));
    expect(parsed()).toMatchObject({ match: null, degraded: false, window: { from: '2026-10-09', to: '2026-10-24' } });
  });

  it('a failed discovery renders the degraded sentence and the key, not "not found"', async () => {
    await cmdMatch('41', ctxFor(feed('eng.1', { events: [inSpan], fail: () => json({}, 503) }).adapter));
    expect(text()).not.toContain('No match found');
    expect(text()).not.toContain('2026-10-24');
    writes = [];
    await cmdMatch('41', ctxFor(feed('eng.1', { events: [inSpan], fail: () => json({}, 503) }).adapter, { json: true }));
    expect(parsed()).toMatchObject({ degraded: true, match: null });
  });

  it('found, and the refresh failed: the provider’s earlier record, degraded, and the copy does not say "bundled schedule"', async () => {
    await cmdMatch('41', ctxFor(feed('eng.1', { events: [inSpan, other], fail: (d) => (d.length === 8 ? json({}, 503) : undefined) }).adapter));
    expect(text()).toContain('Arsenal');
    expect(text()).not.toContain('bundled');
    expect(text()).toContain('earlier record');
  });

  it('`share <id>` after a failed refresh: the card says the provider’s earlier record, never "the bundled schedule" (review round 1)', async () => {
    const stale = feed('eng.1', { events: [inSpan, other], fail: (d) => (d.length === 8 ? json({}, 503) : undefined) });
    await cmdShare('41', undefined, {}, ctxFor(stale.adapter));
    expect(text()).toContain('Arsenal');
    expect(text()).not.toContain('bundled schedule');
    expect(text()).toContain('earlier record');
    writes = [];
    await cmdShare('41', undefined, { style: 'compact' } as never, ctxFor(feed('eng.1', { events: [inSpan, other], fail: (d) => (d.length === 8 ? json({}, 503) : undefined) }).adapter));
    expect(text()).not.toContain('bundled schedule');
  });

  it('an incomplete empty `match`: the "none read" sentence, never "no match found" (review round 1)', async () => {
    const broken: Ev = { id: '45', date: '2026-10-14T19:00Z', home: CHE, away: LIV, raw: { status: { type: { name: 'STATUS_NEW', state: 'limbo' } } } };
    await cmdMatch('41', ctxFor(feed('eng.1', { events: [broken, other] }).adapter));
    expect(text()).toContain('may be incomplete');
    expect(text()).not.toContain('No match found');
    expect(text()).toContain('41');
    writes = [];
    await cmdShare('41', undefined, {}, ctxFor(feed('eng.1', { events: [broken, other] }).adapter));
    expect(text()).toContain('may be incomplete');
    expect(text()).not.toContain('No match found');
  });

  it('`share <id>`: the card for a found match; the window sentence on the empty card', async () => {
    await cmdShare('41', undefined, {}, ctxFor(feed('eng.1', { events: [inSpan, other] }).adapter));
    expect(text()).toContain('Arsenal');
    writes = [];
    await cmdShare('41', undefined, {}, ctxFor(feed('eng.1', { events: [other] }).adapter));
    expect(text()).toContain('2026-10-24');
  });

  it('`markets <id>` stays unsupported off the bundle, with no request', async () => {
    const f = feed('eng.1', { events: [inSpan, other] });
    await cmdMarkets('41', undefined, ctxFor(f.adapter, { markets: true }));
    expect(text()).toContain(NOT_YET);
    expect(f.urls).toEqual([]);
    writes = [];
    await cmdMarkets('41', undefined, ctxFor(f.adapter, { markets: true, json: true }));
    expect(parsed()).toMatchObject({ unsupported: true });
    expect(f.urls).toEqual([]);
  });
});

describe('bracket off the bundle: three values (0.11 2.1c)', () => {
  it('a league with no bracket says so on text, `--json` and the share card; a cup still says "not available yet"', async () => {
    const f = feed('eng.1');
    await cmdBracket(undefined, {}, ctxFor(f.adapter));
    expect(text()).toContain('no bracket');
    expect(text()).not.toContain(NOT_YET);
    expect(f.urls).toEqual([]);
    writes = [];
    await cmdBracket(undefined, {}, ctxFor(feed('eng.1').adapter, { json: true }));
    expect(parsed()).toMatchObject({ inapplicable: true });
    expect(parsed().unsupported).toBeUndefined();
    writes = [];
    await cmdShare('bracket', undefined, {}, ctxFor(feed('esp.1').adapter));
    expect(text()).toContain('no bracket');
    writes = [];
    await cmdShare('bracket', undefined, {}, ctxFor(feed('esp.1').adapter, { json: true }));
    expect(parsed()).toMatchObject({ inapplicable: true });
    for (const c of ['ita.1', 'ger.1', 'mex.1', 'uefa.champions']) {
      writes = [];
      await cmdBracket(undefined, {}, ctxFor(feed(c).adapter));
      expect(text(), c).toContain(NOT_YET);
      expect(text(), c).not.toContain('no bracket');
    }
  });

  it('localized (es): its own sentence, neither the English one nor "not available yet"', async () => {
    await cmdBracket(undefined, {}, ctxFor(feed('eng.1').adapter, { lang: 'es' }));
    expect(text()).not.toContain('no bracket');
    expect(text()).not.toContain('Aún no disponible para esta competición');
    expect(text()).toMatch(/cuadro|llave|eliminatoria/i);
  });
});

describe('between editions on the CLI (0.11 2.1c)', () => {
  const cup = (events: Ev[] = []) => feed('concacaf.champions', { events, standings: NO_TABLE, season: () => ENDED }).adapter;
  const finalFT: Ev = { id: '50', date: '2026-10-09T02:00Z', home: { id: '8001', abbr: 'TOL', name: 'Toluca' }, away: { id: '8002', abbr: 'LAFC', name: 'Los Angeles FC' }, state: 'post' };

  it('today, live, next and match say "between editions" with the edition’s label and end; `--json` carries the key', async () => {
    await cmdToday(undefined, ctxFor(cup([finalFT])));
    expect(text()).toContain('Between editions');
    expect(text()).toContain('2026 Concacaf Champions Cup');
    expect(text()).not.toContain('No matches scheduled');
    expect(text()).not.toContain('Toluca');
    writes = [];
    await cmdToday(undefined, ctxFor(cup([finalFT]), { json: true }));
    expect(parsed()).toMatchObject({ betweenEditions: { ended: '2026-10-08', label: '2026 Concacaf Champions Cup' } });
    writes = [];
    await cmdLive(ctxFor(cup([finalFT])));
    expect(text()).toContain('Between editions');
    expect(text()).not.toContain('No matches in play');
    writes = [];
    await cmdLive(ctxFor(cup([finalFT]), { json: true }));
    expect(parsed()).toMatchObject({ betweenEditions: { label: '2026 Concacaf Champions Cup' } });
    writes = [];
    await cmdNext('Toluca', ctxFor(cup([finalFT])));
    expect(text()).toContain('Between editions');
    expect(text()).not.toContain('14 days');
    writes = [];
    await cmdNext('Toluca', ctxFor(cup([finalFT]), { json: true }));
    expect(parsed()).toMatchObject({ fixture: null, betweenEditions: { label: '2026 Concacaf Champions Cup' } });
    writes = [];
    await cmdMatch('99', ctxFor(cup([finalFT])));
    expect(text()).toContain('Between editions');
    expect(text()).not.toContain('2026-10-24');
  });

  it('the share cards say it too (live, today, next)', async () => {
    await cmdShare('live', undefined, {}, ctxFor(cup([finalFT])));
    expect(text()).toContain('Between editions');
    writes = [];
    await cmdShare(undefined, undefined, {}, ctxFor(cup([finalFT])));
    expect(text()).toContain('Between editions');
    writes = [];
    await cmdShare('next', 'Toluca', {}, ctxFor(cup([finalFT])));
    expect(text()).toContain('Between editions');
    writes = [];
    await cmdShare('live', undefined, {}, ctxFor(cup([finalFT]), { json: true }));
    expect(parsed()).toMatchObject({ betweenEditions: { label: '2026 Concacaf Champions Cup' } });
  });

  it('a date on or before the end day is historical: its records, no sentence (in the provider’s zone, where the final is Oct 8)', async () => {
    await cmdToday('2026-10-08', ctxFor(cup([finalFT]), { tz: 'America/New_York' }));
    expect(text()).toContain('Toluca');
    expect(text()).not.toContain('Between editions');
  });

  it('a UTC viewer asking the final’s UTC date sees it (no sentence); the day after, the sentence', async () => {
    await cmdToday('2026-10-09', ctxFor(cup([finalFT]), { tz: 'UTC' }));
    expect(text()).toContain('Toluca');
    expect(text()).not.toContain('Between editions');
    writes = [];
    await cmdToday('2026-10-09', ctxFor(cup([finalFT]), { tz: 'UTC', json: true }));
    expect(parsed().betweenEditions).toBeUndefined();
    writes = [];
    await cmdToday('2026-10-10', ctxFor(cup([finalFT]), { tz: 'UTC' }));
    expect(text()).toContain('Between editions');
    expect(text()).not.toContain('Toluca');
  });

  it('a scheduled fixture beside an ended season: shown, no sentence', async () => {
    const scheduled: Ev = { id: '51', date: '2026-10-14T02:00Z', home: { id: '8001', abbr: 'TOL', name: 'Toluca' }, away: { id: '8003', abbr: 'MTY', name: 'Monterrey' } };
    await cmdNext('Toluca', ctxFor(cup([finalFT, scheduled])));
    expect(text()).toContain('Monterrey');
    expect(text()).not.toContain('Between editions');
  });

  it('localized (fr): the sentence is not English, and the label is in it', async () => {
    await cmdLive(ctxFor(cup([finalFT]), { lang: 'fr' }));
    expect(text()).not.toContain('Between editions');
    expect(text()).toContain('2026 Concacaf Champions Cup');
  });
});
