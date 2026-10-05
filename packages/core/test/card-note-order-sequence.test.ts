/**
 * 0.11, ledger row D7 — beside `card-note-order.test.ts` (each note before the
 * rows): the ORDER of a card's notes, the empty card (nothing follows its
 * empty note but the footer), and the cards with nothing to say (as they
 * always were).
 */
import { describe, expect, it } from 'vitest';
import { formatShareBracket } from '../src/bracket/format';
import { DISCLAIMER } from '../src/disclaimer';
import { formatShareSnippet, formatShareTable } from '../src/share/format';
import type { Match } from '../src/types';

const match: Match = {
  id: '760415',
  stage: 'GROUP',
  group: 'A',
  kickoff: '2026-06-11T19:00:00Z',
  venue: 'Estadio Azteca',
  city: 'Mexico City',
  country: 'Mexico',
  home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
  away: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' },
  status: 'SCHEDULED',
  updatedAt: '2026-06-08T00:00:00Z',
};
/** Where each needle is, in order: every one present, each after the one before. */
function inOrder(text: string, needles: string[]) {
  const at = needles.map((n) => {
    const i = text.indexOf(n);
    expect(i, `${n} in:\n${text}`).toBeGreaterThanOrEqual(0);
    return i;
  });
  for (let k = 1; k < at.length; k++) expect(at[k], `${needles[k - 1]} before ${needles[k]}`).toBeGreaterThan(at[k - 1] as number);
}
const blocks = (text: string) => text.split('\n\n');

describe('a match card: the verdict note, the outage, the markets, then the matches (D7)', () => {
  const base = { title: 'Matches · Jun 11', matches: [match], tz: 'UTC', locale: 'en' };

  it('all three, in that order, and only the footer after the matches', () => {
    for (const style of ['social', 'compact'] as const) {
      const out = formatShareSnippet({ ...base, degraded: true, marketComplete: false, note: 'Fixture data may be incomplete.' }, { style });
      // A compact row prints codes, a social card names.
      inOrder(out, ['Matches · Jun 11', 'may be incomplete', 'Live data unavailable', 'Market data unavailable or incomplete', style === 'compact' ? 'MEX' : 'Mexico']);
      // The last block is the footer, and the one before it the matches.
      expect(blocks(out).at(-2)).toMatch(/MEX|Mexico/);
      expect(blocks(out).at(-1)).toContain(DISCLAIMER);
    }
  });

  it('an empty card: the market note before the empty note, which is the last thing before the footer', () => {
    const out = formatShareSnippet({ ...base, matches: [], marketComplete: false, emptyNote: 'No matches scheduled for Jun 11.' });
    inOrder(out, ['Market data unavailable or incomplete', 'No matches scheduled for Jun 11.']);
    expect(blocks(out).at(-2)).toBe('No matches scheduled for Jun 11.');
  });

  it('a healthy card says nothing before its matches', () => {
    const out = formatShareSnippet({ ...base, degraded: false, marketComplete: true });
    expect(blocks(out)[0]).toBe('Matches · Jun 11');
    expect(blocks(out)[1]?.startsWith('🇲🇽 Mexico vs South Africa 🇿🇦')).toBe(true);
    expect(out).not.toMatch(/unavailable|incomplete/);
  });
});

describe('a table card: the verdict sentence, then the roster note, then the tables (D7)', () => {
  const rows = [
    { team: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' }, played: 1, won: 1, drawn: 0, lost: 0, goalsFor: 2, goalsAgainst: 0, goalDiff: 2, points: 3 },
  ];

  it('both given (a read never states both: the order is still one)', () => {
    const out = formatShareTable({ tables: [{ group: 'A', rows }], degraded: true, incompleteNote: 'Some tables could not be read' });
    inOrder(out, ['(Some tables could not be read)', '(Live standings unavailable', 'Group A · standings', 'MEX']);
  });

  it('a table’s partial line between its title and its rows, never after them', () => {
    const out = formatShareTable({ tables: [{ group: 'A', rows, partial: { omitted: 1 } }], source: 'espn' });
    inOrder(out, ['Group A · standings', '(partial table — 1 row unreadable', 'MEX']);
    expect(blocks(out).at(-2)).toMatch(/MEX\s+3 pts/);
  });

  it('a healthy table card starts with its table, as it always did', () => {
    const out = formatShareTable({ tables: [{ group: 'A', rows }], source: 'espn' });
    expect(out.split('\n')[0]).toBe('Group A · standings');
    expect(out).not.toContain('(');
  });
});

describe('a bracket card with no stages: its empty note, no tree note (as before) (D7)', () => {
  it('both styles', () => {
    for (const style of ['social', 'compact'] as const) {
      const out = formatShareBracket({ view: { stages: [], degraded: true, standingsDegraded: true }, emptyNote: 'No bracket yet.' }, { style, locale: 'en', tz: 'UTC' });
      expect(out).toContain('No bracket yet.');
      expect(out).not.toMatch(/structure only|standings/i);
    }
  });
});
