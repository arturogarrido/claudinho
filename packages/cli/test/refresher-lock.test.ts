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
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  };
});

import {
  backoffInEffect,
  backoffNotePath,
  type CacheState,
  claimLock,
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
const provider = (each?: (url: string) => Response | undefined) =>
  vi.stubGlobal('fetch', async (input: unknown) => {
    const url = String(input);
    requests.push(url);
    return each?.(url) ?? answer();
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
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIG === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = ORIG;
  rmSync(dir, { recursive: true, force: true });
});

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

  it('the first snapshot of a scope is written under the lock too: a refresher that loses it writes nothing', async () => {
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
    expect(requests).toEqual([]);
    // The refresher folded it into the snapshot it carries.
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
    for (const body of ['', 'not json', '[]', 'null', '{}', '{"until":7}', '{"until":"soon"}', '{"until":"2026-06-11T19:40:00Z","x":1}'.padEnd(5000, ' ')]) {
      rmSync(dir, { recursive: true, force: true });
      writeState(stale(OPENER_LIVE));
      writeFileSync(backoffNotePath(SOURCE, WC), body);
      expect(inEffect(nowMs), JSON.stringify(body.slice(0, 30))).toBeUndefined();
      // And it does not unblock a backoff the snapshot holds.
      writeState(stale(OPENER_LIVE, { backoffUntil: new Date(snapshot).toISOString() }));
      expect(inEffect(nowMs), JSON.stringify(body.slice(0, 30))).toBe(snapshot);
    }
  });

  it('a note belongs to its scope: another competition’s throttle is not this one’s', () => {
    writeBackoffNote(SOURCE, 'eng.1', nowMs + 10 * MIN, nowMs);
    expect(backoffInEffect(undefined, SOURCE, WC, nowMs)).toBeUndefined();
    expect(backoffInEffect(undefined, SOURCE, 'eng.1', nowMs)).toBe(nowMs + 10 * MIN);
    expect(backoffNotePath(SOURCE, 'a/../b')).not.toContain('..');
  });
});
