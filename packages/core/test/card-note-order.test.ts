/**
 * 0.11, ledger row D7 — on a surface a cut can reach (a share card is pasted
 * into a tool's text), every sentence that QUALIFIES the body is printed BEFORE
 * the body, after the verdict's note: a cut takes the end of the body first, and
 * what used to follow the rows (a degraded note, a market-incomplete note, a
 * roster note, a partial-table line, a bracket's two notes) was the first thing
 * a long card lost. The sentences do not change: only their place.
 */
import { describe, expect, it } from 'vitest';
import { formatShareBracket } from '../src/bracket/format';
import type { BracketMatchView } from '../src/bracket/types';
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
/** The position of `needle` in `text`, which must hold it. */
const at = (text: string, needle: string | RegExp): number => {
  const i = typeof needle === 'string' ? text.indexOf(needle) : text.search(needle);
  expect(i, `${String(needle)} in:\n${text}`).toBeGreaterThanOrEqual(0);
  return i;
};
const before = (text: string, a: string | RegExp, b: string | RegExp) => expect(at(text, a)).toBeLessThan(at(text, b));

describe('a date or live card: its qualifying notes come before the rows (D7)', () => {
  const base = { title: 'Matches · Jun 11', matches: [match], tz: 'UTC', locale: 'en' };

  it('the degraded note, in both styles', () => {
    for (const style of ['social', 'compact'] as const) {
      const out = formatShareSnippet({ ...base, degraded: true }, { style });
      // A compact row prints the code, a social one the name.
      before(out, 'Live data unavailable', style === 'compact' ? 'MEX' : 'Mexico');
    }
  });

  it('a caller-given degraded note (the earlier record)', () => {
    const out = formatShareSnippet({ ...base, degraded: true, degradedNote: '(Showing the earlier record.)' });
    before(out, 'earlier record', 'Mexico');
  });

  it('the market-incomplete note', () => {
    const out = formatShareSnippet({ ...base, degraded: false, marketComplete: false });
    before(out, 'Market data unavailable or incomplete', 'Mexico');
  });

  it('after the verdict note, which stays first', () => {
    const out = formatShareSnippet({ ...base, degraded: true, note: 'Fixture data may be incomplete.' });
    before(out, 'may be incomplete', 'Live data unavailable');
    before(out, 'Live data unavailable', 'Mexico');
  });
});

describe('a table card: the roster note, the inventory note and each partial line come before their rows (D7)', () => {
  const rows = [
    { team: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' }, played: 1, won: 1, drawn: 0, lost: 0, goalsFor: 2, goalsAgainst: 0, goalDiff: 2, points: 3 },
    { team: { code: 'KOR', name: 'South Korea', flag: '🇰🇷' }, played: 1, won: 0, drawn: 1, lost: 0, goalsFor: 1, goalsAgainst: 1, goalDiff: 0, points: 1 },
  ];

  it('the roster note, degraded', () => {
    const out = formatShareTable({ tables: [{ group: 'A', rows }], degraded: true });
    before(out, 'Live standings unavailable', 'MEX');
  });

  it('the inventory note (tables missing)', () => {
    const out = formatShareTable({ tables: [{ group: 'A', rows }], source: 'espn', incompleteNote: 'Some tables could not be read' });
    before(out, 'Some tables could not be read', 'MEX');
  });

  it('a partial line before ITS table, between two tables', () => {
    const out = formatShareTable({
      tables: [
        { group: 'A', rows },
        { group: 'B', rows: rows.map((r) => ({ ...r, team: { code: 'ARG', name: 'Argentina', flag: '🇦🇷' } })), partial: { omitted: 2 } },
      ],
      source: 'espn',
    });
    // Group A's rows, then group B's title, its partial line, then its rows.
    before(out, 'MEX', 'Group B');
    before(out, 'Group B', 'partial table');
    before(out, 'partial table', 'ARG');
  });
});

describe('a bracket card: its two notes come before the tree, in both styles (D7)', () => {
  const m: Match = { ...match, id: '1', stage: 'R32', group: undefined, kickoff: '2026-07-04T17:00:00Z', home: { code: 'CZE', name: 'Czechia', flag: '🇨🇿' }, away: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' } };
  const view: BracketMatchView = {
    matchId: '1',
    stage: 'R32',
    index: 1,
    kickoff: m.kickoff,
    home: { label: 'Czechia', flag: '🇨🇿', code: 'CZE', status: 'confirmed' },
    away: { label: 'Mexico', flag: '🇲🇽', code: 'MEX', status: 'confirmed' },
    match: m,
  };
  const stages = [{ stage: 'R32' as const, label: 'Round of 32', matches: [view] }];

  for (const style of ['social', 'compact'] as const) {
    it(`degraded, ${style}`, () => {
      const out = formatShareBracket({ view: { stages, degraded: true, standingsDegraded: false } }, { style, locale: 'en', tz: 'UTC' });
      before(out, /structure only|unavailable/i, 'Czechia');
    });
    it(`standings degraded, ${style}`, () => {
      const out = formatShareBracket({ view: { stages, degraded: false, standingsDegraded: true } }, { style, locale: 'en', tz: 'UTC' });
      before(out, /standings/i, 'Czechia');
    });
    it(`both, after the verdict note, ${style}`, () => {
      const out = formatShareBracket(
        { view: { stages, degraded: true, standingsDegraded: true }, note: 'Fixture data may be incomplete.' },
        { style, locale: 'en', tz: 'UTC' },
      );
      before(out, 'may be incomplete', /structure only|unavailable/i);
      before(out, /structure only|unavailable/i, 'Czechia');
    });
  }
});
