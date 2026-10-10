/**
 * The Liga AUF Uruguaya row (ESPN `uru.1`): the sixteenth competition, a league of clubs with one table (ESPN serves
 * one Torneo child, measured Oct 8, 2026: "Torneo Clausura 2026", 16 rows; the scoreboard's season slug
 * `torneo-clausura`, which the stage grammar already reads as REGULAR under a league). One row in the supported
 * table; every written fact derives from it. The counted copies, the keyword lists and the README matrix are pinned
 * by their own guards and go red with the row until they follow.
 */
import { describe, expect, it } from 'vitest';
import { SUPPORTED, capabilitiesOf, competitionValue, entryOf, listCompetitions } from '../src';

const SLUG = 'uru.1';
const ALIAS = 'liga-auf';

describe('the Liga AUF Uruguaya row', () => {
  it('is in the supported table with its written facts', () => {
    const row = entryOf(SLUG);
    expect(row, 'uru.1 is a row').toBeDefined();
    expect(row?.alias).toBe(ALIAS);
    expect(row?.name).toBe('Liga AUF Uruguaya');
    expect(row?.teams).toBe('club');
    expect(row?.kind).toBe('league');
    expect(row?.standings).toBe('league');
    expect(row?.bracket).toBe('not-offered-yet');
    expect(row?.markets).toBe('not-offered-yet');
    expect(row?.cadenceYears).toBe(1);
  });

  it('is selected by its alias and by its slug, never as experimental', () => {
    for (const v of [ALIAS, SLUG]) {
      const got = competitionValue(v);
      expect(got && 'row' in got ? got.row.slug : undefined, v).toBe(SLUG);
    }
  });

  it('offers scores, next and standings; no bracket, no markets', () => {
    const c = capabilitiesOf(SLUG);
    expect(c.scores).toBe('offered');
    expect(c.next).toBe('offered');
    expect(c.standings).toBe('offered');
    expect(c.bracket).toBe('not-offered-yet');
    expect(c.markets).toBe('not-offered-yet');
  });

  it('is listed by list_competitions with its alias', () => {
    const listed = listCompetitions(SUPPORTED, null).competitions.find((c) => c.slug === SLUG);
    expect(listed?.alias).toBe(ALIAS);
  });
});
