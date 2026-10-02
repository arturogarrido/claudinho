/**
 * 0.11 PR 2.6a, found in review: WHEN the hot path reads the throttle note.
 *
 * The statusline and the hook decide on every prompt whether to start a
 * refresher. The note is one more small file; the description said it is read
 * "only once a refresh would otherwise be started", and the code read it
 * first: on every prompt inside a live window, and off the bundle on every
 * prompt around the clock. The cost is tens of microseconds; the claim was
 * false. The check now comes last, and this counts the reads.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Every path looked at: a `stat` by path, or an `open` (a small file is read through one descriptor). */
const stats: string[] = [];
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return {
    ...fs,
    statSync: ((...args: Parameters<typeof fs.statSync>) => {
      stats.push(String(args[0]));
      return fs.statSync(...args);
    }) as typeof fs.statSync,
    openSync: ((...args: Parameters<typeof fs.openSync>) => {
      stats.push(String(args[0]));
      return fs.openSync(...args);
    }) as typeof fs.openSync,
  };
});

import { backoffNotePath, type CacheState, claimLock, readCurrentState, releaseLock, writeBackoffNote, writeState } from '../src/cache';
import { shouldRefresh, shouldRefreshFixtures } from '../src/refresh';

const SOURCE = 'espn';
const WC = 'fifa.world';
const OPENER_LIVE = new Date('2026-06-11T19:30:00Z').getTime();
const SEMI_LIVE = new Date('2026-07-14T19:30:00Z').getTime();
const QUIET = new Date('2026-06-12T09:00:00Z').getTime();
const snapshot = (at: number, ageMs: number, competition = WC, over: Partial<CacheState> = {}): CacheState => ({
  updatedAt: new Date(at - ageMs).toISOString(),
  live: [],
  degraded: false,
  source: SOURCE,
  competition,
  ...over,
});
/** How many times the scope's note was looked at while `fn` ran. */
function noteReads(competition: string, fn: () => void): number {
  stats.length = 0;
  fn();
  return stats.filter((p) => p === backoffNotePath(SOURCE, competition)).length;
}

let dir: string;
const ORIG = process.env.XDG_CACHE_HOME;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-hotpath-'));
  process.env.XDG_CACHE_HOME = dir;
});
afterEach(() => {
  if (ORIG === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = ORIG;
  rmSync(dir, { recursive: true, force: true });
});

describe('the note is read only once a refresh would otherwise be started', () => {
  const both = (now: number, competition: string) => {
    const state = readCurrentState(SOURCE, competition);
    return [shouldRefresh(now, state, competition, SOURCE), shouldRefreshFixtures(now, state, competition, SOURCE)];
  };

  it('outside every window: not read', () => {
    writeState(snapshot(QUIET, 60_000));
    expect(noteReads(WC, () => both(QUIET, WC))).toBe(0);
  });

  it('in a live window with a FRESH snapshot: not read (it was, on every prompt)', () => {
    writeState(snapshot(OPENER_LIVE, 1000));
    expect(noteReads(WC, () => expect(both(OPENER_LIVE, WC)).toEqual([false, false]))).toBe(0);
  });

  it('in a live window while a refresher holds the lock: not read', () => {
    writeState(snapshot(OPENER_LIVE, 60_000));
    const held = claimLock(OPENER_LIVE);
    expect(noteReads(WC, () => expect(both(OPENER_LIVE, WC)).toEqual([false, false]))).toBe(0);
    releaseLock(held);
  });

  it('off the bundle with a fresh snapshot: not read (it was, on every prompt around the clock)', () => {
    writeState(snapshot(QUIET, 1000, 'eng.1'));
    expect(noteReads('eng.1', () => expect(both(QUIET, 'eng.1')).toEqual([false, false]))).toBe(0);
  });

  it('in the knockout phase with fresh fixtures and a fresh live slice: not read', () => {
    const at = new Date(SEMI_LIVE).toISOString();
    writeState(snapshot(SEMI_LIVE, 1000, WC, { fixtures: [], fixturesUpdatedAt: at, fixturesAttemptedAt: at }));
    expect(noteReads(WC, () => expect(both(SEMI_LIVE, WC)).toEqual([false, false]))).toBe(0);
  });

  it('once a refresh would be started it IS read, and it decides', () => {
    writeState(snapshot(OPENER_LIVE, 60_000));
    expect(noteReads(WC, () => expect(both(OPENER_LIVE, WC)).toEqual([true, false]))).toBe(1);
    writeBackoffNote(SOURCE, WC, OPENER_LIVE + 600_000, OPENER_LIVE);
    expect(noteReads(WC, () => expect(both(OPENER_LIVE, WC)).toEqual([false, false]))).toBe(1);
  });
});
