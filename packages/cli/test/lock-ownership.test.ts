import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A path whose READS are refused (EACCES) while its exclusive create and write
 * go through: what a cache directory with an inherited deny-read ACL does to
 * every file created in it (the lock included), modeled on any platform. Only
 * the read opens are refused (`'wx'` is the lock's create).
 */
let denyReadsOf: string | undefined;
/**
 * The read-back's other answer: a READ open of `of`, while an entry is there,
 * opens `to` instead (another claimer's token). With no entry the read goes to
 * the real path (ENOENT: `absent`), so the claimer's "gone" path is reachable.
 */
let readsFrom: { of: string; to: string } | undefined;
/** The next exclusive create of this path fails as if a lock were there (EEXIST), once. */
let createFailsOnce: string | undefined;
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return {
    ...fs,
    openSync: ((...args: Parameters<typeof fs.openSync>) => {
      if (denyReadsOf !== undefined && String(args[0]) === denyReadsOf && args[1] !== 'wx') {
        const err = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      }
      if (createFailsOnce !== undefined && String(args[0]) === createFailsOnce && args[1] === 'wx') {
        createFailsOnce = undefined;
        const err = new Error('EEXIST: file already exists') as NodeJS.ErrnoException;
        err.code = 'EEXIST';
        throw err;
      }
      if (readsFrom !== undefined && String(args[0]) === readsFrom.of && args[1] !== 'wx' && fs.existsSync(readsFrom.of)) {
        return fs.openSync(readsFrom.to, args[1], args[2]);
      }
      return fs.openSync(...args);
    }) as typeof fs.openSync,
  };
});

import {
  type CacheState,
  claimLock,
  holdsLock,
  isLockFresh,
  publishState,
  readState,
  releaseLock,
} from '../src/cache';
import { cacheDir } from '../src/paths';

/**
 * Audit A10 (P2): after the 60-second lease was reclaimed, an older paused
 * owner could unlink its successor's lock and a third owner then acquired
 * while the successor still ran (repro: a deterministic interleaving on a
 * modeled fs). CONTAINED: the lock carries an owner token, release is a
 * no-op for anyone but the holder, and publication checks ownership first.
 * NOT CLOSED (stated in 0.11, 2.6a, see `claimLock`): both the
 * check-then-unlink and the check-then-write are still races — a takeover
 * between the ownership check and the write lets the stale owner's snapshot
 * land. This narrows the window, it does not close it. What 2.6a did close is
 * the common case, with no crash involved: a refresher deciding what to fetch
 * before it held the lock (`refresher-lock.test.ts`).
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
  denyReadsOf = undefined;
  readsFrom = undefined;
  createFailsOnce = undefined;
});
afterEach(() => {
  denyReadsOf = undefined;
  readsFrom = undefined;
  createFailsOnce = undefined;
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
    expect(readState('espn', 'fifa.world')).toBeUndefined();
    expect(publishState(snapshot('2026-09-15T12:01:01.000Z'), b)).toBe(true);
    expect(readState('espn', 'fifa.world')?.updatedAt).toBe('2026-09-15T12:01:01.000Z');
    releaseLock(b);
  });

  it('the API has one form: the token is required by `holdsLock`, `releaseLock` and `publishState` (D3)', () => {
    const a = claimLock(T);
    expect(holdsLock(a)).toBe(true);
    // A release with another's token is a no-op; with the owner's it frees the lock.
    releaseLock('1 2 deadbeef');
    expect(isLockFresh(T)).toBe(true);
    releaseLock(a);
    expect(isLockFresh(T)).toBe(false);
    // The token parameter is required (no module-level "this process's lock" any more).
    type Required1 = Parameters<typeof holdsLock>;
    type Required2 = Parameters<typeof releaseLock>;
    type Required3 = Parameters<typeof publishState>;
    const one: Required1 = ['t'];
    const two: Required2 = ['t'];
    const three: Required3 = [snapshot('2026-09-15T12:00:00.000Z'), 't'];
    // @ts-expect-error the token is required
    const none1: Required1 = [];
    // @ts-expect-error the token is required
    const none2: Required2 = [];
    // @ts-expect-error the token is required
    const none3: Required3 = [snapshot('2026-09-15T12:00:00.000Z')];
    expect([one, two, three, none1, none2, none3]).toHaveLength(6);
  });
});

// Review round 4 of the cleanup PR. Every use of a token requires `holdsLock`
// (a publish, a release, the record's settlement), so a token that fails it at
// the instant of its claim serves nothing: a cycle holding one asked the
// provider for an answer it could never publish, on every tick, in a cache
// directory whose new files nobody can read (an inherited deny-read ACL: the
// lock is created and written, and cannot be read back by its creator).
describe('a claim the claimer cannot read back is no claim', () => {
  const lockPath = () => join(cacheDir(), 'refresh.lock');

  it('claimLock returns undefined when the token it wrote cannot be read back; the entry is left (nothing is removed without ownership proven)', () => {
    denyReadsOf = lockPath();
    expect(claimLock(T)).toBeUndefined();
    // Created, then refused as a claim; left where it is: a removal here would
    // be the unguarded unlink audit A10 closed (the read-back is the ownership
    // check, and it failed).
    expect(existsSync(lockPath())).toBe(true);
    // The next claimer: the lock it finds cannot be read, so it is stale and
    // taken over, and the new one cannot be read back either. Still no claim.
    expect(claimLock(T + 1000)).toBeUndefined();
    expect(existsSync(lockPath())).toBe(true);
    // Once reads work again the leftover lock is an ordinary one, stamped by its
    // last claimer: fresh for the lease, stale after it, like a refresher that
    // died holding it.
    denyReadsOf = undefined;
    expect(isLockFresh(T + 2000)).toBe(true);
    expect(claimLock(T + 2000)).toBeUndefined();
    const later = claimLock(T + 1000 + 60_001);
    expect(later).toBeDefined();
    expect(holdsLock(later)).toBe(true);
    releaseLock(later);
  });

  // The coder's additions (round 4): the rule's other answer (a token that is
  // not the one written) and its third create (after the lock was found gone).
  const otherToken = () => {
    const p = join(dir, 'other.lock');
    writeFileSync(p, `1 ${T} deadbeef`);
    return p;
  };

  it("a read-back that returns another's token is no claim either; the entry is left", () => {
    readsFrom = { of: lockPath(), to: otherToken() };
    expect(claimLock(T)).toBeUndefined();
    expect(existsSync(lockPath())).toBe(true);
  });

  it('the create after the lock was found gone is read back too', () => {
    // Control: the first create fails (a lock was there) and the lock is gone
    // when looked at, so the claimer creates once more, and that claim reads back.
    createFailsOnce = lockPath();
    const ok = claimLock(T);
    expect(ok).toBeDefined();
    expect(holdsLock(ok)).toBe(true);
    releaseLock(ok);
    expect(existsSync(lockPath())).toBe(false);
    // The same path, with a read-back that is another's token: no claim, the entry left.
    createFailsOnce = lockPath();
    readsFrom = { of: lockPath(), to: otherToken() };
    expect(claimLock(T)).toBeUndefined();
    expect(createFailsOnce).toBeUndefined(); // the gone path was taken: its failing create was spent
    expect(existsSync(lockPath())).toBe(true);
  });

  it('a claim that reads back is unchanged: the token is held, publishes, releases', () => {
    const a = claimLock(T);
    expect(a).toBeDefined();
    expect(holdsLock(a)).toBe(true);
    expect(publishState(snapshot('2026-09-15T12:00:00.000Z'), a)).toBe(true);
    releaseLock(a);
    expect(existsSync(lockPath())).toBe(false);
  });
});
