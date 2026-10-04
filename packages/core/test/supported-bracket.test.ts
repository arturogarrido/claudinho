/**
 * The table's `bracket` is what `bracket` answers (0.11 · 2.5a, review): one
 * row, one fact. `bracketCapability` reads the ROW (offered / not-applicable →
 * inapplicable / not-offered-yet → unsupported; a slug off the table is
 * unsupported), so a listing, the README matrix and the command cannot
 * disagree; and a row that offers a bracket the bundle does not describe is
 * refused when the tables are derived, loud, at load, naming the slug: an
 * offered bracket needs a topology the clients ship, and only the bundled
 * competition has one.
 */
import { describe, expect, it } from 'vitest';
import { bracketCapability, BUNDLE_COMPETITION, type CompetitionEntry, capabilitiesOf, deriveTables, SUPPORTED } from '../src';

const FAKE: CompetitionEntry = {
  slug: 'fra.1',
  alias: 'ligue-1',
  name: 'Ligue 1',
  teams: 'club',
  kind: 'league',
  seasonSlug: 'ligue-1',
  standings: 'league',
  bracket: 'not-offered-yet',
  markets: 'not-offered-yet',
  cadenceYears: 1,
};
const AS_CAPABILITY = { offered: 'offered', 'not-applicable': 'inapplicable', 'not-offered-yet': 'unsupported' } as const;

describe('bracketCapability reads the row', () => {
  it('every row\'s two answers agree', () => {
    for (const e of SUPPORTED) {
      expect(bracketCapability(e.slug), e.slug).toBe(AS_CAPABILITY[capabilitiesOf(e.slug).bracket]);
      expect(bracketCapability(e.slug), e.slug).toBe(AS_CAPABILITY[e.bracket]);
    }
    expect(bracketCapability(BUNDLE_COMPETITION)).toBe('offered');
    expect(bracketCapability('fifa.friendly')).toBe('unsupported');
  });

  it('a table handed in is the one read: a fake row marked inapplicable answers inapplicable, one not offered yet unsupported', () => {
    const table = [...SUPPORTED, { ...FAKE, bracket: 'not-applicable' as const }];
    expect(bracketCapability('fra.1', table)).toBe('inapplicable');
    expect(bracketCapability('fra.1', [...SUPPORTED, FAKE])).toBe('unsupported');
    expect(bracketCapability('fra.1')).toBe('unsupported');
  });

  it('a row that offers a bracket the bundle does not describe is refused at derivation, naming the slug', () => {
    expect(() => deriveTables([...SUPPORTED, { ...FAKE, bracket: 'offered' as const }])).toThrow(/fra\.1/);
    expect(() => deriveTables([...SUPPORTED, { ...FAKE, bracket: 'offered' as const }])).toThrow(/bracket/);
    // The World Cup's own row offers one and derives.
    expect(() => deriveTables(SUPPORTED)).not.toThrow();
    expect(SUPPORTED.find((e) => e.slug === BUNDLE_COMPETITION)?.bracket).toBe('offered');
  });
});
