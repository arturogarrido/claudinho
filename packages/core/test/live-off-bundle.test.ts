import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProviderAdapter } from '../src/adapters/types';
import { bundleApplies } from '../src/competition';
import {
  getBracket,
  getKnockoutFixtures,
  getMatchById,
  getMatchesForDate,
  getNextFixtureForTeam,
  marketFixtureForTeam,
} from '../src/live';
import { fixturesByDate } from '../src/schedule';
import type { Match } from '../src/types';

/**
 * Audit A03 (P2), CONTAINED: under any competition other than the bundled
 * World Cup, the date/detail/next/bracket paths still read the bundled
 * skeleton — an empty foreign day showed 104 World Cup fixtures with foreign
 * attribution (S1), a non-bundled id never fetched (S2), a September `next`
 * fetched the June–July window (S3). Now the bundle is merged ONLY when it
 * applies; off-bundle, the paths that are built on it answer "unsupported"
 * (no fetch, no attribution, no topology) and the date path is live-only.
 * Real support (horizons, discovery, `match <id>` windows) is 0.11 (2.1/D6).
 */
const NOW = new Date('2026-09-15T00:00:00Z');
const foreign: Match = {
  id: '999999001',
  stage: 'FRIENDLY',
  kickoff: '2026-09-16T20:00:00.000Z',
  venue: '',
  home: { code: 'ARS', name: 'Arsenal', flag: '🏳️' },
  away: { code: 'CHE', name: 'Chelsea', flag: '🏳️' },
  status: 'SCHEDULED',
  updatedAt: '2026-09-15T00:00:00.000Z',
};
const calls: string[] = [];
const adapter: ProviderAdapter = {
  name: 'synthetic-other-competition',
  capabilities: { push: false, latencyHintSec: 0 },
  async fetchByDate(d) {
    calls.push(`date:${d}`);
    return [foreign];
  },
  async fetchLive() {
    calls.push('live');
    return [];
  },
  async fetchWindow(a, b) {
    calls.push(`window:${a}-${b}`);
    return [foreign];
  },
};
const WC_OPENER_ID = '760415';

const ORIG = process.env.CLAUDINHO_COMPETITION;
beforeEach(() => {
  process.env.CLAUDINHO_COMPETITION = 'eng.1';
  calls.length = 0;
});
afterEach(() => {
  if (ORIG === undefined) delete process.env.CLAUDINHO_COMPETITION;
  else process.env.CLAUDINHO_COMPETITION = ORIG;
});

describe('off-bundle (CLAUDINHO_COMPETITION=eng.1)', () => {
  it('bundleApplies is false', () => {
    expect(bundleApplies()).toBe(false);
  });

  it('S1: a World Cup date shows no World Cup fixture — the day is live-only', async () => {
    const r = await getMatchesForDate(adapter, '2026-06-11');
    expect(r.degraded).toBe(false);
    expect(fixturesByDate('2026-06-11', r.matches, 'UTC')).toEqual([]);
    expect(r.matches.some((m) => m.id === WC_OPENER_ID)).toBe(false);
    expect(r.matches.map((m) => m.id)).toEqual([foreign.id]); // what the provider served
  });

  it('S2: a World Cup id is not found and nothing is fetched', async () => {
    const r = await getMatchById(adapter, WC_OPENER_ID);
    expect(r.match).toBeUndefined();
    expect(r.unsupported).toBe(true);
    expect(r.degraded).toBe(false);
    expect(calls).toEqual([]);
  });

  it('S3: next never fetches the World Cup knockout window', async () => {
    const r = await getNextFixtureForTeam(adapter, 'MEX', NOW);
    expect(r.fixture).toBeUndefined();
    expect(r.unsupported).toBe(true);
    expect(r.source).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('the bracket is unsupported: no topology, no fetch, no attribution', async () => {
    const r = await getBracket(adapter);
    expect(r.unsupported).toBe(true);
    expect(r.view.stages).toEqual([]);
    expect(r.source).toBeUndefined();
    expect(r.view.source).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('knockout fixtures and the market fixture are unsupported too', async () => {
    const ko = await getKnockoutFixtures(adapter, NOW);
    expect(ko.fixtures).toEqual([]);
    expect(ko.unsupported).toBe(true);
    const mk = await marketFixtureForTeam(adapter, 'MEX', NOW);
    expect(mk.match).toBeUndefined();
    expect(mk.unsupported).toBe(true);
    expect(calls).toEqual([]);
  });
});

describe('on the bundle (default competition) — unchanged', () => {
  beforeEach(() => {
    delete process.env.CLAUDINHO_COMPETITION;
  });

  it('the bracket still renders the World Cup topology', async () => {
    const r = await getBracket(adapter);
    expect(r.unsupported).toBeUndefined();
    expect(r.view.stages.reduce((n, s) => n + s.matches.length, 0)).toBe(32);
  });
});
