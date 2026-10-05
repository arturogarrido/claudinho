/**
 * A list's flair is ONE rule (`matchFlairs`): a row whose side carries a cry
 * prints the cry and reserves no phrase, so the rows with none still get
 * distinct phrases (18 rows with 14 cries printed 3 distinct phrases on the
 * other 4 when every row reserved one). The pin decides between two cries by
 * the one pin predicate (`isPinnedSide`: equal ids when both carry one, the
 * code for an id-less pin, the code and name for a side with no id). A sober
 * line (postponed, cancelled) carries no cry. The cyclic step starts from the
 * row's OWN phrase.
 */
import { describe, expect, it } from 'vitest';
import { FLAVOR_BANKS, flavorsFor, isPinnedSide, matchFlair, matchFlairs, matchFlavor, RALLY_CRIES, rallyCryFor } from '../src';
import type { Match, Team } from '../src';

function match(over: Partial<Match> = {}): Match {
  return {
    id: '800002001',
    stage: 'REGULAR',
    kickoff: '2026-10-10T14:00:00.000Z',
    venue: 'Stadium',
    home: { code: 'AME', name: 'América', id: 'espn:227' },
    away: { code: 'UNAM', name: 'Pumas UNAM', id: 'espn:233' },
    status: 'SCHEDULED',
    updatedAt: '2026-10-04T12:00:00.000Z',
    ...over,
  };
}
/** A club with no cry in the table, numbered so every row is its own fixture. */
const plainClub = (i: number): Team => ({ code: `P${i}`, name: `Plain ${i}`, id: `espn:${97000 + i}` });
const bank = (moment: string) => FLAVOR_BANKS.en?.[moment] ?? [];

/** `n` cry-less fixtures whose OWN phrase is the same (found by asking matchFlavor). */
function sharingOnePhrase(n: number, over: Partial<Match> = {}, start = 800002100): Match[] {
  const mk = (k: number, i: number) => match({ id: String(k), home: plainClub(2 * i), away: plainClub(2 * i + 1), ...over });
  const first = mk(start, 0);
  const own = matchFlavor(first, { level: 'full', locale: 'en' });
  const out = [first];
  for (let k = start + 1; out.length < n; k++) {
    const m = mk(k, out.length);
    if (matchFlavor(m, { level: 'full', locale: 'en' }) === own) out.push(m);
  }
  return out;
}

describe('matchFlairs: a cry row reserves no phrase', () => {
  it('fourteen rows with a cry, then four without that share their own phrase: the four print four different phrases', () => {
    const clubs = RALLY_CRIES.filter((c) => c.kind === 'club').slice(0, 14);
    const cries = clubs.map((c, i) => match({ id: String(800002200 + i), home: { code: c.code, name: c.name, id: c.id }, away: plainClub(100 + i) }));
    const plain = sharingOnePhrase(4);
    const out = matchFlairs([...cries, ...plain], { level: 'full', locale: 'en', kind: 'club' });
    expect(out).toHaveLength(18);
    expect(out.slice(0, 14)).toEqual(clubs.map((c) => ({ text: c.cry, rally: true })));
    const phrases = out.slice(14);
    expect(phrases.every((f) => !f.rally)).toBe(true);
    expect(new Set(phrases.map((f) => f.text)).size).toBe(4);
    // The cry-less rows get exactly what flavorsFor gives them alone.
    expect(phrases.map((f) => f.text)).toEqual(flavorsFor(plain, { level: 'full', locale: 'en' }));
  });

  it('a single line is the list of one', () => {
    const cases = [
      match(),
      match({ home: plainClub(1), away: plainClub(2) }),
      match({ status: 'CANCELLED' }),
      match({ status: 'LIVE', minute: 85, score: { home: 1, away: 1 } }),
    ];
    for (const m of cases) {
      for (const level of ['off', 'subtle', 'full'] as const) {
        expect(matchFlairs([m], { level, locale: 'es', kind: 'club' })).toEqual([matchFlair(m, { level, locale: 'es', kind: 'club' })]);
      }
    }
  });

  it('off is silent on one line too, whatever phrase was handed in', () => {
    expect(matchFlair(match({ home: plainClub(1), away: plainClub(2) }), { level: 'off', kind: 'club' }, 'set the alarm!')).toEqual({ text: '', rally: false });
  });

  it('with no team kind the list is flavorsFor: no cries', () => {
    const list = [match(), match({ id: '800002002' })];
    expect(matchFlairs(list, { level: 'full', locale: 'en' })).toEqual(flavorsFor(list, { level: 'full', locale: 'en' }).map((text) => ({ text, rally: false })));
  });
});

describe('the cyclic step starts from the row\'s own phrase', () => {
  it("two rows sharing their own phrase: the second takes the bank's next one after it", () => {
    const scheduled = bank('scheduled');
    const ownIndex = (m: Match) => scheduled.indexOf(matchFlavor(m, { level: 'full', locale: 'en' }));
    // A first row whose own phrase is neither of the bank's first two: a step
    // that started from index 0 (skipping the taken one) would then give
    // another phrase than the one after its own.
    let start = 800002100;
    while (ownIndex(match({ id: String(start), home: plainClub(0), away: plainClub(1) })) < 2) start++;
    const [a, b] = sharingOnePhrase(2, {}, start);
    const own = ownIndex(a as Match);
    expect(own).toBeGreaterThanOrEqual(2);
    expect(flavorsFor([a as Match, b as Match], { level: 'full', locale: 'en' })).toEqual([scheduled[own], scheduled[(own + 1) % scheduled.length]]);
  });
});

describe('the pin: one predicate', () => {
  const mex: Team = { code: 'MEX', name: 'Mexico', id: 'espn:203' };
  const usaFeed: Team = { code: 'USA', name: 'United States of America', id: 'espn:660' };

  it("an id-less pin matches by code (the bundle's contract): the saved United States picks the feed's", () => {
    const m = match({ home: mex, away: usaFeed });
    expect(rallyCryFor(m, 'nation')).toBe('¿Y si sí?');
    expect(rallyCryFor(m, 'nation', { code: 'USA', name: 'United States' })).toBe('I believe!');
    expect(isPinnedSide(usaFeed, { code: 'USA', name: 'United States' })).toBe(true);
  });

  it("the pin's id decides when both carry one, whatever the labels", () => {
    const clasico = match();
    expect(rallyCryFor(clasico, 'club', { id: 'espn:233', code: 'PUM', name: 'Pumas' })).toBe('¡Goya!');
    expect(rallyCryFor(clasico, 'club', { id: 'espn:999', code: 'UNAM', name: 'Pumas UNAM' })).toBe('¡Ódiame más!');
  });

  it('a pin with an id against a side with none: the code and the name', () => {
    const bundled = match({ home: { code: 'MEX', name: 'Mexico' }, away: { code: 'USA', name: 'United States' } });
    expect(rallyCryFor(bundled, 'nation', { id: 'espn:660', code: 'USA', name: 'United States' })).toBe('I believe!');
    expect(rallyCryFor(bundled, 'nation', { id: 'espn:660', code: 'USA', name: 'USA' })).toBe('¿Y si sí?');
  });
});

describe('a sober line carries no cry', () => {
  it('postponed and cancelled: nothing, at every level; subtle still prints a cry on a scheduled match', () => {
    const arsenal: Team = { code: 'ARS', name: 'Arsenal', id: 'espn:359' };
    for (const status of ['POSTPONED', 'CANCELLED'] as const) {
      const m = match({ home: arsenal, away: plainClub(1), status });
      for (const level of ['subtle', 'full'] as const) {
        expect(matchFlair(m, { level, kind: 'club' })).toEqual({ text: '', rally: false });
        expect(matchFlairs([m], { level, kind: 'club' })).toEqual([{ text: '', rally: false }]);
      }
    }
    expect(matchFlair(match({ home: arsenal, away: plainClub(1) }), { level: 'subtle', kind: 'club' })).toEqual({ text: 'COYG!', rally: true });
  });
});
