/**
 * A state of the source's throttle window that the shared-window test does not
 * reach (0.11 · 2.5a): a window that has PASSED arms nothing. An adapter built
 * after it carries no deadline and asks the provider. (The server compares the
 * remembered deadline with the adapter's clock before arming; arming a past
 * deadline would be inert for requests, but the adapter would then state a
 * window that is over.)
 *
 * Own file: the module-level adapter map and the remembered window outlive a test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveAdapter, toolGetLive } from '../src/tools';

const until = (competition: string) =>
  (resolveAdapter({ competition }) as unknown as { cooldownUntil?: number }).cooldownUntil;
const throttled = (seconds: number) => new Response('', { status: 429, headers: { 'Retry-After': String(seconds) } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('a window that has passed', () => {
  it('arms nothing: the adapter built after it states no deadline and asks the provider', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = new Date('2026-10-04T12:00:00Z').getTime();
    vi.setSystemTime(t0);
    let requests = 0;
    vi.stubGlobal('fetch', () => {
      requests++;
      return Promise.resolve(throttled(60));
    });
    await toolGetLive({ competition: 'past.a' });
    expect(until('past.a')).toBeGreaterThan(t0);
    // Inside the window: armed at construction (the shared-window test's state, here as the control).
    expect(until('past.inside')).toBe(until('past.a'));
    // Past it.
    vi.setSystemTime(t0 + 10 * 60_000);
    expect(until('past.after')).toBeUndefined();
    const before = requests;
    await toolGetLive({ competition: 'past.after' });
    expect(requests).toBeGreaterThan(before);
  });
});
