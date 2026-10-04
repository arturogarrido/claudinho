/**
 * The source's throttle window is feature-detected (0.11 · 2.5a): an adapter
 * that exposes neither `onCooldown` nor `armCooldown` (the `ProviderAdapter`
 * interface has neither) is kept as it is, never an error, and a kept fake
 * beside a real adapter is skipped when the real one meets a throttle.
 *
 * Own file: it replaces core's `makeAdapter` for the whole file, and the
 * module-level adapter map outlives a test.
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

afterEach(() => vi.unstubAllGlobals());

describe('an adapter without the cooldown methods', () => {
  it('is kept as it is, and a throttle met by a real adapter skips it', async () => {
    const fake = resolveAdapter({ competition: 'fake.one' });
    expect(fake.name).toBe('fake');
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 429, headers: { 'Retry-After': '600' } })));
    await expect(toolGetLive({ competition: 'world-cup' })).resolves.toBeDefined();
    // Built after the window opened: still kept as it is.
    expect(resolveAdapter({ competition: 'fake.two' }).name).toBe('fake');
  });
});
