/**
 * The kept adapters are evicted least recently USED, not first built (0.11 ·
 * 2.5a): a competition asked again is moved to the end of the eviction order,
 * so a client that keeps asking one competition while it walks many raw slugs
 * keeps that competition's adapter, and its throttle window with it.
 *
 * Own file: the module-level adapter map outlives a test.
 */
import { describe, expect, it } from 'vitest';
import { KEPT_ADAPTERS_MAX, keptAdapterCount, resolveAdapter } from '../src/tools';

describe('least recently used', () => {
  it('a competition asked again outlives the ones asked before it', () => {
    const first = resolveAdapter({ competition: 'premier-league' });
    for (let i = 1; i < KEPT_ADAPTERS_MAX; i++) resolveAdapter({ competition: `lru.x${i}` });
    expect(keptAdapterCount()).toBe(KEPT_ADAPTERS_MAX);
    // Asked again: now the most recently used.
    expect(resolveAdapter({ competition: 'premier-league' })).toBe(first);
    // One more evicts the least recently used, which is lru.x1, not premier-league.
    const x1 = resolveAdapter({ competition: 'lru.x1' });
    resolveAdapter({ competition: 'lru.extra' });
    expect(keptAdapterCount()).toBe(KEPT_ADAPTERS_MAX);
    expect(resolveAdapter({ competition: 'premier-league' })).toBe(first);
    // lru.x1 was asked again above (a hit, moved to the end), so lru.x2 went instead.
    expect(resolveAdapter({ competition: 'lru.x1' })).toBe(x1);
  });
});
