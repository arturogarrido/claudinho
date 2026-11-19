/**
 * 0.11 · 2.4 — a grammar rule the red tests do not reach, found by reverting
 * it: a league's season NAME counts only after a year (`2026-27-`, `2027-`):
 * a slug that merely ENDS with the name is not the season.
 */
import { describe, expect, it } from 'vitest';
import { parseEspnEvent } from '../src/trust';

function stageOf(slug: string, competition: string) {
  const r = parseEspnEvent(
    {
      id: '700400',
      date: '2026-10-04T14:00Z',
      season: { slug },
      status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
      competitions: [
        {
          competitors: [
            { homeAway: 'home', team: { id: '359', abbreviation: 'ARS', displayName: 'Arsenal' } },
            { homeAway: 'away', team: { id: '363', abbreviation: 'CHE', displayName: 'Chelsea' } },
          ],
        },
      ],
    },
    { competition },
  );
  if (r.kind !== 'valid') throw new Error(JSON.stringify(r));
  return r.value;
}

describe('a league season name counts only after a year', () => {
  it.each([
    '-english-premier-league',
    'x-english-premier-league',
    '202-english-premier-league',
    '2026-2027-english-premier-league',
    'season-2026-english-premier-league',
  ])('%s under eng.1 is OTHER', (slug) => {
    const m = stageOf(slug, 'eng.1');
    expect(m.stage).toBe('OTHER');
  });

  it('with a year in front it is the season', () => {
    expect(stageOf('2026-27-english-premier-league', 'eng.1').stage).toBe('REGULAR');
    expect(stageOf('2026-english-premier-league', 'eng.1').stage).toBe('REGULAR');
  });
});
