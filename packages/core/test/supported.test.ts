/**
 * The supported set is ONE data table (0.11 · 2.5a, D3): fifteen rows, each a
 * slug, an alias, a name, its teams' kind, its own kind, its season name, its
 * standings shape, its bracket and markets capabilities and its cadence. Every
 * other written fact derives from it, and adding a competition is one row: a
 * test adds a fake sixteenth and every consumer takes it with no other change.
 */
import { describe, expect, it } from 'vitest';
import {
  bracketCapability,
  COMPETITION_KIND,
  type CompetitionEntry,
  capabilitiesOf,
  competitionLabel,
  deriveTables,
  entryOf,
  listCompetitions,
  marketsCoverCompetition,
  SEASON_SLUG,
  STANDINGS_SHAPE,
  SUPPORTED,
  TEAM_KIND,
} from '../src';

const SLUGS = [
  'fifa.world', 'uefa.euro', 'conmebol.america', 'uefa.nations', 'concacaf.nations.league', 'concacaf.gold',
  'eng.1', 'esp.1', 'ita.1', 'ger.1', 'mex.1', 'uefa.champions', 'conmebol.libertadores', 'concacaf.champions', 'fifa.cwc',
];
const ALIASES: Record<string, string> = {
  'fifa.world': 'world-cup', 'uefa.euro': 'euro', 'conmebol.america': 'copa-america', 'uefa.nations': 'nations-league',
  'concacaf.nations.league': 'concacaf-nations-league', 'concacaf.gold': 'gold-cup', 'eng.1': 'premier-league',
  'esp.1': 'laliga', 'ita.1': 'serie-a', 'ger.1': 'bundesliga', 'mex.1': 'liga-mx', 'uefa.champions': 'champions-league',
  'conmebol.libertadores': 'libertadores', 'concacaf.champions': 'concacaf-champions-cup', 'fifa.cwc': 'club-world-cup',
};
const NAMES: Record<string, string> = {
  'fifa.world': 'World Cup', 'uefa.euro': 'EURO', 'conmebol.america': 'Copa América', 'uefa.nations': 'UEFA Nations League',
  'concacaf.nations.league': 'Concacaf Nations League', 'concacaf.gold': 'Gold Cup', 'eng.1': 'Premier League',
  'esp.1': 'LALIGA', 'ita.1': 'Serie A', 'ger.1': 'Bundesliga', 'mex.1': 'Liga MX', 'uefa.champions': 'Champions League',
  'conmebol.libertadores': 'Libertadores', 'concacaf.champions': 'Concacaf Champions Cup', 'fifa.cwc': 'Club World Cup',
};
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

describe('the table', () => {
  it('has the fifteen, each with its alias and name', () => {
    expect(SUPPORTED.map((e) => e.slug)).toEqual(SLUGS);
    for (const e of SUPPORTED) {
      expect(e.alias, e.slug).toBe(ALIASES[e.slug]);
      expect(e.name, e.slug).toBe(NAMES[e.slug]);
      expect(e.alias, e.slug).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(e.alias, e.slug).not.toContain('.');
    }
    expect(new Set(SUPPORTED.map((e) => e.alias)).size).toBe(15);
    expect(Object.isFrozen(SUPPORTED)).toBe(true);
  });

  it('is read by own property: a prototype name is no entry', () => {
    expect(entryOf('eng.1')?.alias).toBe('premier-league');
    expect(entryOf('constructor')).toBeUndefined();
    expect(entryOf('__proto__')).toBeUndefined();
    expect(entryOf('fra.1')).toBeUndefined();
    // By slug only: an alias is the resolver's business, not the table lookup's.
    expect(entryOf('premier-league')).toBeUndefined();
  });

  it('is frozen row by row, and so is every derived view', () => {
    for (const e of SUPPORTED) expect(Object.isFrozen(e), e.slug).toBe(true);
    const d = deriveTables(SUPPORTED);
    for (const [name, view] of Object.entries(d)) expect(Object.isFrozen(view), name).toBe(true);
    expect(() => {
      (d.teamKind as Record<string, unknown>)['fra.1'] = 'club';
    }).toThrow();
  });

  it('states the capabilities as the code offers them today', () => {
    expect(capabilitiesOf('fifa.world')).toEqual({ scores: 'offered', next: 'offered', standings: 'offered', bracket: 'offered', markets: 'offered' });
    expect(capabilitiesOf('eng.1')).toEqual({ scores: 'offered', next: 'offered', standings: 'offered', bracket: 'not-applicable', markets: 'not-offered-yet' });
    expect(capabilitiesOf('esp.1').bracket).toBe('not-applicable');
    expect(capabilitiesOf('ita.1').bracket).toBe('not-offered-yet');
    expect(capabilitiesOf('concacaf.champions').standings).toBe('not-applicable');
    expect(capabilitiesOf('uefa.champions')).toEqual({ scores: 'offered', next: 'offered', standings: 'offered', bracket: 'not-offered-yet', markets: 'not-offered-yet' });
    // A raw slug written nowhere: the generic reads, nothing else.
    expect(capabilitiesOf('fra.1')).toEqual({ scores: 'offered', next: 'offered', standings: 'offered', bracket: 'not-offered-yet', markets: 'not-offered-yet' });
    expect(capabilitiesOf('concacaf.champions').bracket).toBe('not-offered-yet');
  });

  it('names a competition by its row, and a raw slug by itself', () => {
    expect(competitionLabel('fifa.world')).toBe('World Cup');
    expect(competitionLabel('eng.1')).toBe('Premier League');
    expect(competitionLabel('fifa.friendly')).toBe('fifa.friendly');
  });
});

describe('every other written fact derives from the table', () => {
  const derived = deriveTables(SUPPORTED);

  it('the teams\' kinds (the experimental extras beside them)', () => {
    for (const e of SUPPORTED) expect(derived.teamKind[e.slug], e.slug).toBe(e.teams);
    expect(TEAM_KIND).toEqual({ ...derived.teamKind, 'fifa.friendly': 'nation' });
  });

  it('the competitions\' kinds, the season names, the standings shapes', () => {
    expect(COMPETITION_KIND).toEqual({ ...derived.competitionKind, 'fifa.friendly': 'friendly' });
    expect(SEASON_SLUG).toEqual(derived.seasonSlug);
    expect(derived.seasonSlug).toEqual({ 'eng.1': 'english-premier-league', 'esp.1': 'laliga', 'ita.1': 'italian-serie-a', 'ger.1': 'german-bundesliga' });
    expect(STANDINGS_SHAPE).toEqual(derived.standingsShape);
    expect(derived.standingsShape).toEqual({ 'eng.1': 'league', 'esp.1': 'league', 'ita.1': 'league', 'ger.1': 'league', 'mex.1': 'league', 'uefa.champions': 'league', 'concacaf.champions': 'none' });
  });

  it('the bracket and markets capabilities', () => {
    expect([...derived.noBracket].sort()).toEqual(['eng.1', 'esp.1']);
    expect(bracketCapability('fifa.world')).toBe('offered');
    expect(bracketCapability('eng.1')).toBe('inapplicable');
    expect(bracketCapability('ita.1')).toBe('unsupported');
    expect([...derived.marketCompetitions]).toEqual(['fifa.world']);
    expect(marketsCoverCompetition('fifa.world')).toBe(true);
    expect(marketsCoverCompetition('eng.1')).toBe(false);
  });

  it('the canary\'s list and cadences', () => {
    expect(derived.slugs).toEqual(SLUGS);
    expect(derived.cadenceYears).toEqual({
      'fifa.world': 4, 'uefa.euro': 4, 'conmebol.america': 4, 'fifa.cwc': 4,
      'uefa.nations': 2, 'concacaf.nations.league': 2, 'concacaf.gold': 2,
      'eng.1': 1, 'esp.1': 1, 'ita.1': 1, 'ger.1': 1, 'mex.1': 1, 'uefa.champions': 1, 'conmebol.libertadores': 1, 'concacaf.champions': 1,
    });
  });
});

describe('a sixteenth row is one row: every consumer takes the table as its input', () => {
  const table = [...SUPPORTED, FAKE];
  const derived = deriveTables(table);

  it('every derived view carries it', () => {
    expect(derived.teamKind['fra.1']).toBe('club');
    expect(derived.competitionKind['fra.1']).toBe('league');
    expect(derived.seasonSlug['fra.1']).toBe('ligue-1');
    expect(derived.standingsShape['fra.1']).toBe('league');
    expect(derived.noBracket.has('fra.1')).toBe(false);
    expect(derived.marketCompetitions.has('fra.1')).toBe(false);
    expect(derived.slugs).toEqual([...SLUGS, 'fra.1']);
    expect(derived.cadenceYears['fra.1']).toBe(1);
  });

  it('the list and the lookups take a table', () => {
    const listed = listCompetitions(table, null);
    expect(listed.competitions.map((c) => c.slug)).toEqual([...SLUGS, 'fra.1']);
    const last = listed.competitions[15];
    expect(last).toMatchObject({ slug: 'fra.1', alias: 'ligue-1', name: 'Ligue 1', teams: 'club', kind: 'league', capabilities: { scores: 'offered', next: 'offered', standings: 'offered', bracket: 'not-offered-yet', markets: 'not-offered-yet' } });
    expect(listed.current).toBeNull();
    expect(entryOf('fra.1', table)?.alias).toBe('ligue-1');
    expect(competitionLabel('fra.1', table)).toBe('Ligue 1');
    expect(capabilitiesOf('fra.1', table).standings).toBe('offered');
  });

  it('the derivations never read the prototype: the views have none', () => {
    const poisoned = [...SUPPORTED, { ...FAKE, slug: 'constructor', alias: 'constructor' }];
    const d = deriveTables(poisoned);
    expect(Object.hasOwn(d.teamKind, 'constructor')).toBe(true);
    expect(entryOf('toString', poisoned)).toBeUndefined();
    const plain = deriveTables(SUPPORTED);
    for (const view of [plain.teamKind, plain.competitionKind, plain.seasonSlug, plain.standingsShape, plain.cadenceYears] as Array<Record<string, unknown>>) {
      expect(Object.getPrototypeOf(view)).toBeNull();
      expect(view.constructor).toBeUndefined();
      expect(view.toString).toBeUndefined();
    }
  });
});
