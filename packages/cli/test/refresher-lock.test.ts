/**
 * 0.11 PR 2.6a — the refresher decides under the lock, and a throttle always
 * has somewhere to be written.
 *
 * Two holes in how refreshers and commands coordinate through the cache:
 *
 *   1. `runRefresh` read the cache and decided what was due BEFORE it took the
 *      lock. A refresher that got the lock just after another released it
 *      acted on a decision made before that other one published: it fetched
 *      again inside the cadence, and could publish over a backoff.
 *   2. A command that met a throttle wrote it under the refresh lock, and when
 *      a refresher held that lock the write was skipped and the throttle lost.
 *      And a writer that did get the lock wrote its own deadline over a longer
 *      one already there.
 *
 * Interleavings are forced, not raced: `claimLock` is wrapped so a test can
 * change the disk at the exact moment between "decided" and "locked".
 */
import { EspnAdapter } from '@claudinho/core';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let onClaim: (() => void) | undefined;
/** While true, every publish is refused (the lease was lost), as `publishState` reports it. */
let refusePublish = false;
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
    publishState: (...args: Parameters<typeof mod.publishState>) => (refusePublish ? false : mod.publishState(...args)),
  };
});

import {
  backoffInEffect,
  backoffNotePath,
  cacheDir,
  cachePath,
  type CacheState,
  claimLock,
  holdsLock,
  isLockFresh,
  readBackoffNote,
  readCurrentState,
  readState,
  releaseLock,
  writeBackoffNote,
  writeState,
} from '../src/cache';
import { withPersistedBackoff } from '../src/providerBackoff';
import { runRefresh, shouldRefresh, shouldRefreshFixtures } from '../src/refresh';

const SOURCE = 'espn';
const WC = 'fifa.world';
/** Inside the opener's live window; not in the knockout phase. */
const OPENER_LIVE = new Date('2026-06-11T19:30:00Z');
/** Inside a semi-final's live window, in the knockout phase: both lanes can be due. */
const SEMI_LIVE = new Date('2026-07-14T19:30:00Z');
const MIN = 60_000;

const seasonOf = (year: number) => ({ year, startDate: `${year}-06-11T04:00Z`, endDate: `${year}-12-31T04:59Z`, displayName: `${year} FIFA World Cup` });
const answer = (events: unknown[] = []) =>
  new Response(JSON.stringify({ leagues: [{ season: seasonOf(2026) }], events }), { status: 200, headers: { 'content-type': 'application/json' } });
const throttle = (retryAfter: string) =>
  new Response('{}', { status: 429, statusText: 'Too Many Requests', headers: { 'retry-after': retryAfter } });

let requests: string[] = [];
/** A provider that answers every request (an empty, healthy day or month) and records it. */
const provider = (each?: (url: string) => Response | undefined | Promise<Response | undefined>) =>
  vi.stubGlobal('fetch', async (input: unknown) => {
    const url = String(input);
    requests.push(url);
    return (await each?.(url)) ?? answer();
  });
const days = () => requests.filter((u) => /dates=\d{8}(&|$)/.test(u));
const months = () => requests.filter((u) => /dates=\d{6}(&|$)/.test(u));

/** A snapshot whose live slice is a minute old at `at`: due for a live read. */
const stale = (at: Date, over: Partial<CacheState> = {}): CacheState => ({
  updatedAt: new Date(at.getTime() - MIN).toISOString(),
  live: [],
  degraded: false,
  source: SOURCE,
  competition: WC,
  ...over,
});
const refresh = (at: Date) => runRefresh({ source: SOURCE, competition: WC, now: at, jitterMs: 0 });
const inEffect = (atMs: number) => backoffInEffect(readCurrentState(SOURCE, WC), SOURCE, WC, atMs);

let dir: string;
const ORIG = process.env.XDG_CACHE_HOME;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-refresher-lock-'));
  process.env.XDG_CACHE_HOME = dir;
  requests = [];
  onClaim = undefined;
  refusePublish = false;
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIG === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = ORIG;
  rmSync(dir, { recursive: true, force: true });
});

/**
 * After a moment, write `text` into the pipe at `path` from another process.
 * The helper opens the pipe for reading AND writing, which never waits and
 * needs nobody on the other end: a reader blocked on the pipe is let through
 * and reads `text`; with nobody reading, the text is discarded when the helper
 * closes. Either way the helper ends by itself.
 */
function feedPipeLater(path: string, text: string): void {
  const helper = spawn(
    process.execPath,
    [
      '-e',
      `setTimeout(() => {
         const fs = require('node:fs');
         try {
           const fd = fs.openSync(process.argv[1], fs.constants.O_RDWR | fs.constants.O_NONBLOCK);
           fs.writeSync(fd, process.argv[2]);
           setTimeout(() => fs.closeSync(fd), 200);
         } catch {}
       }, 1500);`,
      path,
      text,
    ],
    { detached: true, stdio: 'ignore' },
  );
  helper.unref();
}

describe('a decision to ask the provider is made from the state read under the lock', () => {
  it('control: a stale live slice in a live window is refreshed (three day requests)', async () => {
    writeState(stale(OPENER_LIVE));
    provider();
    await refresh(OPENER_LIVE);
    expect(days()).toHaveLength(3);
  });

  it('a refresher that gets the lock just after another one published fetches nothing', async () => {
    writeState(stale(OPENER_LIVE));
    provider();
    // Between this refresher's first look at the cache and its lock, another
    // refresher publishes a fresh live slice and releases.
    onClaim = () => writeState(stale(OPENER_LIVE, { updatedAt: OPENER_LIVE.toISOString() }));
    await refresh(OPENER_LIVE);
    expect(requests).toEqual([]);
    expect(readState(SOURCE, WC)?.updatedAt).toBe(OPENER_LIVE.toISOString());
  });

  it('nor when what the other one published is a backoff, which is still there afterwards', async () => {
    writeState(stale(OPENER_LIVE));
    provider();
    const until = new Date(OPENER_LIVE.getTime() + 6 * MIN).toISOString();
    onClaim = () => writeState(stale(OPENER_LIVE, { degraded: true, backoffUntil: until }));
    await refresh(OPENER_LIVE);
    expect(requests).toEqual([]);
    expect(readState(SOURCE, WC)?.backoffUntil).toBe(until);
  });

  it('the first snapshot of a scope is written under the lock too: a refresher that finds one there, once it holds the lock, writes nothing', async () => {
    // No snapshot, outside every window: the refresher writes one idle
    // snapshot so the hot path stops starting it. Another one got there first.
    const quiet = new Date('2026-06-12T09:00:00Z');
    provider();
    const first = stale(quiet, { updatedAt: quiet.toISOString(), degraded: true });
    onClaim = () => writeState(first);
    await refresh(quiet);
    expect(requests).toEqual([]);
    expect(readState(SOURCE, WC)?.degraded).toBe(true); // the other one's, not overwritten
  });
});

describe('a throttle a command meets while a refresher holds the lock is not lost', () => {
  const nowMs = OPENER_LIVE.getTime();
  const throttled = (retryAfter: string) =>
    new EspnAdapter({
      competition: WC,
      enrichGroups: false,
      now: () => nowMs,
      fetchImpl: (async (input: unknown) => {
        requests.push(String(input));
        return throttle(retryAfter);
      }) as unknown as typeof fetch,
    });

  it('it is on disk when the command returns; the hot path starts nothing and the next refresh asks nothing', async () => {
    writeState(stale(OPENER_LIVE));
    const held = claimLock(nowMs); // a refresher is mid-cycle for the whole command
    expect(held).toBeDefined();
    const adapter = withPersistedBackoff(throttled('600'), SOURCE, OPENER_LIVE);
    await expect(adapter.fetchByDate('2026-06-11')).rejects.toMatchObject({ status: 429 });
    releaseLock(held);

    expect(inEffect(nowMs + 1000)).toBe(nowMs + 600_000);
    const state = readCurrentState(SOURCE, WC);
    expect(shouldRefresh(nowMs + 20_000, state, WC, SOURCE)).toBe(false);
    expect(shouldRefreshFixtures(SEMI_LIVE.getTime(), state, WC, SOURCE)).toBe(true); // long after it ended

    requests = [];
    provider();
    await refresh(new Date(nowMs + 20_000));
    expect(requests).toEqual([]); // it returned at its first look: nothing was asked, nothing written
    await refresh(new Date(nowMs + 601_000));
    expect(days()).toHaveLength(3);
  });

  it('the next command honours it too: its adapter is armed and asks nothing', async () => {
    writeState(stale(OPENER_LIVE));
    const held = claimLock(nowMs);
    await expect(withPersistedBackoff(throttled('600'), SOURCE, OPENER_LIVE).fetchByDate('2026-06-11')).rejects.toMatchObject({ status: 429 });
    releaseLock(held);
    requests = [];
    const next = withPersistedBackoff(throttled('600'), SOURCE, new Date(nowMs + 30_000));
    await expect(next.fetchByDate('2026-06-11')).rejects.toMatchObject({ status: 429 });
    expect(requests).toEqual([]);
  });
});

describe('every writer keeps the later of the deadlines it believes', () => {
  const nowMs = OPENER_LIVE.getTime();
  const command = (retryAfter: string) =>
    withPersistedBackoff(
      new EspnAdapter({
        competition: WC,
        enrichGroups: false,
        now: () => nowMs,
        fetchImpl: (async () => throttle(retryAfter)) as unknown as typeof fetch,
      }),
      SOURCE,
      OPENER_LIVE,
    );

  it('two commands under the lock: the shorter throttle does not replace the longer, in either order', async () => {
    for (const order of [
      ['600', '60'],
      ['60', '600'],
    ]) {
      rmSync(dir, { recursive: true, force: true });
      writeState(stale(OPENER_LIVE));
      // Both started before either throttle existed, so neither is pre-armed.
      const [first, second] = [command(order[0] as string), command(order[1] as string)];
      await expect(first.fetchByDate('2026-06-11')).rejects.toBeDefined();
      await expect(second.fetchByDate('2026-06-11')).rejects.toBeDefined();
      expect(inEffect(nowMs + 1000), order.join(' then ')).toBe(nowMs + 600_000);
    }
  });

  it('two commands while the lock is held (the note): the same', async () => {
    for (const order of [
      ['600', '60'],
      ['60', '600'],
    ]) {
      rmSync(dir, { recursive: true, force: true });
      writeState(stale(OPENER_LIVE));
      const held = claimLock(nowMs);
      const [first, second] = [command(order[0] as string), command(order[1] as string)];
      await expect(first.fetchByDate('2026-06-11')).rejects.toBeDefined();
      await expect(second.fetchByDate('2026-06-11')).rejects.toBeDefined();
      releaseLock(held);
      expect(inEffect(nowMs + 1000), order.join(' then ')).toBe(nowMs + 600_000);
    }
  });

  it('the refresher’s publish: a longer deadline that reached the note during its cycle is what it writes', async () => {
    writeState(stale(OPENER_LIVE));
    const noted = nowMs + 20 * MIN;
    provider(() => {
      // A command, throttled for 20 minutes, could not get the lock.
      writeBackoffNote(SOURCE, WC, noted, nowMs);
      return throttle('60'); // this cycle's own: the 5-minute floor
    });
    await refresh(OPENER_LIVE);
    expect(Date.parse(readState(SOURCE, WC)?.backoffUntil ?? '')).toBe(noted);
  });

  it('a deadline that is not believed takes no part: it does not beat a real throttle, and does not hide one', async () => {
    const never = '2099-01-01T00:00:00.000Z';
    // In the snapshot: a real throttle replaces it.
    writeState(stale(OPENER_LIVE, { backoffUntil: never }));
    await expect(command('600').fetchByDate('2026-06-11')).rejects.toBeDefined();
    expect(readState(SOURCE, WC)?.backoffUntil).toBe(new Date(nowMs + 600_000).toISOString());
    // In the note: the same.
    rmSync(dir, { recursive: true, force: true });
    writeState(stale(OPENER_LIVE));
    writeFileSync(backoffNotePath(SOURCE, WC), JSON.stringify({ until: never }));
    expect(inEffect(nowMs)).toBeUndefined();
    expect(writeBackoffNote(SOURCE, WC, nowMs + 600_000, nowMs)).toBe(true);
    expect(inEffect(nowMs)).toBe(nowMs + 600_000);
    // An unbelieved value on one side does not hide a believed one on the other.
    rmSync(dir, { recursive: true, force: true });
    writeState(stale(OPENER_LIVE, { backoffUntil: new Date(nowMs + 10 * MIN).toISOString() }));
    writeFileSync(backoffNotePath(SOURCE, WC), JSON.stringify({ until: never }));
    expect(inEffect(nowMs)).toBe(nowMs + 10 * MIN);
    rmSync(dir, { recursive: true, force: true });
    writeState(stale(OPENER_LIVE, { backoffUntil: never }));
    writeBackoffNote(SOURCE, WC, nowMs + 10 * MIN, nowMs);
    expect(inEffect(nowMs)).toBe(nowMs + 10 * MIN);
  });
});

describe('the note is read again before each lane of a cycle', () => {
  const nowMs = SEMI_LIVE.getTime();
  const bothDue = () => writeState(stale(SEMI_LIVE));

  it('control: in the knockout phase, inside a live window, both lanes are asked', async () => {
    bothDue();
    provider();
    await refresh(SEMI_LIVE);
    expect(days()).toHaveLength(3);
    expect(months()).toHaveLength(2);
  });

  it('a throttle that reaches the note during the live read stops the knockout read', async () => {
    bothDue();
    let noted = false;
    provider((url) => {
      if (!noted && /dates=\d{8}(&|$)/.test(url)) {
        noted = true;
        writeBackoffNote(SOURCE, WC, nowMs + 10 * MIN, nowMs); // a command, elsewhere, was told to stop
      }
      return undefined;
    });
    await refresh(SEMI_LIVE);
    expect(days()).toHaveLength(3); // already sent together
    expect(months()).toEqual([]);
    expect(Date.parse(readState(SOURCE, WC)?.backoffUntil ?? '')).toBe(nowMs + 10 * MIN);
  });
});

describe('a note is small, bounded and never deleted', () => {
  const nowMs = OPENER_LIVE.getTime();

  it('an expired note blocks nothing and is left where it is', async () => {
    writeState(stale(OPENER_LIVE));
    expect(writeBackoffNote(SOURCE, WC, nowMs + MIN, nowMs)).toBe(true);
    const later = new Date(nowMs + 2 * MIN);
    expect(inEffect(later.getTime())).toBeUndefined();
    provider();
    await refresh(later);
    expect(days()).toHaveLength(3);
    expect(existsSync(backoffNotePath(SOURCE, WC))).toBe(true);
    // The next writer simply writes over it.
    expect(writeBackoffNote(SOURCE, WC, later.getTime() + 5 * MIN, later.getTime())).toBe(true);
    expect(inEffect(later.getTime())).toBe(later.getTime() + 5 * MIN);
  });

  it('a deadline that would not be believed is not written', () => {
    expect(writeBackoffNote(SOURCE, WC, nowMs - 1, nowMs)).toBe(false); // already over
    expect(writeBackoffNote(SOURCE, WC, nowMs + 31 * MIN, nowMs)).toBe(false); // longer than any backoff we honour
    expect(writeBackoffNote(SOURCE, WC, Number.NaN, nowMs)).toBe(false);
    expect(existsSync(backoffNotePath(SOURCE, WC))).toBe(false);
  });

  it('a note that is corrupt, oversized or the wrong shape is no note: it never throws, blocks or unblocks', () => {
    const snapshot = nowMs + 10 * MIN;
    for (const body of [
      '',
      'not json',
      '[]',
      'null',
      '{}',
      '{"until":7}',
      '{"until":"soon"}',
      // A real instant ten minutes ahead, but not written the way this product writes a stamp.
      '{"until":"June 11, 2026 19:40:00 UTC"}',
      '{"until":"2026-06-11T19:40:00+00:00"}',
      // The right shape, in a file far larger than a note is.
      '{"until":"2026-06-11T19:40:00.000Z","x":1}'.padEnd(5000, ' '),
    ]) {
      rmSync(dir, { recursive: true, force: true });
      writeState(stale(OPENER_LIVE));
      writeFileSync(backoffNotePath(SOURCE, WC), body);
      expect(inEffect(nowMs), JSON.stringify(body.slice(0, 30))).toBeUndefined();
      // And it does not unblock a backoff the snapshot holds.
      writeState(stale(OPENER_LIVE, { backoffUntil: new Date(snapshot).toISOString() }));
      expect(inEffect(nowMs), JSON.stringify(body.slice(0, 30))).toBe(snapshot);
    }
  });

  it('a well-formed note IS read (the control for the list above)', () => {
    writeState(stale(OPENER_LIVE));
    writeFileSync(backoffNotePath(SOURCE, WC), '{"until":"2026-06-11T19:40:00.000Z"}');
    expect(inEffect(nowMs)).toBe(Date.parse('2026-06-11T19:40:00.000Z'));
  });

  it('a note with no snapshot beside it: the first snapshot says the provider said stop, not that nothing is on', async () => {
    // Inside the opener's live window. A command was throttled before any
    // refresher ever ran for this scope.
    writeBackoffNote(SOURCE, WC, nowMs + 10 * MIN, nowMs);
    provider();
    await refresh(OPENER_LIVE);
    expect(requests).toEqual([]);
    const state = readState(SOURCE, WC);
    expect(state?.degraded).toBe(true);
    expect(Date.parse(state?.backoffUntil ?? '')).toBe(nowMs + 10 * MIN);
  });

  it('both triggers honour the note', () => {
    const semi = SEMI_LIVE.getTime();
    writeState(stale(SEMI_LIVE));
    const state = readCurrentState(SOURCE, WC);
    expect(shouldRefresh(semi, state, WC, SOURCE)).toBe(true);
    expect(shouldRefreshFixtures(semi, state, WC, SOURCE)).toBe(true);
    writeBackoffNote(SOURCE, WC, semi + 10 * MIN, semi);
    expect(shouldRefresh(semi, state, WC, SOURCE)).toBe(false);
    expect(shouldRefreshFixtures(semi, state, WC, SOURCE)).toBe(false);
  });

  it('a note belongs to its scope: another competition’s throttle is not this one’s', () => {
    writeBackoffNote(SOURCE, 'eng.1', nowMs + 10 * MIN, nowMs);
    expect(backoffInEffect(undefined, SOURCE, WC, nowMs)).toBeUndefined();
    expect(backoffInEffect(undefined, SOURCE, 'eng.1', nowMs)).toBe(nowMs + 10 * MIN);
    // The scope comes from an environment variable: it names a file in the cache directory, never a path.
    for (const hostile of ['a/../b', '../../etc/x', '..\\..\\x', 'a/b']) {
      expect(dirname(backoffNotePath(SOURCE, hostile)), hostile).toBe(cacheDir());
      expect(dirname(backoffNotePath(hostile, WC)), hostile).toBe(cacheDir());
    }
  });
});

describe('found in review', () => {
  const nowMs = OPENER_LIVE.getTime();
  const POSIX = process.platform !== 'win32';
  const throttled = (retryAfter: string) =>
    new EspnAdapter({
      competition: WC,
      enrichGroups: false,
      now: () => nowMs,
      fetchImpl: (async () => throttle(retryAfter)) as unknown as typeof fetch,
    });

  it('a REFRESHER whose publish is refused still leaves the throttle it met on disk', async () => {
    // "A throttle always has somewhere to be written" held for a command and
    // not for the refresher: when its lease was taken over mid-cycle the
    // publish was refused and the deadline it had just been given went nowhere.
    writeState(stale(OPENER_LIVE));
    let successor: ReturnType<typeof claimLock>;
    let stolen = false;
    provider(() => {
      if (!stolen) {
        stolen = true;
        successor = claimLock(Date.now() + 61_000); // the lease is judged stale and taken over, mid-fetch
      }
      return throttle('600');
    });
    await refresh(OPENER_LIVE);
    releaseLock(successor); // the successor finishes, without having been throttled itself
    // The publish was refused: the snapshot is the one from before.
    expect(readState(SOURCE, WC)?.backoffUntil).toBeUndefined();
    // A lower bound only: the refresher's clock is the injected time plus the
    // real time elapsed, and a test never asserts how long something took.
    expect(inEffect(nowMs + 20_000) ?? 0).toBeGreaterThanOrEqual(nowMs + 600_000);
    expect(shouldRefresh(nowMs + 20_000, readCurrentState(SOURCE, WC), WC, SOURCE)).toBe(false);
    requests = [];
    await refresh(new Date(nowMs + 20_000));
    expect(requests).toEqual([]);
  });

  it('only a write that HAPPENED counts: a throttle that could be written nowhere is retried', async () => {
    // The rule from the review of #128. Its test was rewritten when the first
    // persist stopped being skipped (it goes to the note); the rule still has
    // a failing case, and this is it: the lock is someone else's AND the note
    // cannot be written. Marking that throttle "persisted" would lose it.
    writeState(stale(OPENER_LIVE));
    mkdirSync(backoffNotePath(SOURCE, WC), { recursive: true }); // a directory where the note goes
    const held = claimLock(nowMs);
    const inner = throttled('600');
    const adapter = withPersistedBackoff(inner, SOURCE, OPENER_LIVE);
    // Registered AFTER the wrapper's listener: the lock comes free once the first persist has failed.
    inner.onCooldown?.(() => releaseLock(held));
    await expect(adapter.fetchByDate('2026-06-11')).rejects.toMatchObject({ status: 429 });
    expect(Date.parse(readState(SOURCE, WC)?.backoffUntil ?? '')).toBe(nowMs + 600_000);
  });

  it('the refresher’s publish: a carried deadline nobody believes neither outranks the cycle’s real throttle nor is carried on', async () => {
    const never = '2099-01-01T00:00:00.000Z';
    writeState(stale(OPENER_LIVE, { backoffUntil: never }));
    provider(() => throttle('600'));
    await refresh(OPENER_LIVE);
    const until = Date.parse(readState(SOURCE, WC)?.backoffUntil ?? '');
    expect(until).toBeGreaterThanOrEqual(nowMs + 600_000);
    // The upper bound is what tells the real throttle from 2099; it is the
    // product's own 30-minute bound, not a measure of how long the cycle took.
    expect(until).toBeLessThanOrEqual(nowMs + 30 * MIN);
    // A healthy cycle drops it.
    rmSync(dir, { recursive: true, force: true });
    writeState(stale(OPENER_LIVE, { backoffUntil: never }));
    requests = [];
    provider();
    await refresh(OPENER_LIVE);
    expect(days()).toHaveLength(3);
    expect(readState(SOURCE, WC)?.backoffUntil).toBeUndefined();
  });

  it('both sides believed: the backoff in effect is the LATER one, whichever side holds it', () => {
    writeState(stale(OPENER_LIVE, { backoffUntil: new Date(nowMs + 5 * MIN).toISOString() }));
    writeBackoffNote(SOURCE, WC, nowMs + 20 * MIN, nowMs);
    expect(inEffect(nowMs)).toBe(nowMs + 20 * MIN);
    rmSync(dir, { recursive: true, force: true });
    writeState(stale(OPENER_LIVE, { backoffUntil: new Date(nowMs + 20 * MIN).toISOString() }));
    writeBackoffNote(SOURCE, WC, nowMs + 5 * MIN, nowMs);
    expect(inEffect(nowMs)).toBe(nowMs + 20 * MIN);
  });

  it.skipIf(!POSIX)('a note path that is not a regular file is never read (a pipe there would block the hot path)', () => {
    mkdirSync(cacheDir(), { recursive: true });
    const pipe = backoffNotePath(SOURCE, WC);
    execFileSync('mkfifo', [pipe]);
    // Opening a pipe with no writer blocks for ever, and a blocked synchronous
    // read cannot be timed out from here. So that a regression FAILS instead
    // of hanging the suite, a helper process waits a moment and then writes a
    // well-formed note into the pipe: a reader that was wrongly blocked on it
    // wakes up holding a deadline, and the assertion below is red. With the
    // rule in place nothing is reading, and what the helper wrote is discarded.
    feedPipeLater(pipe, JSON.stringify({ until: new Date(nowMs + 10 * MIN).toISOString() }));
    expect(readBackoffNote(SOURCE, WC, nowMs)).toBeUndefined();
    expect(backoffInEffect(undefined, SOURCE, WC, nowMs)).toBeUndefined();
  });

  it.skipIf(!POSIX)('nor is a lock path that is not a regular file: it is a lock nobody can judge, so it is stale, and it is taken over', () => {
    // The hot path asks the lock's age on every prompt, before the note or the
    // snapshot matter. A reader blocked on a pipe there wakes holding the fresh
    // lock the helper wrote, and says a refresher is running.
    mkdirSync(cacheDir(), { recursive: true });
    const pipe = join(cacheDir(), 'refresh.lock');
    execFileSync('mkfifo', [pipe]);
    feedPipeLater(pipe, `${process.pid} ${nowMs} 0123456789ab`);
    expect(isLockFresh(nowMs)).toBe(false);
    const token = claimLock(nowMs);
    expect(token).toBeDefined();
    expect(holdsLock(token)).toBe(true);
    expect(statSync(pipe).isFile()).toBe(true); // the pipe is gone: a real lock is there
    releaseLock(token);
  });

  it.skipIf(!POSIX || process.getuid?.() === 0)('a note that cannot be read back was not written: the caller is told, and retries', () => {
    // An existing note nobody can read: the replacement inherits its mode (an
    // atomic write preserves it), so the deadline is on disk and invisible.
    mkdirSync(cacheDir(), { recursive: true });
    const path = backoffNotePath(SOURCE, WC);
    writeFileSync(path, '{}');
    chmodSync(path, 0o000);
    try {
      expect(writeBackoffNote(SOURCE, WC, nowMs + 10 * MIN, nowMs)).toBe(false);
    } finally {
      chmodSync(path, 0o600);
    }
  });

  it('a deadline that is not a whole millisecond: what is written is what a reader sees, and it counts as written', () => {
    // The note stores a stamp in whole milliseconds; the read-back compared it
    // with the unrounded value and reported a real write as "not written".
    expect(writeBackoffNote(SOURCE, WC, nowMs + 10 * MIN + 0.5, nowMs)).toBe(true);
    expect(readBackoffNote(SOURCE, WC, nowMs)).toBe(nowMs + 10 * MIN);
  });

  it('the note is named after its snapshot, by one rule: a scope cannot have one without the other', () => {
    for (const [source, competition] of [
      [SOURCE, WC],
      [SOURCE, 'eng.1'],
      ['fake', WC],
      [SOURCE, 'a/../b'],
    ] as const) {
      const snapshot = basename(cachePath(source, competition));
      expect(basename(backoffNotePath(source, competition)), snapshot).toBe(snapshot.replace(/^state/, 'backoff'));
    }
  });

  it('before the second lane the refresher asks about the backoff as every reader does: the snapshot’s deadline too, at the time it is now', async () => {
    // The second lane re-read only the NOTE. A deadline in the snapshot that
    // was just past the 30-minute bound when the cycle started (not believed)
    // is believed a moment later, and every other reader would then stop.
    const semi = SEMI_LIVE.getTime();
    writeState(stale(SEMI_LIVE, { backoffUntil: new Date(semi + 30 * MIN + 50).toISOString() }));
    provider(async (url) => {
      // The live read takes a moment (a lower bound is all this needs).
      if (/dates=\d{8}(&|$)/.test(url)) await new Promise((resolve) => setTimeout(resolve, 200));
      return undefined;
    });
    await refresh(SEMI_LIVE);
    expect(days()).toHaveLength(3); // not believed when the cycle decided: the live lane ran
    expect(months()).toEqual([]); // believed by the time the second lane would start
    // And at publish, asked at the time it is THEN: believed, so it is carried, not dropped.
    expect(readState(SOURCE, WC)?.backoffUntil).toBe(new Date(semi + 30 * MIN + 50).toISOString());
  });

  it('an unknown source: its one idle snapshot is written under the lock too, after reading again', async () => {
    const quiet = new Date('2026-06-12T09:00:00Z');
    provider();
    const theirs: CacheState = { updatedAt: '2026-06-12T08:59:00.000Z', live: [], degraded: true, source: 'nope', competition: WC };
    onClaim = () => writeState(theirs);
    await runRefresh({ source: 'nope', competition: WC, now: quiet, jitterMs: 0 });
    expect(requests).toEqual([]);
    expect(readState('nope', WC)?.updatedAt).toBe(theirs.updatedAt); // the other one's, not overwritten
  });
});

describe('found in review, round 2', () => {
  const nowMs = OPENER_LIVE.getTime();
  const POSIX = process.platform !== 'win32';
  const throttledCommand = (retryAfter: string) =>
    withPersistedBackoff(
      new EspnAdapter({
        competition: WC,
        enrichGroups: false,
        now: () => nowMs,
        fetchImpl: (async () => throttle(retryAfter)) as unknown as typeof fetch,
      }),
      SOURCE,
      OPENER_LIVE,
    );

  it('a COMMAND that gets the lock and whose publish is then refused leaves its throttle in the note', async () => {
    // The refresher's refused publish was given the note; the command's was
    // not. A throttle that arrives late (after the command's own call
    // returned) has no "next chance": it must be placed when it is met.
    writeState(stale(OPENER_LIVE));
    refusePublish = true;
    await expect(throttledCommand('600').fetchByDate('2026-06-11')).rejects.toMatchObject({ status: 429 });
    refusePublish = false;
    expect(readState(SOURCE, WC)?.backoffUntil).toBeUndefined();
    expect(readBackoffNote(SOURCE, WC, nowMs)).toBe(nowMs + 600_000);
  });

  it('a command under the lock keeps a LONGER deadline that is in the note, like every writer', async () => {
    // It compared its throttle with the snapshot's deadline only.
    writeState(stale(OPENER_LIVE));
    const command = throttledCommand('600'); // wrapped before the note exists: not pre-armed
    writeBackoffNote(SOURCE, WC, nowMs + 20 * MIN, nowMs);
    await expect(command.fetchByDate('2026-06-11')).rejects.toBeDefined();
    expect(Date.parse(readState(SOURCE, WC)?.backoffUntil ?? '')).toBe(nowMs + 20 * MIN);
  });

  it.skipIf(!POSIX || process.getuid?.() === 0)('a throttle written into a snapshot nobody can read is not "persisted": it goes to the note', async () => {
    // The snapshot-side twin of the unreadable note: an atomic write keeps the
    // mode of the file it replaces, so the deadline is on disk and invisible,
    // and the next command asks the provider inside the backoff.
    writeState(stale(OPENER_LIVE));
    chmodSync(cachePath(SOURCE, WC), 0o000);
    try {
      await expect(throttledCommand('600').fetchByDate('2026-06-11')).rejects.toBeDefined();
      expect(inEffect(nowMs + 1000)).toBe(nowMs + 600_000);
      requests = [];
      const next = withPersistedBackoff(
        new EspnAdapter({
          competition: WC,
          enrichGroups: false,
          now: () => nowMs + 30_000,
          fetchImpl: (async (input: unknown) => {
            requests.push(String(input));
            return answer();
          }) as unknown as typeof fetch,
        }),
        SOURCE,
        new Date(nowMs + 30_000),
      );
      await expect(next.fetchByDate('2026-06-11')).rejects.toBeDefined();
      expect(requests).toEqual([]);
    } finally {
      chmodSync(cachePath(SOURCE, WC), 0o600);
    }
  });

  it.skipIf(!POSIX || process.getuid?.() === 0)('the refresher too: a throttle published into a snapshot nobody can read goes to the note', async () => {
    writeState(stale(OPENER_LIVE));
    chmodSync(cachePath(SOURCE, WC), 0o000);
    try {
      provider(() => throttle('600'));
      await refresh(OPENER_LIVE);
      expect(inEffect(nowMs + 20_000) ?? 0).toBeGreaterThanOrEqual(nowMs + 600_000);
    } finally {
      chmodSync(cachePath(SOURCE, WC), 0o600);
    }
  });

  it('the refresher’s publish, the other way round: its own longer throttle beats a shorter note', async () => {
    // A3 pinned a longer note against a shorter throttle only: a publish that
    // kept the CARRIED deadline whatever came passed it.
    writeState(stale(OPENER_LIVE));
    provider(() => {
      writeBackoffNote(SOURCE, WC, nowMs + MIN, nowMs);
      return throttle('600');
    });
    await refresh(OPENER_LIVE);
    const until = Date.parse(readState(SOURCE, WC)?.backoffUntil ?? '');
    expect(until).toBeGreaterThanOrEqual(nowMs + 600_000);
    expect(until).toBeLessThanOrEqual(nowMs + 30 * MIN);
  });
});
