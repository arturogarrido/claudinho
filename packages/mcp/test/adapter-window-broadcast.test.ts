/**
 * One throttle, one broadcast (0.11 · 2.5a, review): arming an adapter fires
 * ITS listener, and a listener that walked the live set again would recurse
 * once per live adapter; the set of live adapters is bounded by liveness, not
 * by the kept map (every pending request holds one), so with thousands in
 * flight the recursion exhausted the stack after the deadline was remembered
 * and left the adapters past the failure unarmed: their reads went out inside
 * the window. Propagation is non-reentrant: a listener invoked while a
 * broadcast of its source is already walking only records the deadline and
 * returns, and the one walk reaches every live adapter.
 *
 * Own file: the module-level adapter map and the armed window outlive a test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveAdapter, toolGetLive } from '../src/tools';

const until = (a: unknown) => (a as { cooldownUntil?: number }).cooldownUntil;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('one throttle, one broadcast', () => {
  it('arms each live adapter exactly once, the tool reports the throttle as an outage, and none of them asks inside the window', async () => {
    // Held, as a pending request holds its adapter; past the kept map's bound. Each one's `armCooldown`
    // is counted: a recursive walk calls it once per level (N - 1 times each, and N levels deep, which
    // is the stack overflow with thousands in flight); one broadcast calls it once.
    // The clock is frozen: each of the live read's requests meets the 429, and each response's deadline
    // is counted from its own receipt, so on a running clock a later response EXTENDS the window by the
    // milliseconds a broadcast took and is a throttle of its own (one broadcast each, rightly). Frozen,
    // the four land on one deadline: one throttle, so one broadcast.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
    const held = Array.from({ length: 200 }, (_, i) => resolveAdapter({ competition: `live.x${i}` }));
    const calls = held.map((a) => vi.spyOn(a as unknown as { armCooldown: (n: number) => void }, 'armCooldown'));
    let requests = 0;
    vi.stubGlobal('fetch', async () => {
      requests++;
      return new Response('', { status: 429, headers: { 'Retry-After': '600' } });
    });
    const r = await toolGetLive({ competition: 'world-cup' });
    expect((r.data as { degraded?: boolean }).degraded).toBe(true);
    const deadline = until(resolveAdapter({ competition: 'world-cup' }));
    expect(deadline).toBeGreaterThan(Date.now());
    expect(held.filter((a) => until(a) !== deadline)).toHaveLength(0);
    const counts = calls.map((c) => c.mock.calls.length);
    expect(Math.max(...counts)).toBe(1);
    expect(Math.min(...counts)).toBe(1);
    // And none of them asks inside the window.
    const armed = requests;
    await held[199]?.fetchByDate('2026-10-10').catch(() => undefined);
    await held[0]?.fetchByDate('2026-10-10').catch(() => undefined);
    expect(requests).toBe(armed);
  });
});
