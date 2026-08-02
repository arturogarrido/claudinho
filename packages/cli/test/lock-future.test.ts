/**
 * A lock dated in the future must not hold the refresher silent forever.
 *
 * Both readings of a lock's age go through `stampAgeMs`, which treats a future
 * stamp as infinitely old — a clock skew or a hand-edited file otherwise makes
 * the lock permanently "fresh", and a permanently fresh lock means the cache is
 * never refreshed again. The fix landed for the lock's own timestamp and MISSED
 * the mtime fallback beside it, which is the third time in this PR a timestamp
 * rule was applied to the field that was reported and not to its sibling.
 */
import { mkdtempSync, rmSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cacheDir, isLockFresh } from '../src/cache';

let dir: string;
let prevHome: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-lock-'));
  prevHome = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = dir;
});
afterEach(() => {
  if (prevHome === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = prevHome;
  rmSync(dir, { recursive: true, force: true });
});

/** `cacheDir()` reads XDG_CACHE_HOME per CALL, so the env swap above is enough. */
function writeLock(contents: string): string {
  mkdirSync(cacheDir(), { recursive: true });
  const lp = join(cacheDir(), 'refresh.lock');
  writeFileSync(lp, contents);
  return lp;
}

const FUTURE = new Date('2099-01-01T00:00:00Z').getTime();

describe('a future-dated lock is never fresh', () => {
  it('when the future timestamp is INSIDE the lock', () => {
    writeLock(`999 ${FUTURE}`);
    expect(isLockFresh(Date.now())).toBe(false);
  });

  it('and when it is only the file MTIME — the sibling that was missed', () => {
    const lp = writeLock('not a parseable lock'); // forces the mtime fallback
    utimesSync(lp, FUTURE / 1000, FUTURE / 1000);
    expect(isLockFresh(Date.now())).toBe(false);
  });

  it('while a normal fresh lock still holds', () => {
    writeLock(`999 ${Date.now()}`);
    expect(isLockFresh(Date.now())).toBe(true);
  });
});
