import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  acquireLock,
  type CacheState,
  claimLock,
  holdsLock,
  isLockFresh,
  publishState,
  readState,
  releaseLock,
} from '../src/cache';

/**
 * Audit A10 (P2): after the 60-second lease was reclaimed, an older paused
 * owner could unlink its successor's lock and a third owner then acquired
 * while the successor still ran (repro: a deterministic interleaving on a
 * modeled fs). CONTAINED: the lock carries an owner token, release is a
 * no-op for anyone but the holder, and publication checks ownership first.
 * REMAINING (0.11, 2.6): both the check-then-unlink and the check-then-write
 * are still races — a takeover between the ownership check and the write
 * lets the stale owner's snapshot land; a cross-process coordinator with
 * atomic fencing closes it. This narrows the window, it does not close it.
 * This file uses a real temp dir and an injected clock — no sleeps, no processes.
 */
const T = Date.parse('2026-09-15T12:00:00Z');
const snapshot = (updatedAt: string): CacheState => ({
  updatedAt,
  live: [],
  degraded: false,
  source: 'espn',
  competition: 'fifa.world',
});

let dir: string;
const ORIG = process.env.XDG_CACHE_HOME;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-lock-own-'));
  process.env.XDG_CACHE_HOME = dir;
});
afterEach(() => {
  if (ORIG === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = ORIG;
  rmSync(dir, { recursive: true, force: true });
});

describe('lock ownership', () => {
  it("a stale owner cannot release its successor's lock, and a third claimant is refused", () => {
    const a = claimLock(T);
    expect(a).toBeDefined();
    const b = claimLock(T + 60_001); // the lease is stale: B reclaims it
    expect(b).toBeDefined();
    releaseLock(a); // A wakes up and releases — must be a no-op now
    expect(holdsLock(a)).toBe(false);
    expect(holdsLock(b)).toBe(true);
    expect(isLockFresh(T + 60_002)).toBe(true);
    expect(claimLock(T + 60_002)).toBeUndefined(); // C is refused while B runs
    releaseLock(b);
    expect(isLockFresh(T + 60_003)).toBe(false);
  });

  it("publication is fenced: a stale owner's snapshot is refused, the successor's lands", () => {
    const a = claimLock(T);
    const b = claimLock(T + 60_001);
    expect(publishState(snapshot('2026-09-15T12:00:00.000Z'), a)).toBe(false);
    expect(readState()).toBeUndefined();
    expect(publishState(snapshot('2026-09-15T12:01:01.000Z'), b)).toBe(true);
    expect(readState()?.updatedAt).toBe('2026-09-15T12:01:01.000Z');
    releaseLock(b);
  });

  it('the no-argument API still serves a single owner', () => {
    expect(acquireLock(T)).toBe(true);
    expect(holdsLock()).toBe(true);
    releaseLock();
    expect(isLockFresh(T)).toBe(false);
  });
});
