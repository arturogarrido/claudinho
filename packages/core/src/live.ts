/**
 * Shared live-data access: the static bundled schedule is the base truth; live
 * provider state is merged over it by match id. Used by every client (CLI, MCP,
 * notifier) so the overlay logic lives in exactly one place.
 */
import { EspnAdapter, ProviderError } from './adapters/espn';
import { fetchMeta } from './adapters/meta';
import type { ProviderAdapter } from './adapters/types';
import { byKickoff, isFinished, isLive } from './normalize';
import {
  allFixtures,
  fixturesByGroup,
  fixturesByTeam,
  isKnockoutStage,
  LIVE_WINDOW_MS,
  nextFixtureForTeam,
  isUpcoming,
} from './schedule';
import { rosterAtZero, type GroupStandings } from './standings';
import { localDate, shiftUtcDate } from './time';
import type { Match, SeasonInfo, Stage, Team } from './types';
import { isPlaceholderSide } from './bracket/placeholders';
import { buildBracketView } from './bracket/resolve';
import { loadBracketTopology } from './bracket/topology';
import type { BracketResult, BracketView } from './bracket/types';

import { bracketCapability, bundleApplies } from './competition';
import { resolveClub, rosterFor } from './teams';
import { agreedSeason } from './trust/season';
import { isTeam } from './trust/match';
import { humanLabel } from './trust/roles';
import { SCHEDULE_AHEAD_DAYS, SCHEDULE_LOOKBACK_DAYS } from './span';
import { type BetweenEditions, partialOfRead } from './verdict';

/** Provider names {@link makeAdapter} can construct (the CLI validates against this). */
export const KNOWN_SOURCES = ['espn'] as const;

/**
 * Whether a source names a provider {@link makeAdapter} can construct: THE
 * question for every caller that must not ask a provider it does not name (a
 * command's precheck, the refresher, the trigger that starts one).
 */
export function isKnownSource(source: string): boolean {
  return (KNOWN_SOURCES as readonly string[]).includes(source);
}

export interface AdapterOptions {
  /**
   * The competition the adapter will fetch. REQUIRED: the caller is the edge
   * that resolved it (see `resolveCompetition`), and an adapter that picked a
   * default here would be a second place where the competition is decided.
   */
  competition: string;
  /**
   * Enrich group-stage fixtures with their group letter (one extra standings
   * request per poll). Default on; the statusline refresher turns it off because
   * it never renders group letters.
   */
  enrichGroups?: boolean;
  /** Clock, injectable for tests; drives the provider cooldown window. */
  now?: () => number;
}

/**
 * Construct a provider adapter for a `--source` name (default: espn). An
 * unknown source FAILS LOUD instead of silently running ESPN — `--source foo`
 * previously no-op'd, which lied about what the flag did (attribution stayed
 * honest, but the advertised knob did nothing).
 */
export function makeAdapter(source: string, opts: AdapterOptions): ProviderAdapter {
  switch (source) {
    case 'espn':
      return new EspnAdapter({
        competition: opts.competition,
        enrichGroups: opts.enrichGroups,
        now: opts.now,
      });
    default:
      throw new Error(
        `Unknown data source "${source}" (available: ${KNOWN_SOURCES.join(', ')})`,
      );
  }
}

/**
 * Merge live matches over a base set by id. Live entries replace base entries
 * with the same id; unknown ids are appended.
 */
export function mergeLive(base: Match[], live: Match[]): Match[] {
  const byId = new Map(base.map((m) => [m.id, m]));
  for (const m of live) byId.set(m.id, m);
  return [...byId.values()];
}

export interface LiveResult {
  matches: Match[];
  /** True when the provider call failed and we fell back to static data. */
  degraded: boolean;
  /**
   * The live-data provider that served this result (e.g. "espn"), for
   * attribution. Absent when `degraded` — the bundled static schedule, served
   * by no live provider, must not be attributed to one.
   */
  source?: string;
  /**
   * The season the provider reported for the response behind this result.
   * Absent when the provider stated none or the fetch failed, and for a live
   * read at a season turn, whose days state two. A fact about THIS result:
   * `today 2024-06-14` reports the season of that day.
   */
  season?: SeasonInfo;
  /**
   * The read says its competition is between editions (see
   * {@link betweenEditionsOf}): a replacement verdict. The live read's
   * `matches` is then empty (it keeps the matches in play); the dated read
   * keeps the window's records, and states it only when the asked local date
   * holds none of them. Never stated on the bundled competition.
   */
  betweenEditions?: BetweenEditions;
  /**
   * The read behind the result said it was not whole (see
   * `VerdictSource.partial`): the provider sent records the result does not
   * hold. `omitted` is how many, when the read knew it. Absent for a whole
   * read, for an adapter that said nothing about its answer, and for a failed
   * read (which is `degraded`).
   */
  partial?: { omitted?: number };
  /**
   * The dated read only: the bundled skeleton was merged under the provider's
   * records (the bundled competition, and no season stated or the bundle's
   * own). The day's list is then the bundle's, whole, and a fixture whose
   * record was left out shows without its live state; without it, a record
   * left out is simply absent. Request-local: never written to a cache.
   */
  skeleton?: true;
  /**
   * The dated read only, when it succeeded: the ids of the records the
   * provider's window held (what the overlay served). A surface compares it
   * with the fixtures it displays (see `dayAttribution`). Request-local: never
   * written to a cache.
   */
  served?: readonly string[];
}

/**
 * The clock a read counts by when its caller gave none: the adapter's, when
 * it states one (a test injects it there), else the wall clock.
 */
function clockOf(adapter: ProviderAdapter): Date {
  return new Date(adapter.now?.() ?? Date.now());
}

/**
 * The provider's calendar day (`YYYY-MM-DD`) for an instant; the UTC day when
 * the adapter states none; '' for an instant that is not one (it files under
 * no day).
 */
function providerDayOf(adapter: ProviderAdapter, instant: Date): string {
  if (Number.isNaN(instant.getTime())) return '';
  return adapter.bucketDay?.(instant) || instant.toISOString().slice(0, 10);
}

/**
 * BETWEEN EDITIONS: the one rule, for every read that can state it (the dated
 * read, the live read, `next` and `match` off the bundle, each from the read
 * it actually made). Stated exactly when:
 *   (a) the read succeeded and said it was WHOLE (an incomplete read may have
 *       left out the very record that contradicts it);
 *   (b) its season states an end date, which a composed season keeps only
 *       when every stating response stated the same one (`agreedSeason`);
 *   (c) the provider's day of that end date is STRICTLY before the day asked
 *       (the end day itself is still the edition's). That day is what is
 *       stated (`ended`). It is the provider's STATED season end, an
 *       administrative date, not the last match: on the real feed the World
 *       Cup's slug states Dec 31 and league seasons follow each other, so the
 *       sentence is said where the provider says a season ended and no next
 *       one has started;
 *   (d) the surface has nothing to present. Nothing in the whole read, before
 *       the surface's own filter, is scheduled or in play (a fixture of ANY
 *       club still to be played means the competition is not between
 *       editions). For the live read, `next` and `match`, a finished,
 *       cancelled or postponed record (the previous final, inside the
 *       lookback) does not block it: it is neither current nor their answer.
 *       For the DATED read the body is the asked LOCAL date's records (`onDate`,
 *       the viewer's zone): any record on that date, a finished result
 *       included, is that day's body and blocks it. So a UTC viewer asking the
 *       final's UTC date (the day after the provider's end day) sees the final,
 *       and the day after says "between editions".
 * A verdict about a RESPONSE, not a competition: the day a dormant slug states
 * its next edition, it stops being said. Never on the bundled competition,
 * whose edition the bundle decides.
 */
function betweenEditionsOf(
  adapter: ProviderAdapter,
  read: { readonly complete?: boolean; readonly season?: SeasonInfo } | undefined,
  records: readonly Match[],
  dayAsked: string,
  onDate: readonly Match[] = [],
): BetweenEditions | undefined {
  if (bundleApplies(adapter.competition)) return undefined;
  if (onDate.length > 0) return undefined;
  if (read?.complete !== true) return undefined;
  const endDate = read.season?.endDate;
  if (!endDate) return undefined;
  // The provider's END DAY: what the rule decides on, and what is stated (an
  // instant at 03:59Z on Oct 9 is the provider's Oct 8).
  const ended = providerDayOf(adapter, new Date(endDate));
  if (!ended) return undefined;
  if (!(ended < dayAsked)) return undefined;
  if (records.some((m) => m.status === 'SCHEDULED' || isLive(m.status))) return undefined;
  const label = read.season?.label;
  return label ? { ended, label } : { ended };
}

/** Human label for a live-data provider name (attribution). Text only. */
export function liveSourceLabel(source: string): string {
  const known: Record<string, string> = { espn: 'ESPN' };
  return known[source] ?? source.charAt(0).toUpperCase() + source.slice(1);
}

/**
 * Matches for a date, preferring live provider data, falling back to the static
 * schedule on any provider/network error (graceful degradation).
 *
 * Off the bundled competition there is no skeleton to merge, so the window is
 * asked ACROSS a season turn, as the live read asks it: on a turn day its
 * three days state two seasons, the records are served as they are, each on
 * its own day, and the result states no season. On the bundle it is asked
 * strictly: two seasons there would let the skeleton merge over another
 * edition's day, and the refusal protects it. Off the bundle a read whose
 * edition ended before the asked date, with nothing current in it and NOTHING
 * on the asked local date, says "between editions" ({@link betweenEditionsOf});
 * a date on or before the end day is a historical question, answered as asked.
 * `matches` is the window's records in every case: the surface files them by
 * the viewer's date.
 *
 * The result also says what it is made of: `partial` when the window said it
 * was not whole (the count when it knew it), `skeleton` when the bundled
 * schedule was merged under the records, and `served`, the ids the window
 * held. The last two are request-local: a surface reads them to attribute the
 * day it displays (`dayAttribution`) and to say what an empty day means.
 *
 * `tz` is the viewer's zone, the one the surface files the records by (pass
 * the same effective zone: `resolveTz`). A caller that names none asks in the
 * provider's zone, the days the window is counted in.
 */
export async function getMatchesForDate(
  adapter: ProviderAdapter,
  dateISO: string,
  tz?: string,
): Promise<LiveResult> {
  const day = dateISO.slice(0, 10);
  const merges = bundleApplies(adapter.competition);
  try {
    // A local calendar day can straddle two adjacent UTC dates (a 01:00Z
    // kickoff is the previous evening in the Americas). Callers group by the
    // *local* date, so ask for a ±1-day window (the adapter composes it: the
    // provider refuses date ranges) and merge by id. Asking only for `day`
    // would leave a boundary match showing from the static schedule with no
    // live score.
    const live = adapter.fetchWindow
      ? merges
        ? await adapter.fetchWindow(shiftUtcDate(day, -1), shiftUtcDate(day, 1))
        : await adapter.fetchWindow(shiftUtcDate(day, -1), shiftUtcDate(day, 1), { acrossSeasons: true })
      : await adapter.fetchByDate(day);
    const meta = fetchMeta(live);
    const season = meta?.season;
    // The asked local date's records: what the surface will present as the day.
    const onDate = live.filter(
      (m) => (tz ? localDate(m.kickoff, tz) : providerDayOf(adapter, new Date(m.kickoff))) === day,
    );
    const between = betweenEditionsOf(adapter, meta, live, day, onDate);
    // The skeleton is merged ONLY when it is this competition's schedule AND
    // this response's edition; otherwise the day is whatever the provider
    // served, and nothing else (A03). The result says which (`skeleton`): on a
    // read that was not whole, a merged day is still whole (a fixture whose
    // record was left out shows without its live state), and an unmerged one
    // simply lacks the record.
    const merged = bundleApplies(adapter.competition, season);
    return {
      matches: mergeLive(merged ? allFixtures() : [], live),
      degraded: false,
      source: adapter.name,
      ...(season ? { season } : {}),
      ...(between ? { betweenEditions: between } : {}),
      ...partialOfRead(meta),
      ...(merged ? { skeleton: true as const } : {}),
      // What the overlay held, for the day's attribution (`dayAttribution`).
      served: live.map((m) => m.id),
    };
  } catch {
    // No provider answer: nothing reported a season, so the bundle stays what
    // it is — the edition it was built from.
    const merged = bundleApplies(adapter.competition);
    return { matches: merged ? allFixtures() : [], degraded: true, ...(merged ? { skeleton: true as const } : {}) };
  }
}

export interface StandingsResult {
  /** The tables, sorted by key (`A`, `A1`, `A-B`, `LEAGUE`); each table's rows in standings order. */
  tables: GroupStandings[];
  /** True when no authoritative table was available; tables may be a static roster or empty. */
  degraded: boolean;
  /** Provider that served the authoritative result, including an empty one (absent when degraded). */
  source?: string;
  /**
   * The verdict of an ALL-TABLES read whose provider sent a table that could
   * not be read: `tables` holds the ones that were, and is not the whole
   * competition. Never set on a keyed read: a table that was found was read
   * (it says `partial` itself if rows are missing), and one that was not found
   * while a table may be missing is `degraded`, not "no such group".
   */
  incomplete?: true;
}

/**
 * Authoritative group tables, preferring the provider's cumulative standings and
 * FAILING CLOSED when none is available. An adapter with explicit bundled-
 * roster compatibility may use the roster-at-zero; otherwise it returns an
 * empty degraded result because expected group letters alone do not prove the
 * bundle belongs to the same competition.
 *
 * Deliberately does NOT compute a table from a live-match window: that silently
 * drops earlier matchdays and reports a wrong, partial table (e.g. all-zeros for
 * a group not playing today) — the bug this replaced. A degraded roster is
 * explicitly zeroed; a confidently-wrong table is the failure mode we refuse.
 *
 * An empty `tables` with `degraded: false` means either the fetch succeeded but
 * the asked-for group wasn't in it, or the group is definitively outside the
 * adapter's declared scope (caller renders "no such group"). A group declared
 * in that expected scope but omitted from a partial
 * provider result takes the degraded fallback instead of rendering as an
 * authoritative empty table. An aggregate read also falls back when any group
 * in that scope is absent; one result-level verdict cannot honestly describe a
 * mix of live tables and static roster tables. Transport failure without
 * explicit bundled-roster compatibility stays empty and degraded; it must
 * never borrow the bundled World Cup roster.
 *
 * `group` is a table KEY (`A`, `A1`, `A-B`, `LEAGUE`), matched in any case.
 *
 * Two different things can be "not whole". A table whose rows were refused is
 * `partial` (on the table). A provider result from which a whole TABLE is
 * missing has an incomplete inventory (`fetchMeta`), and what that means
 * depends on what was asked:
 *   - with an expected scope, the scope decides, as above (and a table outside
 *     it is not shown);
 *   - without one, an all-tables read returns the tables that were read and
 *     says `incomplete` (when NO table was read it is `degraded`: there is
 *     nothing to qualify); a keyed read returns the table if it was read, and
 *     is `degraded` if it was not: the missing table may be the one asked for.
 */
export async function getStandings(
  adapter: ProviderAdapter,
  group?: string,
): Promise<StandingsResult> {
  const want = group?.toUpperCase();
  const expected = adapter.expectedStandingsGroups;
  if (want && expected && !expected.includes(want)) {
    return { tables: [], degraded: false };
  }
  if (adapter.fetchStandings) {
    try {
      const all = await adapter.fetchStandings();
      // With an expected scope a table outside it is not this competition's.
      const inScope = expected ? all.filter((t) => expected.includes(t.group)) : all;
      const tables = (want ? inScope.filter((t) => t.group === want) : [...inScope]).sort((a, b) =>
        a.group.localeCompare(b.group),
      );
      if (expected) {
        const availableGroups = new Set(tables.map((table) => table.group));
        const expectedGroupWasOmitted = want
          ? expected.includes(want) && tables.length === 0
          : expected.some((group) => !availableGroups.has(group));
        if (!expectedGroupWasOmitted) {
          return { tables, degraded: false, source: adapter.name };
        }
      } else {
        const inventoryComplete = fetchMeta(all)?.inventoryComplete !== false;
        // What was read is returned: every table with the verdict that some
        // are missing, or the one table that was asked for (no verdict about
        // the batch: it was read, and says `partial` itself if rows are
        // missing). NOTHING read while a table is missing is neither "no such
        // group" nor an empty answer that says it is not whole: it is
        // unavailable, for any adapter, and takes the fallback below.
        if (tables.length > 0 || inventoryComplete) {
          return {
            tables,
            degraded: false,
            source: adapter.name,
            ...(!want && !inventoryComplete ? { incomplete: true as const } : {}),
          };
        }
      }
    } catch {
      // fall through to the degraded fallback
    }
  }
  const fallbackGroups = adapter.standingsFallbackGroups;
  const letters = fallbackGroups
    ? want
      ? fallbackGroups.includes(want)
        ? [want]
        : []
      : [...new Set(fallbackGroups)].sort((a, b) => a.localeCompare(b))
    : [];
  const tables = letters
    .map((g) => ({ group: g, rows: rosterAtZero(fixturesByGroup(g)) }))
    .filter((t) => t.rows.length > 0);
  return { tables, degraded: true };
}

/**
 * Knockout-phase UTC window for a single live overlay fetch (first knockout
 * kickoff through the final), DERIVED from the bundled schedule — never a
 * hardcoded calendar. This keeps the `CLAUDINHO_COMPETITION` repurposing seam
 * honest (a future bundle for another tournament resolves its own window) and
 * can't rot after this tournament ends. For the 2026 bundle it derives to
 * exactly the former literals (20260628–20260719); a parity test pins that.
 * `null` when the bundle has no knockout fixtures — callers skip the overlay.
 */
let knockoutWindowMemo: { start: string; end: string } | null | undefined;
export function knockoutWindow(): { start: string; end: string } | null {
  if (knockoutWindowMemo !== undefined) return knockoutWindowMemo;
  const days = allFixtures()
    .filter((m) => isKnockoutStage(m.stage))
    .map((m) => m.kickoff.slice(0, 10).replace(/-/g, ''))
    .filter((d) => d.length === 8);
  knockoutWindowMemo = days.length
    ? {
        start: days.reduce((a, b) => (a < b ? a : b)),
        end: days.reduce((a, b) => (a > b ? a : b)),
      }
    : null;
  return knockoutWindowMemo;
}

/**
 * Knockout bracket with hybrid slot resolution: confirmed FT winners/losers from
 * the live overlay; group slots project from live standings once a group has started.
 */
export async function getBracket(
  adapter: ProviderAdapter,
  opts: { stage?: Stage; lang?: string } = {},
): Promise<BracketResult> {
  // A capability with three values (see `bracketCapability`). Off the bundle
  // there is no topology, no fetch and no attribution either way; what differs
  // is what the reader is told. A league season with no knockout tie of its
  // own HAS no bracket (`inapplicable`); any other competition may have one we
  // do not offer yet (`unsupported`, audit A03).
  const capability = bracketCapability(adapter.competition);
  if (capability === 'inapplicable') {
    const view: BracketView = { stages: [], degraded: false, standingsDegraded: false, inapplicable: true };
    return { view, degraded: false, standingsDegraded: false, inapplicable: true };
  }
  if (capability === 'unsupported') {
    const view: BracketView = { stages: [], degraded: false, standingsDegraded: false, unsupported: true };
    return { view, degraded: false, standingsDegraded: false, unsupported: true };
  }
  const topology = loadBracketTopology();
  const base = allFixtures().filter((m) => isKnockoutStage(m.stage));

  let matches = base;
  let liveDegraded = true;
  let source: string | undefined;
  /** The window's own verdict on its answer, when it said the answer was not whole. */
  let partial: { partial?: { omitted?: number } } = {};

  // No window capability (or no window) means no overlay fetch happened, so
  // the result is degraded and attributes no provider — the bundled skeleton
  // is not a successful fetch (audit A06; mirrors getKnockoutFixtures).
  const win = knockoutWindow();
  if (adapter.fetchWindow && win) {
    try {
      const live = await adapter.fetchWindow(win.start, win.end);
      matches = mergeLive(base, live);
      liveDegraded = false;
      source = adapter.name;
      partial = partialOfRead(fetchMeta(live));
    } catch {
      // static skeleton only
    }
  }

  const standings = await getStandings(adapter);
  // Standings can attribute a bracket whose overlay is missing ONLY when they
  // actually served a table the group slots project from. A successful but
  // EMPTY read contributed no bracket fact, so it names no provider — otherwise
  // "structure only" and "Live data: ESPN" print together (review P2, A06).
  if (!source && !standings.degraded && standings.source && standings.tables.length > 0) {
    source = standings.source;
  }

  const view = buildBracketView(
    topology,
    matches,
    standings.tables,
    standings.degraded,
    liveDegraded,
    opts.stage,
    opts.lang,
  );
  if (source) view.source = source;

  return {
    view,
    degraded: liveDegraded,
    standingsDegraded: standings.degraded,
    source,
    // The ties that were read are in the view; the verdict says the window
    // held more than that. Never `degraded`: the read succeeded.
    ...partial,
  };
}


export interface MatchByIdResult {
  match?: Match;
  degraded: boolean;
  source?: string;
  /** Off the bundle a fixture list to look an id up in does not exist yet (audit A03). */
  unsupported?: true;
  /**
   * Off the bundle: the span searched for an id that a WHOLE read did not
   * hold, in the provider's calendar days (`YYYY-MM-DD`, discovery's span:
   * yesterday to 14 days ahead). "Not found in this window" is not "no such
   * match": a plain field of the answer, not a verdict.
   */
  window?: { from: string; to: string };
  /**
   * The read behind the answer was not whole (see `VerdictSource.partial`):
   * an absent id is then not known to be absent, and a found record's refresh
   * left a record out.
   */
  partial?: { omitted?: number };
  /** The read's edition ended and nothing in it is current (a replacement verdict). */
  betweenEditions?: BetweenEditions;
  /**
   * On the bundle, when the read succeeded: the ids of the records its window
   * held (what the overlay served), as the dated read states them. A shown
   * match not among them is the bundled schedule's row, its live state
   * unconfirmed: the surfaces say so through the day's rule
   * (`dayAttribution`). Request-local: never written to a cache. Not a verdict.
   */
  served?: readonly string[];
  /**
   * Off the bundle, with `degraded`: `match` is the provider's own EARLIER
   * record (read by discovery in this command), whose state could not be
   * refreshed: the refresh failed, or did not hold it. Not the bundled
   * schedule, which is what a degraded match is on the bundle. Says which
   * not-live sentence a surface prints; not a verdict.
   */
  earlierRecord?: true;
}

/** The not-live sentence for a match that is the provider's earlier record (`earlierRecord`): English, one copy for the MCP text and the share card. */
export const EARLIER_RECORD_NOTE = "(Live state could not be refreshed — showing the provider's earlier record.)";

/**
 * Extra slack past the static live window for team-query candidate selection:
 * a knockout match in extra time + penalties runs to ~kickoff + 180 min, well
 * past LIVE_WINDOW_MS (140). The slack only widens which fixture we *check*
 * with a live overlay — the overlay's status, not the clock, then decides.
 */
const EXTRA_TIME_SLACK_MS = 60 * 60_000;

/**
 * The fixture a team-scoped MARKET query should be about, live-confirmed.
 * Static window math alone fails twice at the edges: a match in extra time
 * (now > kickoff + 140min, still LIVE) would be skipped for next week's
 * fixture, and a just-finished match (inside the window, already FT) would be
 * selected over the next one. So: pick the in-window candidate using a widened
 * window, overlay live state, and fall through to the next fixture when the
 * overlay says the candidate is finished. Degraded fetches keep the static
 * candidate (fail-closed: the market-relevance gate then errs toward showing
 * nothing rather than something wrong).
 */
export async function marketFixtureForTeam(
  adapter: ProviderAdapter,
  code: string,
  now: Date = new Date(),
): Promise<MatchByIdResult> {
  if (!bundleApplies(adapter.competition)) return { match: undefined, degraded: false, unsupported: true };
  const nowMs = now.getTime();
  // Overlay the live knockout window so a knockout team's fixtures RESOLVE — the
  // bundle's KO slots are 🏳️ placeholders, so a purely static lookup answers "no
  // upcoming fixture" for a team past its group stage (same root cause as
  // getNextFixtureForTeam). Fail closed to the static skeleton on a provider error.
  let fixtures = allFixtures();
  // No window capability (or no window) means the knockout overlay was never
  // fetched: a knockout tie may be unresolvable and the skeleton is not a
  // successful fetch — the same rule as getBracket/getNextFixtureForTeam
  // (audit A06, sibling found by the call-site sweep).
  let overlayFailed = false;
  /** The knockout window's verdict on its answer (nothing when it was whole, said nothing, or failed). */
  let windowRead: { partial?: { omitted?: number } } = {};
  const win = knockoutWindow();
  if (adapter.fetchWindow && win) {
    try {
      const live = await adapter.fetchWindow(win.start, win.end);
      fixtures = mergeLive(fixtures, live);
      windowRead = partialOfRead(fetchMeta(live));
    } catch {
      overlayFailed = true; // KO overlay unavailable — a knockout tie may be unresolvable
    }
  } else {
    overlayFailed = true;
  }
  const candidate = fixturesByTeam(code, fixtures).find((m) => {
    const k = Date.parse(m.kickoff);
    return nowMs >= k && nowMs <= k + LIVE_WINDOW_MS + EXTRA_TIME_SLACK_MS;
  });
  /** The candidate's own-day refresh's verdict, when one was made. */
  let refreshRead: { partial?: { omitted?: number } } = {};
  if (candidate) {
    // The refresh's verdict is merged with the window's below; what it served
    // describes the refresh alone, not the market answer, and is not kept.
    const { partial, served: _served, ...r } = await getMatchById(adapter, candidate.id);
    refreshRead = partial ? { partial } : {};
    // A second read that fails hands back the BUNDLED fixture, which for a
    // knockout tie is a placeholder. The candidate came from the overlay that
    // did answer: keep it, and keep the failure's `degraded`.
    const m = r.degraded ? candidate : (r.match ?? candidate);
    if (!isFinished(m.status)) return { ...r, match: m, ...bothReads(windowRead, refreshRead) };
    // Confirmed finished → the team's market story has moved on.
  }
  const next = nextFixtureForTeam(code, { from: now, fixtures });
  // When the overlay fetch failed the static skeleton can't resolve a knockout
  // tie, so flag degraded — lets a caller say "feed unavailable" rather than the
  // misleading "no upcoming fixture" for a team past its group stage. Whatever
  // is returned, the reads it was chosen from say whether they were whole.
  return { match: next, degraded: overlayFailed, ...bothReads(windowRead, refreshRead) };
}

/**
 * The `partial` verdict of an answer chosen from two reads (the knockout
 * window, then a candidate's own day): stated when EITHER read stated it.
 * The counts are SUMMED, over the responses, like the window's own count (a
 * fixture in two parts counts its second copy): a record both reads refused
 * counts in each. An upper bound on the records left out, never a lower one
 * (the larger of the two under-counted when the reads refused different
 * records). Stated with no count when a read that stated the verdict did not
 * know its count. A read that failed, was whole, or said nothing contributes
 * nothing.
 */
function bothReads(
  ...reads: ReadonlyArray<{ partial?: { omitted?: number } }>
): { partial?: { omitted?: number } } {
  const stated = reads.flatMap((r) => (r.partial ? [r.partial] : []));
  if (stated.length === 0) return {};
  let omitted: number | undefined = 0;
  for (const p of stated) omitted = omitted === undefined || p.omitted === undefined ? undefined : omitted + p.omitted;
  return partialOfRead({ complete: false, omitted });
}

export interface NextFixtureResult {
  fixture?: Match;
  /** True when the live overlay fetch failed and only the static skeleton was used. */
  degraded: boolean;
  /** The provider that served the live overlay (absent when degraded). */
  source?: string;
  /** Off the bundle "next" is built on a schedule we do not have yet (audit A03). */
  unsupported?: true;
  /**
   * Off the bundle: the query as asked, bounded as a label. What the answer's
   * sentences name when no team was resolved.
   */
  query?: string;
  /** Off the bundle: the club the query resolved to (by its provider id). */
  team?: Team;
  /** Off the bundle: two or more clubs matched the query; no fixture is picked. */
  candidates?: Team[];
  /**
   * The roster the competition has holds no team by that name (a replacement
   * verdict): off the bundle the table read whole and a whole read of the
   * span; on the World Cup the bundled nations (`nationArg`).
   */
  unknownTeam?: true;
  /** What `unknownTeam` rests on, which its sentence names (see `VerdictSource.rosterEvidence`). */
  rosterEvidence?: 'table' | 'bundle';
  /**
   * Off the bundle: the roster was asked for and could not be read whole (a
   * table missing or partial, a row with no id, or no answer), and the query
   * matched no club, or only by a code or a fuzzy name that the unread rest
   * may share. A replacement verdict, not an outage: the provider answered.
   */
  rosterIncomplete?: true;
  /**
   * Off the bundle: a WHOLE read of the span held no fixture for the club. The
   * span in provider days ahead (discovery's): a plain field of the answer,
   * whose sentence is the empty body's own text, never a verdict.
   */
  horizon?: { days: number };
  /** Off the bundle: the read's edition ended and nothing in it is current (a replacement verdict). */
  betweenEditions?: BetweenEditions;
  /** Off the bundle: the season the discovery stated, when it stated one. */
  season?: SeasonInfo;
  /**
   * The knockout window said its answer was not whole: a record it was sent
   * is not in it (see `VerdictSource.partial`). `fixture` is still what was
   * read; a team whose tie was the record left out has none, and that is not
   * "eliminated". Absent when the window was whole, failed, or said nothing.
   */
  partial?: { omitted?: number };
}

/**
 * A team's next UPCOMING fixture, LIVE-RESOLVED across the knockout phase.
 *
 * The bundled schedule's knockout slots are resultless placeholders (home/away
 * are slot refs like "Group A winner", never a nation — see
 * {@link sanitizeBundledFixture}), so a purely static lookup goes blind the
 * moment a team's last GROUP game passes: `next MEX` answers "no upcoming
 * fixture" even after ESPN has confirmed Mexico's Round-of-32 tie. Overlay the
 * live knockout window (the SAME window {@link getBracket} asks for) so the
 * merged set carries the resolved nations, then pick the team's next fixture
 * with kickoff ≥ now. (Strictly upcoming — the in-play match is `getLiveMatches`'
 * job, preserving the pre-overlay `next` semantics.)
 *
 * Fails closed: on any provider error it falls back to the static result
 * (`degraded: true`), so a feed outage degrades to "no fixture" rather than
 * inventing one — advancement is never read from the static skeleton.
 */
export async function getNextFixtureForTeam(
  adapter: ProviderAdapter,
  code: string,
  now: Date = new Date(),
): Promise<NextFixtureResult> {
  if (!bundleApplies(adapter.competition)) return nextOffBundle(adapter, code, now);
  const base = allFixtures();
  let matches = base;
  let degraded = true;
  let liveById: Set<string> | undefined;
  let partial: { partial?: { omitted?: number } } = {};
  // Without a window capability nothing was fetched: stay degraded, attribute
  // nothing (audit A06; mirrors getKnockoutFixtures).
  const win = knockoutWindow();
  if (adapter.fetchWindow && win) {
    try {
      const live = await adapter.fetchWindow(win.start, win.end);
      matches = mergeLive(base, live);
      degraded = false;
      liveById = new Set(live.map((m) => m.id));
      partial = partialOfRead(fetchMeta(live));
    } catch {
      // Static skeleton only — fail closed; never invent a knockout pairing.
    }
  }
  // Strictly the next UPCOMING fixture (kickoff ≥ now), preserving the pre-overlay
  // `next` semantics — the in-play match is `live`'s job, not `next`'s. With a
  // window that was not whole, the tie of a team whose record was left out is
  // the bundle's placeholder, which carries slot codes, never the team's: it
  // is not selected, and the answer is "none read" with the verdict.
  const fixture = nextFixtureForTeam(code, { from: now, fixtures: matches });
  // Attribute the provider only when the live overlay actually served the chosen
  // fixture — a static group game (not in the knockout-window fetch) is not
  // "Live data: ESPN". Mirrors getMatchById's hit-based attribution.
  const source = fixture && liveById?.has(fixture.id) ? adapter.name : undefined;
  return { fixture, degraded, source, ...partial };
}

/** A fixture `next` may answer with: not finished, cancelled or postponed (a match in play is). */
function stillToComplete(m: Match): boolean {
  return m.status === 'SCHEDULED' || isLive(m.status);
}

/**
 * `next <club>` off the bundled competition, in this order:
 *   1. the schedule ahead (discovery: one or two month requests; ONE read per
 *      command, reused for the roster of a competition with no table and for
 *      the fixture). Failed: `degraded`, never "no fixture";
 *   2. between editions, asked of that read BEFORE any club is resolved: a
 *      fixture of ANY club still to be played means it is not;
 *   3. the roster (`rosterFor`, after discovery: the adapter's shared
 *      standings read serves both) and the resolution (`resolveClub`):
 *      `ambiguous` is the candidates and no fixture; `unknown` is a
 *      replacement verdict; `unresolved` with a table asked for (not read
 *      whole, or a row with no id) is the `rosterIncomplete` verdict, and with
 *      no table it is `degraded` when the query matched a club the read cannot
 *      identify, else a club the read decides about, like a known one;
 *   4. the fixture: the club's earliest by kickoff that is not finished,
 *      cancelled or postponed (in play included, with its score), selected by
 *      `isTeam` with the resolved team (equal ids decide when both carry one;
 *      a side with another club's id is never this club's fixture);
 *   5. a read that was not whole: the fixture with `partial`, or none with
 *      `partial` and no horizon (none READ is not none);
 *   6. a whole read and none: `horizon`, the span's days ahead.
 */
async function nextOffBundle(adapter: ProviderAdapter, asked: string, now: Date): Promise<NextFixtureResult> {
  const query = humanLabel(asked, 40);
  const named = query ? { query } : {};
  const discovery = await getScheduleAhead(adapter, now);
  if (discovery.degraded) return { degraded: true, ...named };
  const season = discovery.season ? { season: discovery.season } : {};
  const between = betweenEditionsOf(adapter, discovery, discovery.fixtures, providerDayOf(adapter, now));
  if (between) return { degraded: false, ...named, ...season, betweenEditions: between };

  const roster = await rosterFor(adapter);
  const resolution = resolveClub(query, roster, discovery.fixtures);
  if (resolution.outcome === 'ambiguous') {
    return { degraded: false, ...named, ...season, candidates: resolution.candidates };
  }
  if (resolution.outcome === 'unknown') {
    // "No such team" is claimed only from a WHOLE read: a refused record of an
    // incomplete one may be the club's fixture (a club in no table, out in a
    // qualifying round). Not whole: the partial empty body, as for a known
    // club with nothing read.
    if (discovery.complete !== true) {
      return { degraded: false, ...named, ...season, ...partialOfRead({ complete: false, omitted: discovery.omitted }) };
    }
    return { degraded: false, ...named, ...season, unknownTeam: true, rosterEvidence: 'table' };
  }
  if (resolution.outcome === 'unresolved' && roster.tableAsked) {
    // Not knowing is not "no such team": the roster could not be read whole.
    // Nor is it an outage: the provider answered (its own verdict).
    return { degraded: false, ...named, ...season, rosterIncomplete: true };
  }
  if (resolution.outcome === 'unresolved' && resolution.idless.length > 0) {
    // A club the read holds but cannot identify (no table, no id) is not "no
    // fixture within the span".
    return { degraded: true, ...named, ...season };
  }
  const team = resolution.outcome === 'resolved' ? resolution.team : undefined;
  const fixture = team
    ? discovery.fixtures.find((m) => stillToComplete(m) && (isTeam(m.home, team) || isTeam(m.away, team)))
    : undefined;
  const whole = discovery.complete === true;
  return {
    degraded: false,
    ...named,
    ...(team ? { team } : {}),
    ...season,
    ...(fixture ? { fixture, source: adapter.name } : {}),
    ...(whole ? {} : partialOfRead({ complete: false, omitted: discovery.omitted })),
    ...(whole && !fixture ? { horizon: { days: SCHEDULE_AHEAD_DAYS } } : {}),
  };
}

export interface KnockoutFixturesResult {
  /** Resolved (both nations known) upcoming knockout fixtures, sorted by kickoff. */
  fixtures: Match[];
  /** True when the overlay fetch failed — caller must NOT cache this as "none". */
  degraded: boolean;
  /** Off the bundle there is no knockout window to fetch (audit A03). */
  unsupported?: true;
  /**
   * The season the provider reported for THIS response (absent when it stated
   * none, or on failure). The fixtures belong to it — which need not be the
   * season a live read made in the same breath answered for.
   */
  season?: SeasonInfo;
  /**
   * False when the provider sent records this result does not hold (one it
   * could not read, or two that contradict each other). A fixture that is
   * absent from such a result is not known to be gone: a caller that keeps a
   * previous answer must not let this one erase it. Absent or true otherwise.
   */
  complete?: boolean;
  /**
   * Stated only with `complete: false`: the id of every fixture this answer
   * DID read, whatever became of it. `fixtures` holds the ties that are
   * resolved and still to be played; a tie the provider postponed, cancelled,
   * started, un-resolved or moved outside the span was read and set aside (the
   * last by the window itself: see `FetchMeta.mentioned`). A caller keeping a
   * previous answer must ask "was it read?" of this list, not of `fixtures`,
   * or it puts back what the provider just took away.
   */
  mentioned?: readonly string[];
  /**
   * The verdict a surface prints for `complete: false` (see
   * `VerdictSource.partial`), with the count of records left out when the
   * window knew it. Stated exactly when `complete` is false.
   */
  partial?: { omitted?: number };
}

/**
 * The RESOLVED upcoming knockout fixtures from the live overlay — the data the
 * hot-path statusline can't fetch itself but needs to show a real next-match
 * countdown (e.g. "🇲🇽 vs 🇪🇨 in 2d") instead of a 🏳️ placeholder. The cold-path
 * refresher calls this and caches the result; the statusline reads the cache.
 *
 * Returns only fixtures where BOTH sides are resolved (neither is the 🏳️ placeholder) and kickoff
 * ≥ now, so a slot ESPN hasn't filled yet is simply absent (the statusline then
 * fails closed to "⚽ —", never a placeholder). **Fails closed with
 * `degraded: true` on a provider error** — the caller must keep its prior cached
 * fixtures rather than cache an empty list as a real "no knockouts" (a transient
 * outage must never read as "your team is out").
 */
export async function getKnockoutFixtures(
  adapter: ProviderAdapter,
  now: Date = new Date(),
): Promise<KnockoutFixturesResult> {
  if (!bundleApplies(adapter.competition)) return { fixtures: [], degraded: true, unsupported: true };
  const win = knockoutWindow();
  if (!adapter.fetchWindow || !win) return { fixtures: [], degraded: true };
  let live: Match[];
  try {
    live = await adapter.fetchWindow(win.start, win.end);
  } catch {
    return { fixtures: [], degraded: true };
  }
  const fixtures = live
    .filter(
      (m) =>
        isKnockoutStage(m.stage) &&
        isUpcoming(m, now) &&
        !isPlaceholderSide(m.home) &&
        !isPlaceholderSide(m.away),
    )
    .sort(byKickoff);
  const meta = fetchMeta(live);
  return {
    fixtures,
    degraded: false,
    ...(meta?.season ? { season: meta.season } : {}),
    // What the answer READ is the window's own account when it returned less
    // than it read (a tie moved outside the span, a second copy).
    ...(meta?.complete === false
      ? { complete: false, mentioned: meta.mentioned ?? live.map((m) => m.id) }
      : {}),
    ...partialOfRead(meta),
  };
}

/**
 * A single match by id, with live overlay. The provider's scoreboard buckets
 * days in its own zone (ESPN: US/Eastern), so a fixture's UTC date can differ
 * from the scoreboard day it's filed under — a 02:00Z kickoff belongs to the
 * previous ET evening, and fetching only the UTC date silently misses its live
 * state (the match then renders from the static schedule as if scheduled).
 * Fetch the ±1-day window around the fixture's UTC date instead — the same
 * trick `getMatchesForDate` uses — and fall back to the static fixture on any
 * provider error.
 */
export async function getMatchById(
  adapter: ProviderAdapter,
  id: string,
  now?: Date,
): Promise<MatchByIdResult> {
  if (!bundleApplies(adapter.competition)) return matchOffBundle(adapter, id, now ?? clockOf(adapter));
  const base = allFixtures().find((m) => m.id === id);
  if (!base) return { match: undefined, degraded: false };
  const day = base.kickoff.slice(0, 10);
  try {
    const live = adapter.fetchWindow
      ? await adapter.fetchWindow(shiftUtcDate(day, -1), shiftUtcDate(day, 1))
      : await adapter.fetchByDate(day);
    const hit = live.find((m) => m.id === id);
    // Attribute the provider only when live data actually served the match —
    // a static fixture rendered after a successful-but-missing fetch is not
    // "Live data: ESPN". The window's own verdict rides beside it: a record it
    // left out may be this match's (then the bundle's row is shown, with no
    // live state and no attribution) or a sibling's.
    return {
      match: hit ?? base,
      degraded: false,
      source: hit ? adapter.name : undefined,
      ...partialOfRead(fetchMeta(live)),
      // What the overlay held: a shown record not among them is the bundle's.
      served: live.map((m) => m.id),
    };
  } catch {
    return { match: base, degraded: true };
  }
}

/**
 * `match <id>` off the bundled competition. The id is looked for in the
 * schedule ahead (discovery's span and requests), then refreshed from its own
 * day. Every transition:
 *   - discovery failed: `degraded`;
 *   - the id absent from a read that was not whole: `partial`, no window (not
 *     read is not "not found");
 *   - the id absent from a whole read: between editions when that read says
 *     so, else `window` (the span searched, provider days), never "no such
 *     match";
 *   - the id found: its provider day ±1, asked ACROSS seasons (nothing is
 *     merged and no slice kept: the one record is refreshed). That read
 *     failed: the month's record, attributed (the provider served it moments
 *     ago in this command), `degraded` (its state could not be refreshed).
 *     It holds the id: that record, attributed, with `partial` when the read
 *     was not whole. It does not: the month's record, attributed, `degraded`
 *     (the provider's latest whole word on those days did not hold it, so it
 *     is not presented as refreshed), with `partial` when not whole.
 */
async function matchOffBundle(adapter: ProviderAdapter, id: string, now: Date): Promise<MatchByIdResult> {
  const discovery = await getScheduleAhead(adapter, now);
  if (discovery.degraded) return { degraded: true };
  const record = discovery.fixtures.find((m) => m.id === id);
  if (!record) {
    if (discovery.complete !== true) {
      return { degraded: false, ...partialOfRead({ complete: false, omitted: discovery.omitted }) };
    }
    const between = betweenEditionsOf(adapter, discovery, discovery.fixtures, providerDayOf(adapter, now));
    if (between) return { degraded: false, betweenEditions: between };
    const span = scheduleSpan(adapter, now);
    return { degraded: false, window: { from: span.start, to: span.end } };
  }
  const day = providerDayOf(adapter, new Date(record.kickoff));
  try {
    const fresh = adapter.fetchWindow
      ? await adapter.fetchWindow(shiftUtcDate(day, -1), shiftUtcDate(day, 1), { acrossSeasons: true })
      : await adapter.fetchByDate(day);
    const partial = partialOfRead(fetchMeta(fresh));
    const hit = fresh.find((m) => m.id === id);
    return hit
      ? { match: hit, degraded: false, source: adapter.name, ...partial }
      : { match: record, degraded: true, source: adapter.name, ...partial, earlierRecord: true };
  } catch {
    return { match: record, degraded: true, source: adapter.name, earlierRecord: true };
  }
}

// Discovery's span: its own module (the verdict sentences name it too).
export { SCHEDULE_AHEAD_DAYS, SCHEDULE_LOOKBACK_DAYS } from './span';

export interface ScheduleAheadResult {
  /** Every fixture read in the span, in ANY status, by kickoff. */
  fixtures: Match[];
  /** The schedule could not be had (a failed request, a refused window): the caller keeps what it has. */
  degraded: boolean;
  /**
   * The season every month's response stated, when they all stated the SAME
   * one (by year); absent when one stated none, when two stated different
   * ones, or on failure. A month whose list held no readable record states what
   * its response stated. Two months can state two seasons (the provider's
   * season turns on June 1): the fixtures of both are returned, and the answer
   * states none, because no one season describes all of them.
   */
  season?: SeasonInfo;
  /**
   * False when the provider sent records this result does not hold (one it
   * could not read, a month whose list held no readable record, one fixture in
   * both months), or when the adapter says nothing about its answer. A fixture
   * absent from such a result is not known to be gone. Stated on every answer
   * that is not `degraded`.
   */
  complete?: boolean;
  /**
   * Stated with `complete: false`: the id of every fixture either month's
   * response held, BEFORE the months are narrowed to the span. A caller keeping
   * a previous answer asks "was it read?" of this list, not of `fixtures` (a
   * fixture moved beyond the span was read, and must not be put back).
   */
  mentioned?: readonly string[];
  /**
   * Stated with `complete: false` when the count is known: the provider
   * records the answer left out (each month's own count, and each second copy
   * across the months). Absent when a month's count is not known (a month that
   * read nothing states none). What `partialOfRead` reads beside `complete`.
   */
  omitted?: number;
}

/**
 * Discovery's span for a moment, in the PROVIDER's calendar days: from
 * `SCHEDULE_LOOKBACK_DAYS` back to `SCHEDULE_AHEAD_DAYS` ahead, added as dates
 * (a daylight-saving change does not move it). One computation, so the span
 * discovery reads and the span `match <id>` says it searched are the same.
 */
export function scheduleSpan(adapter: ProviderAdapter, now: Date): { start: string; end: string } {
  const today = providerDayOf(adapter, now);
  return {
    start: shiftUtcDate(today, -SCHEDULE_LOOKBACK_DAYS),
    end: shiftUtcDate(today, SCHEDULE_AHEAD_DAYS),
  };
}

/** `YYYY-MM-DD` of the first and last day of the month a day is in. */
function monthOf(day: string): { first: string; last: string } {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${day.slice(0, 8)}01`, last: `${day.slice(0, 8)}${String(last).padStart(2, '0')}` };
}

/**
 * The schedule ahead: every fixture from `SCHEDULE_LOOKBACK_DAYS` back to
 * `SCHEDULE_AHEAD_DAYS` ahead, counted in the PROVIDER's calendar days and
 * added as dates (a daylight-saving change does not move the span). What the
 * cold-path refresher reads, about once an hour, to know when a match can be
 * in play in a competition the bundled schedule does not describe.
 *
 * Each calendar month the span touches is its OWN window, asked whole (first
 * day to last), so it is exactly one month request whatever part of the month
 * is in the span (a two- or three-day fragment passed as itself would be asked
 * a day at a time). One request, or two, sent together and both settled before
 * this answers (a throttle on one is retained by the adapter whatever the
 * other did). Two windows, not one window of two months: a response states the
 * season of the dates asked, and a composed window asked strictly (as these
 * are) refuses two seasons. So the answer states a season only when every
 * month stated the same one: discovery's own rule, not the window's (a window
 * states the season its stating parts agree on).
 *
 * "A list that is not empty and holds no readable record is a failure" is
 * asked of the WHOLE discovery, as a window asks it of all its parts: a month
 * refused that way (`ProviderError.noReadableRecord`) read nothing, so the
 * answer is not whole and nothing of that month is in `mentioned`, while the
 * other month's fixtures are returned. If no month read a record, the
 * discovery failed. Any other failure of either window fails it:
 * `degraded`, nothing else.
 */
export async function getScheduleAhead(
  adapter: ProviderAdapter,
  now: Date = new Date(),
): Promise<ScheduleAheadResult> {
  if (!adapter.fetchWindow) return { fixtures: [], degraded: true };
  const dayOf = (instant: Date): string => providerDayOf(adapter, instant);
  const { start, end } = scheduleSpan(adapter, now);
  // 16 days touch one month or two.
  const months = [monthOf(start)];
  if (monthOf(end).first !== months[0]?.first) months.push(monthOf(end));

  const settled = await Promise.allSettled(
    months.map((month) => (adapter.fetchWindow as NonNullable<typeof adapter.fetchWindow>)(month.first, month.last)),
  );
  /** A month whose list held records and none that could be read; nothing for any other outcome. */
  const readNothing = (r: PromiseSettledResult<Match[]>) =>
    r.status === 'rejected' && r.reason instanceof ProviderError ? r.reason.noReadableRecord : undefined;
  if (settled.some((r) => r.status === 'rejected' && !readNothing(r))) return { fixtures: [], degraded: true };

  let complete = true;
  /** The records left out, summed over the months; undefined once one month's count is not known. */
  let omitted: number | undefined = 0;
  /** What each month's response stated, in month order. */
  const seasons: Array<SeasonInfo | undefined> = [];
  /** Every id read so far, by any month: what it returned and what its window set aside. */
  const read = new Set<string>();
  const fixtures: Match[] = [];
  for (const r of settled) {
    if (r.status === 'rejected') {
      // It read nothing: the answer is not whole, and what its response stated is still stated.
      complete = false;
      omitted = undefined;
      seasons.push(readNothing(r)?.season);
      continue;
    }
    const window = r.value;
    const meta = fetchMeta(window);
    // Absent is not true: an adapter that says nothing about its answer has
    // not said it is whole.
    if (meta?.complete !== true) complete = false;
    omitted =
      omitted === undefined
        ? undefined
        : meta?.complete === true
          ? omitted
          : meta?.omitted !== undefined
            ? omitted + meta.omitted
            : undefined;
    seasons.push(meta?.season);
    /** What EARLIER months read: the question "is this a second copy?" is asked of that, not of this month. */
    const before = new Set(read);
    for (const id of meta?.mentioned ?? []) read.add(id);
    for (const m of window) {
      read.add(m.id);
      // One fixture is filed under one day, so two months cannot both hold it.
      // If they do, the first copy, in month order, is the one that counts
      // (the window's own rule for its parts) WHEREVER it fell, inside the
      // span or not, and the answer is not whole.
      if (before.has(m.id)) {
        complete = false;
        if (omitted !== undefined) omitted += 1;
        continue;
      }
      const kickoff = new Date(m.kickoff);
      if (Number.isNaN(kickoff.getTime())) {
        complete = false;
        if (omitted !== undefined) omitted += 1;
        continue;
      }
      const day = dayOf(kickoff);
      if (day < start || day > end) continue;
      fixtures.push(m);
    }
  }
  // Nothing was read, and a month's list was not empty: the whole discovery
  // holds no readable record, which is a failure, not an empty schedule.
  if (read.size === 0 && settled.some((r) => r.status === 'rejected')) return { fixtures: [], degraded: true };
  // One season for the answer only when every month stated it, by year; and
  // its dates only where every month stated the same one (`agreedSeason`).
  const first = seasons[0];
  const season =
    first && seasons.every((s) => s?.year === first.year)
      ? agreedSeason(seasons.filter((s): s is SeasonInfo => s !== undefined))
      : undefined;
  fixtures.sort(byKickoff);
  return {
    fixtures,
    degraded: false,
    ...(season ? { season } : {}),
    complete,
    ...(complete ? {} : { mentioned: [...read], ...(omitted !== undefined && omitted > 0 ? { omitted } : {}) }),
  };
}

/**
 * Currently-live matches; empty + degraded on error.
 *
 * The provider buckets its scoreboard by its own day (ESPN: US/Eastern), so a
 * late kickoff that crossed the day boundary lands in an ADJACENT bucket — a
 * 04:00Z match still live at 76' while the provider's default "today" bucket
 * already shows the prior, all-FT day. A bare `adapter.fetchLive()` reads only
 * that single default bucket, so it silently MISSES such a match and `live` /
 * the statusline / the hook show "nothing live" mid-match. Fetch the ±1-day UTC
 * window around `now` instead — the same trick {@link getMatchesForDate} and
 * {@link getMatchById} use — and filter to in-play, so no live match can hide in
 * an adjacent bucket. Adapters without a window fetch fall back to `fetchLive()`.
 */
export async function getLiveMatches(
  adapter: ProviderAdapter,
  now: Date = new Date(),
): Promise<LiveResult> {
  // The surfaces get the read's VERDICT (`partial`, stated when the response
  // said it was not whole), not the refresher's boolean, which is also false
  // for an adapter that said nothing and for a failed read.
  const { complete: _complete, ...result } = await getLiveRead(adapter, now);
  return result;
}

/** A live read with the answer's own account of itself: what the refresher decides from. */
export interface LiveReadResult extends LiveResult {
  /**
   * True only when the provider's answer said every record in it was read.
   * Absent is not true, and a failed read is not whole: a read that is not
   * whole and holds no match in play does not prove none is.
   */
  complete: boolean;
}

/**
 * {@link getLiveMatches}, keeping the window's `complete` verdict (read from
 * the window's result BEFORE the in-play filter makes a new array). For the
 * cold-path refresher, which keeps polling after a match was seen in play
 * until a WHOLE read holds none.
 */
export async function getLiveRead(
  adapter: ProviderAdapter,
  now: Date = new Date(),
): Promise<LiveReadResult> {
  try {
    const day = now.toISOString().slice(0, 10);
    // Asked ACROSS seasons, as the other two callers that merge nothing ask
    // (off the bundled competition, the dated read and the match refresh). A
    // day response states the season of the date asked, so at a competition's
    // season turn the three days state two; a strict window refuses that, and
    // the score of a match played those days was lost after three requests
    // were spent. This read keeps only the matches in play and merges nothing
    // (no bundle, no kept slice), so both editions are a usable answer. The
    // result then states no season: no one season describes it.
    const fetched = adapter.fetchWindow
      ? await adapter.fetchWindow(shiftUtcDate(day, -1), shiftUtcDate(day, 1), { acrossSeasons: true })
      : await adapter.fetchLive();
    const meta = fetchMeta(fetched);
    const season = meta?.season;
    const matches = fetched.filter((m) => isLive(m.status));
    // Asked of the whole read, BEFORE the in-play filter: a match scheduled in
    // the window means the competition is not between editions. The previous
    // final (finished) neither blocks it nor is shown: the filter keeps none.
    const between = betweenEditionsOf(adapter, meta, fetched, providerDayOf(adapter, now));
    return {
      matches,
      degraded: false,
      source: adapter.name,
      ...(season ? { season } : {}),
      ...(between ? { betweenEditions: between } : {}),
      // The read's own verdict, for the surfaces: stated only when the
      // response SAID it was not whole (with the count when it knew it). The
      // boolean below is the refresher's, unchanged: false for that, for an
      // adapter that said nothing, and for a failed read alike.
      ...partialOfRead(meta),
      complete: meta?.complete === true,
    };
  } catch {
    return { matches: [], degraded: true, complete: false };
  }
}
