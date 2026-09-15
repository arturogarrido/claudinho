import { describe, expect, it } from 'vitest';
import type { ProviderAdapter } from '../src/adapters/types';
import { getBracket, getNextFixtureForTeam } from '../src/live';

/**
 * Audit A06 (P2): an adapter WITHOUT `fetchWindow` cannot serve the knockout
 * overlay, so bracket/next must say so — not report the bundled skeleton as a
 * healthy, provider-attributed result of a fetch that never happened (repro S4:
 * 32 static matches, `degraded:false`, `source` set, zero fetches).
 * `getKnockoutFixtures` already degrades here; these two paths mirror it.
 */
const calls: string[] = [];
const noWindow: ProviderAdapter = {
  name: 'synthetic-other-competition',
  capabilities: { push: false, latencyHintSec: 0 },
  async fetchByDate() {
    calls.push('date');
    return [];
  },
  async fetchLive() {
    calls.push('live');
    return [];
  },
};

describe('A06 — missing window capability', () => {
  it('getBracket is degraded and names no provider', async () => {
    const result = await getBracket(noWindow);
    expect(result.degraded).toBe(true);
    expect(result.source).toBeUndefined();
    // Static structure still renders (labelled degraded by the surfaces).
    expect(result.view.stages.reduce((n, s) => n + s.matches.length, 0)).toBe(32);
  });

  it('getNextFixtureForTeam is degraded and names no provider', async () => {
    const result = await getNextFixtureForTeam(noWindow, 'MEX', new Date('2026-06-20T00:00:00Z'));
    expect(result.degraded).toBe(true);
    expect(result.source).toBeUndefined();
  });

  it('no fetch was attempted on either path', () => {
    expect(calls).toEqual([]);
  });
});
