/**
 * A saved pin's next fixture when the read fails (0.11 · 2.5b): a failed
 * discovery is an outage, `degraded`, never "no fixture within the span" (a
 * pinned team with no answer is not a team with no match). The pin is still
 * the answer's team: a surface names it.
 */
import { describe, expect, it } from 'vitest';
import { nextFixtureForPin, type ProviderAdapter } from '../src';

describe('nextFixtureForPin when discovery fails', () => {
  it('is degraded, with no horizon and no fixture, and still names the pin', async () => {
    const adapter: ProviderAdapter = {
      name: 'espn',
      competition: 'eng.1',
      capabilities: { push: false, latencyHintSec: 0 },
      async fetchByDate() {
        throw new Error('network down');
      },
      async fetchLive() {
        throw new Error('network down');
      },
      async fetchWindow() {
        throw new Error('network down');
      },
    };
    const r = await nextFixtureForPin(adapter, { id: 'espn:359', code: 'ARS', name: 'Arsenal' }, new Date('2026-10-04T12:00:00Z'));
    expect(r.degraded).toBe(true);
    expect(r.fixture).toBeUndefined();
    expect(r.horizon).toBeUndefined();
    expect(r.team).toEqual({ id: 'espn:359', code: 'ARS', name: 'Arsenal' });
  });
});
