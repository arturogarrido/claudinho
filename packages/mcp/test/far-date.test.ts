/**
 * A view of ONE match (`get_next_fixture`, `get_match`) says the date of a
 * kickoff 7 or more calendar days away, counted in the request's zone from the
 * request's clock; a day's list (`get_today`) keeps its rows' weekday and time
 * (its header names the day). Text only: no structured key changes.
 */
import type { Match, ProviderAdapter } from '@claudinho/core';
import { describe, expect, it } from 'vitest';
import { toolGetMatch, toolGetNextFixture, toolGetToday } from '../src/tools';

/** Tue Nov 10, 2026, 21:40 in Los Angeles. */
const NOW = new Date('2026-11-11T05:40:00.000Z');
const fixture = (id: string, kickoff: string): Match => ({
  id,
  stage: 'REGULAR',
  kickoff,
  venue: 'St James Park',
  home: { code: 'NEW', name: 'Newcastle United', id: 'espn:361' },
  away: { code: 'ARS', name: 'Arsenal', id: 'espn:359' },
  status: 'SCHEDULED',
  updatedAt: NOW.toISOString(),
});
const FAR = fixture('800000901', '2026-11-21T17:30:00.000Z'); // Sat Nov 21, 09:30 in Los Angeles
const NEAR = fixture('800000902', '2026-11-14T15:00:00.000Z'); // Sat Nov 14, 07:00 in Los Angeles

function adapter(matches: Match[]): ProviderAdapter {
  return {
    name: 'espn',
    competition: 'eng.1',
    capabilities: { push: false, latencyHintSec: 0 },
    async fetchByDate() {
      return matches;
    },
    async fetchLive() {
      return [];
    },
    async fetchWindow() {
      return matches;
    },
  };
}
const base = { competition: 'eng.1', now: NOW, tz: 'America/Los_Angeles', flavor: 'off' as const };

describe('a single match far away says its date', () => {
  it('get_next_fixture: the date and the countdown', async () => {
    const r = await toolGetNextFixture({ ...base, team: 'Arsenal', adapter: adapter([FAR]), lang: 'en' });
    expect(r.text).toContain('Sat, Nov 21, 09:30 (in 10d11h)');
  });

  it('get_next_fixture in Spanish: the date in its own forms', async () => {
    const r = await toolGetNextFixture({ ...base, team: 'Arsenal', adapter: adapter([FAR]), lang: 'es' });
    expect(r.text).toContain('sáb, 21 nov, 09:30 (en 10d11h)');
  });

  it('get_next_fixture, a match within 6 days: the weekday and the time', async () => {
    const r = await toolGetNextFixture({ ...base, team: 'Arsenal', adapter: adapter([NEAR]), lang: 'en' });
    expect(r.text).toContain('Sat 07:00 (in 3d9h)');
    expect(r.text).not.toContain('Nov 14');
  });

  it('get_match: the date', async () => {
    const r = await toolGetMatch({ ...base, id: FAR.id, adapter: adapter([FAR]), lang: 'en' });
    expect(r.text).toContain('Sat, Nov 21, 09:30 (in 10d11h)');
  });

  it("get_today: a day's list keeps the weekday and the time", async () => {
    const r = await toolGetToday({ ...base, date: '2026-11-21', adapter: adapter([FAR]), lang: 'en' });
    expect(r.text).toContain('Sat 09:30 (in 10d11h)');
    expect(r.text).not.toContain('Nov 21, 09:30');
  });
});
