/**
 * The goal moments, 4a-i: the refresher's record of play on the snapshot (`play: PlayState`, advanced by
 * `advancePlay` in `src/play.ts`), written by BOTH publishers under the lock, on every publish.
 *
 * A match the refresher SAW in play (`play.seen`) that a later whole read returns finished moves to `play.finished`,
 * with the time of that read; a failed read between loses nothing; a cycle that only discovers carries the record as
 * it was. The snapshot stays event-free: no `events` key on a live record nor on a finished one. Each live record is
 * written with `lastGoal`: the proven last scoring event of the read (core's `provenLastGoal`), or null.
 *
 * The feed below is refresher-discovery.test.ts's (a fixture filed under its US/Eastern day, ranges refused), with a
 * score and ESPN's `competitions[0].details` per event, in the shape core's detail grammar reads.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EspnAdapter, getLiveRead, type Match } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cachePath, type CacheState, readState, type ScheduleSlice, writeState } from '../src/cache';
import { runRefresh } from '../src/refresh';

const SOURCE = 'espn';
const MEX = 'mex.1';
const MIN = 60_000;
const HOUR = 60 * MIN;
/** Saturday Oct 10 2026, 15:00Z: Eastern Oct 10. */
const NOW = Date.parse('2026-10-10T15:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

type Play = 'pre' | 'in' | 'post';
type Side = { id: string; abbreviation: string; displayName: string };
const AME: Side = { id: '227', abbreviation: 'AME', displayName: 'América' };
const GDL: Side = { id: '219', abbreviation: 'GDL', displayName: 'Guadalajara' };
type Ev = { id: string; at: number; state?: Play; score?: [number, number]; details?: unknown[]; home?: Side; away?: Side; slug?: string };

/** A scoring detail as ESPN serves it: the six flags, the clock, the credited team, one athlete. */
const goalDetail = (minute: string, team: Side, player: string) => ({
  type: { id: '70', text: 'Goal' },
  scoringPlay: true,
  yellowCard: false,
  redCard: false,
  penaltyKick: false,
  ownGoal: false,
  shootout: false,
  clock: { value: 3000, displayValue: minute },
  team: { id: team.id },
  athletesInvolved: [{ id: '99', displayName: player, team: { id: team.id } }],
});

function event(e: Ev) {
  const state = e.state ?? 'pre';
  const type =
    state === 'in'
      ? { name: 'STATUS_IN_PROGRESS', state: 'in' }
      : state === 'post'
        ? { name: 'STATUS_FULL_TIME', state: 'post', completed: true }
        : { name: 'STATUS_SCHEDULED', state: 'pre' };
  const [h, a] = e.score ?? [1, 0];
  return {
    id: e.id,
    date: iso(e.at),
    season: { slug: e.slug ?? 'regular-season' },
    status: { type, displayClock: state === 'in' ? "55'" : undefined, period: state === 'in' ? 2 : 0 },
    competitions: [
      {
        venue: { fullName: 'Estadio Azteca' },
        competitors: [
          { homeAway: 'home', score: String(h), team: { ...(e.home ?? AME) } },
          { homeAway: 'away', score: String(a), team: { ...(e.away ?? GDL) } },
        ],
        ...(e.details ? { details: e.details } : {}),
      },
    ],
  };
}
const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const easternDay = (ms: number) => eastern.format(new Date(ms)).replace(/-/g, '');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** What the provider holds and how it answers. Tests change it between cycles. */
let events: Ev[] = [];
let failing: (dates: string) => Response | undefined = () => undefined;
/** Raw records served beside the events, for one request (a record the parser refuses). */
let extra: (dates: string) => unknown[] = () => [];
let onRequest: ((dates: string) => void) | undefined;
let asked: string[] = [];
const months = () => asked.filter((d) => d.length === 6);
const days = () => asked.filter((d) => d.length === 8);

const refresh = (at: number, competition = MEX) => runRefresh({ source: SOURCE, competition, now: new Date(at), jitterMs: 0 });
const state = (competition = MEX) => readState(SOURCE, competition);
/** The snapshot file as written: the raw JSON, no reader in between. */
const raw = (competition = MEX) => JSON.parse(readFileSync(cachePath(SOURCE, competition), 'utf8')) as Record<string, unknown>;
const play = (competition = MEX) => state(competition)?.play;
const seenIds = (competition = MEX) => (play(competition)?.seen ?? []).map((e) => e.id);
const finishedIds = (competition = MEX) => (play(competition)?.finished ?? []).map((e) => e.match.id);
/** A stamp written by this cycle: at its `now`, or the moment its read was admitted (the cycle's clock, a few ms on). */
const atCycle = (stamp: string | undefined, cycle: number) => {
  const ms = Date.parse(stamp ?? '');
  expect(ms, String(stamp)).toBeGreaterThanOrEqual(cycle);
  expect(ms, String(stamp)).toBeLessThan(cycle + 5_000);
};

let dir: string;
const ORIG = process.env.XDG_CACHE_HOME;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-play-'));
  process.env.XDG_CACHE_HOME = dir;
  events = [];
  failing = () => undefined;
  extra = () => [];
  onRequest = undefined;
  asked = [];
  vi.stubGlobal('fetch', async (input: unknown) => {
    const dates = new URL(String(input)).searchParams.get('dates') ?? '';
    asked.push(dates);
    onRequest?.(dates);
    const failure = failing(dates);
    if (failure) return failure;
    if (dates.includes('-')) return json({ code: 400, message: 'Failed to get events endpoint.' }, 400);
    const inBucket = (e: Ev) => (dates.length === 8 ? easternDay(e.at) === dates : easternDay(e.at).startsWith(dates));
    return json({ leagues: [{ season: { year: 2026, displayName: '2026-27 Liga MX' } }], events: [...events.filter(inBucket).map(event), ...extra(dates)] });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIG === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = ORIG;
  rmSync(dir, { recursive: true, force: true });
});

const KICKOFF = NOW - 30 * MIN;
/** Cycle 1: no cache, the match in play: discovery, then a whole live read that holds it. */
const firstCycleInPlay = async (over: Partial<Ev> = {}) => {
  events = [{ id: '1', at: KICKOFF, state: 'in', ...over }];
  await refresh(NOW);
  expect(days(), 'cycle 1 read live').toHaveLength(3);
};

describe('the off-bundle publisher writes the record of play', () => {
  it('(a) a whole live read with a match in play writes play.seen with its id and the cycle\'s time', async () => {
    await firstCycleInPlay();
    expect(state()?.live.map((m) => m.id)).toEqual(['1']);
    expect(seenIds()).toEqual(['1']);
    atCycle(play()?.seen[0]?.at, NOW);
    expect(finishedIds()).toEqual([]);
  });

  it('(b) the next cycle whose window serves that match post writes it in play.finished with that cycle\'s time, not in seen', async () => {
    await firstCycleInPlay();
    const T2 = NOW + 20_000;
    events = [{ id: '1', at: KICKOFF, state: 'post', score: [2, 1] }];
    asked = [];
    await refresh(T2);
    expect(days(), 'cycle 2 read live').toHaveLength(3);
    expect(state()?.live).toEqual([]);
    expect(seenIds()).toEqual([]);
    expect(finishedIds()).toEqual(['1']);
    const f = play()?.finished[0];
    atCycle(f?.at, T2);
    expect(f?.match).toMatchObject({ id: '1', status: 'FT', score: { home: 2, away: 1 } });
  });

  it('(c) in play, then a cycle whose day requests fail, then full time: the match still reaches play.finished', async () => {
    await firstCycleInPlay();
    failing = (d) => (d.length === 8 ? json({}, 500) : undefined);
    asked = [];
    await refresh(NOW + 20_000);
    expect(days(), 'cycle 2 asked and failed').toHaveLength(3);
    expect(state()?.degraded).toBe(true);
    expect(seenIds(), 'a failed read keeps what was seen').toEqual(['1']);
    expect(finishedIds()).toEqual([]);
    failing = () => undefined;
    events = [{ id: '1', at: KICKOFF, state: 'post', score: [0, 3] }];
    asked = [];
    const T3 = NOW + 40_000;
    await refresh(T3);
    expect(state()?.degraded).toBe(false);
    expect(seenIds()).toEqual([]);
    expect(finishedIds()).toEqual(['1']);
    atCycle(play()?.finished[0]?.at, T3);
    expect(play()?.finished[0]?.match.score).toEqual({ home: 0, away: 3 });
  });

  it('(d) a cycle that runs discovery only (the gate closed) carries play unchanged, on its attempt publish and its last', async () => {
    const ft: Match = {
      id: '8',
      stage: 'REGULAR',
      kickoff: iso(NOW - 3 * HOUR),
      venue: 'Estadio Azteca',
      home: { id: 'espn:227', code: 'AME', name: 'América' },
      away: { id: 'espn:219', code: 'GDL', name: 'Guadalajara' },
      status: 'FT',
      score: { home: 2, away: 2 },
      updatedAt: iso(NOW - MIN),
    };
    const seeded = { seen: [{ id: '7', at: iso(NOW - MIN) }], finished: [{ match: ft, at: iso(NOW - 2 * MIN) }] };
    // Discovery due (its last success two hours ago), the live slice stale, nothing ahead inside a window.
    const old = iso(NOW - 2 * HOUR);
    const schedule: ScheduleSlice = { index: [], updatedAt: old, attemptedAt: old, failures: 0, complete: true, season: { year: 2026, label: '2026-27 Liga MX' } };
    writeState({ updatedAt: old, live: [], liveComplete: true, degraded: false, source: SOURCE, competition: MEX, schedule, play: seeded } as CacheState);
    events = [{ id: '1', at: NOW + 20 * HOUR }];
    let atAttempt: unknown;
    onRequest = (d) => {
      if (d.length === 6) atAttempt = state()?.play;
    };
    await refresh(NOW);
    expect(months()).toEqual(['202610']);
    expect(days(), 'the gate stayed closed').toEqual([]);
    const shape = (p: unknown) => {
      const s = p as CacheState['play'];
      return { seen: s?.seen, finished: (s?.finished ?? []).map((e) => ({ id: e.match.id, at: e.at, score: e.match.score, status: e.match.status })) };
    };
    const expected = { seen: seeded.seen, finished: [{ id: '8', at: seeded.finished[0]?.at, score: { home: 2, away: 2 }, status: 'FT' }] };
    expect(shape(atAttempt), 'the attempt publish, written before the month request').toEqual(expected);
    expect(shape(play()), 'the cycle\'s last publish').toEqual(expected);
  });

  it('(e) the file on disk carries no `events` key on a finished record nor on a live one', async () => {
    const details = [goalDetail("50'", AME, 'Henry Martin')];
    await firstCycleInPlay({ details });
    const live1 = raw().live as Array<Record<string, unknown>>;
    expect(live1.map((m) => m.id)).toEqual(['1']);
    for (const m of live1) expect('events' in m, 'live record').toBe(false);
    events = [{ id: '1', at: KICKOFF, state: 'post', score: [1, 0], details }];
    await refresh(NOW + 20_000);
    const file = raw();
    const finished = ((file.play as { finished?: Array<{ match: Record<string, unknown> }> } | undefined)?.finished ?? []);
    expect(finished.map((e) => e.match.id)).toEqual(['1']);
    for (const e of finished) expect('events' in e.match, 'finished record').toBe(false);
    for (const m of file.live as Array<Record<string, unknown>>) expect('events' in m).toBe(false);
    // Control: the feed's records DO carry events (the read parses the details), so their absence is the writer's.
    events = [{ id: '1', at: KICKOFF, state: 'in', details }];
    const r = await getLiveRead(new EspnAdapter({ competition: MEX, enrichGroups: false }), new Date(NOW));
    expect(r.matches[0]?.events?.length, 'the read holds events').toBeGreaterThan(0);
  });

  it('(f) a live record is written with lastGoal: the proven last scoring event, or null when the details do not prove the score', async () => {
    events = [
      // 2-0, two scoring details for the home side: the score is proven, the last one made it.
      { id: '1', at: KICKOFF, state: 'in', score: [2, 0], details: [goalDetail("12'", AME, 'Henry Martin'), goalDetail("49'", AME, 'Alejandro Zendejas')] },
      // 2-0 with ONE scoring detail: the timeline lags the score, nothing is proven.
      { id: '2', at: KICKOFF, state: 'in', score: [2, 0], details: [goalDetail("12'", AME, 'Henry Martin')] },
      // 1-0 and no details at all.
      { id: '3', at: KICKOFF, state: 'in', score: [1, 0] },
    ];
    await refresh(NOW);
    const live = raw().live as Array<Record<string, unknown>>;
    const byId = new Map(live.map((m) => [m.id, m]));
    expect([...byId.keys()].sort()).toEqual(['1', '2', '3']);
    expect(byId.get('1')?.lastGoal).toEqual({ type: 'GOAL', minute: 49, side: 'home', teamCode: 'AME', player: 'Alejandro Zendejas' });
    expect(byId.get('2')).toHaveProperty('lastGoal', null);
    expect(byId.get('3')).toHaveProperty('lastGoal', null);
  });
});

describe('the bundled competition\'s publisher carries play too', () => {
  // The World Cup lane (`runRefresh`'s own publish, not `refreshOffBundle`'s), during a bundled window: Austria v
  // Jordan kicked off at 04:00Z on Jun 17 (the provider files it under its next day bucket).
  const WC = 'fifa.world';
  const DURING = Date.parse('2026-06-17T05:00:00.000Z');
  const AUT: Side = { id: '474', abbreviation: 'AUT', displayName: 'Austria' };
  const JOR: Side = { id: '2917', abbreviation: 'JOR', displayName: 'Jordan' };
  const wc = (state: Play, score: [number, number]): Ev => ({ id: '760431', at: Date.parse('2026-06-17T04:00:00.000Z'), state, score, home: AUT, away: JOR, slug: 'group-stage' });

  it('in play, then full time: seen, then finished, with the record and the time of the read', async () => {
    events = [wc('in', [2, 1])];
    await refresh(DURING, WC);
    expect(state(WC)?.live.map((m) => m.id)).toEqual(['760431']);
    expect(seenIds(WC)).toEqual(['760431']);
    atCycle(play(WC)?.seen[0]?.at, DURING);
    events = [wc('post', [2, 1])];
    const T2 = DURING + 60_000;
    await refresh(T2, WC);
    expect(state(WC)?.live).toEqual([]);
    expect(seenIds(WC)).toEqual([]);
    expect(finishedIds(WC)).toEqual(['760431']);
    atCycle(play(WC)?.finished[0]?.at, T2);
    expect(play(WC)?.finished[0]?.match.score).toEqual({ home: 2, away: 1 });
    const file = raw(WC);
    for (const e of (file.play as { finished: Array<{ match: Record<string, unknown> }> }).finished) expect('events' in e.match).toBe(false);
  });

  it('the seen ids reach the live read on this lane too: the seen match, the 65th finished record of the window, still reaches play.finished', async () => {
    // Round 2 (the stand-in): `getLiveRead(adapter, now, [])` on this lane alone survived the suite.
    events = [wc('in', [2, 1])];
    await refresh(DURING, WC);
    expect(seenIds(WC)).toEqual(['760431']);
    // 64 other finished records come first in the window (same day, earlier); the seen match is the 65th.
    const earlier = Date.parse('2026-06-17T01:00:00.000Z');
    const others: Ev[] = Array.from({ length: 64 }, (_, i) => ({ id: String(9100 + i), at: earlier, state: 'post', score: [1, 1], slug: 'group-stage' }));
    events = [...others, wc('post', [2, 1])];
    await refresh(DURING + 60_000, WC);
    expect(finishedIds(WC)).toEqual(['760431']);
  });
});

describe('a read that is not whole, and the finished list\'s cap, never decide that a seen match is gone', () => {
  /** `n` other matches that finished earlier today, listed in the window BEFORE anything else this day holds. */
  const others = (n: number): Ev[] => Array.from({ length: n }, (_, i) => ({ id: String(9000 + i), at: NOW - 3 * HOUR, state: 'post', score: [1, 1] }));

  it('(a) in play, then a read that is not whole but not degraded (a refused record, the match absent), then full time: it reaches play.finished', async () => {
    await firstCycleInPlay();
    // Cycle 2: the match's own record is not served; a readable sibling and a record the parser refuses are.
    events = [{ id: '5', at: NOW + 3 * HOUR }];
    extra = (d) => (d === easternDay(NOW) ? [{ id: 'not an id', date: iso(NOW), status: { type: { name: 42 } } }] : []);
    asked = [];
    await refresh(NOW + 20_000);
    expect(days(), 'cycle 2 read live').toHaveLength(3);
    expect(state()).toMatchObject({ degraded: false, liveComplete: false, live: [] });
    expect(seenIds(), 'a partial read keeps what was seen').toEqual(['1']);
    expect(finishedIds()).toEqual([]);
    // Cycle 3: whole, the match served finished.
    extra = () => [];
    events = [{ id: '1', at: KICKOFF, state: 'post', score: [3, 2] }, { id: '5', at: NOW + 3 * HOUR }];
    asked = [];
    const T3 = NOW + 40_000;
    await refresh(T3);
    expect(days(), 'cycle 3 read live').toHaveLength(3);
    expect(state()).toMatchObject({ degraded: false, liveComplete: true });
    expect(seenIds()).toEqual([]);
    expect(finishedIds()).toEqual(['1']);
    atCycle(play()?.finished[0]?.at, T3);
    expect(play()?.finished[0]?.match.score).toEqual({ home: 3, away: 2 });
  });

  it('(b) the seen ids reach the live read: the seen match, the 65th finished record of the window, still reaches play.finished', async () => {
    await firstCycleInPlay();
    // 64 other finished records come first in the window; the seen match is the 65th, past the cap of 64.
    events = [...others(64), { id: '1', at: KICKOFF, state: 'post', score: [2, 2] }];
    asked = [];
    await refresh(NOW + 20_000);
    expect(days(), 'cycle 2 read live').toHaveLength(3);
    expect(state()).toMatchObject({ degraded: false, liveComplete: true, live: [] });
    expect(seenIds()).toEqual([]);
    expect(finishedIds()).toEqual(['1']);
    expect(play()?.finished[0]?.match.score).toEqual({ home: 2, away: 2 });
  });

  it('(c) the cut reaches advancePlay: with more than 64 other finished records and the seen match absent, seen keeps it', async () => {
    await firstCycleInPlay();
    events = others(65);
    asked = [];
    await refresh(NOW + 20_000);
    expect(days(), 'cycle 2 read live').toHaveLength(3);
    expect(state()).toMatchObject({ degraded: false, liveComplete: true, live: [] });
    expect(seenIds(), 'a cut finished list decides nothing').toEqual(['1']);
    expect(finishedIds()).toEqual([]);
  });

  it('(c, control) with the list NOT cut and the seen match absent, the whole read drops it with nothing said', async () => {
    await firstCycleInPlay();
    events = others(3);
    asked = [];
    await refresh(NOW + 20_000);
    expect(days(), 'cycle 2 read live').toHaveLength(3);
    expect(state()).toMatchObject({ degraded: false, liveComplete: true, live: [] });
    expect(seenIds()).toEqual([]);
    expect(finishedIds()).toEqual([]);
  });
});
