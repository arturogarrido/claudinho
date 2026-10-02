/**
 * 0.11 PR 2.6a, found in review: two things the cache did with a path in two
 * steps, where something else can act in between.
 *
 *   1. A small cache file was CHECKED (a `stat`: a regular file, small enough)
 *      and then READ by path. Between the two the path can become another
 *      file: a pipe blocks the hot path for ever, a large file is read whole.
 *      A file is now read through ONE descriptor, and the read is bounded.
 *      The lock is such a file too: the hot path reads it on every prompt.
 *   2. A lock that vanished while a contender was looking at it (its owner
 *      released it, normally) was treated like a stale one: "remove it, create
 *      mine". If a third refresher had created the lock in that instant, the
 *      contender removed a FRESH lock and both held it. No dead or hung owner
 *      was needed. A lock that is gone is not removed: the contender just
 *      tries to create it.
 *
 * Interleavings are forced through the file-system calls, not raced.
 */
import { constants as fsConstants, lstatSync, mkdirSync, mkdtempSync, rmSync as rmReal, symlinkSync, writeFileSync } from 'node:fs';
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
/** One record per OPEN (a descriptor number is reused; an open is not). */
interface Open {
  path: string;
  flags: unknown;
  /** Bytes handed out through this open. */
  bytes: number;
}
let opens: Open[] = [];
let openByFd = new Map<number, Open>();
/** Every whole-file read: by path, or of a descriptor (the path it was opened on). */
let wholeReads: string[] = [];

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
      if (typeof path === 'string') {
        const record = { path, flags: rest[0], bytes: 0 };
        opens.push(record);
        openByFd.set(fd, record);
      } else {
        openByFd.delete(fd);
      }
      return fd;
    }) as typeof fs.openSync,
    fstatSync: ((fd: number, ...rest: unknown[]) => {
      const info = (fs.fstatSync as (...a: unknown[]) => unknown)(fd, ...rest);
      before('checked', openByFd.get(fd)?.path);
      return info;
    }) as typeof fs.fstatSync,
    readSync: ((fd: number, ...rest: unknown[]) => {
      const n = (fs.readSync as (...a: unknown[]) => number)(fd, ...rest);
      const record = openByFd.get(fd);
      if (record) record.bytes += n;
      return n;
    }) as typeof fs.readSync,
    readFileSync: ((path: Parameters<typeof fs.readFileSync>[0], ...rest: unknown[]) => {
      before('look', path);
      // A whole read OF A DESCRIPTOR is a whole read of the file it was opened on.
      const named = typeof path === 'number' ? openByFd.get(path)?.path : path;
      if (typeof named === 'string' && !busy) wholeReads.push(named);
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
  isLockFresh,
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
  opens = [];
  openByFd = new Map();
});
afterEach(() => {
  onPath = undefined;
  if (ORIG === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = ORIG;
  rmReal(dir, { recursive: true, force: true });
});
/** The most bytes any ONE open of `path` handed out. */
const mostRead = (path: string) => Math.max(0, ...opens.filter((o) => o.path === path).map((o) => o.bytes));
/** The opens of `path` made to READ it (a write is opened with a string mode: `wx`, `w`). */
const readOpens = (path: string) => opens.filter((o) => o.path === path && typeof o.flags === 'number');
/** Where the platform has the flag (Windows has none, and no pipe can sit in a directory there). */
const NONBLOCK = fsConstants.O_NONBLOCK ?? 0;
const lockFile = () => join(cacheDir(), 'refresh.lock');

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

  it('the lock too: the hot path asks its age on every prompt, and a contender and an owner read it', () => {
    const owner = claimLock(NOW);
    expect(owner).toBeDefined();
    opens = [];
    wholeReads = [];
    expect(isLockFresh(NOW)).toBe(true); // the statusline and the hook, before they start a refresher
    expect(holdsLock(owner)).toBe(true); // an owner, before it publishes
    expect(claimLock(NOW)).toBeUndefined(); // a contender, judging the lock's age
    expect(readOpens(lockFile()).length).toBeGreaterThanOrEqual(3);
    expect(wholeReads).not.toContain(lockFile());
    // A lock is a pid, a stamp and a few random bytes: its bound is small.
    expect(mostRead(lockFile())).toBeLessThanOrEqual(257);
  });

  it('none of the three is opened in a way that can wait: a pipe at any of these paths must not block a prompt', () => {
    // Opening a pipe that has no writer blocks for ever unless the open says
    // not to. (Pinned on the flags, which is the rule; a real pipe is tried in
    // refresher-lock.test.ts, where a regression fails after a moment.)
    writeBackoffNote(SOURCE, WC, NOW + 10 * MIN, NOW);
    writeState({ updatedAt: new Date(NOW).toISOString(), live: [], degraded: false, source: SOURCE, competition: WC });
    const owner = claimLock(NOW);
    opens = [];
    readBackoffNote(SOURCE, WC, NOW);
    readState(SOURCE, WC);
    isLockFresh(NOW);
    holdsLock(owner);
    claimLock(NOW);
    for (const path of [backoffNotePath(SOURCE, WC), cachePath(SOURCE, WC), lockFile()]) {
      const reads = readOpens(path);
      expect(reads.length, path).toBeGreaterThan(0);
      for (const o of reads) expect((o.flags as number) & NONBLOCK, path).toBe(NONBLOCK);
    }
  });
});

describe('every state the lock path can be in: what it is, and what a contender does', () => {
  // Found in review, twice over: the reader that replaced the by-path read
  // sorted the path into "absent", "unreadable" (so stale) and "read", and two
  // ordinary states fell on the wrong side. A lock whose owner has created it
  // and not yet written its token GREW while it was read: "unreadable", so
  // stale, so a contender removed a lock a second old and both held it. A link
  // to nothing answered "no such file" to the read and "exists" to the create:
  // "absent", so never removed, and no refresher could take the lock again.
  // The table is every state, so the next change is made against all of them.
  const POSIX = process.platform !== 'win32';
  const junk = 'x'.repeat(300);
  interface Case {
    name: string;
    /** Puts the lock path in the state; `now` is the real clock (a file's date is the file system's). */
    arrange: (lock: string, now: number) => void;
    /** `isLockFresh`: a refresher is running, start none. */
    fresh: boolean;
    /** `claimLock`: whether a contender gets the lock. */
    claimed: boolean;
    posix?: boolean;
  }
  const cases: Case[] = [
    { name: 'nothing there', arrange: () => {}, fresh: false, claimed: true },
    { name: 'a lock stamped now', arrange: (l, now) => writeFileSync(l, `1 ${now} abcdef012345`), fresh: true, claimed: false },
    { name: 'a lock stamped 61 seconds ago', arrange: (l, now) => writeFileSync(l, `1 ${now - 61_000} abcdef012345`), fresh: false, claimed: true },
    { name: 'a lock just created, its token not written yet (an empty file)', arrange: (l) => writeFileSync(l, ''), fresh: true, claimed: false },
    { name: 'no stamp, written just now: judged by its date', arrange: (l) => writeFileSync(l, 'not a lock'), fresh: true, claimed: false },
    { name: 'a stamp beyond the range of a date', arrange: (l) => writeFileSync(l, '1 99999999999999999999 abc'), fresh: false, claimed: true },
    { name: 'a negative stamp beyond it', arrange: (l) => writeFileSync(l, '1 -99999999999999999999 abc'), fresh: false, claimed: true },
    { name: 'larger than a lock can be (stale at once: stated)', arrange: (l) => writeFileSync(l, junk), fresh: false, claimed: true },
    {
      name: 'a link to nothing',
      arrange: (l) => symlinkSync(join(dir, 'nowhere'), l),
      fresh: false,
      claimed: true,
      posix: true,
    },
    {
      name: 'a link to a lock stamped now (read through, as before)',
      arrange: (l, now) => {
        writeFileSync(join(dir, 'elsewhere'), `1 ${now} abcdef012345`);
        symlinkSync(join(dir, 'elsewhere'), l);
      },
      fresh: true,
      claimed: false,
      posix: true,
    },
    {
      // Stated, and as on `main`: a directory cannot be removed like a file, so nothing takes the lock.
      name: 'a directory (cannot be taken over: stated)',
      arrange: (l) => mkdirSync(l),
      fresh: false,
      claimed: false,
    },
  ];
  for (const c of cases) {
    it.skipIf(c.posix === true && !POSIX)(c.name, () => {
      mkdirSync(cacheDir(), { recursive: true });
      const now = Date.now();
      c.arrange(lockFile(), now);
      expect(() => isLockFresh(now)).not.toThrow();
      expect(isLockFresh(now)).toBe(c.fresh);
      const token = claimLock(now);
      expect(token !== undefined).toBe(c.claimed);
      if (token) {
        // What is at the path now is a real lock, and it is the contender's.
        expect(lstatSync(lockFile()).isFile()).toBe(true);
        expect(holdsLock(token)).toBe(true);
        releaseLock(token);
      }
    });
  }

  it('a lock that GROWS while it is read (its owner is writing its token) is not stale: the contender gets nothing', () => {
    mkdirSync(cacheDir(), { recursive: true });
    const lock = lockFile();
    writeFileSync(lock, ''); // the owner's exclusive create has happened; its token is not written yet
    const now = Date.now();
    const owner = `${process.pid} ${now} 0123456789ab`;
    let wrote = false;
    onPath = (kind, p) => {
      // Right after the contender has looked at the open lock (its size: zero), the owner writes its token.
      if (p === lock && kind === 'checked' && !wrote) {
        wrote = true;
        writeFileSync(lock, owner);
      }
    };
    const contender = claimLock(now);
    onPath = undefined;
    expect(wrote).toBe(true); // the interleaving happened
    expect(contender).toBeUndefined();
    expect(holdsLock(owner)).toBe(true); // the owner's lock is still there, and still the owner's
  });

  it('and the hot path, in the same instant, says a refresher is running', () => {
    mkdirSync(cacheDir(), { recursive: true });
    const lock = lockFile();
    writeFileSync(lock, '');
    const now = Date.now();
    let wrote = false;
    onPath = (kind, p) => {
      if (p === lock && kind === 'checked' && !wrote) {
        wrote = true;
        writeFileSync(lock, `${process.pid} ${now} 0123456789ab`);
      }
    };
    const fresh = isLockFresh(now);
    onPath = undefined;
    expect(wrote).toBe(true);
    expect(fresh).toBe(true);
  });

  it('the other kept files are not the lock: one that grows while it is read is simply not read', () => {
    writeBackoffNote(SOURCE, WC, NOW + 10 * MIN, NOW);
    const path = backoffNotePath(SOURCE, WC);
    let grown = false;
    onPath = (kind, p) => {
      if (p === path && kind === 'checked' && !grown) {
        grown = true;
        writeFileSync(path, `${' '.repeat(100)}{"until":"${new Date(NOW + 10 * MIN).toISOString()}"}`);
      }
    };
    expect(readBackoffNote(SOURCE, WC, NOW)).toBeUndefined();
    onPath = undefined;
    expect(grown).toBe(true);
  });
});

describe('a lock that vanished is not removed', () => {
  it('the owner releases while a contender is looking, and a third refresher takes the lock: the contender does not take it too', () => {
    const lock = lockFile();
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
      // The contender looks at the lock's age: a look by path, or an open to read it.
      if (step === 1 && (kind === 'look' || (kind === 'open' && flags !== 'wx'))) {
        step = 2;
        releaseLock(owner); // released normally, just before the contender looks at the lock's age
        return;
      }
      if (step === 2 && (kind === 'remove' || (kind === 'open' && flags === 'wx'))) {
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
    const lock = lockFile();
    const owner = claimLock(NOW);
    let released = false;
    onPath = (kind, p, flags) => {
      if (p === lock && !released && (kind === 'look' || (kind === 'open' && flags !== 'wx'))) {
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
