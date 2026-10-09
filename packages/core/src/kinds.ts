/**
 * What a competition IS, written down: which teams it fields (nations or
 * clubs), what kind of competition it is (a league, a cup, the friendly one),
 * a league's season name, its standings shape. Facts of the competition, one
 * entry each, never inferred from a name, a slug or a payload.
 *
 * The supported sixteen are ONE table (`supported.ts`); every view below is
 * derived from it. Beside it, the EXPERIMENTAL extras: competitions the product
 * does not support but whose kinds are written down because the raw-slug
 * escape hatch reaches them. They OVERRIDE the table for their slug.
 *
 * Re-exported by `competition.ts`, where the other written facts live; kept in
 * this leaf module because the trust layer reads them at parse time, and
 * `competition.ts` imports the adapter, which imports the trust layer (an
 * import cycle would leave these tables uninitialized on one path).
 *
 * An unlisted competition asserts nothing: its teams are clubs (no flag is
 * ever generated from a name that merely looks like a region) and it is a cup
 * (no league season, no friendly). Every lookup is an OWN-property one: the
 * competition comes from a flag, an environment variable or a tool argument,
 * and `constructor` is not one.
 */
import { rallyEntryFor } from './rally';
import type { StandingsShape } from './trust/espn';
import { SUPPORTED_TABLES, type TeamKind } from './supported';
import type { Team } from './types';

export type { TeamKind } from './supported';

/** A league (its season is the regular stage), a cup (rounds and phases), or the friendly competition. */
export type CompetitionKind = 'league' | 'cup' | 'friendly';

/**
 * The experimental extras: written down beside the table, never supported.
 * International friendlies (`fifa.friendly`, reachable as a raw slug) are
 * nations' matches, and the one competition whose `friendly` slug is the
 * `FRIENDLY` stage.
 */
const EXPERIMENTAL: Readonly<Record<string, { readonly teams: TeamKind; readonly kind: CompetitionKind }>> =
  Object.freeze({ 'fifa.friendly': Object.freeze({ teams: 'nation', kind: 'friendly' }) });

/** The table's view, then the extras over it: no prototype, frozen. */
function withExtras<V>(base: Readonly<Record<string, V>>, extra: (e: { teams: TeamKind; kind: CompetitionKind }) => V) {
  const out: Record<string, V> = Object.assign(Object.create(null), base);
  for (const slug of Object.keys(EXPERIMENTAL)) out[slug] = extra(EXPERIMENTAL[slug] as { teams: TeamKind; kind: CompetitionKind });
  return Object.freeze(out) as Readonly<Record<string, V>>;
}

/**
 * The teams each competition fields: the supported table's (`nation` for the
 * World Cup, the Euro, the Copa America, both Nations Leagues and the Gold
 * Cup; `club` for the five leagues and the four club cups), and the friendly
 * competition's (`nation`). An unlisted competition fields clubs: a nations
 * competition the set does not list renders its teams by name until it is
 * written down.
 */
export const TEAM_KIND: Readonly<Record<string, TeamKind>> = withExtras(SUPPORTED_TABLES.teamKind, (e) => e.teams);

/** The teams a competition fields; an unlisted (or absent) competition fields clubs. */
export function teamKind(competition: string | undefined): TeamKind {
  return competition !== undefined && Object.hasOwn(TEAM_KIND, competition)
    ? (TEAM_KIND[competition] as TeamKind)
    : 'club';
}

/**
 * Each competition's kind: the supported table's (`league`: the five leagues,
 * whose regular season the stage grammar reads as `REGULAR`; `cup`: the other
 * ten), and `friendly` for `fifa.friendly`, the one competition whose
 * `friendly` slug is the `FRIENDLY` stage.
 */
export const COMPETITION_KIND: Readonly<Record<string, CompetitionKind>> = withExtras<CompetitionKind>(
  SUPPORTED_TABLES.competitionKind,
  (e) => e.kind,
);

/** A competition's kind; an unlisted (or absent) competition is a cup, the kind that asserts nothing. */
export function competitionKind(competition: string | undefined): CompetitionKind {
  return competition !== undefined && Object.hasOwn(COMPETITION_KIND, competition)
    ? (COMPETITION_KIND[competition] as CompetitionKind)
    : 'cup';
}

/**
 * The season NAME a league's regular season is filed under (the table's
 * `seasonSlug`): `2026-27-english-premier-league`, `2026-27-laliga`,
 * `2026-27-italian-serie-a`, `2026-27-german-bundesliga` on the real feed. The
 * year in front varies; the name is this one, matched whole. `mex.1` has none.
 */
export const SEASON_SLUG: Readonly<Record<string, string>> = SUPPORTED_TABLES.seasonSlug;

/** A league's written season name, or undefined (no such name, or not a league). */
export function seasonSlugOf(competition: string | undefined): string | undefined {
  return competition !== undefined && Object.hasOwn(SEASON_SLUG, competition)
    ? SEASON_SLUG[competition]
    : undefined;
}

/**
 * What a competition's standings are, where it is not lettered or numbered
 * GROUPS (the default, also for a competition that is not listed): the
 * table's `standings`.
 *   - `league`: the competition is authorised to serve exactly ONE table (a
 *     season, a league phase). That is a fact about the competition, written
 *     down; it is never inferred from a payload having one child, because a
 *     grouped competition whose payload shrinks to one group is not a league.
 *   - `none`: the competition has no table (knockout from the first round).
 *     The provider then answers with no table list at all, and for such a
 *     competition, and only for one, that is an empty answer rather than an
 *     unreadable one. The canary checks the feed against it: the day it serves
 *     a table, that is a changed shape.
 * Read through {@link standingsShapeOf}, never by a bare index.
 */
export const STANDINGS_SHAPE: Readonly<Record<string, 'league' | 'none'>> = SUPPORTED_TABLES.standingsShape;

/**
 * How a competition's standings payload is read: its written shape, or
 * `groups` for one not written down. By own property: a bare index on the
 * table gave a competition named like a prototype key (`constructor`) the
 * `Object` function as its shape.
 */
export function standingsShapeOf(competition: string | undefined): StandingsShape {
  return competition !== undefined && Object.hasOwn(STANDINGS_SHAPE, competition)
    ? (STANDINGS_SHAPE[competition] as StandingsShape)
    : 'groups';
}

/** Mexico's national team, by the provider's id: a written fact (`espn:203`). */
export const MEXICO_TEAM_ID = 'espn:203';

/**
 * Is this side Mexico's national team: the team the rally cry ("¿Y si sí?")
 * belongs to? The Mexico case of the rally table's rule (`rally.ts`): by
 * IDENTITY, in a competition that fields nations: the provider's id when the
 * side carries one (a present id that is not Mexico's is never Mexico,
 * whatever its labels say), or, for the bundle's id-less Mexico, its code AND
 * its name. A club abbreviated `MEX` never is; neither is Mexico's id read
 * under a club competition.
 */
export function isMexicoNationalTeam(team: Team, kind: TeamKind): boolean {
  return rallyEntryFor(team, kind)?.id === MEXICO_TEAM_ID;
}
