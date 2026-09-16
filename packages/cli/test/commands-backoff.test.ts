import { EspnAdapter, type Match, type ProviderAdapter } from '@claudinho/core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimLock, readState, releaseLock, writeState } from '../src/cache';
import { cmdToday } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';

/**
 * Audit A12 (P2), the CLI half: the ambient refresher honoured a persisted
 * backoff but every interactive command built a fresh adapter and fetched
 * regardless. Now the CLI pre-arms its adapter from the cache's `backoffUntil`
 * (zero requests, honest degraded output) and an interactive throttle is
 * persisted for the next process. Assertions count fetches.
 */
const NOW = new Date('2026-06-11T12:00:00Z');
const nowMs = NOW.getTime();
type FetchImpl = typeof fetch;
const ok = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({ events: [] }) }));
const throttled = vi.fn(async () => ({
  ok: false,
  status: 429,
  statusText: 'Too Many Requests',
  headers: { get: (k: string) => (k.toLowerCase() === 'retry-after' ? '600' : null) },
}));

function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return { lang: 'en', tz: 'UTC', json: true, color: false, source: 'espn', flavor: 'off', markets: false, ...over };
}
let dir: string;
const ORIG = process.env.XDG_CACHE_HOME;
const outSpy = vi.spyOn(process.stdout, 'write');
let writes: string[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-cmd-backoff-'));
  process.env.XDG_CACHE_HOME = dir;
  writes = [];
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
  ok.mockClear();
  throttled.mockClear();
});
afterEach(() => {
  outSpy.mockReset();
  if (ORIG === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = ORIG;
  rmSync(dir, { recursive: true, force: true });
});
const json = () => JSON.parse(writes.join(''));

describe('interactive commands and the persisted provider backoff', () => {
  it('a fresh process under a persisted backoff makes zero requests and says so', async () => {
    writeState({
      updatedAt: NOW.toISOString(),
      live: [],
      degraded: false,
      source: 'espn',
      competition: 'fifa.world',
      backoffUntil: new Date(nowMs + 10 * 60_000).toISOString(),
    });
    const adapter = new EspnAdapter({ fetchImpl: ok as unknown as FetchImpl, now: () => nowMs });
    await cmdToday('2026-06-11', { cfg: cfg(), t: makeT('en'), adapter, now: NOW });
    expect(ok).not.toHaveBeenCalled();
    expect(json().degraded).toBe(true);
  });

  it('an interactive throttle is persisted for the next process, honouring Retry-After', async () => {
    const adapter = new EspnAdapter({ fetchImpl: throttled as unknown as FetchImpl, now: () => nowMs });
    await cmdToday('2026-06-11', { cfg: cfg(), t: makeT('en'), adapter, now: NOW });
    expect(json().degraded).toBe(true);
    const until = Date.parse(readState()?.backoffUntil ?? '');
    expect(until - nowMs).toBeGreaterThanOrEqual(600_000);
    expect(until - nowMs).toBeLessThanOrEqual(601_000);
  });

  it('without a persisted backoff the command fetches as before (no regression)', async () => {
    const adapter = new EspnAdapter({ fetchImpl: ok as unknown as FetchImpl, now: () => nowMs });
    await cmdToday('2026-06-11', { cfg: cfg(), t: makeT('en'), adapter, now: NOW });
    expect(ok).toHaveBeenCalled();
    expect(json().degraded).toBe(false);
  });
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const resp = (status: number, retryAfter?: string) => ({
  ok: status < 400,
  status,
  statusText: 's',
  headers: { get: (k: string) => (k.toLowerCase() === 'retry-after' ? (retryAfter ?? null) : null) },
  json: async () => ({ events: [] }),
});
const tick = () => new Promise((r) => setTimeout(r, 0));
const persistedDelay = () => Date.parse(readState()?.backoffUntil ?? '') - nowMs;

describe('persistence follows the retained cooldown, not lastError (review P2 on #128)', () => {
  it('standings 429 then scoreboard 500: the ten-minute cooldown is persisted although lastError is the 500', async () => {
    const standings = deferred<unknown>();
    const scoreboard = deferred<unknown>();
    const fetchImpl = vi.fn((url: unknown) =>
      String(url).includes('/standings') ? standings.promise : scoreboard.promise,
    );
    const adapter = new EspnAdapter({ fetchImpl: fetchImpl as unknown as FetchImpl, now: () => nowMs });
    const run = cmdToday('2026-06-11', { cfg: cfg(), t: makeT('en'), adapter, now: NOW });
    standings.resolve(resp(429, '600'));
    await tick();
    scoreboard.resolve(resp(500));
    await run;
    expect(adapter.lastError?.status).toBe(500);
    expect(persistedDelay()).toBeGreaterThanOrEqual(600_000);
    expect(persistedDelay()).toBeLessThanOrEqual(601_000);
  });

  it('scoreboard 500 first, standings 429 after the command returned: the late throttle is still persisted', async () => {
    const standings = deferred<unknown>();
    const scoreboard = deferred<unknown>();
    const fetchImpl = vi.fn((url: unknown) =>
      String(url).includes('/standings') ? standings.promise : scoreboard.promise,
    );
    const adapter = new EspnAdapter({ fetchImpl: fetchImpl as unknown as FetchImpl, now: () => nowMs });
    const run = cmdToday('2026-06-11', { cfg: cfg(), t: makeT('en'), adapter, now: NOW });
    scoreboard.resolve(resp(500));
    await run; // the command is done; the enrichment request is still in flight
    expect(readState()?.backoffUntil).toBeUndefined();
    standings.resolve(resp(429, '600'));
    await tick();
    await tick();
    expect(persistedDelay()).toBeGreaterThanOrEqual(600_000);
    expect(persistedDelay()).toBeLessThanOrEqual(601_000);
  });
});

describe('the post-call fallback (an adapter with a retained window but no listener)', () => {
  it('persists from cooldownUntil even when lastError is a non-throttle failure', async () => {
    // The real adapter notifies through onCooldown; this fake has none, so the
    // wrapper's post-call check is the only path — and it must read the retained
    // window, never lastError (which here is the later 500).
    const fake: ProviderAdapter & { cooldownUntil?: number; lastError?: { kind: string; status?: number; throttled?: boolean } } = {
      name: 'espn',
      capabilities: { push: false, latencyHintSec: 0 },
      async fetchByDate(): Promise<Match[]> {
        return [];
      },
      async fetchLive(): Promise<Match[]> {
        return [];
      },
      async fetchWindow(): Promise<Match[]> {
        fake.cooldownUntil = nowMs + 600_000; // a concurrent 429 armed this…
        fake.lastError = { kind: 'http', status: 500, throttled: false }; // …then a 500 landed last
        throw new Error('500');
      },
    };
    await cmdToday('2026-06-11', { cfg: cfg(), t: makeT('en'), adapter: fake, now: NOW });
    expect(json().degraded).toBe(true);
    expect(persistedDelay()).toBe(600_000);
  });
});

describe('persistence bookkeeping (review round 2 on #128)', () => {
  it('a write skipped because another owner holds the lock is retried by the post-call fallback', async () => {
    // The test owns the lock while the 429 listener fires (its persist is
    // skipped), and releases it — via a listener registered AFTER the wrapper's —
    // before the command's own call settles. The fallback must then persist:
    // a skipped write is not a persisted one.
    const held = claimLock(nowMs);
    expect(held).toBeDefined();
    let registered = false;
    const fetchImpl = vi.fn(async () => {
      if (!registered) {
        registered = true;
        adapter.onCooldown(() => releaseLock(held)); // runs AFTER the wrapper's listener
      }
      return throttled();
    });
    const adapter = new EspnAdapter({ fetchImpl: fetchImpl as unknown as FetchImpl, now: () => nowMs, enrichGroups: false });
    await cmdToday('2026-06-11', { cfg: cfg(), t: makeT('en'), adapter, now: NOW });
    expect(json().degraded).toBe(true);
    expect(persistedDelay()).toBeGreaterThanOrEqual(600_000);
    expect(persistedDelay()).toBeLessThanOrEqual(601_000);
  });

  it('a cached deadline the cache rejects does not suppress a real throttle', async () => {
    // 31 min ahead is past the cache's 30-min bound: backoffActive rejects it, so
    // nothing is pre-armed — and it must not count as "already persisted" either,
    // or a real 600 s throttle could never replace it.
    writeState({
      updatedAt: NOW.toISOString(),
      live: [],
      degraded: false,
      source: 'espn',
      competition: 'fifa.world',
      backoffUntil: new Date(nowMs + 31 * 60_000).toISOString(),
    });
    const first = new EspnAdapter({ fetchImpl: throttled as unknown as FetchImpl, now: () => nowMs, enrichGroups: false });
    await cmdToday('2026-06-11', { cfg: cfg(), t: makeT('en'), adapter: first, now: NOW });
    expect(throttled).toHaveBeenCalledTimes(1);
    expect(persistedDelay()).toBeGreaterThanOrEqual(600_000);
    expect(persistedDelay()).toBeLessThanOrEqual(601_000);
    // A fresh invocation now honours the repaired deadline: zero requests.
    const second = new EspnAdapter({ fetchImpl: ok as unknown as FetchImpl, now: () => nowMs, enrichGroups: false });
    await cmdToday('2026-06-11', { cfg: cfg(), t: makeT('en'), adapter: second, now: NOW });
    expect(ok).not.toHaveBeenCalled();
  });
});
