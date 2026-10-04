/**
 * A state of the source's throttle window that the shared-window test does not
 * reach (0.11 · 2.5a): the LATEST deadline is the one remembered, whichever
 * adapter reports last. An adapter evicted from the kept set can still have a
 * request in flight; it is no longer armed by a later throttle, so when its
 * own, shorter, throttle arrives after a longer one it reports an EARLIER
 * deadline. The source's window must not move back.
 *
 * Own file: the module-level adapter map and the remembered window outlive a test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEPT_ADAPTERS_MAX, resolveAdapter, toolGetLive } from '../src/tools';

const until = (competition: string) =>
  (resolveAdapter({ competition }) as unknown as { cooldownUntil?: number }).cooldownUntil;
const throttled = (seconds: number) => new Response('', { status: 429, headers: { 'Retry-After': String(seconds) } });

afterEach(() => vi.unstubAllGlobals());

describe('the source window, latest wins', () => {
  it('an evicted adapter whose shorter throttle lands after a longer one does not move the window back', async () => {
    const pending: Array<(r: Response) => void> = [];
    vi.stubGlobal('fetch', (url: string | URL) =>
      String(url).includes('/late.e/')
        ? new Promise<Response>((resolve) => pending.push(resolve))
        : Promise.resolve(throttled(600)),
    );
    // A request of late.e's goes out, then late.e is evicted while it waits.
    const inFlight = toolGetLive({ competition: 'late.e' });
    await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0));
    for (let i = 0; i < KEPT_ADAPTERS_MAX; i++) resolveAdapter({ competition: `late.x${i}` });
    // The long throttle, met by a kept adapter.
    await toolGetLive({ competition: 'world-cup' });
    const latest = until('world-cup');
    expect(latest).toBeGreaterThan(Date.now() + 500_000);
    // The evicted adapter's own throttle, shorter, lands last.
    for (const resolve of pending) resolve(throttled(60));
    await inFlight;
    // An adapter built now is armed with the latest deadline, not the last reported.
    expect(until('late.after')).toBe(latest);
  });
});
