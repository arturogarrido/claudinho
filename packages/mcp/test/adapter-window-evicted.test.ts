/**
 * The source's window reaches an adapter a tool call still holds after the map
 * evicted it (0.11 · 2.5a, review): eviction forgets an adapter for the NEXT
 * request, not for the one in flight, and a throttle met while that request
 * runs must arm it too, or its later reads (an off-bundle match refreshing its
 * day, three requests) go out inside the window the provider set. The window
 * is the source's: every adapter built for the source that is still alive is
 * armed, kept or not.
 *
 * Own file: the module-level adapter map and the armed window outlive a test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEPT_ADAPTERS_MAX, keptAdapterCount, resolveAdapter, toolGetLive } from '../src/tools';

const NOW = new Date('2026-10-04T12:00:00Z');
const until = (a: unknown) => (a as { cooldownUntil?: number }).cooldownUntil;
let requests = 0;
afterEach(() => vi.unstubAllGlobals());

describe('an evicted adapter still held by a request', () => {
  it('is armed by a throttle met after its eviction, and makes no request inside the window', async () => {
    vi.stubGlobal('fetch', async () => {
      requests++;
      return new Response('', { status: 429, headers: { 'Retry-After': '600' } });
    });
    // Held by "a running tool call": the reference outlives the map's entry.
    const held = resolveAdapter({ competition: 'premier-league' });
    for (let i = 0; i < KEPT_ADAPTERS_MAX + 4; i++) resolveAdapter({ competition: `evict.x${i}` });
    expect(keptAdapterCount()).toBeLessThanOrEqual(KEPT_ADAPTERS_MAX);
    expect(resolveAdapter({ competition: 'premier-league' })).not.toBe(held);
    // The throttle, met by another competition's adapter after the eviction.
    await toolGetLive({ competition: 'world-cup', now: NOW });
    const armed = requests;
    const deadline = until(resolveAdapter({ competition: 'world-cup' }));
    expect(deadline).toBeGreaterThan(Date.now());
    // The held adapter carries the window and asks nothing.
    expect(until(held)).toBe(deadline);
    // ISO dates, as the adapter takes them: a Date throws in the date formatting before any request.
    await held.fetchByDate('2026-10-10').catch(() => undefined);
    await held.fetchWindow?.('2026-10-09', '2026-10-11').catch(() => undefined);
    expect(requests).toBe(armed);
  });
});
