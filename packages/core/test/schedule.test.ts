import { describe, expect, it } from 'vitest';
import { fixturesByDate, type Match } from '../src/index';

function fx(id: string, kickoff: string): Match {
  return {
    id,
    stage: 'GROUP',
    group: 'D',
    kickoff,
    venue: 'X',
    home: { code: 'USA', name: 'United States', flag: '🇺🇸' },
    away: { code: 'PAR', name: 'Paraguay', flag: '🇵🇾' },
    status: 'SCHEDULED',
    updatedAt: '2026-06-01T00:00Z',
  };
}

// A kickoff at 01:00Z on the 13th is the evening of the 12th in the Americas.
const lateUtc = fx('late', '2026-06-13T01:00Z');
// A midday kickoff stays on the 13th everywhere in the Americas.
const midday = fx('mid', '2026-06-13T19:00Z');

describe('fixturesByDate — local-date grouping', () => {
  it('groups a late-UTC kickoff under the day the user actually sees (the bug)', () => {
    // America/Mexico_City (UTC-6): 01:00Z 13th → 19:00 on the 12th.
    expect(fixturesByDate('2026-06-12', [lateUtc, midday], 'America/Mexico_City').map((m) => m.id)).toEqual(['late']);
    expect(fixturesByDate('2026-06-13', [lateUtc, midday], 'America/Mexico_City').map((m) => m.id)).toEqual(['mid']);
  });

  it('groups by UTC date when tz is UTC', () => {
    expect(fixturesByDate('2026-06-13', [lateUtc, midday], 'UTC').map((m) => m.id)).toEqual(['late', 'mid']);
    expect(fixturesByDate('2026-06-12', [lateUtc, midday], 'UTC')).toEqual([]);
  });

  it('weekday/date stay consistent: a Friday-evening match is never under Saturday', () => {
    // Under the 13th (Saturday) in MX, only the genuinely-Saturday match appears.
    const sat = fixturesByDate('2026-06-13', [lateUtc, midday], 'America/Mexico_City');
    for (const m of sat) {
      const wd = new Date(m.kickoff).toLocaleString('en-US', {
        timeZone: 'America/Mexico_City',
        weekday: 'long',
      });
      expect(wd).toBe('Saturday');
    }
  });
});
