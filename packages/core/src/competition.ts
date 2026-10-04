import { DEFAULT_COMPETITION } from './adapters/espn';
import { t } from './i18n';
import { SUPPORTED, SUPPORTED_TABLES, entryOf } from './supported';
import { humanLabel } from './trust/roles';

// The written kinds of a competition (its teams: nations or clubs; itself: a
// league, a cup or the friendly one) and a league's season name. Facts of the
// competition like the ones below, kept in a leaf module the trust layer can
// import without a cycle (see `kinds.ts`).
export {
  COMPETITION_KIND,
  type CompetitionKind,
  competitionKind,
  isMexicoNationalTeam,
  MEXICO_TEAM_ID,
  SEASON_SLUG,
  seasonSlugOf,
  STANDINGS_SHAPE,
  standingsShapeOf,
  TEAM_KIND,
  type TeamKind,
  teamKind,
} from './kinds';
import { allFixtures } from './schedule';
import type { SeasonInfo } from './types';

/**
 * Where a selection came from: the command line's `--competition` or a tool's
 * `competition` argument (`flag`), `CLAUDINHO_COMPETITION` (`env`), the saved
 * choice (`saved`, 2.5b), or nothing at all (`default`: the bundled World Cup).
 */
export type ChosenBy = 'flag' | 'env' | 'saved' | 'default';

/** A competition a request is for, and where that choice came from. */
export interface SelectedCompetition {
  readonly kind: 'selected';
  /** The provider's slug the request asks for. */
  readonly slug: string;
  /** The table's alias; absent for a raw slug. */
  readonly alias?: string;
  /** What a surface names it: the table's name, or a raw slug as it is. */
  readonly name: string;
  readonly chosenBy: ChosenBy;
  /** A raw slug the table does not hold: the escape hatch, labelled. */
  readonly experimental: boolean;
}

/**
 * What the edge resolved: a competition; a value that is neither an alias nor
 * a slug, REFUSED with the aliases (an unknown value is never a request); or
 * `none`, reserved for "nothing chosen" (never produced while the bundled
 * World Cup is the default).
 */
export type CompetitionSelection =
  | SelectedCompetition
  | { readonly kind: 'refused'; readonly value: string; readonly aliases: string[] }
  | { readonly kind: 'none' };

/**
 * A raw ESPN slug: two or more lower-case segments of letters, digits and
 * underscores, joined by single dots (`fifa.friendly`, `esp.copa_del_rey`:
 * real slugs carry underscores, measured on the feed). Nothing else: no upper
 * case, no space, no leading, trailing or double dot.
 */
const RAW_SLUG = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;
/** The longest raw slug believed, in UTF-16 units. */
const MAX_SLUG_UNITS = 64;

/**
 * The ONE constructor of a selected competition: a slug and where it was
 * chosen, described by the table (its alias and name) or, for a slug the
 * table does not hold, as itself and experimental. The resolver builds every
 * selection through it; an edge that already holds a slug (a config built
 * without the resolver) describes it through it too, never by hand.
 */
export function selectedCompetition(slug: string, chosenBy: ChosenBy): SelectedCompetition {
  const row = entryOf(slug);
  return row
    ? { kind: 'selected', slug: row.slug, alias: row.alias, name: row.name, chosenBy, experimental: false }
    : { kind: 'selected', slug, name: slug, chosenBy, experimental: true };
}

/** One value, from one source: an alias, a slug in the table, a raw slug, or refused. */
function selectionFor(value: string, chosenBy: ChosenBy): CompetitionSelection {
  const row = SUPPORTED.find((e) => e.alias === value) ?? entryOf(value);
  if (row) return selectedCompetition(row.slug, chosenBy);
  if (value.length <= MAX_SLUG_UNITS && RAW_SLUG.test(value)) return selectedCompetition(value, chosenBy);
  return { kind: 'refused', value, aliases: SUPPORTED.map((e) => e.alias) };
}

/**
 * THE EDGE. The one function that decides which competition a request is for,
 * from the values its edge hands in: the flag (`--competition`, a tool's
 * `competition` argument), then the environment (`CLAUDINHO_COMPETITION`), then
 * the saved choice (2.5b), then the bundled World Cup (`chosenBy: 'default'`).
 * The FIRST present source decides (an empty string is absent): a present
 * value that is refused is refused, even when a lower source holds a valid one
 * (what was asked for is not answered with something else).
 *
 * Each value is an alias (`premier-league`), a slug in the table (`eng.1`), or
 * a raw ESPN slug the table does not hold (`fifa.friendly`, `esp.copa_del_rey`:
 * lower-case segments of letters, digits and underscores joined by dots, 64
 * units at most; experimental);
 * anything else (`foo`, `ENG.1`, a space) is refused with the aliases.
 *
 * Core reads NO environment: the edges pass it. It is called where a request
 * ENTERS (the CLI's option resolution, the MCP server's request) and nowhere
 * else. From there the competition travels as a value (on the config, on the
 * adapter), so nothing further down can answer for a different competition
 * halfway through. `core/test/selection-identity.test.ts` fails if a call
 * appears anywhere else.
 */
export function resolveCompetition(explicit?: string, env?: string, saved?: string): CompetitionSelection {
  const sources: ReadonlyArray<readonly [ChosenBy, string | undefined]> = [
    ['flag', explicit],
    ['env', env],
    ['saved', saved],
  ];
  for (const [chosenBy, value] of sources) {
    if (typeof value === 'string' && value !== '') return selectionFor(value, chosenBy);
  }
  return selectionFor(DEFAULT_COMPETITION, 'default');
}

/**
 * The line every competition-answering text answer prints after its header:
 * the competition's name, then where the choice came from when it was the
 * flag or the environment (`from the command line`; on MCP, `from the
 * request`; `from the environment`), then `experimental` for a raw slug. A
 * saved choice and the default print the name alone. The name is not
 * localized; the rest is. Empty for a selection that is not a competition.
 */
export function modeLine(
  selection: CompetitionSelection,
  lang?: string,
  /** What a flag is on this surface: the command line's, or a tool request's argument. */
  flag: 'command' | 'request' = 'command',
): string {
  if (selection.kind !== 'selected') return '';
  const parts = [selection.name];
  if (selection.chosenBy === 'flag') parts.push(t(lang, flag === 'request' ? 'selection.request' : 'selection.flag'));
  else if (selection.chosenBy === 'env') parts.push(t(lang, 'selection.env'));
  if (selection.experimental) parts.push(t(lang, 'selection.experimental'));
  return parts.join(' · ');
}

/** The structured form of a selection: what `--json` and MCP `data` carry. */
export interface CompetitionKey {
  readonly slug: string;
  readonly alias?: string;
  readonly name: string;
  readonly chosenBy: ChosenBy;
  readonly experimental?: true;
}

/**
 * The selection as ONE structured key, `competition`, for every
 * competition-answering structured answer (CLI `--json`, MCP `data`): the
 * alias only when there is one, `experimental` only when true. Nothing for a
 * selection that is not a competition. Every emit site spreads this; none
 * builds the key by hand.
 */
export function selectionExtras(selection: CompetitionSelection): { competition?: CompetitionKey } {
  if (selection.kind !== 'selected') return {};
  return {
    competition: {
      slug: selection.slug,
      ...(selection.alias !== undefined ? { alias: selection.alias } : {}),
      name: selection.name,
      chosenBy: selection.chosenBy,
      ...(selection.experimental ? { experimental: true as const } : {}),
    },
  };
}

/**
 * Why a selection is not a competition, in the reader's language, naming the
 * value (bounded) and the aliases; undefined for a competition. The CLI
 * raises it as an input error, MCP as a tool error, before any request.
 */
export function selectionRefusal(selection: CompetitionSelection, lang?: string): string | undefined {
  if (selection.kind === 'selected') return undefined;
  const aliases = SUPPORTED.map((e) => e.alias).join(', ');
  if (selection.kind === 'refused') {
    return t(lang, 'selection.refused', { value: humanLabel(selection.value, 40), aliases });
  }
  return t(lang, 'selection.none', { aliases });
}

/** The competition whose schedule ships bundled in the clients: the World Cup. */
export const BUNDLE_COMPETITION = DEFAULT_COMPETITION;

let bundleYear: number | undefined;
/**
 * The edition the bundled schedule describes, read from the schedule itself
 * (the year of its first kickoff) rather than written down a second time.
 */
export function bundleSeasonYear(): number {
  if (bundleYear === undefined) {
    const first = allFixtures()
      .map((m) => m.kickoff)
      .sort()[0];
    bundleYear = Number((first ?? '').slice(0, 4));
  }
  return bundleYear;
}

/**
 * Does the bundled schedule describe what this request is about?
 *
 * The competition is an ARGUMENT — the caller's adapter states it — never a
 * default. Off the bundle, every path built on the skeleton (date merge,
 * `match <id>`, `next`, the bracket, the knockout-fixture cache, the market
 * fixture) must not read it: an empty foreign day once showed 104 World Cup
 * fixtures with foreign attribution (audit A03).
 *
 * The bundle is ONE EDITION of its competition. When the provider reported the
 * season a response belongs to and it is a different one, the bundle does not
 * describe that response. With no provider answer (offline, degraded) there is
 * nothing to compare, and the bundle stays what it is: the 2026 edition.
 */
export function bundleApplies(competition: string, season?: SeasonInfo): boolean {
  if (competition !== BUNDLE_COMPETITION) return false;
  return season === undefined || season.year === bundleSeasonYear();
}

/**
 * The competitions that HAVE NO BRACKET: league seasons with no knockout tie of
 * their own, where "no bracket" is the answer, not a gap. Written down in the
 * supported table (`bracket: 'not-applicable'`), one fact each, never inferred
 * from the standings shape (`STANDINGS_SHAPE` says
 * how a table is read, not whether a knockout follows it: `uefa.champions` and
 * `mex.1` read as one league table and both have one).
 *   - `eng.1`: the Premier League; a 38-round league, no play-off.
 *   - `esp.1`: LaLiga; a 38-round league, no play-off.
 * Deliberately NOT here: `ita.1` (championship and relegation play-offs since
 * the FIGC's May 2026 decision), `ger.1` (the relegation play-off), `mex.1`
 * (the Liguilla), `uefa.champions` (a knockout after the league phase). A
 * competition joins by a written fact.
 */
export const NO_BRACKET: ReadonlySet<string> = SUPPORTED_TABLES.noBracket;

/**
 * What `bracket` is for a competition, one of three values:
 *   - `offered`: the bundled competition, whose topology ships in the clients;
 *   - `inapplicable`: the competition has no bracket ({@link NO_BRACKET});
 *   - `unsupported`: it may have one, and it is not offered yet.
 */
export function bracketCapability(competition: string): 'offered' | 'inapplicable' | 'unsupported' {
  if (bundleApplies(competition)) return 'offered';
  return NO_BRACKET.has(competition) ? 'inapplicable' : 'unsupported';
}
