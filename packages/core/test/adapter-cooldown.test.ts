import { describe, expect, it, vi } from 'vitest';
import { EspnAdapter, MAX_COOLDOWN_MS, ProviderError } from '../src/adapters/espn';

/**
 * Audit A12 (P2): after a 429 with `Retry-After: 3600`, two consecutive
 * adapter calls both fetched — no cooldown was retained and the header was
 * never read. Now the adapter arms a cooldown on 429/403 (Retry-After in both
 * RFC 9110 forms, capped by policy, 5 min when absent) and every call inside
 * it throws the retained throttle WITHOUT a request. Assertions count fetches;
 * the clock is injected.
 */
type FetchImpl = typeof fetch;
const T0 = Date.parse('2026-09-15T12:00:00Z');
const throttled = (status: number, retryAfter?: string) =>
  vi.fn(async () => ({
    ok: false,
    status,
    statusText: 'throttled',
    headers: { get: (k: string) => (k.toLowerCase() === 'retry-after' ? (retryAfter ?? null) : null) },
  })) as unknown as FetchImpl & { mock: { calls: unknown[] } };

describe('EspnAdapter cooldown', () => {
  it('the audit repro: after a 429 with Retry-After 3600 the next call does not fetch; the window is capped', async () => {
    const fetchImpl = throttled(429, '3600');
    // enrichGroups off, as in the audit's own repro: group enrichment is a second,
    // concurrent request on the first call, which would count as two fetches.
    const adapter = new EspnAdapter({ fetchImpl, now: () => T0, enrichGroups: false });
    await expect(adapter.fetchByDate('2026-09-15')).rejects.toBeInstanceOf(ProviderError);
    await expect(adapter.fetchByDate('2026-09-15')).rejects.toMatchObject({ throttled: true });
    expect(fetchImpl.mock.calls).toHaveLength(1);
    expect(adapter.cooldownUntil).toBe(T0 + MAX_COOLDOWN_MS);
    expect(adapter.lastError?.retryAfterMs).toBe(MAX_COOLDOWN_MS);
  });

  it('Retry-After in delay-seconds below the cap is honoured exactly', async () => {
    // Pins the delay-seconds branch on its own: without it a bare number falls
    // through to Date.parse, where '3600' reads as the YEAR 3600 and the cap hid
    // the difference (a mutant that dropped the branch survived on that case).
    const adapter = new EspnAdapter({ fetchImpl: throttled(429, '120'), now: () => T0 });
    await expect(adapter.fetchStandings()).rejects.toBeInstanceOf(ProviderError);
    expect(adapter.cooldownUntil).toBe(T0 + 120_000);
    expect(adapter.lastError?.retryAfterMs).toBe(120_000);
  });

  it('Retry-After as an HTTP-date is honoured', async () => {
    const fetchImpl = throttled(429, new Date(T0 + 120_000).toUTCString());
    const adapter = new EspnAdapter({ fetchImpl, now: () => T0 });
    await expect(adapter.fetchStandings()).rejects.toBeInstanceOf(ProviderError);
    expect(adapter.cooldownUntil).toBeGreaterThanOrEqual(T0 + 119_000);
    expect(adapter.cooldownUntil).toBeLessThanOrEqual(T0 + 121_000);
  });

  it('no Retry-After → a five-minute default', async () => {
    const adapter = new EspnAdapter({ fetchImpl: throttled(429), now: () => T0 });
    await expect(adapter.fetchStandings()).rejects.toBeInstanceOf(ProviderError);
    expect(adapter.cooldownUntil).toBe(T0 + 5 * 60_000);
  });

  it('a 403 arms the cooldown too', async () => {
    const fetchImpl = throttled(403);
    const adapter = new EspnAdapter({ fetchImpl, now: () => T0 });
    await expect(adapter.fetchStandings()).rejects.toBeInstanceOf(ProviderError);
    await expect(adapter.fetchStandings()).rejects.toMatchObject({ throttled: true });
    expect(fetchImpl.mock.calls).toHaveLength(1);
  });

  it('once the window has passed, the adapter fetches again', async () => {
    let now = T0;
    const fetchImpl = throttled(429, '60');
    const adapter = new EspnAdapter({ fetchImpl, now: () => now });
    await expect(adapter.fetchStandings()).rejects.toBeInstanceOf(ProviderError);
    now = T0 + 60_001;
    await expect(adapter.fetchStandings()).rejects.toBeInstanceOf(ProviderError); // still 429, but it TRIED
    expect(fetchImpl.mock.calls).toHaveLength(2);
  });

  it('armCooldown pre-arms a fresh adapter without any request', async () => {
    const fetchImpl = throttled(200);
    const adapter = new EspnAdapter({ fetchImpl, now: () => T0, enrichGroups: false });
    adapter.armCooldown(T0 + 60_000);
    await expect(adapter.fetchByDate('2026-09-15')).rejects.toMatchObject({ throttled: true });
    expect(fetchImpl.mock.calls).toHaveLength(0);
    expect(adapter.cooldownUntil).toBe(T0 + 60_000);
  });
});
