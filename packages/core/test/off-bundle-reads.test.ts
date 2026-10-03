/**
 * 0.11 PR 2.1c — off the bundle: `next`, `match`, `bracket`; between editions;
 * the dated reads across a turn.
 *
 * Off the bundled competition `next`, `match <id>` and `bracket` answered
 * "not available for this competition yet" without a request (0.10.1 batch
 * 4). Now `next <club>` resolves a club against the competition's roster (the
 * standings, with coverage; the schedule ahead as positive evidence) and
 * answers its earliest unfinished fixture within discovery's span (the
 * provider's yesterday to 14 days ahead); `match <id>` looks the id up in that
 * span and refreshes it from its own day; `bracket` says which of three things
 * it is (offered on the bundle; "no bracket" for a league with no knockout tie
 * of its own; not offered yet for the rest). A read whose season ended before
 * the day asked, with nothing current in it, is "between editions". And the
 * dated reads compose across a season turn off the bundle, as the live read
 * does: they merge nothing there.
 *
 * The feed below files a fixture under its kickoff's US/Eastern day, refuses
 * ranges, serves one league table with the teams' ids, and answers for the
 * competition it is asked about.
 */
import { describe, expect, it } from 'vitest';
import { EspnAdapter } from '../src/adapters/espn';
import { fetchMeta } from '../src/adapters/meta';
import { bracketCapability, NO_BRACKET } from '../src/competition';
import {
  getBracket,
  getLiveMatches,
  getMatchById,
  getMatchesForDate,
  getNextFixtureForTeam,
  getScheduleAhead,
} from '../src/live';
import { resolveClub, rosterFor } from '../src/teams';
import type { Team } from '../src/types';

const STATS = ['gamesPlayed', 'wins', 'ties', 'losses', 'pointsFor', 'pointsAgainst', 'pointDifferential', 'points', 'rank'];
/** Saturday Oct 10 2026, 15:00Z: Eastern Oct 10. Discovery's span is Oct 9 to Oct 24: one month. */
const NOW = new Date('2026-10-10T15:00:00.000Z');
type Season = { year: number; displayName: string; startDate?: string; endDate?: string };
const S2026: Season = { year: 2026, displayName: '2026-27 English Premier League', startDate: '2026-08-01T04:00Z', endDate: '2027-05-30T03:59Z' };
const S2027: Season = { ...S2026, year: 2027, displayName: '2027-28 English Premier League', startDate: '2027-08-01T04:00Z', endDate: '2028-05-30T03:59Z' };
/** A season that ended on provider day Oct 8, 2026 (the final was Oct 8 evening Eastern). */
const ENDED: Season = { year: 2026, displayName: '2026 Concacaf Champions Cup', startDate: '2026-02-01T05:00Z', endDate: '2026-10-09T03:59Z' };

type Side = { id?: string; abbr: string; name: string };
type Play = 'pre' | 'in' | 'post' | 'postponed' | 'cancelled';
type Ev = { id: string; date: string; home: Side; away: Side; state?: Play; raw?: Record<string, unknown> };
function event(e: Ev) {
  const state = e.state ?? 'pre';
  const type =
    state === 'in'
      ? { name: 'STATUS_IN_PROGRESS', state: 'in' }
      : state === 'post'
        ? { name: 'STATUS_FULL_TIME', state: 'post' }
        : state === 'postponed'
          ? { name: 'STATUS_POSTPONED', state: 'post' }
          : state === 'cancelled'
            ? { name: 'STATUS_CANCELED', state: 'post' }
            : { name: 'STATUS_SCHEDULED', state: 'pre' };
  const side = (s: Side, homeAway: string, score: string) => ({
    homeAway,
    score,
    team: { ...(s.id ? { id: s.id } : {}), abbreviation: s.abbr, displayName: s.name },
  });
  return {
    id: e.id,
    date: e.date,
    season: { slug: 'regular-season' },
    status: { type, displayClock: state === 'in' ? "55'" : undefined, period: state === 'in' ? 2 : 0 },
    competitions: [{ competitors: [side(e.home, 'home', '1'), side(e.away, 'away', '0')] }],
    ...e.raw,
  };
}
const ARS: Side = { id: '359', abbr: 'ARS', name: 'Arsenal' };
const CHE: Side = { id: '363', abbr: 'CHE', name: 'Chelsea' };
const LIV: Side = { id: '364', abbr: 'LIV', name: 'Liverpool' };
const OM: Side = { id: '4501', abbr: 'O&M', name: 'Oriente y Mar' };
/** Two Libertadores clubs that share a code. */
const CARABOBO: Side = { id: '7001', abbr: 'CAR', name: 'Carabobo' };
const ALWAYS_READY: Side = { id: '7002', abbr: 'CAR', name: 'Always Ready' };

type Row = { side: Side; rank: number; raw?: Record<string, unknown> };
function table(name: string, rows: Row[]) {
  return {
    children: [
      {
        name,
        standings: {
          entries: rows.map((r) => ({
            team: { ...(r.side.id ? { id: r.side.id } : {}), abbreviation: r.side.abbr, displayName: r.side.name },
            stats: STATS.map((n) => ({ name: n, value: n === 'rank' ? r.rank : 0 })),
            ...r.raw,
          })),
        },
      },
    ],
  };
}
const PL_TABLE = table('2026-27 English Premier League', [
  { side: ARS, rank: 1 },
  { side: CHE, rank: 2 },
  { side: LIV, rank: 3 },
  { side: OM, rank: 4 },
]);
/** What a competition with no table answers. */
const NO_TABLE = { name: 'Concacaf Champions Cup', season: { year: 2026 }, seasons: [{ year: 2016 }] };

const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const easternDay = (iso: string) => eastern.format(new Date(iso)).replace(/-/g, '');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface FeedOpts {
  events?: Ev[];
  season?: (dates: string) => Season | undefined;
  standings?: unknown | ((url: string) => Response);
  fail?: (dates: string) => Response | undefined;
}
function feed(competition: string, opts: FeedOpts = {}) {
  const urls: string[] = [];
  const dates: string[] = [];
  const events = opts.events ?? [];
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('/standings')) {
      const s = opts.standings ?? PL_TABLE;
      return typeof s === 'function' ? (s as (u: string) => Response)(url) : json(s);
    }
    const asked = new URL(url).searchParams.get('dates') ?? '';
    dates.push(asked);
    const failure = opts.fail?.(asked);
    if (failure) return failure;
    if (asked.includes('-')) return json({ code: 400, message: 'Failed to get events endpoint.' }, 400);
    const season = opts.season ? opts.season(asked) : S2026;
    const inBucket = (e: Ev) =>
      asked.length === 8 ? easternDay(e.date) === asked : asked.length === 6 ? easternDay(e.date).startsWith(asked) : false;
    return json({ leagues: [{ season }], events: events.filter(inBucket).map(event) });
  }) as unknown as typeof fetch;
  const adapter = new EspnAdapter({ competition, fetchImpl, now: () => NOW.getTime() });
  return { adapter, urls, dates, months: () => dates.filter((d) => d.length === 6), days: () => dates.filter((d) => d.length === 8) };
}
const ids = (ms: { id: string }[]) => ms.map((m) => m.id).sort();

describe('the dated reads compose across a turn off the bundle (0.11 2.1c, ledger D9)', () => {
  // A day response states the season of the DATE asked; off the bundle the
  // dated read merges nothing, so it composes as the live read does.
  const turn = (d: string) => (d >= '20261011' ? S2027 : S2026);
  const sat: Ev = { id: '1', date: '2026-10-10T19:00Z', home: ARS, away: CHE, state: 'post' };
  const sun: Ev = { id: '2', date: '2026-10-11T15:00Z', home: LIV, away: ARS };

  it('today <date> on a turn day is served, attributed, with no season stated', async () => {
    const f = feed('eng.1', { events: [sat, sun], season: turn });
    const r = await getMatchesForDate(f.adapter, '2026-10-10');
    expect(r.degraded).toBe(false);
    expect(r.source).toBe('espn');
    expect(ids(r.matches)).toEqual(['1', '2']);
    expect(r.season).toBeUndefined();
    expect([...f.days()].sort()).toEqual(['20261009', '20261010', '20261011']);
  });

  it('on a day with one season nothing changes: the season is stated', async () => {
    const r = await getMatchesForDate(feed('eng.1', { events: [sat, sun] }).adapter, '2026-10-10');
    expect(r.degraded).toBe(false);
    expect(r.season).toMatchObject({ year: 2026 });
  });
});

describe('the roster and the resolver (0.11 2.1c)', () => {
  it('a league table is the roster, complete when every row was read and carries an id', async () => {
    const f = feed('eng.1');
    const roster = await rosterFor(f.adapter);
    expect(roster.complete).toBe(true);
    expect(roster.tableAsked).toBe(true);
    expect(roster.teams.map((t) => t.id).sort()).toEqual(['espn:359', 'espn:363', 'espn:364', 'espn:4501']);
    expect(f.urls.filter((u) => u.includes('/standings'))).toHaveLength(1);
  });

  it('a degraded, incomplete or partial table, or a row with no id, is not a complete roster', async () => {
    const down = await rosterFor(feed('eng.1', { standings: () => json({}, 503) }).adapter);
    expect(down).toMatchObject({ complete: false, tableAsked: true });
    const idless = await rosterFor(feed('eng.1', { standings: table('2026-27 English Premier League', [{ side: { abbr: 'ARS', name: 'Arsenal' }, rank: 1 }, { side: CHE, rank: 2 }]) }).adapter);
    expect(idless.complete).toBe(false);
    expect(idless.teams.map((t) => t.name).sort()).toEqual(['Arsenal', 'Chelsea']); // still known, not resolvable by identity
    // One refused row (a rank that is not a number): the table is partial, the roster not complete.
    const refused = await rosterFor(
      feed('eng.1', { standings: table('2026-27 English Premier League', [{ side: ARS, rank: 1 }, { side: CHE, rank: 2, raw: { stats: [{ name: 'rank', value: 'two' }] } }]) }).adapter,
    );
    expect(refused.complete).toBe(false);
  });

  it('two rows sharing a code are two teams in the roster (deduplicated by id, never by code)', async () => {
    const roster = await rosterFor(feed('conmebol.libertadores', { standings: table('Group A', [{ side: CARABOBO, rank: 1 }, { side: ALWAYS_READY, rank: 2 }]) }).adapter);
    expect(roster.complete).toBe(true);
    expect(roster.teams.map((t) => t.id).sort()).toEqual(['espn:7001', 'espn:7002']);
  });

  it('a competition with no table has no roster: nothing asked for was read, so it is never complete', async () => {
    const roster = await rosterFor(feed('concacaf.champions', { standings: NO_TABLE }).adapter);
    expect(roster).toMatchObject({ complete: false, tableAsked: false });
    expect(roster.teams).toEqual([]);
  });

  const complete = (teams: Team[]) => ({ teams, complete: true, tableAsked: true });
  const T = (s: Side): Team => ({ id: `espn:${s.id}`, code: s.abbr, name: s.name, flag: '🏳️' });
  const PL = complete([T(ARS), T(CHE), T(LIV), T(OM)]);

  it('resolves by exact code, exact name, then a unique fuzzy name; identity is the id', () => {
    expect(resolveClub('ars', PL, [])).toMatchObject({ outcome: 'resolved', team: { id: 'espn:359' } });
    expect(resolveClub('Arsenal', PL, [])).toMatchObject({ outcome: 'resolved', team: { id: 'espn:359' } });
    expect(resolveClub('arsen', PL, [])).toMatchObject({ outcome: 'resolved', team: { id: 'espn:359' } });
    expect(resolveClub('O&M', PL, [])).toMatchObject({ outcome: 'resolved', team: { id: 'espn:4501' } });
    expect(resolveClub('oriente', PL, [])).toMatchObject({ outcome: 'resolved', team: { id: 'espn:4501' } });
  });

  it('an exact name wins over a fuzzy pair it is a prefix of', () => {
    const two = complete([T({ id: '11', abbr: 'BOC', name: 'Boca' }), T({ id: '12', abbr: 'BOJ', name: 'Boca Juniors' })]);
    expect(resolveClub('Boca', two, [])).toMatchObject({ outcome: 'resolved', team: { id: 'espn:11' } });
    expect(resolveClub('boc', two, [])).toMatchObject({ outcome: 'resolved', team: { id: 'espn:11' } }); // the exact code
    expect(resolveClub('boca j', two, []).outcome).toBe('resolved');
  });

  it('the fuzzy pass is a prefix, then a substring; a query under three letters gets no fuzzy pass', () => {
    const two = complete([T({ id: '31', abbr: 'NAC', name: 'Nacional' }), T({ id: '32', abbr: 'ATN', name: 'Atletico Nacional' })]);
    expect(resolveClub('Nacional', two, [])).toMatchObject({ outcome: 'resolved', team: { id: 'espn:31' } }); // the exact name
    expect(resolveClub('nacio', two, []).outcome).toBe('ambiguous'); // prefix of one, substring of the other: two hits
    expect(resolveClub('atleti', two, [])).toMatchObject({ outcome: 'resolved', team: { id: 'espn:32' } });
    expect(resolveClub('tico', two, [])).toMatchObject({ outcome: 'resolved', team: { id: 'espn:32' } }); // substring
    expect(resolveClub('na', two, []).outcome).toBe('unknown'); // two letters: no fuzzy pass, and the roster is whole
  });

  it('two clubs sharing a code are two candidates, never a pick; so are two fuzzy hits', () => {
    const LIB = complete([T(CARABOBO), T(ALWAYS_READY)]);
    const r = resolveClub('CAR', LIB, []);
    expect(r.outcome).toBe('ambiguous');
    expect(r.outcome === 'ambiguous' && r.candidates.map((t) => t.name).sort()).toEqual(['Always Ready', 'Carabobo']);
    expect(resolveClub('Carabobo', LIB, [])).toMatchObject({ outcome: 'resolved', team: { id: 'espn:7001' } });
    const two = complete([T(CHE), T({ id: '9', abbr: 'CHT', name: 'Cheltenham' })]);
    expect(resolveClub('che', two, []).outcome).toBe('resolved'); // the exact code wins
    expect(resolveClub('chel', two, []).outcome).toBe('ambiguous');
  });

  it('a single code or fuzzy hit resolves only against a roster read whole (or a competition with no table); an exact name resolves anyway', () => {
    // The other club may be the refused row: with the roster not whole, one hit by code or by a fuzzy name is not known to be unique.
    const partialRoster = { ...complete([T({ id: '21', abbr: 'UCH', name: 'Universidad de Chile' })]), complete: false };
    expect(resolveClub('universidad', partialRoster, []).outcome).toBe('unresolved');
    expect(resolveClub('UCH', partialRoster, []).outcome).toBe('unresolved');
    expect(resolveClub('Universidad de Chile', partialRoster, [])).toMatchObject({ outcome: 'resolved', team: { id: 'espn:21' } });
    const noTable = { teams: [], complete: false, tableAsked: false };
    const fixture = { id: '9', kickoff: '2026-10-12T19:00Z', home: T({ id: '21', abbr: 'UCH', name: 'Universidad de Chile' }), away: T(ARS) };
    expect(resolveClub('universidad', noTable, [fixture as never])).toMatchObject({ outcome: 'resolved', team: { id: 'espn:21' } });
  });

  it('"unknown" needs a complete roster; without one the miss is "unresolved"', () => {
    expect(resolveClub('Everton', PL, []).outcome).toBe('unknown');
    expect(resolveClub('Everton', { ...PL, complete: false }, []).outcome).toBe('unresolved');
    expect(resolveClub('Everton', { teams: [], complete: false, tableAsked: false }, []).outcome).toBe('unresolved');
  });

  it('a team found only in the schedule ahead is known (positive evidence); absence from it proves nothing', () => {
    const fixture = { id: '9', kickoff: '2026-10-12T19:00Z', home: T(ARS), away: T({ id: '400', abbr: 'EVE', name: 'Everton' }) };
    const r = resolveClub('Everton', { teams: [], complete: false, tableAsked: false }, [fixture as never]);
    expect(r).toMatchObject({ outcome: 'resolved', team: { id: 'espn:400' } });
    // A club that lacks an id in the schedule cannot be resolved by identity: unresolved, not unknown.
    const idless = { ...fixture, away: { code: 'EVE', name: 'Everton', flag: '🏳️' } };
    expect(resolveClub('Everton', { teams: [], complete: false, tableAsked: false }, [idless as never]).outcome).toBe('unresolved');
  });
});

describe('next <club> off the bundle (0.11 2.1c)', () => {
  const upcoming: Ev[] = [
    { id: '10', date: '2026-10-09T19:00Z', home: ARS, away: CHE, state: 'post' }, // yesterday, played
    { id: '11', date: '2026-10-17T14:00Z', home: LIV, away: ARS }, // Arsenal's next
    { id: '12', date: '2026-10-24T14:00Z', home: ARS, away: OM },
    { id: '13', date: '2026-10-11T15:00Z', home: CHE, away: LIV },
  ];

  it('by code, by name, by a fuzzy name: the earliest unfinished fixture, by id, attributed; the result carries the resolved team', async () => {
    for (const q of ['ARS', 'Arsenal', 'arsen']) {
      const f = feed('eng.1', { events: upcoming });
      const r = await getNextFixtureForTeam(f.adapter, q, NOW);
      expect(r.degraded, q).toBe(false);
      expect(r.unsupported, q).toBeUndefined();
      expect(r.fixture?.id, q).toBe('11');
      expect(r.source, q).toBe('espn');
      expect(r.team, q).toMatchObject({ id: 'espn:359', code: 'ARS', name: 'Arsenal' });
      // Discovery's requests, and the one standings request; no bundled window.
      expect(f.months(), q).toEqual(['202610']);
      expect(f.days(), q).toEqual([]);
      expect(f.urls.filter((u) => u.includes('/standings')), q).toHaveLength(1);
    }
  });

  it('a club in play is answered with its score (the selector is "earliest kickoff not finished")', async () => {
    const live: Ev = { id: '14', date: '2026-10-10T14:30Z', home: ARS, away: CHE, state: 'in' };
    const r = await getNextFixtureForTeam(feed('eng.1', { events: [live, ...upcoming] }).adapter, 'ARS', NOW);
    expect(r.fixture?.id).toBe('14');
    expect(r.fixture?.status).toBe('LIVE');
    // Postponed and cancelled are not "unfinished".
    const r2 = await getNextFixtureForTeam(
      feed('eng.1', { events: [{ ...live, state: 'postponed' }, { ...(upcoming[1] as Ev), state: 'cancelled' }, upcoming[2] as Ev] }).adapter,
      'ARS',
      NOW,
    );
    expect(r2.fixture?.id).toBe('12');
  });

  it('a fixture side whose id differs from the resolved club’s is never its fixture, whatever its labels say (review round 1)', async () => {
    // Contradictory provider data: a side labelled Carabobo carrying Always Ready's id.
    const LIB = table('Group A', [
      { side: CARABOBO, rank: 1 },
      { side: ALWAYS_READY, rank: 2 },
    ]);
    const mislabelled: Ev = { id: '22', date: '2026-10-12T22:00Z', home: { id: '7002', abbr: 'CAR', name: 'Carabobo' }, away: { id: '7003', abbr: 'BOC', name: 'Boca Juniors' } };
    const season = () => ({ year: 2026, displayName: '2026 Copa Libertadores', startDate: '2026-01-20T05:00Z', endDate: '2026-11-30T05:00Z' });
    const r = await getNextFixtureForTeam(feed('conmebol.libertadores', { events: [mislabelled], standings: LIB, season }).adapter, 'Carabobo', NOW);
    expect(r.team?.id).toBe('espn:7001');
    expect(r.fixture).toBeUndefined();
    expect(r.horizon).toEqual({ days: 14 });
  });

  it('an id-less fixture side with the club’s code and name is its fixture (sameTeam as written)', async () => {
    const r = await getNextFixtureForTeam(feed('eng.1', { events: [{ id: '15', date: '2026-10-13T19:00Z', home: { abbr: 'ARS', name: 'Arsenal' }, away: CHE }] }).adapter, 'Arsenal', NOW);
    expect(r.fixture?.id).toBe('15');
  });

  it('two clubs with one code: `next Carabobo` is Carabobo’s match, never Always Ready’s; `next CAR` is two candidates and no fixture', async () => {
    const LIB = table('Group A', [
      { side: CARABOBO, rank: 1 },
      { side: ALWAYS_READY, rank: 2 },
    ]);
    const events: Ev[] = [
      { id: '20', date: '2026-10-12T22:00Z', home: ALWAYS_READY, away: { id: '7003', abbr: 'BOC', name: 'Boca Juniors' } },
      { id: '21', date: '2026-10-15T22:00Z', home: { id: '7004', abbr: 'FLA', name: 'Flamengo' }, away: CARABOBO },
    ];
    const season = () => ({ year: 2026, displayName: '2026 Copa Libertadores', startDate: '2026-01-20T05:00Z', endDate: '2026-11-30T05:00Z' });
    const r = await getNextFixtureForTeam(feed('conmebol.libertadores', { events, standings: LIB, season }).adapter, 'Carabobo', NOW);
    expect(r.fixture?.id).toBe('21');
    expect(r.team?.id).toBe('espn:7001');
    const amb = await getNextFixtureForTeam(feed('conmebol.libertadores', { events, standings: LIB, season }).adapter, 'CAR', NOW);
    expect(amb.fixture).toBeUndefined();
    expect(amb.candidates?.map((t) => t.name).sort()).toEqual(['Always Ready', 'Carabobo']);
    expect(amb.degraded).toBe(false);
    // One of the two rows refused: the roster is not complete and the code is not "unique".
    const oneRefused = table('Group A', [
      { side: CARABOBO, rank: 1 },
      { side: ALWAYS_READY, rank: 2, raw: { stats: [{ name: 'rank', value: 'two' }] } },
    ]);
    const half = await getNextFixtureForTeam(feed('conmebol.libertadores', { events, standings: oneRefused, season }).adapter, 'CAR', NOW);
    expect(half.fixture?.id).not.toBe('20');
  });

  it('an unknown name: "no team called" only with a complete roster; with a degraded, partial or id-less table the miss is "roster not whole", its own verdict, not an outage', async () => {
    const unknown = await getNextFixtureForTeam(feed('eng.1', { events: upcoming }).adapter, 'Everton', NOW);
    expect(unknown).toMatchObject({ unknownTeam: true, degraded: false });
    expect(unknown.fixture).toBeUndefined();
    expect(unknown.horizon).toBeUndefined();
    for (const standings of [() => json({}, 503), table('2026-27 English Premier League', [{ side: { abbr: 'ARS', name: 'Arsenal' }, rank: 1 }])]) {
      const r = await getNextFixtureForTeam(feed('eng.1', { events: upcoming, standings }).adapter, 'Everton', NOW);
      // The provider was reached and answered; the roster could not be read whole. Not "couldn't reach the provider".
      expect(r.degraded).toBe(false);
      expect(r.rosterIncomplete).toBe(true);
      expect(r.unknownTeam).toBeUndefined();
      expect(r.horizon).toBeUndefined();
    }
    // The same for a single code hit against a roster not read whole (the other club may be the refused row).
    const byCode = await getNextFixtureForTeam(feed('eng.1', { events: upcoming, standings: () => json({}, 503) }).adapter, 'ARS', NOW);
    expect(byCode).toMatchObject({ rosterIncomplete: true, degraded: false });
    // But an exact name resolves, and its fixture is served.
    const byName = await getNextFixtureForTeam(feed('eng.1', { events: upcoming, standings: () => json({}, 503) }).adapter, 'Arsenal', NOW);
    expect(byName.fixture?.id).toBe('11');
  });

  it('the query is bounded like a human label before it names anything', async () => {
    const r = await getNextFixtureForTeam(feed('eng.1', { events: upcoming }).adapter, `${'x'.repeat(60)}\u0007`, NOW);
    expect(r.unknownTeam).toBe(true);
    expect(typeof r.query).toBe('string');
    expect((r.query as string).length).toBeLessThanOrEqual(40);
    expect(r.query).not.toContain('\u0007');
  });

  it('a known club with nothing in a whole span: the horizon, as a plain field, never a verdict', async () => {
    const r = await getNextFixtureForTeam(feed('eng.1', { events: [upcoming[3] as Ev] }).adapter, 'Arsenal', NOW);
    expect(r.fixture).toBeUndefined();
    expect(r.degraded).toBe(false);
    expect(r.horizon).toEqual({ days: 14 });
    expect(r.team?.id).toBe('espn:359');
    expect(r.unknownTeam).toBeUndefined();
    expect(r.partial).toBeUndefined();
  });

  it('on a competition with no table, a name with nothing in a whole span is the horizon sentence, never "no team called" and never degraded for the roster alone', async () => {
    const r = await getNextFixtureForTeam(feed('concacaf.champions', { events: [], standings: NO_TABLE, season: () => ({ year: 2026, displayName: '2026 Concacaf Champions Cup', startDate: '2026-02-01T05:00Z', endDate: '2026-12-31T05:00Z' }) }).adapter, 'Some Club', NOW);
    expect(r.degraded).toBe(false);
    expect(r.unknownTeam).toBeUndefined();
    expect(r.horizon).toEqual({ days: 14 });
  });

  it('an incomplete discovery: the readable fixture with partial, or an empty body with partial and no horizon', async () => {
    const broken: Ev = { id: '16', date: '2026-10-14T19:00Z', home: CHE, away: LIV, raw: { status: { type: { name: 'STATUS_NEW', state: 'limbo' } } } };
    const withFixture = await getNextFixtureForTeam(feed('eng.1', { events: [broken, upcoming[1] as Ev] }).adapter, 'ARS', NOW);
    expect(withFixture.fixture?.id).toBe('11');
    expect(withFixture.partial).toEqual({ omitted: 1 });
    const none = await getNextFixtureForTeam(feed('eng.1', { events: [broken, upcoming[3] as Ev] }).adapter, 'ARS', NOW);
    expect(none.fixture).toBeUndefined();
    expect(none.partial).toEqual({ omitted: 1 });
    expect(none.horizon).toBeUndefined();
    expect(none.degraded).toBe(false);
  });

  it('a failed discovery is degraded: never "no fixture", never "no team called"', async () => {
    const r = await getNextFixtureForTeam(feed('eng.1', { events: upcoming, fail: () => json({}, 503) }).adapter, 'ARS', NOW);
    expect(r.degraded).toBe(true);
    expect(r.fixture).toBeUndefined();
    expect(r.horizon).toBeUndefined();
    expect(r.unknownTeam).toBeUndefined();
  });

  it('one discovery per command: the roster of a no-table competition and the fixture come from the same month requests', async () => {
    const f = feed('concacaf.champions', {
      events: [{ id: '30', date: '2026-10-14T02:00Z', home: { id: '8001', abbr: 'TOL', name: 'Toluca' }, away: { id: '8002', abbr: 'LAFC', name: 'Los Angeles FC' } }],
      standings: NO_TABLE,
      season: () => ({ year: 2026, displayName: '2026 Concacaf Champions Cup', startDate: '2026-02-01T05:00Z', endDate: '2026-12-31T05:00Z' }),
    });
    const r = await getNextFixtureForTeam(f.adapter, 'Toluca', NOW);
    expect(r.fixture?.id).toBe('30');
    expect(f.months()).toEqual(['202610']);
  });
});

describe('match <id> off the bundle (0.11 2.1c): every transition', () => {
  const inSpan: Ev = { id: '41', date: '2026-10-17T14:00Z', home: LIV, away: ARS };
  const other: Ev = { id: '42', date: '2026-10-11T15:00Z', home: CHE, away: LIV };

  it('found in the span and refreshed from its own day, across seasons, attributed', async () => {
    const f = feed('eng.1', { events: [inSpan, other], season: (d) => (d === '20261018' ? S2027 : S2026) });
    const r = await getMatchById(f.adapter, '41');
    expect(r.degraded).toBe(false);
    expect(r.match?.id).toBe('41');
    expect(r.source).toBe('espn');
    expect(f.months()).toEqual(['202610']);
    expect([...f.days()].sort()).toEqual(['20261016', '20261017', '20261018']);
    expect(r.partial).toBeUndefined();
  });

  it('the refresh is asked around the PROVIDER’s day of the kickoff, not the UTC date', async () => {
    // 01:00Z on Oct 18 is Oct 17 for the provider: the refresh asks Oct 16 to 18, not 17 to 19.
    const late: Ev = { id: '47', date: '2026-10-18T01:00Z', home: LIV, away: ARS };
    const f = feed('eng.1', { events: [late, other] });
    const r = await getMatchById(f.adapter, '47');
    expect(r.match?.id).toBe('47');
    expect(r.degraded).toBe(false);
    expect([...f.days()].sort()).toEqual(['20261016', '20261017', '20261018']);
  });

  it('found: the REFRESHED record is answered (the day read’s state, not the month’s)', async () => {
    const f = feed('eng.1', {
      events: [inSpan, other],
      // The day read says the match is in play; the month said scheduled.
      fail: (d) => (d === '20261017' ? json({ leagues: [{ season: S2026 }], events: [event({ ...inSpan, state: 'in' })] }) : d.length === 8 ? json({ leagues: [{ season: S2026 }], events: [] }) : undefined),
    });
    const r = await getMatchById(f.adapter, '41', new Date('2026-10-17T15:00:00Z'));
    expect(r.match?.id).toBe('41');
    expect(r.match?.status).toBe('LIVE');
    expect(r.degraded).toBe(false);
  });

  it('found, and the refresh was not whole (a refused sibling; a conflicting duplicate of the id): the record with partial', async () => {
    const broken: Ev = { id: '43', date: '2026-10-17T16:00Z', home: CHE, away: OM, raw: { status: { type: { name: 'STATUS_NEW', state: 'limbo' } } } };
    const r = await getMatchById(feed('eng.1', { events: [inSpan, broken] }).adapter, '41');
    expect(r.match?.id).toBe('41');
    expect(r.partial).toEqual({ omitted: 1 });
    // The same id twice in the day's response: the first copy is kept, the read is not whole.
    const dup = feed('eng.1', { events: [inSpan, { ...inSpan, date: '2026-10-17T18:00Z' }] });
    const r2 = await getMatchById(dup.adapter, '41');
    expect(r2.match?.id).toBe('41');
    expect(r2.partial).toEqual({ omitted: 1 });
  });

  it('found, and the refresh failed: the month’s record, attributed, degraded; never "not found"', async () => {
    const r = await getMatchById(feed('eng.1', { events: [inSpan, other], fail: (d) => (d.length === 8 ? json({}, 503) : undefined) }).adapter, '41');
    expect(r.degraded).toBe(true);
    expect(r.match?.id).toBe('41');
    expect(r.source).toBe('espn');
    expect(r.window).toBeUndefined();
  });

  it('found, and a whole refresh did not hold it: the month’s record, attributed, degraded (not presented as refreshed); an incomplete one adds partial', async () => {
    // The day responses hold nothing (the month filed it under Oct 17; the days say otherwise).
    const moved = feed('eng.1', {
      events: [inSpan, other],
      fail: (d) => (d.length === 8 ? json({ leagues: [{ season: S2026 }], events: [] }) : undefined),
    });
    const r = await getMatchById(moved.adapter, '41');
    expect(r.match?.id).toBe('41');
    expect(r.degraded).toBe(true);
    expect(r.source).toBe('espn');
    expect(r.partial).toBeUndefined();
    const broken = feed('eng.1', {
      events: [inSpan, other],
      // The match's own day holds a readable sibling and a refused record, and neither is the id; the other days are empty
      // (a day whose only records are unreadable is a refused read, not an incomplete one).
      fail: (d) =>
        d === '20261017'
          ? json({ leagues: [{ season: S2026 }], events: [event({ id: '45', date: '2026-10-17T18:00Z', home: LIV, away: OM }), event({ id: '44', date: '2026-10-17T20:00Z', home: CHE, away: OM, raw: { status: { type: { name: 'STATUS_NEW', state: 'limbo' } } } })] })
          : d.length === 8
            ? json({ leagues: [{ season: S2026 }], events: [] })
            : undefined,
    });
    const r2 = await getMatchById(broken.adapter, '41');
    expect(r2.match?.id).toBe('41');
    expect(r2.degraded).toBe(true);
    expect(r2.partial).toEqual({ omitted: 1 });
  });

  it('a whole discovery without the id: "not found between", with the window as a plain field, never "no such match"', async () => {
    const r = await getMatchById(feed('eng.1', { events: [other] }).adapter, '41');
    expect(r.match).toBeUndefined();
    expect(r.degraded).toBe(false);
    expect(r.window).toEqual({ from: '2026-10-09', to: '2026-10-24' });
    expect(r.partial).toBeUndefined();
  });

  it('an incomplete discovery without the id: an empty body with partial, no window sentence', async () => {
    const broken: Ev = { id: '45', date: '2026-10-14T19:00Z', home: CHE, away: LIV, raw: { status: { type: { name: 'STATUS_NEW', state: 'limbo' } } } };
    const r = await getMatchById(feed('eng.1', { events: [broken, other] }).adapter, '41');
    expect(r.match).toBeUndefined();
    expect(r.degraded).toBe(false);
    expect(r.partial).toEqual({ omitted: 1 });
    expect(r.window).toBeUndefined();
  });

  it('a failed discovery is degraded, with no window', async () => {
    const r = await getMatchById(feed('eng.1', { events: [inSpan], fail: () => json({}, 503) }).adapter, '41');
    expect(r.degraded).toBe(true);
    expect(r.match).toBeUndefined();
    expect(r.window).toBeUndefined();
  });
});

describe('bracket off the bundle: a capability with three values (0.11 2.1c)', () => {
  it('the list is written down: the league seasons with no knockout tie of their own', () => {
    expect([...NO_BRACKET].sort()).toEqual(['eng.1', 'esp.1']);
    expect(bracketCapability('fifa.world')).toBe('offered');
    expect(bracketCapability('eng.1')).toBe('inapplicable');
    for (const c of ['ita.1', 'ger.1', 'mex.1', 'uefa.champions', 'concacaf.champions', 'uefa.euro', 'fifa.friendly']) {
      expect(bracketCapability(c), c).toBe('unsupported');
    }
  });

  it('a league with no bracket answers inapplicable, with no request; the rest stay unsupported', async () => {
    const f = feed('eng.1');
    const r = await getBracket(f.adapter, {});
    expect(r).toMatchObject({ inapplicable: true, degraded: false });
    expect(r.unsupported).toBeUndefined();
    expect(f.urls).toEqual([]);
    const g = feed('ger.1');
    expect(await getBracket(g.adapter, {})).toMatchObject({ unsupported: true });
    expect(g.urls).toEqual([]);
  });
});

describe('between editions (0.11 2.1c): one rule for every surface', () => {
  // The Concacaf Champions Cup's 2026 edition ended on provider day Oct 8; it is Oct 10.
  const cup = (opts: FeedOpts = {}) =>
    feed('concacaf.champions', { standings: NO_TABLE, season: () => ENDED, ...opts });
  const finalFT: Ev = { id: '50', date: '2026-10-09T02:00Z', home: { id: '8001', abbr: 'TOL', name: 'Toluca' }, away: { id: '8002', abbr: 'LAFC', name: 'Los Angeles FC' }, state: 'post' };

  it('a whole read with nothing current and an ended season: live, next and match say so (the key, with the end and the label)', async () => {
    const live = await getLiveMatches(cup().adapter, NOW);
    expect(live.matches).toEqual([]);
    expect(live.degraded).toBe(false);
    // `ended` is the PROVIDER's end day (the rule decides on it; 03:59Z on Oct 9 is Eastern Oct 8), not the UTC date of the instant.
    expect(live.betweenEditions).toEqual({ ended: '2026-10-08', label: '2026 Concacaf Champions Cup' });
    const next = await getNextFixtureForTeam(cup().adapter, 'Toluca', NOW);
    expect(next.fixture).toBeUndefined();
    expect(next.betweenEditions).toMatchObject({ label: '2026 Concacaf Champions Cup' });
    expect(next.horizon).toBeUndefined();
    expect(next.unknownTeam).toBeUndefined();
    expect(next.degraded).toBe(false);
    const match = await getMatchById(cup().adapter, '99');
    expect(match.betweenEditions).toMatchObject({ label: '2026 Concacaf Champions Cup' });
    expect(match.window).toBeUndefined();
  });

  it('the day after the final: yesterday’s FT is inside the lookback, not shown, not blocking', async () => {
    const live = await getLiveMatches(cup({ events: [finalFT] }).adapter, NOW);
    expect(live.matches).toEqual([]);
    expect(live.betweenEditions).toBeDefined();
    const next = await getNextFixtureForTeam(cup({ events: [finalFT] }).adapter, 'Toluca', NOW);
    expect(next.fixture).toBeUndefined();
    expect(next.betweenEditions).toBeDefined();
    const today = await getMatchesForDate(cup({ events: [finalFT] }).adapter, '2026-10-10');
    expect(today.matches).toEqual([]);
    expect(today.betweenEditions).toBeDefined();
  });

  it('today <date> on or before the end day is a historical question: its records, no sentence; the day after says so', async () => {
    const r = await getMatchesForDate(cup({ events: [finalFT] }).adapter, '2026-10-08');
    expect(ids(r.matches)).toEqual(['50']);
    expect(r.betweenEditions).toBeUndefined();
    // Oct 9 is after the end day (Eastern Oct 8): the final is in the three-day
    // read, finished, so it neither blocks the sentence nor is the day's body.
    const after = await getMatchesForDate(cup({ events: [finalFT] }).adapter, '2026-10-09');
    expect(after.betweenEditions).toMatchObject({ label: '2026 Concacaf Champions Cup' });
  });

  it('the dated read judges "nothing to present" on the asked LOCAL date, a finished result included: a UTC user still sees the final', async () => {
    // Found by the coder: the final at 02:00Z on Oct 9 is Oct 8 for the
    // provider and Oct 9 for a UTC viewer. Dropping the window's records
    // whenever the edition had ended hid it from that viewer on every date.
    // The window's records are kept; the verdict is stated only when the asked
    // local date holds nothing at all (a finished result is that day's body).
    const utc9 = await getMatchesForDate(cup({ events: [finalFT] }).adapter, '2026-10-09', 'UTC');
    expect(ids(utc9.matches)).toContain('50');
    expect(utc9.betweenEditions).toBeUndefined();
    const utc10 = await getMatchesForDate(cup({ events: [finalFT] }).adapter, '2026-10-10', 'UTC');
    expect(utc10.betweenEditions).toMatchObject({ label: '2026 Concacaf Champions Cup' });
    const ny9 = await getMatchesForDate(cup({ events: [finalFT] }).adapter, '2026-10-09', 'America/New_York');
    expect(ny9.betweenEditions).toMatchObject({ label: '2026 Concacaf Champions Cup' });
    // The window's records are still there for the surface's own filter, and a scheduled one still blocks.
    expect(ids(ny9.matches)).toContain('50');
    const ny8 = await getMatchesForDate(cup({ events: [finalFT] }).adapter, '2026-10-08', 'America/New_York');
    expect(ny8.betweenEditions).toBeUndefined();
  });

  it('a scheduled or in-play fixture of any club: shown, and the sentence not stated (the provider owns the contradiction)', async () => {
    const scheduled: Ev = { id: '51', date: '2026-10-14T02:00Z', home: { id: '8001', abbr: 'TOL', name: 'Toluca' }, away: { id: '8003', abbr: 'MTY', name: 'Monterrey' } };
    const next = await getNextFixtureForTeam(cup({ events: [finalFT, scheduled] }).adapter, 'Toluca', NOW);
    expect(next.fixture?.id).toBe('51');
    expect(next.betweenEditions).toBeUndefined();
    // Another club's fixture means the competition is not between editions either: the horizon sentence instead.
    const other = await getNextFixtureForTeam(cup({ events: [finalFT, scheduled] }).adapter, 'Los Angeles FC', NOW);
    expect(other.fixture).toBeUndefined();
    expect(other.betweenEditions).toBeUndefined();
    expect(other.horizon).toEqual({ days: 14 });
    const inPlay = await getLiveMatches(cup({ events: [{ ...scheduled, date: '2026-10-10T14:30Z', state: 'in' }] }).adapter, NOW);
    expect(ids(inPlay.matches)).toEqual(['51']);
    expect(inPlay.betweenEditions).toBeUndefined();
  });

  it('no end date, parts disagreeing on the end date, a turn, or an incomplete read: nothing stated', async () => {
    const noEnd = await getLiveMatches(cup({ season: () => ({ year: 2026, displayName: '2026 Concacaf Champions Cup' }) }).adapter, NOW);
    expect(noEnd.betweenEditions).toBeUndefined();
    const disagree = await getLiveMatches(
      cup({ season: (d) => (d === '20261010' ? { ...ENDED, endDate: '2026-12-31T05:00Z' } : ENDED) }).adapter,
      NOW,
    );
    expect(disagree.betweenEditions).toBeUndefined();
    const turn = await getLiveMatches(cup({ season: (d) => (d === '20261011' ? { ...ENDED, year: 2027, endDate: '2027-10-09T03:59Z' } : ENDED) }).adapter, NOW);
    expect(turn.betweenEditions).toBeUndefined();
    const broken: Ev = { id: '52', date: '2026-10-10T20:00Z', home: { id: '8001', abbr: 'TOL', name: 'Toluca' }, away: { id: '8003', abbr: 'MTY', name: 'Monterrey' }, raw: { status: { type: { name: 'STATUS_NEW', state: 'limbo' } } } };
    const incomplete = await getLiveMatches(cup({ events: [broken] }).adapter, NOW);
    expect(incomplete.matches).toEqual([]);
    expect(incomplete.betweenEditions).toBeUndefined();
    // A readable sibling keeps the discovery an incomplete read rather than a refused one.
    const incompleteNext = await getNextFixtureForTeam(cup({ events: [broken, finalFT] }).adapter, 'Toluca', NOW);
    expect(incompleteNext.betweenEditions).toBeUndefined();
    expect(incompleteNext.partial).toEqual({ omitted: 1 });
  });

  it('a match asked for by id is answered as asked: the previous final, found inside the lookback, is the body, with no sentence (review round 1: deliberate)', async () => {
    // Like `today <date in the old edition>`: a historical question gets its record. Asked the day after the final.
    const r = await getMatchById(cup({ events: [finalFT] }).adapter, '50', new Date('2026-10-09T15:00:00Z'));
    expect(r.match?.id).toBe('50');
    expect(r.match?.status).toBe('FT');
    expect(r.source).toBe('espn');
    expect(r.degraded).toBe(false);
    expect(r.betweenEditions).toBeUndefined();
  });

  it('the provider day after the end day is between editions; the end day itself is not', async () => {
    // ENDED's end is 03:59Z on Oct 9 = Eastern Oct 8, 23:59. Asked on Eastern Oct 8: not yet.
    const onEndDay = await getLiveMatches(cup().adapter, new Date('2026-10-09T01:00:00Z'));
    expect(onEndDay.betweenEditions).toBeUndefined();
    const after = await getLiveMatches(cup().adapter, new Date('2026-10-09T12:00:00Z'));
    expect(after.betweenEditions).toBeDefined();
  });

  it('the day asked by next and match is the provider’s, not the UTC date (02:00Z on Oct 9 is still the end day)', async () => {
    const at = new Date('2026-10-09T02:00:00Z'); // Eastern Oct 8 22:00: the end day itself
    const next = await getNextFixtureForTeam(cup().adapter, 'Toluca', at);
    expect(next.betweenEditions).toBeUndefined();
    const match = await getMatchById(cup().adapter, '99', at);
    expect(match.betweenEditions).toBeUndefined();
    const later = new Date('2026-10-09T12:00:00Z'); // Eastern Oct 9: after it
    expect((await getNextFixtureForTeam(cup().adapter, 'Toluca', later)).betweenEditions).toBeDefined();
    expect((await getMatchById(cup().adapter, '99', later)).betweenEditions).toBeDefined();
  });

  it('on the bundle the verdict is never stated', async () => {
    const f = feed('fifa.world', { season: () => ({ year: 2026, displayName: '2026 FIFA World Cup', startDate: '2026-06-11T04:00Z', endDate: '2026-07-20T03:59Z' }) });
    const r = await getLiveMatches(f.adapter, NOW);
    expect(r.betweenEditions).toBeUndefined();
  });
});

describe('a composed season carries its end date only when every stating part agrees (0.11 2.1c)', () => {
  it('a window: the same end date in every part keeps it; a different or missing one drops it, the year stays', async () => {
    const same = await feed('eng.1').adapter.fetchWindow?.('2026-10-09', '2026-10-11');
    expect(fetchMeta(same ?? [])?.season).toMatchObject({ year: 2026, endDate: '2027-05-30T03:59:00.000Z' });
    const differ = await feed('eng.1', { season: (d) => (d === '20261010' ? { ...S2026, endDate: '2027-06-01T03:59Z' } : S2026) }).adapter.fetchWindow?.('2026-10-09', '2026-10-11');
    const m = fetchMeta(differ ?? [])?.season;
    expect(m?.year).toBe(2026);
    expect(m?.endDate).toBeUndefined();
    const missing = await feed('eng.1', { season: (d) => (d === '20261010' ? { year: 2026, displayName: S2026.displayName } : S2026) }).adapter.fetchWindow?.('2026-10-09', '2026-10-11');
    expect(fetchMeta(missing ?? [])?.season?.endDate).toBeUndefined();
  });

  it('a discovery across two months counts a fixture filed in both as a record left out', async () => {
    const late = new Date('2026-10-25T15:00:00.000Z');
    const twice: Ev = { id: '60', date: '2026-11-01T15:00Z', home: ARS, away: CHE };
    // Both month responses hold the same fixture (the provider filed it under one day; two months cannot both hold it).
    const both = (async (input: unknown) => {
      const url = String(input);
      if (url.includes('/standings')) return json(PL_TABLE);
      const asked = new URL(url).searchParams.get('dates') ?? '';
      if (asked === '202610' || asked === '202611') return json({ leagues: [{ season: S2026 }], events: [event(twice)] });
      return json({ leagues: [{ season: S2026 }], events: [] });
    }) as unknown as typeof fetch;
    const adapter = new EspnAdapter({ competition: 'eng.1', fetchImpl: both, now: () => late.getTime() });
    const r = await getScheduleAhead(adapter, late);
    expect(r.complete).toBe(false);
    expect(r.omitted).toBe(1);
  });

  it('a discovery across two months: the same rule', async () => {
    const late = new Date('2026-10-25T15:00:00.000Z'); // the span touches October and November
    const agree = await getScheduleAhead(feed('eng.1').adapter, late);
    expect(agree.season).toMatchObject({ year: 2026, endDate: '2027-05-30T03:59:00.000Z' });
    const differ = await getScheduleAhead(feed('eng.1', { season: (d) => (d === '202611' ? { ...S2026, endDate: '2027-06-01T03:59Z' } : S2026) }).adapter, late);
    expect(differ.season?.year).toBe(2026);
    expect(differ.season?.endDate).toBeUndefined();
  });
});
