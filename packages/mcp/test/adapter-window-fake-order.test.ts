/**
 * The arming walk never reaches an adapter without the cooldown methods, and
 * does reach the real ones built AFTER it (0.11 · 2.5a, review): a fake that
 * entered the source's ref set would make the listener throw on
 * `armCooldown`, the tool would read the throw as an outage, and every real
 * adapter after the fake in the walk's order would stay unarmed inside the
 * provider's window. A kept fake is not in the set (feature-detected).
 *
 * Own file, and one case: the window must not exist yet when the real
 * adapters are kept (an adapter built inside a window is armed at construction,
 * which would hide the walk), so this module's map starts empty.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@claudinho/core', async (importOriginal) => {
  const core = await importOriginal<typeof import('@claudinho/core')>();
  return {
    ...core,
    makeAdapter: (source: string, opts: { competition: string }) =>
      opts.competition.startsWith('fake.')
        ? {
            name: 'fake',
            competition: opts.competition,
            fetchLive: async () => [],
            fetchByDate: async () => [],
          }
        : core.makeAdapter(source, opts),
  };
});

const { resolveAdapter, toolGetLive } = await import('../src/tools');
const until = (a: unknown) => (a as { cooldownUntil?: number }).cooldownUntil;

afterEach(() => vi.unstubAllGlobals());

describe('a fake kept before the real adapters', () => {
  it('is skipped by the walk, and the real adapters after it are armed by the throttle', async () => {
    expect(resolveAdapter({ competition: 'fake.first' }).name).toBe('fake');
    const pl = resolveAdapter({ competition: 'premier-league' });
    const ll = resolveAdapter({ competition: 'laliga' });
    expect(until(pl)).toBeUndefined();
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 429, headers: { 'Retry-After': '600' } })));
    const r = await toolGetLive({ competition: 'world-cup' });
    expect(r).toBeDefined();
    const deadline = until(resolveAdapter({ competition: 'world-cup' }));
    expect(deadline).toBeGreaterThan(Date.now());
    expect(until(pl)).toBe(deadline);
    expect(until(ll)).toBe(deadline);
    expect(until(resolveAdapter({ competition: 'fake.first' }))).toBeUndefined();
  });
});
