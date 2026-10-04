/**
 * What a competition IS, written down: which teams it fields (nations or
 * clubs), and what kind of competition it is (a league, a cup, the friendly
 * one). Facts of the competition, one entry each, never inferred from a name,
 * a slug or a payload. Re-exported by `competition.ts`, where the other written
 * facts live; kept in this leaf module because the trust layer reads them at
 * parse time, and `competition.ts` imports the adapter, which imports the trust
 * layer (an import cycle would leave these tables uninitialized on one path).
 *
 * An unlisted competition asserts nothing: its teams are clubs (no flag is
 * ever generated from a name that merely looks like a region) and it is a cup
 * (no league season, no friendly). Every lookup is an OWN-property one: the
 * competition comes from an environment variable, and `constructor` is not one.
 */
import type { Team } from './types';

/** Whether a competition fields nations (a flag is generated from the name) or clubs (no flag). */
export type TeamKind = 'nation' | 'club';

/** A league (its season is the regular stage), a cup (rounds and phases), or the friendly competition. */
export type CompetitionKind = 'league' | 'cup' | 'friendly';

/**
 * The supported fifteen, by the teams they field. `nation`: the World Cup,
 * the Euro, the Copa América, the UEFA Nations League, the Concacaf Nations
 * League, the Gold Cup. `club`: the five leagues and the four club cups.
 */
export const TEAM_KIND: Readonly<Record<string, TeamKind>> = Object.freeze({
  'fifa.world': 'nation',
  'uefa.euro': 'nation',
  'conmebol.america': 'nation',
  'uefa.nations': 'nation',
  'concacaf.nations.league': 'nation',
  'concacaf.gold': 'nation',
  'eng.1': 'club',
  'esp.1': 'club',
  'ita.1': 'club',
  'ger.1': 'club',
  'mex.1': 'club',
  'uefa.champions': 'club',
  'conmebol.libertadores': 'club',
  'concacaf.champions': 'club',
  'fifa.cwc': 'club',
});

/** The teams a competition fields; an unlisted (or absent) competition fields clubs. */
export function teamKind(competition: string | undefined): TeamKind {
  return competition !== undefined && Object.hasOwn(TEAM_KIND, competition)
    ? (TEAM_KIND[competition] as TeamKind)
    : 'club';
}

/**
 * The supported fifteen and the friendly competition, by kind. `league`: the
 * five leagues, whose regular season the stage grammar reads as `REGULAR`;
 * `friendly`: `fifa.friendly` (reachable through `CLAUDINHO_COMPETITION`), the
 * one competition whose `friendly` slug is the `FRIENDLY` stage; `cup`: the
 * other ten.
 */
export const COMPETITION_KIND: Readonly<Record<string, CompetitionKind>> = Object.freeze({
  'eng.1': 'league',
  'esp.1': 'league',
  'ita.1': 'league',
  'ger.1': 'league',
  'mex.1': 'league',
  'fifa.friendly': 'friendly',
  'fifa.world': 'cup',
  'uefa.euro': 'cup',
  'conmebol.america': 'cup',
  'uefa.nations': 'cup',
  'concacaf.nations.league': 'cup',
  'concacaf.gold': 'cup',
  'uefa.champions': 'cup',
  'conmebol.libertadores': 'cup',
  'concacaf.champions': 'cup',
  'fifa.cwc': 'cup',
});

/** A competition's kind; an unlisted (or absent) competition is a cup, the kind that asserts nothing. */
export function competitionKind(competition: string | undefined): CompetitionKind {
  return competition !== undefined && Object.hasOwn(COMPETITION_KIND, competition)
    ? (COMPETITION_KIND[competition] as CompetitionKind)
    : 'cup';
}

/**
 * The season NAME a league's regular season is filed under, as measured on
 * the real feed (Oct 3, 2026): `2026-27-english-premier-league`,
 * `2026-27-laliga`, `2026-27-italian-serie-a`, `2026-27-german-bundesliga`.
 * The year in front varies; the name is this one, matched whole. `mex.1` has
 * none: its slugs are `torneo-apertura`, `torneo-clausura` and its play-off
 * rounds.
 */
export const SEASON_SLUG: Readonly<Record<string, string>> = Object.freeze({
  'eng.1': 'english-premier-league',
  'esp.1': 'laliga',
  'ita.1': 'italian-serie-a',
  'ger.1': 'german-bundesliga',
});

/** A league's written season name, or undefined (no such name, or not a league). */
export function seasonSlugOf(competition: string | undefined): string | undefined {
  return competition !== undefined && Object.hasOwn(SEASON_SLUG, competition)
    ? SEASON_SLUG[competition]
    : undefined;
}

/** Mexico's national team, by the provider's id: a written fact (`espn:203`). */
export const MEXICO_TEAM_ID = 'espn:203';

/**
 * Is this side Mexico's national team: the team the rally cry ("¿Y si sí?")
 * belongs to? By IDENTITY, in a competition that fields nations: the
 * provider's id when the side carries one (a present id that is not Mexico's
 * is never Mexico, whatever its labels say), or, for the bundle's id-less
 * Mexico, its code AND its name. A club abbreviated `MEX` never is; neither is
 * Mexico's id read under a club competition.
 */
export function isMexicoNationalTeam(team: Team, kind: TeamKind): boolean {
  if (kind !== 'nation') return false;
  if (team.id !== undefined) return team.id === MEXICO_TEAM_ID;
  return team.code === 'MEX' && team.name === 'Mexico';
}
