/**
 * A team's kind and a competition's kind are WRITTEN facts of the competition
 * (0.11 · 2.2 + 2.4). A flag is generated from a NATION's name and a club has
 * none; a league's regular season, a cup's league phase and the play-offs are
 * stages the grammar reaches only where the competition's kind allows. Nothing
 * here is inferred from a name, a slug or a payload: an unlisted competition
 * asserts nothing (a club, a cup).
 */
import { describe, expect, it } from 'vitest';
import {
  COMPETITION_KIND,
  competitionKind,
  SEASON_SLUG,
  TEAM_KIND,
  teamKind,
} from '../src';

/** The supported set: the canary's fifteen. */
const NATIONS = ['fifa.world', 'uefa.euro', 'conmebol.america', 'uefa.nations', 'concacaf.nations.league', 'concacaf.gold'];
const LEAGUES = ['eng.1', 'esp.1', 'ita.1', 'ger.1', 'mex.1'];
const CLUB_CUPS = ['uefa.champions', 'conmebol.libertadores', 'concacaf.champions', 'fifa.cwc'];
const SUPPORTED = [...NATIONS, ...LEAGUES, ...CLUB_CUPS];

describe('TEAM_KIND: which competitions field nations', () => {
  it('lists every supported competition, and no other', () => {
    expect(Object.keys(TEAM_KIND).sort()).toEqual([...SUPPORTED].sort());
  });

  it.each(NATIONS)('%s fields nations', (c) => {
    expect(teamKind(c)).toBe('nation');
  });

  it.each([...LEAGUES, ...CLUB_CUPS])('%s fields clubs', (c) => {
    expect(teamKind(c)).toBe('club');
  });

  it('an unlisted competition fields clubs: no flag is generated from a name nobody vouched for', () => {
    expect(teamKind('fra.1')).toBe('club');
    expect(teamKind('usa.1')).toBe('club');
    expect(teamKind('fifa.friendly')).toBe('club');
    expect(teamKind('')).toBe('club');
  });
});

describe('COMPETITION_KIND: a league, a cup, or the friendly competition', () => {
  it('lists the supported fifteen and the friendly competition', () => {
    expect(Object.keys(COMPETITION_KIND).sort()).toEqual([...SUPPORTED, 'fifa.friendly'].sort());
  });

  it.each(LEAGUES)('%s is a league', (c) => {
    expect(competitionKind(c)).toBe('league');
  });

  it.each([...NATIONS, ...CLUB_CUPS])('%s is a cup', (c) => {
    expect(competitionKind(c)).toBe('cup');
  });

  it('fifa.friendly is the one friendly competition; an unlisted one is a cup (the side that asserts nothing)', () => {
    expect(competitionKind('fifa.friendly')).toBe('friendly');
    expect(competitionKind('fra.1')).toBe('cup');
    expect(competitionKind('')).toBe('cup');
  });
});

describe('SEASON_SLUG: the measured season name a league files its regular season under', () => {
  it('names the four leagues the provider files by season, and not mex.1 (torneo slugs)', () => {
    expect(SEASON_SLUG).toEqual({
      'eng.1': 'english-premier-league',
      'esp.1': 'laliga',
      'ita.1': 'italian-serie-a',
      'ger.1': 'german-bundesliga',
    });
  });

  it('every competition with a season name is a league', () => {
    for (const c of Object.keys(SEASON_SLUG)) expect(competitionKind(c)).toBe('league');
  });
});
