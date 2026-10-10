/**
 * 0.11 PR 2.6b — discovery, then live polling only when a match can be in play.
 *
 * Off the bundled competition the refresher had no schedule, so its live gate
 * was always open: a live read (three requests) every cycle, around the clock.
 * Now a cycle is: discovery if due (the schedule ahead, about once an hour);
 * the backoff again; the gate, on the slice as it now is; a live read if the
 * gate is open and the live slice is at least 12 seconds old; one final publish
 * (the discovery's attempt is written before its request).
 *
 * Requests are pinned by their URLs: a MONTH request (`dates=YYYYMM`) is
 * discovery, DAY requests (`dates=YYYYMMDD`, three of them) are a live read.
 * The feed below files a fixture under its US/Eastern day and refuses ranges,
 * as the provider does. On the base every "the gate is closed" case fails:
 * there the gate does not exist.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let failPublish = 0;
/** The n-th publish of a cycle THROWS (a failed atomic write); 0 for none. */
let throwPublishAt = 0;
let publishes = 0;
/** Runs once, at the moment a refresher asks for the lock: what another process did since its first look. */
let onClaim: (() => void) | undefined;
vi.mock('../src/cache', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/cache')>();
  return {
    ...mod,
    claimLock: (...args: Parameters<typeof mod.claimLock>) => {
      const hook = onClaim;
      onClaim = undefined;
      hook?.();
      return mod.claimLock(...args);
    },
    publishState: (...args: Parameters<typeof mod.publishState>) => {
      publishes++;
      if (throwPublishAt > 0 && publishes === throwPublishAt) throw new Error('the write failed');
      if (failPublish > 0) {
        failPublish--;
        return false;
      }
      return mod.publishState(...args);
    },
  };
});

import { ambientView } from '../src/ambient';
import { cachePath, type CacheState, readState, type ScheduleSlice, writeBackoffNote, writeState } from '../src/cache';
import { refreshWanted, runRefresh } from '../src/refresh';
import { renderHook } from '../src/hook';
import { renderPrompt } from '../src/statusline';

const SOURCE = 'espn';
const MEX = 'mex.1';
const MIN = 60_000;
const HOUR = 60 * MIN;
/** Saturday Oct 10 2026, 15:00Z: Eastern Oct 10. The discovery span is Oct 9 to Oct 24: one month. */
const NOW = Date.parse('2026-10-10T15:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const NEVER = '1970-01-01T00:00:00.000Z';

type Season = { year: number; displayName: string };
const S2026: Season = { year: 2026, displayName: '2026-27 Liga MX' };
const S2025: Season = { year: 2025, displayName: '2025-26 Liga MX' };
type Play = 'pre' | 'in' | 'post' | 'postponed';
type Ev = { id: string; at: number; state?: Play; home?: string; away?: string };
function event(e: Ev) {
  const state = e.state ?? 'pre';
  const type =
    state === 'in'
      ? { name: 'STATUS_IN_PROGRESS', state: 'in' }
      : state === 'post'
        ? { name: 'STATUS_FULL_TIME', state: 'post' }
        : state === 'postponed'
          ? { name: 'STATUS_POSTPONED', state: 'post' }
          : { name: 'STATUS_SCHEDULED', state: 'pre' };
  return {
    id: e.id,
    date: iso(e.at),
    season: { slug: 'regular-season' },
    status: { type, displayClock: state === 'in' ? "55'" : undefined, period: state === 'in' ? 2 : 0 },
    competitions: [
      {
        competitors: [
          { homeAway: 'home', score: '1', team: { id: '227', abbreviation: 'AME', displayName: e.home ?? 'América' } },
          { homeAway: 'away', score: '0', team: { id: '219', abbreviation: 'GDL', displayName: e.away ?? 'Guadalajara' } },
        ],
      },
    ],
  };
}
const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const easternDay = (ms: number) => eastern.format(new Date(ms)).replace(/-/g, '');
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** What the provider holds and how it answers. Tests change it between cycles. */
let events: Ev[] = [];
let season: (dates: string) => Season | undefined = () => S2026;
let failing: (dates: string) => Response | undefined = () => undefined;
let extra: (dates: string) => unknown[] = () => [];
let onRequest: ((dates: string) => void) | undefined;
let asked: string[] = [];
const months = () => asked.filter((d) => d.length === 6);
const days = () => asked.filter((d) => d.length === 8);
const liveReads = () => days().length / 3;

const refresh = (at: number, competition = MEX) => runRefresh({ source: SOURCE, competition, now: new Date(at), jitterMs: 0 });
const state = (competition = MEX) => readState(SOURCE, competition);
const wanted = (at: number) => refreshWanted(at, state(), MEX, SOURCE);
/** A snapshot whose live slice was read `liveAgeMs` before `at`, with a schedule slice. */
const seed = (at: number, schedule: ScheduleSlice | undefined, over: Partial<CacheState> = {}, liveAgeMs = HOUR) =>
  writeState({
    updatedAt: iso(at - liveAgeMs),
    live: [],
    degraded: false,
    source: SOURCE,
    competition: MEX,
    ...(schedule ? { schedule } : {}),
    ...over,
  });
const entry = (id: string, at: number, on = true) => ({ id, kickoff: iso(at), on });
/** A schedule discovered `ago` before `at` (so not due again), holding `index`. */
const fresh = (at: number, index: ReturnType<typeof entry>[], over: Partial<ScheduleSlice> = {}, ago = 10 * MIN): ScheduleSlice => ({
  index,
  updatedAt: iso(at - ago),
  attemptedAt: iso(at - ago),
  failures: 0,
  season: { year: 2026, label: '2026-27 Liga MX' },
  complete: true,
  ...over,
});

let dir: string;
const ORIG = process.env.XDG_CACHE_HOME;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-discovery-'));
  process.env.XDG_CACHE_HOME = dir;
  events = [];
  season = () => S2026;
  failing = () => undefined;
  extra = () => [];
  onRequest = undefined;
  asked = [];
  failPublish = 0;
  throwPublishAt = 0;
  publishes = 0;
  onClaim = undefined;
  vi.stubGlobal('fetch', async (input: unknown) => {
    const url = String(input);
    const dates = new URL(url).searchParams.get('dates') ?? '';
    asked.push(dates);
    onRequest?.(dates);
    const failure = failing(dates);
    if (failure) return failure;
    if (dates.includes('-')) return json({ code: 400, message: 'Failed to get events endpoint.' }, 400);
    const s = season(dates);
    const inBucket = (e: Ev) => (dates.length === 8 ? easternDay(e.at) === dates : easternDay(e.at).startsWith(dates));
    return json({ leagues: s ? [{ season: s }] : [{}], events: [...events.filter(inBucket).map(event), ...extra(dates)] });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIG === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = ORIG;
  rmSync(dir, { recursive: true, force: true });
});

describe('with no cache, the first cycle discovers; it does not read live blind', () => {
  it('nothing on now: one month request, no live read, and the schedule is stored', async () => {
    events = [{ id: '1', at: NOW + 20 * HOUR }];
    await refresh(NOW);
    expect(asked).toEqual(['202610']);
    const s = state();
    expect(s?.schedule?.index).toEqual([entry('1', NOW + 20 * HOUR)]);
    expect(s?.schedule).toMatchObject({ attemptedAt: iso(NOW), updatedAt: iso(NOW), failures: 0, complete: true });
    expect(s?.schedule?.season).toMatchObject({ year: 2026 });
    // No live read was made: the live slice says so, with a stamp that is never fresh.
    expect(s).toMatchObject({ live: [], degraded: false, updatedAt: NEVER });
    expect(s?.fixtures).toBeUndefined();
  });

  it('a window open: it reads live in the same cycle (1 + 3 requests)', async () => {
    events = [{ id: '1', at: NOW - 30 * MIN, state: 'in' }];
    await refresh(NOW);
    expect(months()).toEqual(['202610']);
    expect(days()).toHaveLength(3);
    const s = state();
    expect(s?.live.map((m) => m.id)).toEqual(['1']);
    expect(Date.parse(s?.updatedAt ?? '')).toBeGreaterThanOrEqual(NOW);
    expect(s?.schedule?.inPlayUntil).toBe(iso(NOW - 30 * MIN + 6 * HOUR));
  });

  it('a span that crosses a month, with a window open: 2 + 3, the most a cold start asks', async () => {
    const at = Date.parse('2026-10-25T15:00:00.000Z');
    events = [
      { id: '1', at: at - 30 * MIN, state: 'in' },
      { id: '2', at: Date.parse('2026-11-07T23:00:00.000Z') },
    ];
    await refresh(at);
    expect([...months()].sort()).toEqual(['202610', '202611']);
    expect(asked).toHaveLength(5);
    expect(state()?.schedule?.index?.map((e) => e.id)).toEqual(['1', '2']);
  });

  it('a FIRST answer that is incomplete is stored, with or without a season, and its windows open the gate', async () => {
    for (const stated of [S2026, undefined]) {
      rmSync(dir, { recursive: true, force: true });
      asked = [];
      season = () => stated;
      events = [{ id: '1', at: NOW - 30 * MIN, state: 'pre' }]; // kicked off late: scheduled, inside its window
      extra = (d) => (d === '202610' ? [{ id: 'not an id', date: iso(NOW + HOUR) }] : []);
      await refresh(NOW);
      const s = state();
      expect(s?.schedule?.index, String(stated?.year)).toEqual([entry('1', NOW - 30 * MIN)]);
      expect(s?.schedule?.complete).toBe(false);
      expect(days(), String(stated?.year)).toHaveLength(3);
    }
  });
});

describe('gate closed: a stale live slice and a fresh schedule ask nothing, at any time of day', () => {
  for (const hour of [0, 3, 9, 15, 21]) {
    it(`${String(hour).padStart(2, '0')}:00Z: no request, and the trigger starts no process`, async () => {
      const at = Date.parse(`2026-10-10T${String(hour).padStart(2, '0')}:00:00.000Z`);
      events = [{ id: '1', at: at + 20 * HOUR }];
      seed(at, fresh(at, [entry('1', at + 20 * HOUR)]));
      expect(wanted(at)).toBe(false);
      await refresh(at);
      expect(asked).toEqual([]);
    });
  }

  it('control: the same schedule with its fixture inside its window is read live', async () => {
    events = [{ id: '1', at: NOW - 10 * MIN, state: 'in' }];
    seed(NOW, fresh(NOW, [entry('1', NOW - 10 * MIN)]));
    expect(wanted(NOW)).toBe(true);
    await refresh(NOW);
    expect(months()).toEqual([]);
    expect(days()).toHaveLength(3);
  });

  it('a postponed fixture opens nothing', async () => {
    seed(NOW, fresh(NOW, [entry('1', NOW - 10 * MIN, false)]));
    expect(wanted(NOW)).toBe(false);
    await refresh(NOW);
    expect(asked).toEqual([]);
  });

  it('after the window, with no match seen in play: not refreshed', async () => {
    events = [{ id: '1', at: NOW - 150 * MIN, state: 'post' }];
    seed(NOW, fresh(NOW, [entry('1', NOW - 150 * MIN)]));
    expect(wanted(NOW)).toBe(false);
    await refresh(NOW);
    expect(asked).toEqual([]);
  });
});

describe('inside a window the live slice is refreshed at most every 12 seconds, whatever starts the cycle', () => {
  it('a live read 5 seconds ago is not repeated; at 12 seconds it is', async () => {
    events = [{ id: '1', at: NOW - 10 * MIN, state: 'in' }];
    seed(NOW, fresh(NOW, [entry('1', NOW - 10 * MIN)]), {}, 5000);
    await refresh(NOW);
    expect(asked).toEqual([]);
    await refresh(NOW + 7000);
    expect(days()).toHaveLength(3);
  });

  // 300 cycles, each a refresh through the real lock and cache files: 3 to 5.4 s on the Windows runner (a 5 s
  // default timed out once), so the limit is the work's, not the default.
  it('over a simulated hour with a discovery falling due in it: at most 300 live reads, and one discovery', { timeout: 30_000 }, async () => {
    events = [{ id: '1', at: NOW - 10 * MIN, state: 'in' }];
    // Discovered 5 minutes ago: due again 55 minutes into the hour.
    seed(NOW, fresh(NOW, [entry('1', NOW - 10 * MIN)], {}, 5 * MIN));
    for (let t = 0; t < HOUR; t += 6000) await refresh(NOW + t);
    expect(months()).toHaveLength(1);
    expect(liveReads()).toBeLessThanOrEqual(300);
    // The lower bound is loose on purpose: a read's stamp is the moment it was
    // admitted, a few real milliseconds into its cycle, so with cycles every 6
    // seconds the next one falls at 12 or at 18. Never fewer than every 18.
    expect(liveReads()).toBeGreaterThanOrEqual(200);
  });
});

describe('the continuation: a match seen in play keeps the gate open until it is seen to be over', () => {
  const KICKOFF = NOW - 100 * MIN;
  const AFTER = KICKOFF + 150 * MIN; // past the fixture's 140-minute window
  const held = () => state()?.schedule?.inPlayUntil;
  /** A cycle inside the window that sees the match in play. */
  const seen = async () => {
    events = [{ id: '1', at: KICKOFF, state: 'in' }];
    seed(NOW, fresh(NOW, [entry('1', KICKOFF)]));
    await refresh(NOW);
    expect(held()).toBe(iso(KICKOFF + 6 * HOUR));
    asked = [];
  };

  it('past its window it is still read (extra time, penalties, a long stoppage)', async () => {
    await seen();
    expect(wanted(AFTER)).toBe(true);
    await refresh(AFTER);
    expect(days()).toHaveLength(3);
    expect(state()?.live.map((m) => m.id)).toEqual(['1']);
  });

  it('control: without a match seen in play the same moment asks nothing', async () => {
    events = [{ id: '1', at: KICKOFF, state: 'post' }];
    seed(AFTER, fresh(AFTER, [entry('1', KICKOFF)]));
    await refresh(AFTER);
    expect(asked).toEqual([]);
  });

  it('a FAILED read leaves it', async () => {
    await seen();
    failing = (d) => (d.length === 8 ? json({}, 500) : undefined);
    await refresh(AFTER);
    expect(held()).toBe(iso(KICKOFF + 6 * HOUR));
    expect(state()?.degraded).toBe(true);
    expect(state()?.liveComplete).toBe(false); // a failed read is not whole
  });

  it('an INCOMPLETE read with none in play leaves it: such a read does not prove the match is over', async () => {
    await seen();
    events = [{ id: '1', at: KICKOFF, state: 'post' }];
    extra = (d) => (d.length === 8 && d === easternDay(AFTER) ? [{ id: 'not an id', date: iso(AFTER) }] : []);
    await refresh(AFTER);
    expect(state()?.live).toEqual([]);
    expect(held()).toBe(iso(KICKOFF + 6 * HOUR));
    // The snapshot states that the read was not whole, so the view's empty list is not current and the line syncs
    // (the continuation keeps the gate open): an omitted record is never "nothing on".
    expect(state()?.liveComplete).toBe(false);
    const v = ambientView(state(), { defaultCompetition: false, teamKind: 'club', now: new Date(AFTER) });
    expect(v).toMatchObject({ current: false, degraded: false });
    expect(v.line).toContain('live · syncing…');
  });

  it('a read that holds only an EARLIER match in play does not shorten it', async () => {
    const later = NOW - 20 * MIN;
    events = [
      { id: '1', at: KICKOFF, state: 'in' },
      { id: '2', at: later, state: 'in' },
    ];
    seed(NOW, fresh(NOW, [entry('1', KICKOFF), entry('2', later)]));
    await refresh(NOW);
    expect(held()).toBe(iso(later + 6 * HOUR));
    events = [
      { id: '1', at: KICKOFF, state: 'in' },
      { id: '2', at: later, state: 'post' },
    ];
    await refresh(NOW + MIN);
    expect(held()).toBe(iso(later + 6 * HOUR));
  });

  it('a WHOLE read with none in play ends it, and the next cycle asks nothing', async () => {
    await seen();
    events = [{ id: '1', at: KICKOFF, state: 'post' }];
    await refresh(AFTER);
    expect(days()).toHaveLength(3);
    expect(held()).toBeUndefined();
    expect(state()?.liveComplete).toBe(true); // a whole read: the snapshot says so
    expect(ambientView(state(), { defaultCompetition: false, teamKind: 'club', now: new Date(AFTER) })).toMatchObject({ current: true, degraded: false });
    asked = [];
    expect(wanted(AFTER + MIN)).toBe(false);
    await refresh(AFTER + MIN);
    expect(asked).toEqual([]);
  });

  it('a match the provider leaves in play for ever: polling stops six hours after kickoff', async () => {
    await seen();
    const END = KICKOFF + 6 * HOUR;
    await refresh(END - MIN);
    expect(days()).toHaveLength(3);
    asked = [];
    await refresh(END + MIN);
    expect(days()).toEqual([]); // still "in play" at the provider; not asked about any more
  });
});

describe('a match in play that no window covers is found by a discovery', () => {
  const LONG_AGO = NOW - 200 * MIN; // kicked off before its window ended; nobody was looking
  const due = () => seed(NOW, fresh(NOW, [], {}, 61 * MIN));

  it('opens the gate: the same cycle reads live, and the continuation holds', async () => {
    events = [{ id: '1', at: LONG_AGO, state: 'in' }];
    due();
    await refresh(NOW);
    expect(months()).toEqual(['202610']);
    expect(days()).toHaveLength(3);
    expect(state()?.schedule?.inPlayUntil).toBe(iso(LONG_AGO + 6 * HOUR));
    expect(state()?.live.map((m) => m.id)).toEqual(['1']);
  });

  it('control: the same discovery with that match finished leaves the gate closed', async () => {
    events = [{ id: '1', at: LONG_AGO, state: 'post' }];
    due();
    await refresh(NOW);
    expect(months()).toEqual(['202610']);
    expect(days()).toEqual([]);
  });
});

describe('discovery has its own cadence, anchored on the latest attempt', () => {
  it('after a success (also an empty one, also one that never changes): once per 60 minutes, over a day', async () => {
    for (let t = 0; t < 24 * HOUR; t += MIN) await refresh(NOW + t);
    // The span moves with the day: the month asked is October throughout (Oct 10 to Oct 11).
    expect(months()).toHaveLength(24);
    expect(days()).toEqual([]);
  });

  it('while it fails: attempts at minute 0, 5, 15, 35, 75, then hourly; each followed by one probe', async () => {
    failing = (d) => (d.length === 6 ? json({}, 500) : undefined);
    const attempts: number[] = [];
    for (let minute = 0; minute <= 200; minute++) {
      const before = months().length;
      await refresh(NOW + minute * MIN);
      if (months().length > before) attempts.push(minute);
    }
    expect(attempts).toEqual([0, 5, 15, 35, 75, 135, 195]);
    expect(liveReads()).toBe(attempts.length);
    expect(state()?.schedule?.failures).toBe(attempts.length);
  });

  it('the attempt is on disk BEFORE the request is made: a refresher that dies mid-discovery has still counted it', async () => {
    seed(NOW, fresh(NOW, [], { failures: 2 }, 61 * MIN));
    let onDisk: ScheduleSlice | undefined;
    onRequest = (d) => {
      if (d.length === 6) onDisk = JSON.parse(readFileSync(cachePath(SOURCE, MEX), 'utf8')).schedule;
    };
    await refresh(NOW);
    expect(onDisk).toMatchObject({ attemptedAt: iso(NOW), failures: 3 });
    // And a success corrects the count.
    expect(state()?.schedule?.failures).toBe(0);
  });

  it('an attempt whose first write failed makes no request', async () => {
    seed(NOW, fresh(NOW, [], {}, 61 * MIN));
    failPublish = 1;
    await refresh(NOW);
    expect(asked).toEqual([]);
  });

  it('due, with the gate closed and a snapshot on disk: the trigger starts a refresher for it', () => {
    seed(NOW, fresh(NOW, [], {}, 61 * MIN));
    expect(wanted(NOW)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
    seed(NOW, fresh(NOW, [], {}, 59 * MIN));
    expect(wanted(NOW)).toBe(false);
  });

  it('with NO snapshot and a throttle in the note, the trigger starts nothing: "never during a backoff" has no exception', () => {
    expect(wanted(NOW)).toBe(true); // no snapshot, no backoff: start one
    writeBackoffNote(SOURCE, MEX, NOW + 5 * MIN, NOW);
    expect(wanted(NOW)).toBe(false);
    expect(wanted(NOW + 6 * MIN)).toBe(true);
  });

  it('none during a backoff, in the snapshot or in the note', async () => {
    seed(NOW, fresh(NOW, [], {}, 61 * MIN), { backoffUntil: iso(NOW + 5 * MIN) });
    expect(wanted(NOW)).toBe(false);
    await refresh(NOW);
    expect(asked).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
    seed(NOW, fresh(NOW, [], {}, 61 * MIN));
    writeBackoffNote(SOURCE, MEX, NOW + 5 * MIN, NOW);
    expect(wanted(NOW)).toBe(false);
    await refresh(NOW);
    expect(asked).toEqual([]);
  });

  it('a throttle is a throttle however short its wait: `Retry-After: 0` is not a failed discovery either', async () => {
    // Found in review: "was it throttled?" was asked as "is the cooldown still
    // running?". With a wait of zero it was not, so the 429 was counted as a
    // failure, a probe followed (three more requests to a provider that had
    // just said stop), and no backoff was published at all.
    const before = fresh(NOW, [entry('1', NOW - 20 * MIN)], { failures: 1 }, 61 * MIN);
    seed(NOW, before);
    failing = (d) => (d.length === 6 ? json({}, 429, { 'retry-after': '0' }) : undefined);
    await refresh(NOW);
    expect(asked).toEqual(['202610']);
    const s = state();
    expect(s?.schedule).toMatchObject({ failures: 1, attemptedAt: before.attemptedAt });
    expect(s?.schedule?.probe).toBeUndefined();
    // The provider is left alone for the floor every throttle gets.
    expect(Date.parse(s?.backoffUntil ?? '')).toBeGreaterThanOrEqual(NOW + 5 * MIN);
  });

  it('a throttled discovery whose FINAL publish throws (a failed atomic write) still leaves the throttle in the note', async () => {
    // Found in review: the throttle was settled only after a publish that
    // RETURNED. One that threw ended the cycle with the attempt on disk and no
    // deadline anywhere, and the next cycle asked the provider inside its
    // cooldown. The attempt's pre-write is the first publish; the final one is
    // the second.
    const before = fresh(NOW, [entry('1', NOW - 20 * MIN)], { failures: 1 }, 61 * MIN);
    seed(NOW, before);
    failing = (d) => (d.length === 6 ? json({}, 429, { 'retry-after': '600' }) : undefined);
    throwPublishAt = 2;
    await expect(refresh(NOW)).resolves.toBeUndefined();
    expect(asked).toEqual(['202610']);
    expect(wanted(NOW + 1000)).toBe(false);
    asked = [];
    await refresh(NOW + MIN);
    expect(asked).toEqual([]);
  });

  it('a THROTTLED discovery is not a failure: no probe, no count, and it is due again when the backoff ends', async () => {
    // A fixture inside its window: the gate is open, and the cycle still stops at the throttle.
    const before = fresh(NOW, [entry('1', NOW - 20 * MIN)], { failures: 1 }, 61 * MIN);
    seed(NOW, before);
    failing = (d) => (d.length === 6 ? json({}, 429, { 'retry-after': '600' }) : undefined);
    await refresh(NOW);
    expect(asked).toEqual(['202610']); // nothing else is asked in the cycle
    const s = state();
    expect(s?.schedule).toMatchObject({ failures: 1, attemptedAt: before.attemptedAt });
    expect(s?.schedule?.probe).toBeUndefined();
    expect(s?.schedule?.index).toEqual(before.index);
    const until = Date.parse(s?.backoffUntil ?? '');
    expect(until).toBeGreaterThanOrEqual(NOW + 600_000);
    // The live slice was not touched: nobody read it.
    expect(s).toMatchObject({ updatedAt: iso(NOW - HOUR), degraded: false });
    asked = [];
    failing = () => undefined;
    await refresh(NOW + 5 * MIN);
    expect(asked).toEqual([]);
    await refresh(until + 1000);
    expect(months()).toEqual(['202610']);
  });
});

describe('the provider’s season turns on June 1: the two months are two answers', () => {
  const MAY20 = Date.parse('2026-05-20T15:00:00.000Z'); // span May 19 to June 3
  beforeEach(() => {
    events = [
      { id: '40', at: Date.parse('2026-05-23T23:00:00.000Z') },
      { id: '41', at: Date.parse('2026-06-02T23:00:00.000Z') },
    ];
    season = (d) => (d.startsWith('202605') ? S2025 : S2026);
  });

  it('exactly two month requests (never a day request for the three June days); both months’ fixtures; two seasons, so the slice states none', async () => {
    await refresh(MAY20);
    expect([...asked].sort()).toEqual(['202605', '202606']);
    const s = state();
    expect(s?.schedule?.index?.map((e) => e.id)).toEqual(['40', '41']);
    // Two seasons in one answer: the slice cannot say which its records belong to.
    expect(s?.schedule?.season).toBeUndefined();
    expect(s?.schedule?.complete).toBe(true);
  });

  it('an INCOMPLETE answer after the turn of the season does not delete a fixture it did not read', async () => {
    // Found in review. May 31: May (season 2025) and June (2026) are read; a
    // June fixture kicks off on June 1 at 15:30Z. June 1, 15:00Z: June's answer
    // holds that fixture as a record nobody can read, beside a readable one.
    // The slice was stored as "season 2025" and the answer said "2026": another
    // season, so it replaced the slice, and at 15:30Z nothing was polled.
    const MAY31 = Date.parse('2026-05-31T15:00:00.000Z');
    const JUNE1 = Date.parse('2026-06-01T15:00:00.000Z');
    const KICKOFF = Date.parse('2026-06-01T15:30:00.000Z');
    events = [
      { id: '41', at: KICKOFF },
      { id: '42', at: Date.parse('2026-06-03T23:00:00.000Z') },
    ];
    await refresh(MAY31);
    expect(state()?.schedule?.index?.map((e) => e.id)).toEqual(['41', '42']);
    // The next day's discovery: 41 comes back unreadable.
    events = [{ id: '42', at: Date.parse('2026-06-03T23:00:00.000Z') }];
    extra = (d) => (d === '202606' ? [{ id: 'not an id', date: iso(KICKOFF) }] : []);
    await refresh(JUNE1);
    expect(state()?.schedule?.index?.map((e) => e.id)).toContain('41');
    expect(wanted(KICKOFF + MIN)).toBe(true);
    asked = [];
    await refresh(KICKOFF + MIN);
    expect(days()).toHaveLength(3);
  });

  it('an entry kept by a union under an unknown season is not deleted by a later answer of another season', async () => {
    // Found in review. 13:00: a response stating no season gives 41 (15:30)
    // and 42 (tomorrow). 14:00: an incomplete answer stating 2025 reads only
    // 42; the union kept 41 and labelled the slice 2025. 15:00: an incomplete
    // answer stating 2026 reads only 42: "another season", so it replaced the
    // slice and 41 was gone at kickoff. The provider's season label moving
    // between two answers for the same dates is not an ordinary rollover; the
    // rule still must not invent a provenance for what it did not read.
    const T13 = Date.parse('2026-06-02T13:00:00.000Z');
    const KICKOFF = Date.parse('2026-06-02T15:30:00.000Z');
    const unread = { id: 'not an id', date: iso(KICKOFF) };
    events = [
      { id: '41', at: KICKOFF },
      { id: '42', at: Date.parse('2026-06-03T23:00:00.000Z') },
    ];
    season = () => undefined;
    await refresh(T13);
    expect(state()?.schedule?.index?.map((e) => e.id)).toEqual(['41', '42']);
    expect(state()?.schedule?.season).toBeUndefined();
    events = [{ id: '42', at: Date.parse('2026-06-03T23:00:00.000Z') }];
    extra = () => [unread];
    season = () => S2025;
    await refresh(T13 + 61 * MIN);
    expect(state()?.schedule?.index?.map((e) => e.id)).toEqual(['41', '42']);
    season = () => S2026;
    await refresh(T13 + 122 * MIN);
    expect(state()?.schedule?.index?.map((e) => e.id)).toEqual(['41', '42']);
    expect(wanted(KICKOFF + MIN)).toBe(true);
  });

  it('either month failing is a failed discovery: the slice stands, and ONE probe follows', async () => {
    const before = fresh(MAY20, [entry('40', Date.parse('2026-05-23T23:00:00.000Z'))], { season: { year: 2025, label: 'x' } }, 61 * MIN);
    seed(MAY20, before);
    failing = (d) => (d === '202606' ? json({}, 500) : undefined);
    await refresh(MAY20);
    expect([...months()].sort()).toEqual(['202605', '202606']);
    expect(days()).toHaveLength(3); // the probe
    const s = state();
    expect(s?.schedule?.index).toEqual(before.index);
    expect(s?.schedule?.failures).toBe(1);
    // Cleared by the live read that was admitted, whatever it returned.
    expect(s?.schedule?.probe).toBeUndefined();
    asked = [];
    await refresh(MAY20 + MIN);
    expect(asked).toEqual([]);
  });
});

describe('the probe: one live read after a failed discovery, inside the same interval as any live read', () => {
  const failingDiscovery = () => {
    failing = (d) => (d.length === 6 ? json({}, 500) : undefined);
  };

  it('a live read made a moment before IS the probe’s answer: no request, and the flag is cleared', async () => {
    seed(NOW, fresh(NOW, [], {}, 61 * MIN), {}, 5000); // read live 5 seconds ago
    failingDiscovery();
    await refresh(NOW);
    expect(days()).toEqual([]);
    expect(state()?.schedule?.probe).toBeUndefined();
    expect(state()?.schedule?.failures).toBe(1);
  });

  it('a probe that finds a match in play raises the continuation: the gate stays open', async () => {
    const kickoff = NOW - 30 * MIN;
    events = [{ id: '1', at: kickoff, state: 'in' }];
    seed(NOW, fresh(NOW, [], {}, 61 * MIN));
    failingDiscovery();
    await refresh(NOW);
    expect(days()).toHaveLength(3);
    expect(state()?.schedule?.inPlayUntil).toBe(iso(kickoff + 6 * HOUR));
    asked = [];
    await refresh(NOW + 20_000);
    expect(days()).toHaveLength(3); // no discovery (5 minutes are not up), and still polling
    expect(months()).toEqual([]);
  });

  it('a probe that is owed opens the gate for the trigger and the refresher, with no window and no discovery due', async () => {
    seed(NOW, fresh(NOW, [], { probe: true, failures: 1 }, MIN));
    expect(wanted(NOW)).toBe(true);
    await refresh(NOW);
    expect(months()).toEqual([]);
    expect(days()).toHaveLength(3);
    expect(state()?.schedule?.probe).toBeUndefined();
  });

  it('a probe that could not be made (a throttle reached the note during discovery) stays owed', async () => {
    seed(NOW, fresh(NOW, [], {}, 61 * MIN));
    failingDiscovery();
    onRequest = (d) => {
      if (d.length === 6) writeBackoffNote(SOURCE, MEX, NOW + 5 * MIN, NOW);
    };
    await refresh(NOW);
    expect(days()).toEqual([]);
    expect(state()?.schedule?.probe).toBe(true);
    // Once the backoff ends it is made, at the live interval, though no window is open.
    asked = [];
    onRequest = undefined;
    expect(wanted(NOW + 6 * MIN)).toBe(true);
    await refresh(NOW + 6 * MIN);
    expect(days()).toHaveLength(3);
    expect(state()?.schedule?.probe).toBeUndefined();
  });
});

describe('what is read back from the cache is input', () => {
  it('a poisoned slice throws nothing, opens nothing, and does not silence discovery', async () => {
    const poisoned = {
      index: [null, { id: 'x y' }, { id: '1', kickoff: 'now', on: true }, { id: '2', kickoff: iso(NOW - MIN), on: 'yes' }],
      inPlayUntil: '2099-01-01T00:00:00.000Z',
      attemptedAt: '2099-01-01T00:00:00.000Z',
      failures: -4,
      probe: 'yes',
      fixtures: [null, 7, { id: 'x' }],
    } as unknown as ScheduleSlice;
    seed(NOW, poisoned);
    events = [{ id: '9', at: NOW + 20 * HOUR }];
    await refresh(NOW);
    // An attempt stamp in 2099 is "never": discovery ran. Nothing else did.
    expect(asked).toEqual(['202610']);
    expect(state()?.schedule?.index).toEqual([entry('9', NOW + 20 * HOUR)]);
    expect(state()?.schedule?.inPlayUntil).toBeUndefined();
  });

  it('a stored index of 257 records is no schedule: the gate is closed, and discovery keeps its own pace', async () => {
    const index = Array.from({ length: 257 }, (_, i) => entry(String(i + 1), NOW - MIN));
    seed(NOW, fresh(NOW, index));
    expect(wanted(NOW)).toBe(false);
    await refresh(NOW);
    expect(asked).toEqual([]);
  });

  it('a discovery ANSWER with 257 relevant fixtures is a failed discovery: the slice stands and a probe follows', async () => {
    const before = fresh(NOW, [entry('900', NOW + 20 * HOUR)], {}, 61 * MIN);
    seed(NOW, before);
    events = Array.from({ length: 257 }, (_, i) => ({ id: String(i + 1), at: NOW + HOUR + i * MIN }));
    await refresh(NOW);
    expect(months()).toEqual(['202610']);
    expect(state()?.schedule?.index).toEqual(before.index);
    expect(state()?.schedule?.failures).toBe(1);
    expect(days()).toHaveLength(3);
  });

  it('the 65th fixture opens the gate at its kickoff, though no full record of it is kept', async () => {
    events = Array.from({ length: 70 }, (_, i) => ({ id: String(i + 1), at: NOW + HOUR + i * 3 * HOUR }));
    await refresh(NOW);
    const s = state();
    expect(s?.schedule?.index).toHaveLength(70);
    expect(s?.schedule?.fixtures).toHaveLength(64);
    const k65 = NOW + HOUR + 64 * 3 * HOUR;
    // Keep the schedule as discovered (as if discovery kept failing quietly): the index alone decides.
    seed(k65 + MIN, { ...(s?.schedule as ScheduleSlice), attemptedAt: iso(k65), updatedAt: iso(k65) });
    expect(wanted(k65 + MIN)).toBe(true);
    asked = [];
    await refresh(k65 + MIN);
    expect(days()).toHaveLength(3);
  });
});

describe('rules the first mutation pass could not see (found by a reviewer’s own pass)', () => {
  it('the decision is made again under the lock: another refresher discovered and read live in between, and nothing is asked', async () => {
    events = [{ id: '1', at: NOW - 10 * MIN, state: 'in' }];
    seed(NOW, fresh(NOW, [entry('1', NOW - 10 * MIN)], {}, 61 * MIN)); // discovery due, a window open, a stale live slice
    onClaim = () => seed(NOW, fresh(NOW, [entry('1', NOW - 10 * MIN)], {}, 0), {}, 1000);
    await refresh(NOW);
    expect(asked).toEqual([]);
  });

  it('a live slice read less than twelve seconds ago: the cycle takes no lock and writes nothing', async () => {
    // Two checks say this (the plan, and the one beside the read). Without the
    // plan's, a refresher would take the lock and publish on every prompt of a
    // live window for nothing: the lock is what is observed here.
    events = [{ id: '1', at: NOW - 10 * MIN, state: 'in' }];
    seed(NOW, fresh(NOW, [entry('1', NOW - 10 * MIN)]), {}, 5_000);
    const before = state();
    let claimed = false;
    onClaim = () => {
      claimed = true;
    };
    await refresh(NOW);
    expect(claimed).toBe(false);
    expect(asked).toEqual([]);
    expect(state()).toEqual(before);
  });

  it('a cycle that only reads live carries the schedule’s display records through', async () => {
    events = [{ id: '1', at: NOW - 10 * MIN, state: 'in' }];
    await refresh(NOW - HOUR + MIN); // a first cycle: discovers (the fixture is 49 minutes away then)
    const before = state()?.schedule?.fixtures?.map((m) => m.id);
    expect(before).toEqual(['1']);
    asked = [];
    await refresh(NOW); // not due to discover again; the window is open
    expect(months()).toEqual([]);
    expect(days()).toHaveLength(3);
    expect(state()?.schedule?.fixtures?.map((m) => m.id)).toEqual(['1']);
  });

  it('no snapshot and a throttle in the note: the first snapshot says so, off the bundle too', async () => {
    writeBackoffNote(SOURCE, MEX, NOW + 5 * MIN, NOW);
    await refresh(NOW);
    expect(asked).toEqual([]);
    expect(state()).toMatchObject({ degraded: true, backoffUntil: iso(NOW + 5 * MIN) });
  });

  it('the backoff is asked again before the live read at the time it is THEN', async () => {
    // A deadline in the snapshot just past the 30-minute bound when the cycle
    // decides is believed by the time discovery has answered.
    events = [{ id: '1', at: NOW - 10 * MIN, state: 'in' }];
    seed(NOW, fresh(NOW, [entry('1', NOW - 10 * MIN)], {}, 61 * MIN), { backoffUntil: iso(NOW + 30 * MIN + 50) });
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: unknown) => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return real(input as never);
    });
    await refresh(NOW);
    expect(months()).toEqual(['202610']);
    expect(days()).toEqual([]);
  });

  it('the live stamp is the moment the read was admitted, after a discovery that took a while', async () => {
    events = [{ id: '1', at: NOW - 10 * MIN, state: 'in' }];
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: unknown) => {
      if (/dates=\d{6}(&|$)/.test(String(input))) await new Promise((resolve) => setTimeout(resolve, 200));
      return real(input as never);
    });
    await refresh(NOW); // no cache: discovers (200 ms), then reads live
    expect(days()).toHaveLength(3);
    // A lower bound only: at least the discovery's wait after the cycle began.
    expect(Date.parse(state()?.updatedAt ?? '')).toBeGreaterThanOrEqual(NOW + 150);
  });
});

describe('a source nobody can ask', () => {
  it('once its idle snapshot exists the trigger starts nothing (it started a do-nothing refresher on every prompt)', async () => {
    // Found in review: the refresher refuses an unknown source and writes one
    // degraded snapshot with no schedule slice; "no slice" read as "discovery
    // is due", for ever.
    await runRefresh({ source: 'bogus', competition: MEX, now: new Date(NOW), jitterMs: 0 });
    expect(asked).toEqual([]);
    const s = readState('bogus', MEX);
    expect(s?.degraded).toBe(true);
    for (const at of [NOW, NOW + MIN, NOW + HOUR, NOW + 24 * HOUR]) expect(refreshWanted(at, s, MEX, 'bogus'), String(at - NOW)).toBe(false);
  });
});

describe('the live read across the provider’s season turn (0.11 2.1b)', () => {
  // Measured Oct 3 2026: a day response states the season of the DATE asked;
  // `mex.1` turns on June 1. The live read's window is three UTC dates, so on
  // May 31 and June 1 its parts state two seasons, and a composed window
  // refused that (#139): no score for a match played on those days. The live
  // read keeps only matches in play and merges nothing: it composes across the
  // turn; the knockout read, which publishes a slice, keeps refusing.
  const JUNE1 = Date.parse('2026-06-01T15:00:00.000Z');
  const JUNE2 = Date.parse('2026-06-02T15:00:00.000Z');
  const atTurn = (d: string) => (d.startsWith('202605') ? S2025 : S2026);

  it('off the bundle, with the gate open at the turn: the live read succeeds, the score is shown, the snapshot states no season; the day after it states one', async () => {
    events = [{ id: '41', at: JUNE1 - 30 * MIN, state: 'in' }];
    season = atTurn;
    await refresh(JUNE1);
    expect(days()).toHaveLength(3); // the live read was made, inside its window
    const s = state();
    expect(s?.degraded).toBe(false);
    expect(s?.live.map((m) => m.id)).toEqual(['41']);
    expect(s?.season).toBeUndefined();
    // As the base renders a club: codes on a flagless statusline, names in the hook.
    expect(renderPrompt(s, { defaultCompetition: false, now: new Date(JUNE1), flags: false })).toBe('⚽ AME 1–0 GDL 55\'');
    expect(renderHook(s, { defaultCompetition: false, now: new Date(JUNE1) })).toContain('América 1–0 Guadalajara');
    // The day after: every day of the window is of the new season.
    events = [{ id: '42', at: JUNE2 - 30 * MIN, state: 'in' }];
    await refresh(JUNE2);
    expect(state()?.live.map((m) => m.id)).toEqual(['42']);
    expect(state()?.season).toMatchObject({ year: 2026 });
  });

  it('control: on main the same cycle was degraded, so this pins the repair', async () => {
    // The strict window at the turn is still a refusal: asked as the dated read asks it, it fails.
    events = [{ id: '41', at: JUNE1 - 30 * MIN, state: 'in' }];
    season = atTurn;
    const { EspnAdapter } = await import('@claudinho/core');
    const a = new EspnAdapter({ competition: MEX, enrichGroups: false, now: () => JUNE1 });
    await expect(a.fetchWindow('2026-05-31', '2026-06-02')).rejects.toThrow(/seasons 2025 and 2026/);
  });

  it('on the bundle, a synthetic turn during an admitted live and knockout window: the live read succeeds, the knockout read is refused and the cached slice stands', async () => {
    const WC = 'fifa.world';
    // The World Cup's slug states 2026 on every date probed; the design must
    // not depend on that. A knockout tie resolved earlier is in the cache.
    const R32 = Date.parse('2026-06-28T19:00:00.000Z');
    const tie = {
      id: '900001',
      stage: 'R32',
      kickoff: iso(R32 + 2 * HOUR),
      venue: 'Stadium',
      home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽', id: 'espn:203' },
      away: { code: 'ECU', name: 'Ecuador', flag: '🇪🇨', id: 'espn:210' },
      status: 'SCHEDULED',
      updatedAt: iso(R32 - HOUR),
    } as CacheState['fixtures'] extends (infer M)[] | undefined ? M : never;
    writeState({
      updatedAt: iso(R32 - MIN),
      live: [],
      degraded: false,
      source: SOURCE,
      competition: WC,
      fixtures: [tie],
      // Older than the slice's TTL (15 minutes), so the knockout read IS made
      // this cycle: seeded fresher, the test passed without ever asking it.
      fixturesUpdatedAt: iso(R32 - 20 * MIN),
      fixturesAttemptedAt: iso(R32 - 20 * MIN),
      fixturesSeason: { year: 2026, label: 'FIFA World Cup 2026' },
      season: { year: 2026, label: 'FIFA World Cup 2026' },
    } as CacheState);
    events = [{ id: '900002', at: R32 - 30 * MIN, state: 'in' }];
    // June states 2026, July states 2027: the knockout span (a month each) and
    // the live window (June 27, 28, 29) are asked at the turn placed on June 28.
    season = (d) => (d === '202606' || d === '20260627' ? S2026 : { year: 2027, displayName: 'FIFA World Cup 2027' });
    await refresh(R32, WC);
    const s = state(WC);
    expect(s?.live.map((m) => m.id)).toEqual(['900002']);
    expect(s?.degraded).toBe(false);
    expect(s?.season).toBeUndefined();
    // The knockout span was asked (both months) and refused: the slice stands
    // with its own stamp and season, and the attempt stamp paces the next ask.
    // Asked across seasons instead, a composed whole answer would REPLACE the
    // slice with its (empty) list and no season: that is the hazard the strict
    // mode of every reader that keeps a slice exists to prevent.
    expect([...months()].sort()).toEqual(['202606', '202607']);
    expect(s?.fixtures?.map((m) => m.id)).toEqual(['900001']);
    expect(s?.fixturesUpdatedAt).toBe(iso(R32 - 20 * MIN));
    expect(s?.fixturesAttemptedAt).toBe(iso(R32));
    expect(s?.fixturesSeason).toMatchObject({ year: 2026 });
  });
});

describe('on the bundled competition nothing changes', () => {
  const WC = 'fifa.world';
  const OPENER_LIVE = Date.parse('2026-06-11T19:30:00.000Z');
  const QUIET = Date.parse('2026-06-12T09:00:00.000Z');

  it('a live window is the bundled schedule’s: three day requests, no discovery, no schedule slice', async () => {
    writeState({ updatedAt: iso(OPENER_LIVE - MIN), live: [], degraded: false, source: SOURCE, competition: WC });
    await refresh(OPENER_LIVE, WC);
    expect(days()).toHaveLength(3);
    expect(months()).toEqual([]);
    expect(state(WC)?.schedule).toBeUndefined();
  });

  it('a throttle with a wait of zero still gets the floor every throttle gets, on this path too', async () => {
    writeState({ updatedAt: iso(OPENER_LIVE - MIN), live: [], degraded: false, source: SOURCE, competition: WC });
    failing = () => json({}, 429, { 'retry-after': '0' });
    await refresh(OPENER_LIVE, WC);
    expect(Date.parse(state(WC)?.backoffUntil ?? '')).toBeGreaterThanOrEqual(OPENER_LIVE + 5 * MIN);
  });

  it('outside every window nothing is asked, whatever a schedule slice in the file says', async () => {
    writeState({
      updatedAt: iso(QUIET - HOUR),
      live: [],
      degraded: false,
      source: SOURCE,
      competition: WC,
      schedule: { index: [entry('1', QUIET - MIN)], probe: true, inPlayUntil: iso(QUIET + HOUR) },
    });
    expect(refreshWanted(QUIET, state(WC), WC, SOURCE)).toBe(false);
    await refresh(QUIET, WC);
    expect(asked).toEqual([]);
  });
});
