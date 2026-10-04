/**
 * The source's throttle window walks every adapter of the source still alive
 * through weak refs (0.11 · 2.5a). A ref whose adapter was collected arms
 * nothing and is dropped when the set is walked (at the next build, and on a
 * throttle's walk); nothing throws, and the adapters after it in the set are
 * still armed.
 *
 * Collection cannot be forced in a test, so `WeakRef` is replaced by a ref the
 * test can "collect": it derefs to its adapter until the adapter is marked
 * collected, then to undefined, exactly what the server sees of an adapter the
 * collector took after it was built.
 *
 * Own file: the module-level adapter map and the refs outlive a test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { builtAdapterRefs, resolveAdapter, toolGetLive } from '../src/tools';

const collected = new Set<object>();
class CollectableRef<T extends object> {
  constructor(private readonly target: T) {}
  deref(): T | undefined {
    return collected.has(this.target) ? undefined : this.target;
  }
}
beforeEach(() => vi.stubGlobal('WeakRef', CollectableRef));
afterEach(() => vi.unstubAllGlobals());

const until = (a: unknown) => (a as { cooldownUntil?: number }).cooldownUntil;

describe('a ref whose adapter was collected', () => {
  it('is dropped when the next adapter of the source is built', () => {
    collected.add(resolveAdapter({ competition: 'gone.a' }));
    expect(builtAdapterRefs()).toBe(1);
    resolveAdapter({ competition: 'alive.b' });
    expect(builtAdapterRefs()).toBe(1);
  });

  it("arms nothing and is dropped on the throttle's walk; the adapter after it in the set is still armed", async () => {
    const b = resolveAdapter({ competition: 'alive.b' });
    const gone = resolveAdapter({ competition: 'gone.x' });
    const c = resolveAdapter({ competition: 'alive.c' });
    // Collected after alive.c was built: its ref sits between alive.b and alive.c.
    collected.add(gone);
    expect(builtAdapterRefs()).toBe(3);
    // ONE throttle event: the first response is the 429, every later one a 503 (no window), so a walk
    // that stopped at the collected ref is not healed by a second event.
    let calls = 0;
    vi.stubGlobal('fetch', async () =>
      calls++ === 0
        ? new Response('', { status: 429, headers: { 'Retry-After': '600' } })
        : new Response('', { status: 503 }),
    );
    await toolGetLive({ competition: 'alive.b' });
    expect(builtAdapterRefs()).toBe(2);
    const deadline = until(b);
    expect(deadline).toBeGreaterThan(Date.now());
    expect(until(c)).toBe(deadline);
  });
});
