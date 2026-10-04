/**
 * The broadcast's guard (0.11 · 2.5a): one walk per throttle, never left set.
 *
 *  - An adapter whose arming throws is passed over and the walk goes on: the
 *    window is the provider's, and the adapters after it in the set are armed.
 *  - The guard is cleared when the walk ends, the throw included: a later
 *    throttle of the source still reaches every adapter alive (a guard left
 *    set would silence it).
 *
 * The clock is frozen (fake `Date`) so a window can be made to pass. Own file:
 * the module-level adapter map, the refs and the remembered window outlive a test.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { resolveAdapter, toolGetLive } from '../src/tools';

const T0 = new Date('2026-10-04T12:00:00Z').getTime();
const until = (a: unknown) => (a as { cooldownUntil?: number }).cooldownUntil;
/** One throttle event: the first response is the 429, every later one a 503 (no window). */
const oneThrottle = (seconds: number) => {
  let calls = 0;
  vi.stubGlobal('fetch', async () =>
    calls++ === 0
      ? new Response('', { status: 429, headers: { 'Retry-After': String(seconds) } })
      : new Response('', { status: 503 }),
  );
};

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});
afterAll(() => vi.useRealTimers());
afterEach(() => vi.unstubAllGlobals());

describe('the broadcast', () => {
  const a = resolveAdapter({ competition: 'guard.a' });
  const b = resolveAdapter({ competition: 'guard.b' });
  const c = resolveAdapter({ competition: 'guard.c' });

  it("passes over an adapter whose arming throws and arms the ones after it", async () => {
    vi.spyOn(b as unknown as { armCooldown: (n: number) => void }, 'armCooldown').mockImplementationOnce(() => {
      throw new Error('this adapter could not be armed');
    });
    oneThrottle(60);
    await expect(toolGetLive({ competition: 'guard.a' })).resolves.toBeDefined();
    expect(until(a)).toBe(T0 + 60_000);
    expect(until(b)).toBeUndefined();
    expect(until(c)).toBe(T0 + 60_000);
  });

  it('is over when the walk ends, the throw included: a later throttle reaches every adapter alive', async () => {
    vi.setSystemTime(T0 + 120_000);
    oneThrottle(600);
    await toolGetLive({ competition: 'guard.c' });
    const later = T0 + 120_000 + 600_000;
    expect(until(c)).toBe(later);
    expect(until(a)).toBe(later);
    expect(until(b)).toBe(later);
  });
});
