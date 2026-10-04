/**
 * 0.11 · 2.4 — two grammar and card rules the red tests do not reach, found
 * by reverting each rule:
 *
 *   - a league's season NAME counts only after a year (`2026-27-`, `2027-`):
 *     a slug that merely ENDS with the name is not the season;
 *   - a card whose OTHER stage carries no words pushes no stage line at all:
 *     not even an empty one (which would leave a stray blank line in the
 *     pasted card).
 */
import { describe, expect, it } from 'vitest';
import { formatShareSnippet } from '../src';
import type { Match } from '../src/types';
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

describe('a card whose stage has no words', () => {
  const m: Match = {
    id: '800000001',
    stage: 'OTHER',
    kickoff: '2026-10-04T14:00:00.000Z',
    venue: 'Emirates Stadium',
    city: 'London',
    home: { code: 'ARS', name: 'Arsenal', id: 'espn:359' },
    away: { code: 'CHE', name: 'Chelsea', id: 'espn:363' },
    status: 'LIVE',
    minute: 50,
    score: { home: 2, away: 1 },
    updatedAt: '2026-10-04T14:50:00.000Z',
  };

  it('prints the match line and its location, and no blank line of its own', () => {
    const out = formatShareSnippet({ title: 'Live now', matches: [m], tz: 'UTC', locale: 'en' }, { style: 'social' });
    // Blocks are separated by ONE blank line: a card that pushed an empty stage
    // line would leave two.
    expect(out).not.toMatch(/\n\n\n/);
    expect(out).toContain("Arsenal 2–1 Chelsea · 50'\nEmirates Stadium, London\n\n");
  });

  it('with words, the words are its last line', () => {
    const out = formatShareSnippet(
      { title: 'Live now', matches: [{ ...m, stageLabel: 'Qualifying final' }], tz: 'UTC', locale: 'en' },
      { style: 'social' },
    );
    expect(out).toContain('Emirates Stadium, London\nQualifying final\n\n');
  });
});
