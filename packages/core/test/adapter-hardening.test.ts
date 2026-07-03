/**
 * F5 Batch 2 adapter hardening: typed provider errors (throttle vs blip),
 * the never-cache-a-transient-failure rule on the group map, the shared
 * standings fetch, the versioned User-Agent, and the bundle-derived knockout
 * window (parity-pinned against the former hardcoded literals).
 */
import { describe, expect, it, vi } from 'vitest';
import { EspnAdapter, ProviderError } from '../src/adapters/espn';
import { knockoutWindow } from '../src/live';

type FetchImpl = typeof fetch;

const STANDINGS = {
  children: [
    {
      name: 'Group A',
      standings: {
        entries: [
          {
            team: { abbreviation: 'MEX', displayName: 'Mexico' },
            stats: [{ name: 'rank', value: 1 }],
          },
        ],
      },
    },
  ],
};

const okJson = (body: unknown) =>
  ({ ok: true, status: 200, statusText: 'OK', json: async () => body }) as unknown as Response;
const httpError = (status: number, statusText = 'err') =>
  ({ ok: false, status, statusText }) as unknown as Response;

describe('typed provider errors', () => {
  it('classifies 429/403 as throttled and records lastError', async () => {
    const adapter = new EspnAdapter({
      fetchImpl: (async () => httpError(429, 'Too Many Requests')) as FetchImpl,
    });
    await expect(adapter.fetchStandings()).rejects.toBeInstanceOf(ProviderError);
    expect(adapter.lastError?.kind).toBe('http');
    expect(adapter.lastError?.status).toBe(429);
    expect(adapter.lastError?.throttled).toBe(true);
  });

  it('a plain 500 is http but NOT throttled', async () => {
    const adapter = new EspnAdapter({ fetchImpl: (async () => httpError(500)) as FetchImpl });
    await expect(adapter.fetchStandings()).rejects.toMatchObject({ kind: 'http', status: 500 });
    expect(adapter.lastError?.throttled).toBe(false);
  });

  it('an aborted request classifies as a timeout', async () => {
    const fetchImpl = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      })) as FetchImpl;
    const adapter = new EspnAdapter({ fetchImpl, timeoutMs: 10 });
    await expect(adapter.fetchStandings()).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('an unparseable body classifies as parse', async () => {
    const adapter = new EspnAdapter({
      fetchImpl: (async () =>
        ({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => {
            throw new Error('bad json');
          },
        }) as unknown as Response) as FetchImpl,
    });
    await expect(adapter.fetchStandings()).rejects.toMatchObject({ kind: 'parse' });
  });

  it('lastError clears when a subsequent request starts and succeeds', async () => {
    let fail = true;
    const adapter = new EspnAdapter({
      fetchImpl: (async () => (fail ? httpError(429) : okJson(STANDINGS))) as FetchImpl,
    });
    await expect(adapter.fetchStandings()).rejects.toBeInstanceOf(ProviderError);
    fail = false;
    await adapter.fetchStandings();
    expect(adapter.lastError).toBeUndefined();
  });
});

describe('group map: never cache a transient failure (F5 ARCH-2)', () => {
  it('a failed standings fetch yields {} for THAT call, then recovers on the next', async () => {
    let calls = 0;
    const adapter = new EspnAdapter({
      fetchImpl: (async () => {
        calls += 1;
        return calls === 1 ? httpError(500) : okJson(STANDINGS);
      }) as FetchImpl,
    });
    // First call: transient failure → empty map, but NOT pinned.
    expect(await adapter.fetchGroupMap()).toEqual({});
    // Second call: the blip passed → the real map (the old code returned {} forever).
    expect(await adapter.fetchGroupMap()).toEqual({ MEX: 'A' });
  });
});

describe('shared standings fetch (F5 PERF-4)', () => {
  it('fetchStandings + fetchGroupMap share ONE request within the TTL', async () => {
    const fetchImpl = vi.fn(async () => okJson(STANDINGS));
    const adapter = new EspnAdapter({ fetchImpl: fetchImpl as unknown as FetchImpl });
    await adapter.fetchStandings();
    await adapter.fetchGroupMap();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('a scoreboard fetch with enrichment = standings + scoreboard, and a following fetchStandings reuses the share', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: unknown) => {
      urls.push(String(url));
      return String(url).includes('/standings') ? okJson(STANDINGS) : okJson({ events: [] });
    });
    const adapter = new EspnAdapter({ fetchImpl: fetchImpl as unknown as FetchImpl });
    await adapter.fetchByDate('2026-07-04');
    expect(urls.filter((u) => u.includes('/standings'))).toHaveLength(1);
    expect(urls.filter((u) => u.includes('/scoreboard'))).toHaveLength(1);
    // The `bracket` shape: a standings read after the scoreboard adds NO request.
    await adapter.fetchStandings();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('a REJECTED shared fetch is not cached — the next caller retries', async () => {
    let calls = 0;
    const adapter = new EspnAdapter({
      fetchImpl: (async () => {
        calls += 1;
        return calls === 1 ? httpError(500) : okJson(STANDINGS);
      }) as FetchImpl,
    });
    await expect(adapter.fetchStandings()).rejects.toBeInstanceOf(ProviderError);
    expect(await adapter.fetchStandings()).toHaveLength(1);
    expect(calls).toBe(2);
  });
});

describe('request shape', () => {
  it('sends a versioned claudinho User-Agent', async () => {
    let ua: string | undefined;
    const adapter = new EspnAdapter({
      fetchImpl: (async (_url: unknown, init?: RequestInit) => {
        ua = (init?.headers as Record<string, string>)?.['User-Agent'];
        return okJson(STANDINGS);
      }) as FetchImpl,
    });
    await adapter.fetchStandings();
    // Built artifacts inline the real version via tsup define; unbuilt runs fall
    // back to 0.0. Either way the product name + a version segment are present.
    expect(ua).toMatch(/^claudinho\/\d/);
    expect(ua).toContain('github.com/arturogarrido/claudinho');
  });
});

describe('knockout window derives from the bundle (F5 ARCH-6)', () => {
  it('matches the former hardcoded literals for the 2026 bundle (parity pin)', () => {
    // The window used to be KNOCKOUT_WINDOW_START/END = '20260628'/'20260719'.
    // Deriving from the bundled schedule must land on exactly the same span —
    // this pin proves the seam change is behavior-identical for this bundle.
    expect(knockoutWindow()).toEqual({ start: '20260628', end: '20260719' });
  });
});
