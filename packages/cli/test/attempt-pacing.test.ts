/**
 * The attempt record in the refresher's cycles (0.11, the cleanup PR, ledger
 * row D8). With a snapshot nobody can read, every tick used to start a cycle
 * and inside a live window every cycle asked the provider. Now every cycle
 * whose base read is undefined ADMITS first (the record written under the lock
 * and read back; not visible → nothing done), on every lane: the bundle's live
 * and fixtures reads, the off-bundle discovery and live reads, both idle
 * writers, the unknown-source idle publish. A believed record that is not due
 * returns before anything is published or asked. After the cycle, the record
 * is settled to `count: 0` only when the snapshot reads back usable and the
 * lock is still held.
 *
 * Mode-000 fixtures skip on Windows (the mode does not refuse a read) and as
 * root (nothing refuses root).
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ spawn: vi.fn(() => ({ unref: vi.fn() })) }));

let publishes = 0;
let throwPublishAt = 0;
/** Runs once, just before the next `claimLock` (another refresher publishing between the first look and the lock). */
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
      return mod.publishState(...args);
    },
  };
});

import { spawn } from 'node:child_process';
import {
  attemptRecordPath,
  backoffNotePath,
  type CacheState,
  cachePath,
  readAttemptRecord,
  readBackoffNote,
  readCurrentState,
  writeState,
} from '../src/cache';
import { cmdHook, cmdPrompt } from '../src/commands';
import { resolveConfig } from '../src/config';
import { makeT } from '../src/i18n';
import { refreshWanted, runRefresh } from '../src/refresh';
import { inLiveWindow } from '../src/statusline';

const SOURCE = 'espn';
const WC = 'fifa.world';
const MEX = 'mex.1';
const MIN = 60_000;
const HOUR = 60 * MIN;
/** Inside the opener's live window (Jun 11, 2026, kickoff 19:00Z), in the group stage: the live lane alone. */
const LIVE = Date.parse('2026-06-11T19:30:00Z');
/** A quiet morning in the group stage: no live window, no knockout phase. */
const QUIET = Date.parse('2026-06-12T09:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const POSIX = process.platform !== 'win32';
const unprivileged = POSIX && (typeof process.getuid !== 'function' || process.getuid() !== 0);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let dir: string;
let asked: string[] = [];
let answer: (dates: string) => Response = () => json({ leagues: [{ season: { year: 2026, displayName: '2026 World Cup' } }], events: [] });
const ORIG = process.env.XDG_CACHE_HOME;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-pacing-'));
  process.env.XDG_CACHE_HOME = dir;
  asked = [];
  publishes = 0;
  throwPublishAt = 0;
  onClaim = undefined;
  vi.mocked(spawn).mockClear();
  vi.stubGlobal('fetch', async (input: unknown) => {
    const dates = new URL(String(input)).searchParams.get('dates') ?? '';
    asked.push(dates);
    return answer(dates);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const competition of [WC, MEX]) {
    for (const p of [cachePath(SOURCE, competition), attemptRecordPath(SOURCE, competition), attemptRecordPath('nope', competition)]) {
      try {
        chmodSync(p, 0o644);
      } catch {
        /* absent */
      }
    }
  }
  if (ORIG === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = ORIG;
  rmSync(dir, { recursive: true, force: true });
});

const refresh = (at: number, competition = WC, source = SOURCE) => runRefresh({ source, competition, now: new Date(at), jitterMs: 0 });
const record = (competition = WC, at = LIVE, source = SOURCE) => readAttemptRecord(source, competition, at + 10 * HOUR);
const snapshot = (at: number, competition = WC, over: Partial<CacheState> = {}): CacheState => ({
  updatedAt: iso(at - 1000),
  live: [],
  degraded: false,
  source: SOURCE,
  competition,
  ...over,
});
/** A snapshot file this reader cannot read: written, then mode 000. */
const unreadableSnapshot = (at: number, competition = WC) => {
  writeState(snapshot(at, competition));
  chmodSync(cachePath(SOURCE, competition), 0o000);
  expect(readCurrentState(SOURCE, competition)).toBeUndefined();
};
const ctxOf = (competition = WC, source = SOURCE) => {
  const cfg = resolveConfig({ tz: 'UTC', color: false, source, flavor: 'off', markets: false, competition: competition === WC ? 'world-cup' : competition });
  return { cfg, t: makeT('en') };
};

describe('inside a live window on the bundle, a snapshot of mode 000', () => {
  it.skipIf(!unprivileged)('two cycles in a row make the requests of ONE (three day URLs); the record is admitted, not settled', async () => {
    unreadableSnapshot(LIVE);
    await refresh(LIVE);
    expect(asked).toHaveLength(3);
    expect(asked.every((d) => d.length === 8)).toBe(true);
    expect(readCurrentState(SOURCE, WC)).toBeUndefined(); // the mode is kept by the atomic replacement
    expect(record()).toEqual({ at: LIVE, count: 1 });
    await refresh(LIVE + 5000);
    expect(asked).toHaveLength(3); // not due: nothing asked
    expect(record()).toEqual({ at: LIVE, count: 1 }); // nothing written either
  });

  it.skipIf(!unprivileged)('the hot path does not spawn while the record is not due: `cmdPrompt` and `cmdHook`', async () => {
    unreadableSnapshot(LIVE);
    await refresh(LIVE);
    vi.mocked(spawn).mockClear();
    cmdPrompt({ ...ctxOf(), now: new Date(LIVE + 5000) } as never, { cursor: undefined });
    cmdHook({ ...ctxOf(), now: new Date(LIVE + 5000) } as never);
    expect(spawn).not.toHaveBeenCalled();
    expect(refreshWanted(LIVE + MIN - 1, undefined, WC, SOURCE)).toBe(false);
    expect(refreshWanted(LIVE + MIN, undefined, WC, SOURCE)).toBe(true);
  });

  it.skipIf(!unprivileged)('the delay doubles per failed cycle and caps at thirty minutes; the cap plus one ms carries the count', async () => {
    unreadableSnapshot(LIVE);
    const expectedAt = [0, 1, 3, 7, 15, 31, 61, 91].map((m) => LIVE + m * MIN);
    let requests = 0;
    for (let i = 0; i < expectedAt.length; i++) {
      const at = expectedAt[i] as number;
      // One ms before the admission is due: nothing.
      if (i > 0) {
        await refresh(at - 1);
        expect(asked.length, `before admission ${i}`).toBe(requests);
      }
      await refresh(at);
      requests += 3;
      expect(asked.length, `admission ${i}`).toBe(requests);
      expect(record(WC, at)).toEqual({ at, count: i + 1 });
    }
    // Past the cap the count keeps rising and the delay stays 30 minutes: the cap plus one ms.
    // The opener's window ended at 21:20Z, so this cycle is the idle lane's: admitted in the
    // same ramp (the count carried, not reset), with no request.
    const late = LIVE + 91 * MIN + 30 * MIN + 1;
    expect(inLiveWindow(LIVE + 91 * MIN)).toBe(true);
    expect(inLiveWindow(late)).toBe(false);
    await refresh(late);
    expect(asked.length).toBe(requests);
    expect(record(WC, late)).toEqual({ at: late, count: 9 });
    expect(refreshWanted(late + 30 * MIN - 1, undefined, WC, SOURCE)).toBe(false);
    expect(refreshWanted(late + 30 * MIN, undefined, WC, SOURCE)).toBe(true);
  });

  it.skipIf(!unprivileged)('irregular invocations: the count paces, not the clock (0, then 60, 62, 66, 74, 90)', async () => {
    unreadableSnapshot(LIVE);
    const invoked: number[] = [];
    for (const m of [0, 60, 61, 62, 64, 66, 70, 74, 80, 90, 100]) {
      const before = asked.length;
      await refresh(LIVE + m * MIN);
      if (asked.length > before) invoked.push(m);
    }
    expect(invoked).toEqual([0, 60, 62, 66, 74, 90]);
  });

  it.skipIf(!unprivileged)('a retained record is not due until its delay even after a usable snapshot was seen and vanished', async () => {
    unreadableSnapshot(LIVE);
    for (const m of [0, 1, 3, 7, 15, 31]) await refresh(LIVE + m * MIN);
    expect(record(WC, LIVE + 31 * MIN)).toEqual({ at: LIVE + 31 * MIN, count: 6 });
    // Repaired: the snapshot is usable, the record untouched by a tick that never opens it.
    chmodSync(cachePath(SOURCE, WC), 0o644);
    expect(readCurrentState(SOURCE, WC)).toBeDefined();
    expect(refreshWanted(LIVE + 32 * MIN, readCurrentState(SOURCE, WC), WC, SOURCE)).toBe(true); // the cadences: the live slice is stale
    // Vanished again two minutes later: the retained count (6) is not due until 30 minutes after its stamp.
    rmSync(cachePath(SOURCE, WC), { force: true });
    expect(refreshWanted(LIVE + 33 * MIN, undefined, WC, SOURCE)).toBe(false);
    expect(refreshWanted(LIVE + 61 * MIN, undefined, WC, SOURCE)).toBe(true);
  });
});

describe('outside every window on the bundle (the idle lane), and an unknown source', () => {
  it.skipIf(!unprivileged)('the idle writer admits too: the second `cmdPrompt` and `cmdHook` do not spawn, the count rose, nothing was asked', async () => {
    unreadableSnapshot(QUIET);
    await refresh(QUIET);
    expect(asked).toHaveLength(0);
    expect(readCurrentState(SOURCE, WC)).toBeUndefined();
    expect(record(WC, QUIET)).toEqual({ at: QUIET, count: 1 });
    vi.mocked(spawn).mockClear();
    cmdPrompt({ ...ctxOf(), now: new Date(QUIET + 5000) } as never, { cursor: undefined });
    cmdHook({ ...ctxOf(), now: new Date(QUIET + 5000) } as never);
    expect(spawn).not.toHaveBeenCalled();
    await refresh(QUIET + 5000);
    expect(record(WC, QUIET)).toEqual({ at: QUIET, count: 1 }); // not due: nothing written
    expect(asked).toHaveLength(0);
  });

  it.skipIf(!unprivileged)('an unknown source: its idle publish admits, and the next tick does not spawn', async () => {
    writeState({ ...snapshot(QUIET), source: 'nope' });
    chmodSync(cachePath('nope', WC), 0o000);
    await refresh(QUIET, WC, 'nope');
    expect(asked).toHaveLength(0);
    expect(readAttemptRecord('nope', WC, QUIET)).toEqual({ at: QUIET, count: 1 });
    expect(refreshWanted(QUIET + 5000, undefined, WC, 'nope')).toBe(false);
    cmdPrompt({ ...ctxOf(WC, 'nope'), now: new Date(QUIET + 5000) } as never, { cursor: undefined });
    cmdHook({ ...ctxOf(WC, 'nope'), now: new Date(QUIET + 5000) } as never);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('the first run (no snapshot, no record) starts at once and settles the record to 0 when its snapshot reads back', async () => {
    expect(refreshWanted(QUIET, undefined, WC, SOURCE)).toBe(true);
    await refresh(QUIET);
    expect(readCurrentState(SOURCE, WC)).toBeDefined();
    expect(record(WC, QUIET)).toEqual({ at: QUIET, count: 0 });
  });
});

describe('off the bundle, discovery', () => {
  it.skipIf(!unprivileged)('two cycles in a row make the month requests of ONE; the count paces the next', async () => {
    const at = Date.parse('2026-10-10T15:00:00Z');
    answer = () => json({ leagues: [{ season: { year: 2026, displayName: '2026-27 Liga MX' } }], events: [] });
    unreadableSnapshot(at, MEX);
    await refresh(at, MEX);
    expect(asked).toEqual(['202610']);
    expect(readAttemptRecord(SOURCE, MEX, at)).toEqual({ at, count: 1 });
    await refresh(at + 5000, MEX);
    expect(asked).toEqual(['202610']);
    expect(refreshWanted(at + MIN - 1, undefined, MEX, SOURCE)).toBe(false);
    expect(refreshWanted(at + MIN, undefined, MEX, SOURCE)).toBe(true);
    await refresh(at + MIN, MEX);
    expect(asked).toEqual(['202610', '202610']);
    expect(readAttemptRecord(SOURCE, MEX, at + MIN)).toEqual({ at: at + MIN, count: 2 });
  });
});

describe('admission that cannot be made visible: the gate fails closed only where a publish could not heal', () => {
  // The snapshot file is PRESENT and unreadable: the atomic replacement keeps its mode, so a publish
  // cannot heal it, and a cycle whose attempt cannot be recorded does nothing.
  it.skipIf(!unprivileged)('an unreadable snapshot and a record path that is a directory: nothing is published, nothing asked, the lock released', async () => {
    unreadableSnapshot(LIVE);
    mkdirSync(attemptRecordPath(SOURCE, WC), { recursive: true });
    await refresh(LIVE);
    expect(asked).toHaveLength(0);
    expect(readCurrentState(SOURCE, WC)).toBeUndefined();
    expect(existsSync(join(dir, 'claudinho', 'refresh.lock'))).toBe(false);
  });

  it.skipIf(!unprivileged)('an unreadable snapshot and a record of mode 000: the attempt is not admitted and the provider is not asked', async () => {
    unreadableSnapshot(LIVE);
    writeFileSync(attemptRecordPath(SOURCE, WC), JSON.stringify({ at: iso(LIVE - HOUR), count: 1 }));
    chmodSync(attemptRecordPath(SOURCE, WC), 0o000);
    await refresh(LIVE);
    expect(asked).toHaveLength(0);
    expect(readCurrentState(SOURCE, WC)).toBeUndefined();
  });

  // The snapshot file is ABSENT: a publish starts a fresh file with no mode to inherit, so one cycle
  // heals (as on `main`); the attempt is recorded when it can be, and the cycle proceeds either way.
  it('an ABSENT snapshot and a record path that is a directory: the cycle proceeds, publishes a readable snapshot, and the loop ends', async () => {
    mkdirSync(attemptRecordPath(SOURCE, WC), { recursive: true });
    await refresh(LIVE);
    expect(asked).toHaveLength(3);
    expect(readCurrentState(SOURCE, WC)).toBeDefined();
    expect(existsSync(join(dir, 'claudinho', 'refresh.lock'))).toBe(false);
    // The next tick has a snapshot: the cadences, and no spawn before the live slice is stale.
    expect(refreshWanted(LIVE + 5000, readCurrentState(SOURCE, WC), WC, SOURCE)).toBe(false);
  });

  it.skipIf(!unprivileged)('an ABSENT snapshot and a record of mode 000: the same, outside a window too (the idle writer publishes)', async () => {
    mkdirSync(join(dir, 'claudinho'), { recursive: true });
    writeFileSync(attemptRecordPath(SOURCE, WC), JSON.stringify({ at: iso(QUIET - HOUR), count: 1 }));
    chmodSync(attemptRecordPath(SOURCE, WC), 0o000);
    await refresh(QUIET);
    expect(asked).toHaveLength(0);
    expect(readCurrentState(SOURCE, WC)).toBeDefined();
    // And for an unknown source.
    rmSync(cachePath(SOURCE, WC), { force: true });
    await refresh(QUIET, WC, 'nope');
    expect(readCurrentState('nope', WC)).toBeDefined();
  });

  it('an ABSENT snapshot with a working record is still paced by it: two cycles, one set of requests, then the count settles when the snapshot reads back', async () => {
    // The first cycle admits (count 1), publishes a readable snapshot, settles to 0.
    await refresh(LIVE);
    expect(asked).toHaveLength(3);
    expect(record()).toEqual({ at: LIVE, count: 0 });
    // The snapshot deleted each tick by something else: every cycle finds it absent, admits, and the
    // record paces the hot path between cycles (a settled count of 0 is due at once, so the first
    // re-attempt is immediate; its own admission raises the count only until it settles again).
    rmSync(cachePath(SOURCE, WC), { force: true });
    expect(refreshWanted(LIVE + 5000, undefined, WC, SOURCE)).toBe(true);
  });
});

describe('the settlement', () => {
  it('a readable-but-rejected snapshot (bad JSON) is recovered by one admitted cycle: the admission first, the reset visible after', async () => {
    mkdirSync(join(dir, 'claudinho'), { recursive: true });
    writeFileSync(cachePath(SOURCE, WC), '{ not json');
    await refresh(LIVE);
    expect(asked).toHaveLength(3);
    expect(readCurrentState(SOURCE, WC)).toBeDefined();
    expect(record()).toEqual({ at: LIVE, count: 0 });
    // The admission was written before the request: a cycle that dies after it leaves count 1.
    writeFileSync(cachePath(SOURCE, WC), '{ not json');
    // The first cycle published once: the next publish is the one that throws.
    throwPublishAt = publishes + 1;
    await refresh(LIVE + 2 * MIN);
    expect(record(WC, LIVE + 2 * MIN)).toEqual({ at: LIVE + 2 * MIN, count: 1 });
  });

  it('a normal cycle with a readable snapshot neither reads nor writes the record', async () => {
    mkdirSync(join(dir, 'claudinho'), { recursive: true });
    writeFileSync(attemptRecordPath(SOURCE, WC), JSON.stringify({ at: iso(LIVE - 2 * HOUR), count: 6 }));
    writeState(snapshot(LIVE, WC, { updatedAt: iso(LIVE - HOUR) }));
    const before = readFileSync(attemptRecordPath(SOURCE, WC), 'utf8');
    await refresh(LIVE);
    expect(asked).toHaveLength(3);
    expect(readFileSync(attemptRecordPath(SOURCE, WC), 'utf8')).toBe(before);
  });

  it('a throttle met by a lane whose reset write then fails still reaches the note; a failed admission makes no request', async () => {
    // The lane requests, meets a 429, and the record's reset cannot be written (its path becomes a directory
    // during the cycle: the fetch stub swaps it in). The note must hold the throttle.
    mkdirSync(join(dir, 'claudinho'), { recursive: true });
    writeFileSync(cachePath(SOURCE, WC), '{ not json');
    answer = () => {
      // Idempotent across the three day requests: the first call swaps the file for a directory, the next
      // two find it there (an `rmSync` of a directory without `recursive` throws, which would turn them
      // into errors rather than throttles).
      const isDir = (() => {
        try {
          return statSync(attemptRecordPath(SOURCE, WC)).isDirectory();
        } catch {
          return false;
        }
      })();
      if (!isDir) {
        rmSync(attemptRecordPath(SOURCE, WC), { force: true });
        mkdirSync(attemptRecordPath(SOURCE, WC), { recursive: true });
      }
      return new Response('slow down', { status: 429, headers: { 'retry-after': '120' } });
    };
    await refresh(LIVE);
    expect(asked.length).toBeGreaterThan(0);
    expect(readBackoffNote(SOURCE, WC, LIVE)).toBeDefined();
    expect(readBackoffNote(SOURCE, WC, LIVE)).toBeGreaterThan(LIVE);
    // A failed admission (the directory still there, the snapshot unreadable again, no backoff) makes no request at all.
    asked = [];
    rmSync(backoffNotePath(SOURCE, WC), { force: true });
    writeFileSync(cachePath(SOURCE, WC), '{ not json');
    await refresh(LIVE + 10 * MIN);
    expect(asked).toHaveLength(0);
  });
});

describe('the rules the fourth reader found unpinned', () => {
  it('off the bundle, a first run settles the record to 0 (the settlement is every lane\'s)', async () => {
    const at = Date.parse('2026-10-10T15:00:00Z');
    answer = () => json({ leagues: [{ season: { year: 2026, displayName: '2026-27 Liga MX' } }], events: [] });
    await refresh(at, MEX);
    expect(asked).toEqual(['202610']);
    expect(readCurrentState(SOURCE, MEX)).toBeDefined();
    expect(readAttemptRecord(SOURCE, MEX, at)).toEqual({ at, count: 0 });
  });

  it('off the bundle, a cycle with a readable snapshot neither reads nor writes the record (no settlement either)', async () => {
    const at = Date.parse('2026-10-10T15:00:00Z');
    answer = () => json({ leagues: [{ season: { year: 2026, displayName: '2026-27 Liga MX' } }], events: [] });
    mkdirSync(join(dir, 'claudinho'), { recursive: true });
    writeFileSync(attemptRecordPath(SOURCE, MEX), JSON.stringify({ at: iso(at - 2 * HOUR), count: 6 }));
    // A readable snapshot whose discovery is due (an old slice): the lane asks, the record is untouched.
    writeState({
      ...snapshot(at, MEX, { updatedAt: iso(at - HOUR) }),
      schedule: { index: [], updatedAt: iso(at - 2 * HOUR), attemptedAt: iso(at - 2 * HOUR), failures: 0, complete: true, season: { year: 2026, label: '2026-27 Liga MX' } },
    } as CacheState);
    const before = readFileSync(attemptRecordPath(SOURCE, MEX), 'utf8');
    await refresh(at, MEX);
    expect(asked).toEqual(['202610']);
    expect(readFileSync(attemptRecordPath(SOURCE, MEX), 'utf8')).toBe(before);
  });

  it('the idle writer reads the snapshot before admitting: a snapshot published between the first look and the lock leaves the record untouched', async () => {
    onClaim = () => writeState(snapshot(QUIET));
    await refresh(QUIET);
    expect(asked).toHaveLength(0);
    expect(readCurrentState(SOURCE, WC)).toBeDefined();
    expect(existsSync(attemptRecordPath(SOURCE, WC))).toBe(false);
  });
});
