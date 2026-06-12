import { describe, expect, it } from 'vitest';
import type { Match } from '@claudinho/core';
import { vibeLiveSegment, vibePool } from '../src/commands';

function m(id: string, home: [string, string], away: [string, string], over: Partial<Match> = {}): Match {
  return {
    id,
    stage: 'GROUP',
    group: 'A',
    kickoff: '2026-06-11T19:00Z',
    venue: 'X',
    home: { code: home[0], name: home[0], flag: home[1] },
    away: { code: away[0], name: away[0], flag: away[1] },
    status: 'LIVE',
    updatedAt: '2026-06-11T20:00:00Z',
    ...over,
  };
}

describe('vibeLiveSegment', () => {
  const live = [
    m('1', ['MEX', '🇲🇽'], ['RSA', '🇿🇦'], { score: { home: 1, away: 0 }, minute: 67 }),
    m('2', ['BRA', '🇧🇷'], ['MAR', '🇲🇦'], { score: { home: 2, away: 1 }, minute: 70 }),
  ];

  it('is undefined when nothing is live', () => {
    expect(vibeLiveSegment([])).toBeUndefined();
  });

  it('shows the first live match with score and minute', () => {
    expect(vibeLiveSegment(live)).toBe("🇲🇽 1–0 🇿🇦 67'");
  });

  it('prefers the CLAUDINHO_TEAM match (case-insensitive)', () => {
    expect(vibeLiveSegment(live, 'bra')).toBe("🇧🇷 2–1 🇲🇦 70'");
  });

  it('marks halftime as HT', () => {
    expect(vibeLiveSegment([m('1', ['MEX', '🇲🇽'], ['RSA', '🇿🇦'], { status: 'HT', score: { home: 0, away: 0 } })])).toBe(
      '🇲🇽 0–0 🇿🇦 HT',
    );
  });
});

describe('vibePool', () => {
  const fixtures = [
    m('first', ['MEX', '🇲🇽'], ['RSA', '🇿🇦'], { kickoff: '2026-06-11T19:00Z' }),
    m('mid', ['BRA', '🇧🇷'], ['MAR', '🇲🇦'], { kickoff: '2026-06-13T22:00Z' }),
    m('last', ['TBD', '🏳️'], ['TBD', '🏳️'], { kickoff: '2026-07-19T19:00Z' }),
  ];

  it('mixes opener lines in on the first day only', () => {
    expect(vibePool('2026-06-11', fixtures).length).toBeGreaterThan(
      vibePool('2026-06-13', fixtures).length,
    );
  });

  it('mixes final-day lines in on the last day', () => {
    const finals = vibePool('2026-07-19', fixtures);
    expect(finals.some((l) => /final/i.test(l))).toBe(true);
  });

  it('is the plain pool on an ordinary day', () => {
    const plain = vibePool('2026-06-13', fixtures);
    expect(plain.some((l) => /opening|final/i.test(l))).toBe(false);
  });
});
