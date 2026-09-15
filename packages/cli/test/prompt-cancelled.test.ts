import type { Match } from '@claudinho/core';
import { describe, expect, it } from 'vitest';
import type { CacheState } from '../src/cache';
import { renderPrompt } from '../src/statusline';

/**
 * Audit A07 on the statusline: a cached, resolved knockout tie that has been
 * CANCELLED (kickoff still ahead) must never drive the countdown — with a team
 * (`nextFixtureForTeam`) or without one (`nextOverall`). The hot path reads
 * only the cache, so the fixture is seeded there exactly as the refresher
 * would have written it.
 */
const NOW = new Date('2026-06-28T12:00:00Z');
const tie = (status: Match['status']): Match => ({
  id: '760486',
  stage: 'R32',
  kickoff: '2026-06-30T18:00Z',
  venue: 'SoFi Stadium',
  home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
  away: { code: 'ECU', name: 'Ecuador', flag: '🇪🇨' },
  status,
  updatedAt: NOW.toISOString(),
});
const cache = (fixture: Match): CacheState => ({
  updatedAt: NOW.toISOString(),
  live: [],
  degraded: false,
  source: 'espn',
  competition: 'fifa.world',
  fixtures: [fixture],
  fixturesUpdatedAt: NOW.toISOString(),
});

describe('statusline countdown — cancelled next fixture (A07)', () => {
  it('control: a scheduled cached tie drives the countdown', () => {
    const line = renderPrompt(cache(tie('SCHEDULED')), { team: 'MEX', now: NOW });
    expect(line).toContain('🇲🇽');
    expect(line).toContain(' in ');
  });

  it('a cancelled tie never counts down, with a team or without', () => {
    expect(renderPrompt(cache(tie('CANCELLED')), { team: 'MEX', now: NOW })).toBe('⚽ —');
    expect(renderPrompt(cache(tie('CANCELLED')), { now: NOW })).toBe('⚽ —');
  });

  it('a postponed tie never counts down either', () => {
    expect(renderPrompt(cache(tie('POSTPONED')), { team: 'MEX', now: NOW })).toBe('⚽ —');
  });
});
