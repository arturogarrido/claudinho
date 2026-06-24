import { describe, expect, it } from 'vitest';
import { formatBracketMatchLine, formatShareBracket } from '../src/bracket/format';
import type { BracketMatchView } from '../src/bracket/types';
import type { Match } from '../src/types';

const match: Match = {
  id: '1',
  stage: 'R32',
  kickoff: '2026-07-04T17:00Z',
  venue: 'X',
  home: { code: 'CZE', name: 'Czechia', flag: '🇨🇿' },
  away: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
  status: 'SCHEDULED',
  updatedAt: '',
};

const view: BracketMatchView = {
  matchId: '1',
  stage: 'R32',
  index: 1,
  kickoff: match.kickoff,
  home: { label: 'Czechia', flag: '🇨🇿', code: 'CZE', status: 'confirmed' },
  away: { label: 'Mexico', flag: '🇲🇽', code: 'MEX', status: 'confirmed' },
  match,
};

describe('formatBracketMatchLine', () => {
  it('mirrors next/matchLine flag placement (home before, away after)', () => {
    const line = formatBracketMatchLine(view, { flags: true });
    expect(line).toContain('🇨🇿 Czechia');
    expect(line).toContain('Mexico 🇲🇽');
    expect(line).not.toMatch(/Czechia 🇨🇿/);
    expect(line).not.toMatch(/🇲🇽 Mexico/);
  });

  it('formatShareBracket compact style uses one line per match', () => {
    const stages = [{ stage: 'R32' as const, label: 'Round of 32', matches: [view] }];
    const card = formatShareBracket(
      { view: { stages, degraded: true, standingsDegraded: false } },
      { style: 'compact', locale: 'en' },
    );
    expect(card).toContain('Round of 32 · 🇨🇿 Czechia vs Mexico 🇲🇽');
    expect(card.split('\n').filter((l) => l.includes('vs')).length).toBe(1);
  });
});
