import type { Match, ProviderAdapter } from '@claudinho/core';
import { describe, expect, it } from 'vitest';
import { toolGetBracket } from '../src/tools';

/**
 * Review P2 on batch 1: an adapter with no window capability whose standings
 * read succeeds but serves NO table must not print "bracket structure only"
 * AND "Live data: ESPN" in the same response — no provider-derived bracket
 * fact exists. Rendered text and structured attribution are both pinned.
 */
const adapter: ProviderAdapter = {
  name: 'espn',
  capabilities: { push: false, latencyHintSec: 0 },
  async fetchByDate(): Promise<Match[]> {
    return [];
  },
  async fetchLive(): Promise<Match[]> {
    return [];
  },
  async fetchStandings() {
    return [];
  },
};

describe('get_bracket — no window capability + empty standings', () => {
  it('says structure only and names no provider, in text and data', async () => {
    const r = await toolGetBracket({ adapter });
    expect(r.text).toContain('bracket structure only');
    expect(r.text).not.toMatch(/live data/i);
    expect(r.data).toMatchObject({ degraded: true, standingsDegraded: false, source: null });
    expect((r.data as { view: { source?: string } }).view.source).toBeUndefined();
  });
});
