/**
 * The flair slot's one rule (`matchFlair`) and the edges of the moments the
 * bank test leaves open: a level full time that somebody WON (a shootout, a
 * winner the provider declares) is no draw, a full time with no score is no
 * draw either, and a side whose id is not the entry's never borrows its cry by
 * its labels.
 */
import { describe, expect, it } from 'vitest';
import { FLAVOR_BANKS, flavorsFor, isMexicoNationalTeam, matchFlair, matchFlavor, RALLY_CRIES, rallyEntryFor } from '../src';
import type { Match } from '../src';

function match(over: Partial<Match> = {}): Match {
  return {
    id: '800000901',
    stage: 'REGULAR',
    kickoff: '2026-10-10T14:00:00.000Z',
    venue: 'Estadio Olímpico Universitario',
    home: { code: 'UNAM', name: 'Pumas UNAM', id: 'espn:233' },
    away: { code: 'PUE', name: 'Puebla', id: 'espn:231' },
    status: 'SCHEDULED',
    updatedAt: '2026-10-04T12:00:00.000Z',
    ...over,
  };
}
const neutral = (over: Partial<Match> = {}): Match =>
  match({ home: { code: 'NEC', name: 'Necaxa', id: 'espn:229' }, ...over });
const bank = (moment: string) => FLAVOR_BANKS.en?.[moment] ?? [];

/**
 * `n` matches whose OWN phrase is the same (ids found by asking matchFlavor,
 * so the list collides whatever the bank's depth): consecutive ids hash to
 * consecutive phrases, so a list of them is distinct without any stepping.
 */
function sharingOnePhrase(n: number, locale: string, over: Partial<Match> = {}): Match[] {
  const first = neutral({ id: '800000700', ...over });
  const own = matchFlavor(first, { level: 'full', locale });
  const out = [first];
  for (let k = 800000701; out.length < n; k++) {
    const m = neutral({ id: String(k), ...over });
    if (matchFlavor(m, { level: 'full', locale }) === own) out.push(m);
  }
  return out;
}

describe('a list whose matches share their own phrase', () => {
  it('still gets a different phrase per row, in every language, the first row keeping its own', () => {
    for (const locale of ['en', 'es', 'pt', 'fr']) {
      const list = sharingOnePhrase(8, locale);
      expect(new Set(list.map((m) => matchFlavor(m, { level: 'full', locale }))).size, locale).toBe(1);
      const out = flavorsFor(list, { level: 'full', locale });
      expect(new Set(out).size, locale).toBe(8);
      expect(out[0]).toBe(matchFlavor(list[0] as Match, { level: 'full', locale }));
    }
  });

  it('past the bank, a row takes its own phrase again', () => {
    const depth = bank('draw').length;
    const list = sharingOnePhrase(depth + 1, 'en', { status: 'FT', score: { home: 0, away: 0 } });
    const out = flavorsFor(list, { level: 'full', locale: 'en' });
    expect(new Set(out.slice(0, depth)).size).toBe(depth);
    expect(out[depth]).toBe(matchFlavor(list[depth] as Match, { level: 'full', locale: 'en' }));
  });
});

describe('a draw is a level result nobody won', () => {
  it('a shootout, or a winner the provider declares on a level score, is a decided full time', () => {
    const level = { status: 'FT' as const, score: { home: 1, away: 1 } };
    expect(bank('draw')).toContain(matchFlavor(neutral(level), { level: 'full' }));
    expect(bank('ft')).toContain(matchFlavor(neutral({ ...level, shootout: { home: 4, away: 3 } }), { level: 'full' }));
    expect(bank('ft')).toContain(matchFlavor(neutral({ ...level, winnerCode: 'NEC' }), { level: 'full' }));
  });

  it('a full time with no score on the board is not called a draw', () => {
    expect(bank('ft')).toContain(matchFlavor(neutral({ status: 'FT' }), { level: 'full' }));
  });
});

describe('matchFlair: the cry, else the phrase handed in, else the match\'s own', () => {
  it('the cry takes the slot (rally), at full and at subtle, and nothing at off', () => {
    expect(matchFlair(match(), { level: 'full', kind: 'club' })).toEqual({ text: '¡Goya!', rally: true });
    expect(matchFlair(match(), { level: 'subtle', kind: 'club' })).toEqual({ text: '¡Goya!', rally: true });
    expect(matchFlair(match(), { level: 'off', kind: 'club' })).toEqual({ text: '', rally: false });
  });

  it('without a team kind no side carries a cry (a kind nobody stated vouches for nothing)', () => {
    const own = matchFlavor(match(), { level: 'full', locale: 'es' });
    expect(matchFlair(match(), { level: 'full', locale: 'es' })).toEqual({ text: own, rally: false });
  });

  it("a side with no cry: the phrase handed in, else the match's own phrase", () => {
    expect(matchFlair(neutral(), { level: 'full', kind: 'club' }, 'set the alarm!')).toEqual({ text: 'set the alarm!', rally: false });
    expect(matchFlair(neutral(), { level: 'full', kind: 'club' }, '')).toEqual({ text: '', rally: false });
    expect(matchFlair(neutral(), { level: 'full', kind: 'club' })).toEqual({ text: matchFlavor(neutral(), { level: 'full' }), rally: false });
  });

  it('the pin decides between two sides that both carry one', () => {
    const clasico = match({ home: { code: 'AME', name: 'América', id: 'espn:227' }, away: { code: 'UNAM', name: 'Pumas UNAM', id: 'espn:233' } });
    expect(matchFlair(clasico, { kind: 'club' }).text).toBe('¡Ódiame más!');
    expect(matchFlair(clasico, { kind: 'club', pin: { id: 'espn:233', code: 'UNAM', name: 'Pumas UNAM' } }).text).toBe('¡Goya!');
  });
});

describe('the rally table: identity, never labels', () => {
  it("a present id that is not the entry's is never that team, whatever its code and name", () => {
    expect(rallyEntryFor({ code: 'BRA', name: 'Brazil', id: 'espn:999999' }, 'nation')).toBeUndefined();
    expect(rallyEntryFor({ code: 'BRA', name: 'Brazil' }, 'nation')?.cry).toBe('Vai Brasil!');
    expect(rallyEntryFor({ code: 'BRA', name: 'Brazil' }, 'club')).toBeUndefined();
  });

  it("a cry is said only in a competition of its kind: a nation's id under a club competition carries none", () => {
    expect(rallyEntryFor({ code: 'ARG', name: 'Argentina', id: 'espn:202' }, 'club')).toBeUndefined();
    expect(rallyEntryFor({ code: 'UNAM', name: 'Pumas UNAM', id: 'espn:233' }, 'nation')).toBeUndefined();
  });

  it('isMexicoNationalTeam is the Mexico case of the table', () => {
    for (const c of RALLY_CRIES) {
      expect(isMexicoNationalTeam({ code: c.code, name: c.name, id: c.id }, c.kind), c.name).toBe(c.id === 'espn:203');
    }
  });

  it('the banks and the table are frozen', () => {
    expect(Object.isFrozen(FLAVOR_BANKS)).toBe(true);
    expect(Object.isFrozen(FLAVOR_BANKS.es)).toBe(true);
    expect(Object.isFrozen(FLAVOR_BANKS.es?.goal)).toBe(true);
    expect(Object.isFrozen(RALLY_CRIES)).toBe(true);
    expect(Object.isFrozen(RALLY_CRIES[0])).toBe(true);
  });
});
