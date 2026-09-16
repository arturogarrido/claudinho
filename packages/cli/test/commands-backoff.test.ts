import { EspnAdapter } from '@claudinho/core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readState, writeState } from '../src/cache';
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
