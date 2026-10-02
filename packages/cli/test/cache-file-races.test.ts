/**
 * 0.11 PR 2.6a, found in review: two things the cache did with a path in two
 * steps, where something else can act in between.
 *
 *   1. A small cache file was CHECKED (a `stat`: a regular file, small enough)
 *      and then READ by path. Between the two the path can become another
 *      file: a pipe blocks the hot path for ever, a large file is read whole.
 *      A file is now read through ONE descriptor, and the read is bounded.
 *   2. A lock that vanished while a contender was looking at it (its owner
 *      released it, normally) was treated like a stale one: "remove it, create
 *      mine". If a third refresher had created the lock in that instant, the
 *      contender removed a FRESH lock and both held it. No dead or hung owner
 *      was needed. A lock that is gone is not removed: the contender just
 *      tries to create it.
 *
 * Interleavings are forced through the file-system calls, not raced.
 */
import { mkdtempSync, rmSync as rmReal } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Kind = 'open' | 'look' | 'remove' | 'checked';
/**
 * Called BEFORE a file-system call that names a path (`open`, `look`,
 * `remove`), and AFTER a descriptor opened on a path was inspected
 * (`checked`: an `fstat`). Never re-entered.
 */
let onPath: ((kind: Kind, path: string, flags?: unknown) => void) | undefined;
let busy = false;
/** Every whole-file read by path, and every byte handed out per descriptor. */
let wholeReads: string[] = [];
let bytesByFd = new Map<number, number>();
let pathByFd = new Map<number, string>();

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  const before = (kind: Kind, path: unknown, flags?: unknown) => {
    if (busy || !onPath || typeof path !== 'string') return;
    busy = true;
    try {
      onPath(kind, path, flags);
    } finally {
      busy = false;
    }
  };
  return {
    ...fs,
    openSync: ((path: Parameters<typeof fs.openSync>[0], ...rest: unknown[]) => {
      before('open', path, rest[0]);
      const fd = (fs.openSync as (...a: unknown[]) => number)(path, ...rest);
      if (typeof path === 'string') pathByFd.set(fd, path);
      return fd;
    }) as typeof fs.openSync,
    fstatSync: ((fd: number, ...rest: unknown[]) => {
      const info = (fs.fstatSync as (...a: unknown[]) => unknown)(fd, ...rest);
      before('checked', pathByFd.get(fd));
      return info;
    }) as typeof fs.fstatSync,
    readSync: ((fd: number, ...rest: unknown[]) => {
      const n = (fs.readSync as (...a: unknown[]) => number)(fd, ...rest);
      bytesByFd.set(fd, (bytesByFd.get(fd) ?? 0) + n);
      return n;
    }) as typeof fs.readSync,
    readFileSync: ((path: Parameters<typeof fs.readFileSync>[0], ...rest: unknown[]) => {
      before('look', path);
      if (typeof path === 'string' && !busy) wholeReads.push(path);
      return (fs.readFileSync as (...a: unknown[]) => unknown)(path, ...rest);
    }) as typeof fs.readFileSync,
    statSync: ((path: Parameters<typeof fs.statSync>[0], ...rest: unknown[]) => {
      before('look', path);
      return (fs.statSync as (...a: unknown[]) => unknown)(path, ...rest);
    }) as typeof fs.statSync,
    lstatSync: ((path: Parameters<typeof fs.lstatSync>[0], ...rest: unknown[]) => {
      before('look', path);
      return (fs.lstatSync as (...a: unknown[]) => unknown)(path, ...rest);
    }) as typeof fs.lstatSync,
    existsSync: ((path: Parameters<typeof fs.existsSync>[0]) => {
      before('look', path);
      return fs.existsSync(path);
    }) as typeof fs.existsSync,
    rmSync: ((path: Parameters<typeof fs.rmSync>[0], ...rest: unknown[]) => {
      before('remove', path);
      return (fs.rmSync as (...a: unknown[]) => void)(path, ...rest);
    }) as typeof fs.rmSync,
    unlinkSync: ((path: Parameters<typeof fs.unlinkSync>[0]) => {
      before('remove', path);
      return fs.unlinkSync(path);
    }) as typeof fs.unlinkSync,
  };
});

import {
  backoffNotePath,
  cacheDir,
  cachePath,
  claimLock,
  holdsLock,
  readBackoffNote,
  readState,
  releaseLock,
  writeBackoffNote,
  writeState,
} from '../src/cache';

const SOURCE = 'espn';
const WC = 'fifa.world';
const NOW = Date.parse('2026-06-11T19:30:00.000Z');
const MIN = 60_000;

let dir: string;
const ORIG = process.env.XDG_CACHE_HOME;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-races-'));
  process.env.XDG_CACHE_HOME = dir;
  onPath = undefined;
  wholeReads = [];
  bytesByFd = new Map();
  pathByFd = new Map();
});
afterEach(() => {
  onPath = undefined;
  if (ORIG === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = ORIG;
  rmReal(dir, { recursive: true, force: true });
});
/** The most bytes any one descriptor opened on `path` handed out. */
const mostRead = (path: string) => Math.max(0, ...[...pathByFd].filter(([, p]) => p === path).map(([fd]) => bytesByFd.get(fd) ?? 0));

describe('a small cache file is read through one descriptor, and the read is bounded', () => {
  it('the throttle note: never a whole-file read by path; a valid note is still read', () => {
    expect(writeBackoffNote(SOURCE, WC, NOW + 10 * MIN, NOW)).toBe(true);
    wholeReads = [];
    expect(readBackoffNote(SOURCE, WC, NOW)).toBe(NOW + 10 * MIN);
    expect(wholeReads).not.toContain(backoffNotePath(SOURCE, WC));
    expect(mostRead(backoffNotePath(SOURCE, WC))).toBeLessThanOrEqual(257);
  });

  it('a note that GROWS after it was checked is not read whole: at most one byte past its bound', async () => {
    const fs = await vi.importActual<typeof import('node:fs')>('node:fs');
    const path = backoffNotePath(SOURCE, WC);
    writeBackoffNote(SOURCE, WC, NOW + 10 * MIN, NOW);
    // Right after the reader has CHECKED the note (an `fstat` on its descriptor,
    // or, read by path, between its `stat` and its read), the note becomes a megabyte.
    let grown = false;
    let looks = 0;
    onPath = (kind, p) => {
      if (p !== path || grown) return;
      if (kind === 'checked' || (kind === 'look' && ++looks === 2)) {
        grown = true;
        fs.writeFileSync(path, `${' '.repeat(1024 * 1024)}{"until":"${new Date(NOW + 10 * MIN).toISOString()}"}`);
      }
    };
    expect(readBackoffNote(SOURCE, WC, NOW)).toBeUndefined();
    expect(grown).toBe(true); // the interleaving happened: it grew after the check
    expect(wholeReads).not.toContain(path);
    expect(mostRead(path)).toBeLessThanOrEqual(257);
  });

  it('the snapshot, which the statusline reads on every prompt, is read the same way', () => {
    writeState({ updatedAt: new Date(NOW).toISOString(), live: [], degraded: false, source: SOURCE, competition: WC });
    wholeReads = [];
    expect(readState(SOURCE, WC)?.competition).toBe(WC);
    expect(wholeReads).not.toContain(cachePath(SOURCE, WC));
    // Its bound is a megabyte: one byte past it at most.
    expect(mostRead(cachePath(SOURCE, WC))).toBeLessThanOrEqual(1024 * 1024 + 1);
  });
});

describe('a lock that vanished is not removed', () => {
  it('the owner releases while a contender is looking, and a third refresher takes the lock: the contender does not take it too', () => {
    const lock = join(cacheDir(), 'refresh.lock');
    const owner = claimLock(NOW);
    expect(owner).toBeDefined();
    let third: ReturnType<typeof claimLock>;
    let step = 0;
    onPath = (kind, p, flags) => {
      if (p !== lock) return;
      if (step === 0 && kind === 'open' && flags === 'wx') {
        step = 1; // the contender's exclusive create is about to fail: the owner holds a fresh lock
        return;
      }
      if (step === 1 && kind === 'look') {
        step = 2;
        releaseLock(owner); // released normally, just before the contender looks at the lock's age
        return;
      }
      if (step === 2 && (kind === 'remove' || kind === 'open')) {
        step = 3;
        third = claimLock(NOW); // a third refresher creates the lock in that instant
      }
    };
    const contender = claimLock(NOW);
    onPath = undefined;
    expect(step).toBe(3); // the interleaving happened as written
    expect(third).toBeDefined();
    // The third refresher holds it. The contender must not have removed a fresh lock to take it.
    expect(holdsLock(third)).toBe(true);
    expect(contender).toBeUndefined();
  });

  it('control: a lock that is really stale is still taken over', () => {
    const owner = claimLock(NOW - 61_000);
    expect(owner).toBeDefined();
    const next = claimLock(NOW);
    expect(next).toBeDefined();
    expect(holdsLock(next)).toBe(true);
    expect(holdsLock(owner)).toBe(false);
  });

  it('control: a lock that vanished and that nobody else took is simply claimed', () => {
    const lock = join(cacheDir(), 'refresh.lock');
    const owner = claimLock(NOW);
    let released = false;
    onPath = (kind, p) => {
      if (p === lock && kind === 'look' && !released) {
        released = true;
        releaseLock(owner);
      }
    };
    const contender = claimLock(NOW);
    onPath = undefined;
    expect(released).toBe(true);
    expect(contender).toBeDefined();
    expect(holdsLock(contender)).toBe(true);
  });
});
