import { describe, expect, it } from 'vitest';
import type { ProviderAdapter } from '../src/adapters/types';
import { getKnockoutFixtures } from '../src/live';
import { isUpcoming, nextFixtureForTeam } from '../src/schedule';
import type { Match } from '../src/types';

/**
 * Audit A07 (P2): a cancelled (or postponed) fixture whose kickoff is still in
 * the future must never be "the next match" — on any selector. ONE predicate,
 * `isUpcoming`, decides eligibility; every selector calls it (repro S11: a
 * future CANCELLED fixture was returned by `nextFixtureForTeam`).
 */
const NOW = new Date('2026-09-15T00:00:00Z');
const home = { code: 'MEX', name: 'Mexico', flag: '🇲🇽' };
const away = { code: 'CAN', name: 'Canada', flag: '🇨🇦' };
const fixture = (id: string, kickoff: string, status: Match['status']): Match => ({
  id,
  stage: 'QF',
  kickoff,
  venue: '',
  home,
  away,
  status,
  updatedAt: '2026-09-15T00:00:00.000Z',
});
const cancelled = fixture('1', '2026-09-16T20:00:00.000Z', 'CANCELLED');
const postponed = fixture('2', '2026-09-17T20:00:00.000Z', 'POSTPONED');
const scheduled = fixture('3', '2026-09-18T20:00:00.000Z', 'SCHEDULED');
const past = fixture('0', '2026-09-10T20:00:00.000Z', 'SCHEDULED');

describe('A07 — isUpcoming', () => {
  it.each([
    ['a future scheduled fixture', scheduled, true],
    ['a future cancelled fixture', cancelled, false],
    ['a future postponed fixture', postponed, false],
    ['a past fixture', past, false],
    ['a future fixture already marked finished', fixture('9', '2026-09-18T20:00:00.000Z', 'FT'), false],
  ])('%s → %s', (_label, m, expected) => {
    expect(isUpcoming(m, NOW)).toBe(expected);
  });
});

describe('A07 — every selector', () => {
  it('nextFixtureForTeam skips cancelled and postponed and returns the next playable fixture', () => {
    const next = nextFixtureForTeam('MEX', { from: NOW, fixtures: [cancelled, postponed, scheduled] });
    expect(next?.id).toBe('3');
    expect(nextFixtureForTeam('MEX', { from: NOW, fixtures: [cancelled] })).toBeUndefined();
  });

  it('getKnockoutFixtures excludes a cancelled resolved tie', async () => {
    const adapter: ProviderAdapter = {
      name: 'espn',
      capabilities: { push: false, latencyHintSec: 0 },
      async fetchByDate() {
        return [];
      },
      async fetchLive() {
        return [];
      },
      async fetchWindow() {
        return [cancelled, scheduled];
      },
    };
    const { fixtures, degraded } = await getKnockoutFixtures(adapter, NOW);
    expect(degraded).toBe(false);
    expect(fixtures.map((m) => m.id)).toEqual(['3']);
  });
});
