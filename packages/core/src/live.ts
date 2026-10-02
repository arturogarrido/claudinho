/**
 * Shared live-data access: the static bundled schedule is the base truth; live
 * provider state is merged over it by match id. Used by every client (CLI, MCP,
 * notifier) so the overlay logic lives in exactly one place.
 */
import { EspnAdapter } from './adapters/espn';
import { fetchMeta } from './adapters/meta';
import type { ProviderAdapter } from './adapters/types';
import { byKickoff, isFinished, isLive } from './normalize';
import {
  allFixtures,
  fixturesByGroup,
  fixturesByTeam,
  LIVE_WINDOW_MS,
  nextFixtureForTeam,
  isUpcoming,
} from './schedule';
import { rosterAtZero, type GroupStandings } from './standings';
import { shiftUtcDate } from './time';
import type { Match, SeasonInfo, Stage } from './types';
import { isResolvedNation } from './bracket/placeholders';
import { buildBracketView } from './bracket/resolve';
import { loadBracketTopology } from './bracket/topology';
import type { BracketResult, BracketView } from './bracket/types';

import { bundleApplies } from './competition';

/** Provider names {@link makeAdapter} can construct (the CLI validates against this). */
export const KNOWN_SOURCES = ['espn'] as const;

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
   * Absent when the provider stated none or the fetch failed. A fact about
   * THIS result: `today 2024-06-14` reports the season of that day.
   */
  season?: SeasonInfo;
}

/**
 * The bundled fixtures a result may be merged over: all of them when the
 * bundle describes this competition AND, once a provider has answered, the
 * season it answered for; none otherwise.
 */
function skeletonFor(adapter: ProviderAdapter, season?: SeasonInfo): Match[] {
  return bundleApplies(adapter.competition, season) ? allFixtures() : [];
}

/** Human label for a live-data provider name (attribution). Text only. */
export function liveSourceLabel(source: string): string {
  const known: Record<string, string> = { espn: 'ESPN' };
  return known[source] ?? source.charAt(0).toUpperCase() + source.slice(1);
}

/**
 * Matches for a date, preferring live provider data, falling back to the static
 * schedule on any provider/network error (graceful degradation).
 */
export async function getMatchesForDate(
  adapter: ProviderAdapter,
  dateISO: string,
): Promise<LiveResult> {
  const day = dateISO.slice(0, 10);
  try {
    // A local calendar day can straddle two adjacent UTC dates (a 01:00Z
    // kickoff is the previous evening in the Americas). Callers group by the
    // *local* date, so ask for a ±1-day window (the adapter composes it: the
    // provider refuses date ranges) and merge by id. Asking only for `day`
    // would leave a boundary match showing from the static schedule with no
    // live score.
    const live = adapter.fetchWindow
      ? await adapter.fetchWindow(shiftUtcDate(day, -1), shiftUtcDate(day, 1))
      : await adapter.fetchByDate(day);
    const season = fetchMeta(live)?.season;
    // The skeleton is merged ONLY when it is this competition's schedule AND
    // this response's edition; otherwise the day is whatever the provider
    // served, and nothing else (A03).
    return {
      matches: mergeLive(skeletonFor(adapter, season), live),
      degraded: false,
      source: adapter.name,
      ...(season ? { season } : {}),
    };
  } catch {
    // No provider answer: nothing reported a season, so the bundle stays what
    // it is — the edition it was built from.
    return { matches: skeletonFor(adapter), degraded: true };
  }
}

export interface StandingsResult {
  /** Group tables in group-letter order; each table's rows in standings order. */
  tables: GroupStandings[];
  /** True when no authoritative table was available; tables may be a static roster or empty. */
  degraded: boolean;
  /** Provider that served the authoritative result, including an empty one (absent when degraded). */
  source?: string;
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
      const tables = (want ? all.filter((t) => t.group === want) : all).sort((a, b) =>
        a.group.localeCompare(b.group),
      );
      const availableGroups = new Set(tables.map((table) => table.group));
      const expectedGroupWasOmitted = want
        ? (expected?.includes(want) ?? false) && tables.length === 0
        : (expected?.some((group) => !availableGroups.has(group)) ?? false);
      if (!expectedGroupWasOmitted) {
        return { tables, degraded: false, source: adapter.name };
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
    .filter((m) => m.stage !== 'GROUP' && m.stage !== 'FRIENDLY')
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
  if (!bundleApplies(adapter.competition)) {
    // No topology, no fetch, no attribution: the bracket is a World Cup
    // feature and off the bundle it does not exist yet (audit A03).
    const view: BracketView = { stages: [], degraded: false, standingsDegraded: false, unsupported: true };
    return { view, degraded: false, standingsDegraded: false, unsupported: true };
  }
  const topology = loadBracketTopology();
  const base = allFixtures().filter((m) => m.stage !== 'GROUP' && m.stage !== 'FRIENDLY');

  let matches = base;
  let liveDegraded = true;
  let source: string | undefined;

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
  };
}


export interface MatchByIdResult {
  match?: Match;
  degraded: boolean;
  source?: string;
  /** Off the bundle a fixture list to look an id up in does not exist yet (audit A03). */
  unsupported?: true;
}

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
  const win = knockoutWindow();
  if (adapter.fetchWindow && win) {
    try {
      fixtures = mergeLive(fixtures, await adapter.fetchWindow(win.start, win.end));
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
  if (candidate) {
    const r = await getMatchById(adapter, candidate.id);
    // A second read that fails hands back the BUNDLED fixture, which for a
    // knockout tie is a placeholder. The candidate came from the overlay that
    // did answer: keep it, and keep the failure's `degraded`.
    const m = r.degraded ? candidate : (r.match ?? candidate);
    if (!isFinished(m.status)) return { ...r, match: m };
    // Confirmed finished → the team's market story has moved on.
  }
  const next = nextFixtureForTeam(code, { from: now, fixtures });
  // When the overlay fetch failed the static skeleton can't resolve a knockout
  // tie, so flag degraded — lets a caller say "feed unavailable" rather than the
  // misleading "no upcoming fixture" for a team past its group stage.
  return { match: next, degraded: overlayFailed };
}

export interface NextFixtureResult {
  fixture?: Match;
  /** True when the live overlay fetch failed and only the static skeleton was used. */
  degraded: boolean;
  /** The provider that served the live overlay (absent when degraded). */
  source?: string;
  /** Off the bundle "next" is built on a schedule we do not have yet (audit A03). */
  unsupported?: true;
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
  if (!bundleApplies(adapter.competition)) return { fixture: undefined, degraded: false, unsupported: true };
  const base = allFixtures();
  let matches = base;
  let degraded = true;
  let liveById: Set<string> | undefined;
  // Without a window capability nothing was fetched: stay degraded, attribute
  // nothing (audit A06; mirrors getKnockoutFixtures).
  const win = knockoutWindow();
  if (adapter.fetchWindow && win) {
    try {
      const live = await adapter.fetchWindow(win.start, win.end);
      matches = mergeLive(base, live);
      degraded = false;
      liveById = new Set(live.map((m) => m.id));
    } catch {
      // Static skeleton only — fail closed; never invent a knockout pairing.
    }
  }
  // Strictly the next UPCOMING fixture (kickoff ≥ now), preserving the pre-overlay
  // `next` semantics — the in-play match is `live`'s job, not `next`'s.
  const fixture = nextFixtureForTeam(code, { from: now, fixtures: matches });
  // Attribute the provider only when the live overlay actually served the chosen
  // fixture — a static group game (not in the knockout-window fetch) is not
  // "Live data: ESPN". Mirrors getMatchById's hit-based attribution.
  const source = fixture && liveById?.has(fixture.id) ? adapter.name : undefined;
  return { fixture, degraded, source };
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
}

/**
 * The RESOLVED upcoming knockout fixtures from the live overlay — the data the
 * hot-path statusline can't fetch itself but needs to show a real next-match
 * countdown (e.g. "🇲🇽 vs 🇪🇨 in 2d") instead of a 🏳️ placeholder. The cold-path
 * refresher calls this and caches the result; the statusline reads the cache.
 *
 * Returns only fixtures where BOTH nations are resolved (flag ≠ 🏳️) and kickoff
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
        m.stage !== 'GROUP' &&
        m.stage !== 'FRIENDLY' &&
        isUpcoming(m, now) &&
        isResolvedNation(m.home) &&
        isResolvedNation(m.away),
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
): Promise<MatchByIdResult> {
  if (!bundleApplies(adapter.competition)) return { match: undefined, degraded: false, unsupported: true };
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
    // "Live data: ESPN".
    return { match: hit ?? base, degraded: false, source: hit ? adapter.name : undefined };
  } catch {
    return { match: base, degraded: true };
  }
}

/** Discovery looks this many provider days back (a match that kicked off late yesterday can still be in play). */
export const SCHEDULE_LOOKBACK_DAYS = 1;
/** And this many ahead. */
export const SCHEDULE_AHEAD_DAYS = 14;

export interface ScheduleAheadResult {
  /** Every fixture read in the span, in ANY status, by kickoff. */
  fixtures: Match[];
  /** The schedule could not be had (a failed request, a refused window): the caller keeps what it has. */
  degraded: boolean;
  /**
   * The season stated by the response for the month that holds `now` (absent
   * when it stated none, or on failure). Two months can state two seasons (the
   * provider's season turns on June 1); the fixtures of both are returned.
   */
  season?: SeasonInfo;
  /**
   * False when the provider sent records this result does not hold (one it
   * could not read, one fixture in both months), or when the adapter says
   * nothing about its answer. A fixture absent from such a result is not known
   * to be gone. Stated on every answer that is not `degraded`.
   */
  complete?: boolean;
  /**
   * Stated with `complete: false`: the id of every fixture either month's
   * response held, BEFORE the months are narrowed to the span. A caller keeping
   * a previous answer asks "was it read?" of this list, not of `fixtures` (a
   * fixture moved beyond the span was read, and must not be put back).
   */
  mentioned?: readonly string[];
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
 * season of the dates asked, and a composed window refuses two seasons.
 *
 * If either window fails, discovery failed: `degraded`, nothing else.
 */
export async function getScheduleAhead(
  adapter: ProviderAdapter,
  now: Date = new Date(),
): Promise<ScheduleAheadResult> {
  if (!adapter.fetchWindow) return { fixtures: [], degraded: true };
  const dayOf = (instant: Date): string =>
    adapter.bucketDay?.(instant) || instant.toISOString().slice(0, 10);
  const today = dayOf(now);
  const start = shiftUtcDate(today, -SCHEDULE_LOOKBACK_DAYS);
  const end = shiftUtcDate(today, SCHEDULE_AHEAD_DAYS);
  // 16 days touch one month or two.
  const months = [monthOf(start)];
  if (monthOf(end).first !== months[0]?.first) months.push(monthOf(end));

  const settled = await Promise.allSettled(
    months.map((month) => (adapter.fetchWindow as NonNullable<typeof adapter.fetchWindow>)(month.first, month.last)),
  );
  if (settled.some((r) => r.status === 'rejected')) return { fixtures: [], degraded: true };
  const windows = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));

  let complete = true;
  let season: SeasonInfo | undefined;
  /** Every id read so far, by any month: what it returned and what its window set aside. */
  const read = new Set<string>();
  const fixtures: Match[] = [];
  windows.forEach((window, i) => {
    const meta = fetchMeta(window);
    // Absent is not true: an adapter that says nothing about its answer has
    // not said it is whole.
    if (meta?.complete !== true) complete = false;
    if (months[i]?.first === monthOf(today).first) season = meta?.season;
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
        continue;
      }
      const kickoff = new Date(m.kickoff);
      if (Number.isNaN(kickoff.getTime())) {
        complete = false;
        continue;
      }
      const day = dayOf(kickoff);
      if (day < start || day > end) continue;
      fixtures.push(m);
    }
  });
  fixtures.sort(byKickoff);
  return {
    fixtures,
    degraded: false,
    ...(season ? { season } : {}),
    complete,
    ...(complete ? {} : { mentioned: [...read] }),
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
  try {
    const day = now.toISOString().slice(0, 10);
    const fetched = adapter.fetchWindow
      ? await adapter.fetchWindow(shiftUtcDate(day, -1), shiftUtcDate(day, 1))
      : await adapter.fetchLive();
    const season = fetchMeta(fetched)?.season;
    const matches = fetched.filter((m) => isLive(m.status));
    return { matches, degraded: false, source: adapter.name, ...(season ? { season } : {}) };
  } catch {
    return { matches: [], degraded: true };
  }
}
