/**
 * The attempt record (0.11, the cleanup PR, ledger row D8): a snapshot nobody
 * can read (mode 000) looked like "no cache" on every tick, so the statusline
 * spawned a refresher per tick and inside a live window each one asked the
 * provider. An attempt is now recorded where a reader finds it WITHOUT the
 * snapshot: `attempt<scope>.json` beside the throttle note, `{ at, count }`,
 * read only when no snapshot could be read, written under the lock before
 * anything else, admitted only when it reads back, paced 1 min doubling to 30.
 *
 * This file pins the rules: the record's grammar and belief, the pace, the
 * admission's visibility, and the hot path's order (the lock, then the record,
 * then the note). The refresher's cycles are in `attempt-pacing.test.ts`.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Every path opened (a small file is read through one descriptor). */
const opens: string[] = [];
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return {
    ...fs,
    openSync: ((...args: Parameters<typeof fs.openSync>) => {
      opens.push(String(args[0]));
      return fs.openSync(...args);
    }) as typeof fs.openSync,
  };
});

import {
  admitAttempt,
  attemptDelayMs,
  attemptDue,
  attemptRecordPath,
  backoffNotePath,
  type CacheState,
  claimLock,
  readAttemptRecord,
  readCurrentState,
  releaseLock,
  settleAttempt,
  writeBackoffNote,
  writeState,
} from '../src/cache';
import { refreshWanted, runRefresh } from '../src/refresh';

const SOURCE = 'espn';
const WC = 'fifa.world';
const MIN = 60_000;
const NOW = Date.parse('2026-06-11T19:30:00Z'); // inside the opener's live window
const iso = (ms: number) => new Date(ms).toISOString();
const POSIX = process.platform !== 'win32';
const unprivileged = POSIX && (typeof process.getuid !== 'function' || process.getuid() !== 0);

let dir: string;
const ORIG = process.env.XDG_CACHE_HOME;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-attempt-'));
  process.env.XDG_CACHE_HOME = dir;
  opens.length = 0;
});
afterEach(() => {
  if (ORIG === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = ORIG;
  try {
    chmodSync(attemptRecordPath(SOURCE, WC), 0o644);
  } catch {
    /* absent */
  }
  rmSync(dir, { recursive: true, force: true });
});
const writeRecord = (body: unknown) => {
  mkdirSync(join(dir, 'claudinho'), { recursive: true });
  writeFileSync(attemptRecordPath(SOURCE, WC), typeof body === 'string' ? body : JSON.stringify(body));
};
const snapshot = (over: Partial<CacheState> = {}): CacheState => ({
  updatedAt: iso(NOW - 1000),
  live: [],
  degraded: false,
  source: SOURCE,
  competition: WC,
  ...over,
});

describe('the record lives beside the note, by the scope rule', () => {
  it('is named like the note, in the cache directory, per scope', () => {
    const p = attemptRecordPath(SOURCE, WC);
    expect(p.startsWith(join(dir, 'claudinho'))).toBe(true);
    expect(p).not.toBe(backoffNotePath(SOURCE, WC));
    expect(p).toMatch(/attempt.*\.json$/);
    expect(attemptRecordPath(SOURCE, 'eng.1')).not.toBe(p);
  });
});

describe('a record is believed by its grammar', () => {
  it('a stamp this product writes and a non-negative integer count', () => {
    writeRecord({ at: iso(NOW - MIN), count: 3 });
    expect(readAttemptRecord(SOURCE, WC, NOW)).toEqual({ at: NOW - MIN, count: 3 });
  });

  it('absent, unparseable, not an object, a non-stamp or a stamp more than 60 s ahead: not believed', () => {
    expect(readAttemptRecord(SOURCE, WC, NOW)).toBeUndefined();
    for (const body of ['{', '[1]', 'null', '"x"', { at: 'yesterday', count: 1 }, { at: 1, count: 1 }, { count: 1 }, { at: iso(NOW + 61_000), count: 1 }]) {
      writeRecord(body);
      expect(readAttemptRecord(SOURCE, WC, NOW), JSON.stringify(body)).toBeUndefined();
    }
    // A lead of 60 s is inside the skew the snapshot tolerates: believed.
    writeRecord({ at: iso(NOW + 60_000), count: 1 });
    expect(readAttemptRecord(SOURCE, WC, NOW)?.count).toBe(1);
  });

  it('a count that is not a non-negative integer reads as 0 (the stamp still believed)', () => {
    for (const count of [-1, 1.5, 'two', null, undefined, Number.MAX_SAFE_INTEGER + 2]) {
      writeRecord({ at: iso(NOW - MIN), count });
      expect(readAttemptRecord(SOURCE, WC, NOW), String(count)).toEqual({ at: NOW - MIN, count: 0 });
    }
  });

  it('has no age bound: a record of any age is believed, its count carried', () => {
    writeRecord({ at: iso(NOW - 400 * 24 * 60 * MIN), count: 6 });
    expect(readAttemptRecord(SOURCE, WC, NOW)).toEqual({ at: NOW - 400 * 24 * 60 * MIN, count: 6 });
  });

  it('is bounded like the note: a file past the small-file bound is not read', () => {
    writeRecord(`{"at":"${iso(NOW - MIN)}","count":1,"pad":"${'x'.repeat(4096)}"}`);
    expect(readAttemptRecord(SOURCE, WC, NOW)).toBeUndefined();
  });
});

describe('the pace: one minute doubling to thirty', () => {
  it('attemptDelayMs: 1, 2, 4, 8, 16, 30, 30… minutes from count 1; count 0 is due at once', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 40, 1000].map(attemptDelayMs)).toEqual([1, 2, 4, 8, 16, 30, 30, 30, 30].map((m) => m * MIN));
    expect(attemptDelayMs(0)).toBe(0);
  });

  it('attemptDue at the boundaries: one ms before the delay is not due, at it is; the cap plus one carries the count', () => {
    expect(attemptDue(undefined, NOW)).toBe(true);
    expect(attemptDue({ at: NOW, count: 0 }, NOW)).toBe(true);
    for (const [count, delay] of [
      [1, MIN],
      [2, 2 * MIN],
      [3, 4 * MIN],
      [6, 30 * MIN],
      [9, 30 * MIN],
    ] as const) {
      expect(attemptDue({ at: NOW, count }, NOW + delay - 1), `count ${count}`).toBe(false);
      expect(attemptDue({ at: NOW, count }, NOW + delay), `count ${count}`).toBe(true);
    }
    // A record written 60 s in the future (the tolerated skew) waits its delay from its own stamp.
    expect(attemptDue({ at: NOW + 60_000, count: 1 }, NOW + 60_000 + MIN - 1)).toBe(false);
    expect(attemptDue({ at: NOW + 60_000, count: 1 }, NOW + 60_000 + MIN)).toBe(true);
  });
});

describe('admission: written first, believed only when it reads back', () => {
  it('writes { at, count+1 } and returns the count when the record read back is the one written', () => {
    expect(admitAttempt(SOURCE, WC, NOW)).toBe(1);
    expect(JSON.parse(readFileSync(attemptRecordPath(SOURCE, WC), 'utf8'))).toEqual({ at: iso(NOW), count: 1 });
    expect(admitAttempt(SOURCE, WC, NOW + MIN)).toBe(2);
    expect(readAttemptRecord(SOURCE, WC, NOW + MIN)).toEqual({ at: NOW + MIN, count: 2 });
  });

  it('carries the count of a believed record of any age, and starts at 1 over a record that is not believed', () => {
    writeRecord({ at: iso(NOW - 400 * 24 * 60 * MIN), count: 6 });
    expect(admitAttempt(SOURCE, WC, NOW)).toBe(7);
    writeRecord('{');
    expect(admitAttempt(SOURCE, WC, NOW)).toBe(1);
  });

  it('the count is clamped where the delay is: a record with a huge count admits without overflowing', () => {
    writeRecord({ at: iso(NOW - 60 * MIN), count: Number.MAX_SAFE_INTEGER });
    const n = admitAttempt(SOURCE, WC, NOW);
    expect(n).toBeDefined();
    expect(Number.isSafeInteger(n)).toBe(true);
    expect(attemptDue({ at: NOW, count: n as number }, NOW + 30 * MIN)).toBe(true);
  });

  it('not visible: the path is a directory → undefined, nothing admitted', () => {
    mkdirSync(attemptRecordPath(SOURCE, WC), { recursive: true });
    expect(admitAttempt(SOURCE, WC, NOW)).toBeUndefined();
  });

  it.skipIf(!unprivileged)('not visible: the record itself is mode 000, so what was written cannot be read back → undefined', () => {
    writeRecord({ at: iso(NOW - MIN), count: 1 });
    chmodSync(attemptRecordPath(SOURCE, WC), 0o000);
    expect(admitAttempt(SOURCE, WC, NOW)).toBeUndefined();
    expect(readAttemptRecord(SOURCE, WC, NOW)).toBeUndefined();
  });

  it('settleAttempt writes { at, count: 0 } and says whether it reads back; a directory in its place: false', () => {
    admitAttempt(SOURCE, WC, NOW);
    expect(settleAttempt(SOURCE, WC, NOW + 5000)).toBe(true);
    expect(readAttemptRecord(SOURCE, WC, NOW + 5000)).toEqual({ at: NOW + 5000, count: 0 });
    rmSync(attemptRecordPath(SOURCE, WC), { force: true });
    mkdirSync(attemptRecordPath(SOURCE, WC), { recursive: true });
    expect(settleAttempt(SOURCE, WC, NOW + 6000)).toBe(false);
  });
});

describe('the hot path asks the record only without a snapshot, after the lock and before the note', () => {
  const recordOpens = () => opens.filter((p) => p === attemptRecordPath(SOURCE, WC)).length;
  const noteOpens = () => opens.filter((p) => p === backoffNotePath(SOURCE, WC)).length;

  it('no snapshot, a record not due: no refresh, and the note is not opened', () => {
    writeRecord({ at: iso(NOW - 30_000), count: 1 });
    opens.length = 0;
    expect(refreshWanted(NOW, undefined, WC, SOURCE)).toBe(false);
    expect(recordOpens()).toBe(1);
    expect(noteOpens()).toBe(0);
  });

  it('no snapshot, a record due: the note is asked next, and decides', () => {
    writeRecord({ at: iso(NOW - 2 * MIN), count: 1 });
    expect(refreshWanted(NOW, undefined, WC, SOURCE)).toBe(true);
    writeBackoffNote(SOURCE, WC, NOW + 5 * MIN, NOW);
    expect(refreshWanted(NOW, undefined, WC, SOURCE)).toBe(false);
  });

  it('no snapshot, no record: a refresh as before (the first run starts at once)', () => {
    expect(refreshWanted(NOW, undefined, WC, SOURCE)).toBe(true);
  });

  it('the lock comes first: a fresh lock means no refresh and the record is not opened', () => {
    writeRecord({ at: iso(NOW - 2 * MIN), count: 1 });
    const token = claimLock(NOW);
    opens.length = 0;
    expect(refreshWanted(NOW, undefined, WC, SOURCE)).toBe(false);
    expect(recordOpens()).toBe(0);
    releaseLock(token);
  });

  it('with a readable snapshot the record is never opened, an old record with a positive count on disk or not', () => {
    writeRecord({ at: iso(NOW - 10_000), count: 6 });
    writeState(snapshot());
    const state = readCurrentState(SOURCE, WC);
    expect(state).toBeDefined();
    opens.length = 0;
    refreshWanted(NOW, state, WC, SOURCE);
    refreshWanted(NOW + 20_000, state, WC, SOURCE);
    expect(recordOpens()).toBe(0);
  });

  it('the record is not believed (unparseable): the refresh is wanted as with none', () => {
    writeRecord('{');
    expect(refreshWanted(NOW, undefined, WC, SOURCE)).toBe(true);
  });

  it('an unknown source with no snapshot is paced like any other (the branch above `isKnownSource`)', () => {
    mkdirSync(join(dir, 'claudinho'), { recursive: true });
    writeFileSync(attemptRecordPath('nope', WC), JSON.stringify({ at: iso(NOW - 10_000), count: 1 }));
    expect(refreshWanted(NOW, undefined, WC, 'nope')).toBe(false);
    rmSync(attemptRecordPath('nope', WC), { force: true });
    expect(refreshWanted(NOW, undefined, WC, 'nope')).toBe(true);
  });
});

describe('a cycle with a readable snapshot opens the record zero times (acceptance 5, the cycle side)', () => {
  it('a stale readable snapshot in a live window: the lane fetches, and the record on disk is never opened', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ leagues: [{ season: { year: 2026, displayName: '2026 World Cup' } }], events: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    try {
      writeRecord({ at: iso(NOW - 2 * 60 * MIN), count: 6 });
      writeState(snapshot({ updatedAt: iso(NOW - 60 * MIN) }));
      opens.length = 0;
      await runRefresh({ source: SOURCE, competition: WC, now: new Date(NOW), jitterMs: 0 });
      expect(opens.filter((p) => p === attemptRecordPath(SOURCE, WC))).toHaveLength(0);
      expect(readCurrentState(SOURCE, WC)?.updatedAt).toBe(iso(NOW)); // the lane ran
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
