/**
 * The provider's throttle window is the SOURCE's, not a competition's (0.11 ·
 * 2.5a, review). `competition` became a tool argument, so the server keeps one
 * adapter per source and competition; before, one adapter held the one window
 * and A12's containment ("inside the window every call throws the retained
 * throttle with no request") covered every call. It still must: a throttle met
 * by one adapter arms every adapter of its source, an adapter built inside the
 * window is armed at construction, and the latest deadline wins. And the map
 * of kept adapters is bounded: a client's distinct raw slugs do not grow the
 * server without limit, and an evicted adapter loses no window (the window is
 * the source's).
 *
 * Own file: the module-level adapter map and the armed window outlive a test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEPT_ADAPTERS_MAX, keptAdapterCount, resolveAdapter, toolGetLive, toolGetStandings, toolGetToday } from '../src/tools';

const NOW = new Date('2026-10-04T12:00:00Z');
const until = (competition: string) => (resolveAdapter({ competition }) as unknown as { cooldownUntil?: number }).cooldownUntil;
let requests = 0;
const throttle = () => {
  requests++;
  return new Response('', { status: 429, headers: { 'Retry-After': '600' } });
};
afterEach(() => vi.unstubAllGlobals());

describe('one window per source', () => {
  it('a throttle met for one competition stops the requests for every other, the ones already kept and the ones built inside the window', async () => {
    vi.stubGlobal('fetch', throttle);
    // Two adapters kept before the throttle.
    resolveAdapter({ competition: 'premier-league' });
    resolveAdapter({ competition: 'laliga' });
    await toolGetLive({ competition: 'world-cup', now: NOW });
    expect(requests).toBeGreaterThan(0);
    const armed = requests;
    // Kept before the window: no request.
    await toolGetLive({ competition: 'premier-league', now: NOW });
    await toolGetToday({ date: '2026-10-04', competition: 'laliga', now: NOW });
    // Built inside the window: no request either.
    await toolGetStandings({ competition: 'serie-a' });
    await toolGetLive({ competition: 'fifa.friendly', now: NOW });
    expect(requests).toBe(armed);
    // The window is readable on every adapter of the source, the latest deadline on each.
    const deadline = until('world-cup');
    // The adapters the server builds count by the process clock (Retry-After from now), not by the tools' `now`.
    expect(deadline).toBeGreaterThan(Date.now());
    for (const c of ['premier-league', 'laliga', 'serie-a', 'fifa.friendly']) expect(until(c), c).toBe(deadline);
  });
});

describe('the kept adapters are bounded', () => {
  it('distinct raw slugs past the bound evict the oldest; a kept competition keeps its instance; an adapter built after an eviction is inside the window', () => {
    for (let i = 0; i < KEPT_ADAPTERS_MAX + 8; i++) resolveAdapter({ competition: `probe.x${i}` });
    expect(keptAdapterCount()).toBeLessThanOrEqual(KEPT_ADAPTERS_MAX);
    expect(KEPT_ADAPTERS_MAX).toBeGreaterThanOrEqual(16);
    // A competition asked again returns its kept instance while it is kept; one asked once more after
    // an eviction is a fresh instance, armed from the source's window like any other.
    expect(resolveAdapter({ competition: `probe.x${KEPT_ADAPTERS_MAX + 7}` })).toBe(resolveAdapter({ competition: `probe.x${KEPT_ADAPTERS_MAX + 7}` }));
    expect(until('probe.x0')).toBe(until('world-cup'));
    expect(until('probe.x0')).toBeGreaterThan(Date.now());
  });
});
