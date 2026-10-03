/**
 * 0.11 PR 2.1c, added by the coder beside the specification
 * (`off-bundle-reads.test.ts`): cases its mutation pass showed no test could
 * see. Each names the rule it pins.
 */
import { describe, expect, it } from 'vitest';
import { EspnAdapter } from '../src/adapters/espn';
import { getLiveMatches, getMatchById, getMatchesForDate, getNextFixtureForTeam } from '../src/live';
import { resolveClub, rosterFor } from '../src/teams';
import type { Match, Team } from '../src/types';

const STATS = ['gamesPlayed', 'wins', 'ties', 'losses', 'pointsFor', 'pointsAgainst', 'pointDifferential', 'points', 'rank'];
const NOW = new Date('2026-10-10T15:00:00.000Z');
const ENDED = { year: 2026, displayName: '2026 Concacaf Champions Cup', startDate: '2026-02-01T05:00Z', endDate: '2026-10-09T03:59Z' };
const OPEN = { ...ENDED, endDate: '2026-12-31T05:00Z' };
const NO_TABLE = { name: 'Concacaf Champions Cup', season: { year: 2026 }, seasons: [{ year: 2016 }] };

type Side = { id?: string; abbr: string; name: string };
type Ev = { id: string; date: string; home: Side; away: Side; state?: 'pre' | 'in' | 'post' };
const TOL: Side = { id: '8001', abbr: 'TOL', name: 'Toluca' };
const LAFC: Side = { id: '8002', abbr: 'LAFC', name: 'Los Angeles FC' };
const MTY: Side = { id: '8003', abbr: 'MTY', name: 'Monterrey' };

function event(e: Ev) {
  const state = e.state ?? 'pre';
  const type =
    state === 'in'
      ? { name: 'STATUS_IN_PROGRESS', state: 'in' }
      : state === 'post'
        ? { name: 'STATUS_FULL_TIME', state: 'post' }
        : { name: 'STATUS_SCHEDULED', state: 'pre' };
  const side = (s: Side, homeAway: string) => ({
    homeAway,
    score: '0',
    team: { ...(s.id ? { id: s.id } : {}), abbreviation: s.abbr, displayName: s.name },
  });
  return {
    id: e.id,
    date: e.date,
    season: { slug: 'regular-season' },
    status: { type, period: state === 'in' ? 2 : 0 },
    competitions: [{ competitors: [side(e.home, 'home'), side(e.away, 'away')] }],
  };
}
const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const easternDay = (iso: string) => eastern.format(new Date(iso)).replace(/-/g, '');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function feed(competition: string, opts: { events?: Ev[]; season?: unknown; standings?: unknown } = {}) {
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    if (url.includes('/standings')) return json(opts.standings ?? NO_TABLE);
    const asked = new URL(url).searchParams.get('dates') ?? '';
    const inBucket = (e: Ev) =>
      asked.length === 8 ? easternDay(e.date) === asked : asked.length === 6 ? easternDay(e.date).startsWith(asked) : false;
    return json({ leagues: [{ season: opts.season ?? ENDED }], events: (opts.events ?? []).filter(inBucket).map(event) });
  }) as unknown as typeof fetch;
  return new EspnAdapter({ competition, fetchImpl, now: () => NOW.getTime() });
}
const entries = (sides: Side[]) =>
  sides.map((s, i) => ({
    team: { ...(s.id ? { id: s.id } : {}), abbreviation: s.abbr, displayName: s.name },
    stats: STATS.map((n) => ({ name: n, value: n === 'rank' ? i + 1 : 0 })),
  }));

describe('the roster: a table missing from the inventory is not a complete roster', () => {
  it('one group read, one child that is not a group: the read is incomplete, so is the roster', async () => {
    const standings = {
      children: [
        { name: 'Group A', standings: { entries: entries([TOL, MTY]) } },
        { name: 'Something Else', standings: { entries: entries([LAFC]) } },
      ],
    };
    const roster = await rosterFor(feed('conmebol.libertadores', { standings }));
    expect(roster.tableAsked).toBe(true);
    expect(roster.teams.map((t) => t.name).sort()).toEqual(['Monterrey', 'Toluca']);
    expect(roster.complete).toBe(false);
  });
});

describe('the resolver: a row with no id is the club the schedule names with one', () => {
  it('an id-less roster row and a schedule side with an id and the same code and name are ONE club, by its id', () => {
    const idless: Team = { code: 'TOL', name: 'Toluca', flag: '\u{1F3F3}️' };
    const withId: Team = { ...idless, id: 'espn:8001' };
    const other: Team = { code: 'MTY', name: 'Monterrey', flag: '\u{1F3F3}️', id: 'espn:8003' };
    const fixture = { id: '1', stage: 'FRIENDLY', kickoff: '2026-10-12T02:00:00.000Z', venue: '', home: withId, away: other, status: 'SCHEDULED', updatedAt: NOW.toISOString() } as Match;
    const r = resolveClub('Toluca', { teams: [idless], complete: false, tableAsked: true }, [fixture]);
    expect(r).toMatchObject({ outcome: 'resolved', team: { id: 'espn:8001' } });
  });
});

describe('next: a club the read holds but cannot identify is not "no fixture"', () => {
  it('no table, and the only side matching the name has no id: degraded, never the horizon sentence', async () => {
    const idlessTol: Side = { abbr: 'TOL', name: 'Toluca' };
    const r = await getNextFixtureForTeam(
      feed('concacaf.champions', { season: OPEN, events: [{ id: '60', date: '2026-10-14T02:00Z', home: idlessTol, away: MTY }] }),
      'Toluca',
      NOW,
    );
    expect(r.degraded).toBe(true);
    expect(r.horizon).toBeUndefined();
    expect(r.fixture).toBeUndefined();
  });
});

describe('between editions is asked of the WHOLE read, before a surface filters it', () => {
  it('the live read: a fixture scheduled in its window (not in play) means the edition is not over', async () => {
    const scheduled: Ev = { id: '61', date: '2026-10-11T02:00Z', home: TOL, away: MTY };
    const live = await getLiveMatches(feed('concacaf.champions', { events: [scheduled] }), NOW);
    expect(live.matches).toEqual([]);
    expect(live.betweenEditions).toBeUndefined();
  });

  it('the dated read: the previous final inside the window, on ANOTHER local date, does not block it, and the window\u2019s records are kept', async () => {
    const finalFT: Ev = { id: '50', date: '2026-10-09T02:00Z', home: TOL, away: LAFC, state: 'post' };
    // Oct 9 asks the provider days Oct 8 to 10: the final (Eastern Oct 8) is
    // in the read. With no zone named, the asked date is the provider's.
    const r = await getMatchesForDate(feed('concacaf.champions', { events: [finalFT] }), '2026-10-09');
    expect(r.betweenEditions).toBeDefined();
    expect(r.matches.map((m) => m.id)).toEqual(['50']);
    // Named zones decide the asked date: Oct 9 in New York holds nothing, in UTC the final.
    expect((await getMatchesForDate(feed('concacaf.champions', { events: [finalFT] }), '2026-10-09', 'America/New_York')).betweenEditions).toBeDefined();
    expect((await getMatchesForDate(feed('concacaf.champions', { events: [finalFT] }), '2026-10-09', 'UTC')).betweenEditions).toBeUndefined();
  });

  it('the dated read: a scheduled record anywhere in the window still blocks it, also off the asked local date', async () => {
    // Oct 11 asks provider days Oct 10 to 12; this one is Oct 12 (Eastern and UTC), not the asked UTC date.
    const scheduled: Ev = { id: '62', date: '2026-10-12T20:00Z', home: TOL, away: MTY };
    const r = await getMatchesForDate(feed('concacaf.champions', { events: [scheduled] }), '2026-10-11', 'UTC');
    expect(r.matches.map((m) => m.id)).toEqual(['62']);
    expect(r.betweenEditions).toBeUndefined();
  });
});

describe('the dated read on the BUNDLED competition stays strict at a season turn', () => {
  it('two seasons in its three days: refused, the bundled skeleton only, degraded (the skeleton is never merged over another edition)', async () => {
    const turn = (dates: string) => ({ year: dates >= '20260612' ? 2027 : 2026, displayName: 'FIFA World Cup' });
    const fetchImpl = (async (input: unknown) => {
      const url = String(input);
      if (url.includes('/standings')) return json({});
      const asked = new URL(url).searchParams.get('dates') ?? '';
      return json({ leagues: [{ season: turn(asked) }], events: [] });
    }) as unknown as typeof fetch;
    const r = await getMatchesForDate(new EspnAdapter({ competition: 'fifa.world', enrichGroups: false, fetchImpl }), '2026-06-11');
    expect(r.degraded).toBe(true);
    expect(r.source).toBeUndefined();
    expect(r.matches.some((m) => m.id === '760415')).toBe(true);
  });
});

describe('match <id>: a WHOLE refresh that does not hold the record does not present it as refreshed', () => {
  it('the month’s record, attributed, degraded, with no partial', async () => {
    const ARS: Side = { id: '359', abbr: 'ARS', name: 'Arsenal' };
    const LIV: Side = { id: '364', abbr: 'LIV', name: 'Liverpool' };
    const inSpan: Ev = { id: '41', date: '2026-10-17T14:00Z', home: LIV, away: ARS };
    const fetchImpl = (async (input: unknown) => {
      const url = String(input);
      if (url.includes('/standings')) return json({});
      const asked = new URL(url).searchParams.get('dates') ?? '';
      // The month holds it; the days (a whole, empty answer) do not.
      const events = asked.length === 6 && easternDay(inSpan.date).startsWith(asked) ? [event(inSpan)] : [];
      return json({ leagues: [{ season: OPEN }], events });
    }) as unknown as typeof fetch;
    const r = await getMatchById(new EspnAdapter({ competition: 'eng.1', fetchImpl, now: () => NOW.getTime() }), '41');
    expect(r).toMatchObject({ degraded: true, source: 'espn', match: { id: '41' } });
    expect(r.partial).toBeUndefined();
  });
});

describe('review round 1 (coder): the selection predicate, the World Cup name argument, the vocabulary', () => {
  it('isTeam: equal ids decide when both carry one; otherwise the same code and name; sameTeam is unchanged', async () => {
    const { isTeam, sameTeam } = await import('../src/trust/match');
    const carabobo: Team = { id: 'espn:7001', code: 'CAR', name: 'Carabobo', flag: '' };
    const mislabelled: Team = { id: 'espn:7002', code: 'CAR', name: 'Carabobo', flag: '' };
    const idless: Team = { code: 'CAR', name: 'Carabobo', flag: '' };
    const renamed: Team = { id: 'espn:7001', code: 'CRB', name: 'Carabobo FC', flag: '' };
    expect(isTeam(mislabelled, carabobo)).toBe(false);
    expect(sameTeam(mislabelled, carabobo)).toBe(true); // the pairing refusal is the generous one, as written
    expect(isTeam(idless, carabobo)).toBe(true);
    expect(isTeam(renamed, carabobo)).toBe(true);
  });

  it('nationArg: a code passes as it always did; a name resolves; an ambiguous or unknown name is answered without a request', async () => {
    const { nationArg } = await import('../src/teams');
    expect(nationArg('mex')).toEqual({ code: 'MEX' });
    expect(nationArg('ZZZ')).toEqual({ code: 'ZZZ' });
    expect(nationArg('Mexico')).toEqual({ code: 'MEX' });
    const south = nationArg('South');
    expect('answer' in south && south.answer.candidates?.map((t) => t.code).sort()).toEqual(['KOR', 'RSA']);
    expect(nationArg('Narnia')).toEqual({ answer: { degraded: false, query: 'Narnia', unknownTeam: true } });
  });

  it('no surface spells the "none read" sentences or their keys: they come from the card builders', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    // A file URL's pathname is not a filesystem path on Windows (`/D:/...`): convert it, as the vocabulary guard does.
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const sources = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? sources(join(dir, n)) : n.endsWith('.ts') ? [join(dir, n)] : []));
    for (const pkg of ['cli', 'mcp']) {
      for (const f of sources(join(root, pkg, 'src'))) {
        const code = readFileSync(f, 'utf8');
        expect(/was read in this span|['"`](next|match)\.noneRead['"`]|earlier record\.\)/.test(code), f).toBe(false);
      }
    }
  });
});
