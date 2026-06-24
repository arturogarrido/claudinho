/**
 * Shared live-data access: the static bundled schedule is the base truth; live
 * provider state is merged over it by match id. Used by every client (CLI, MCP,
 * notifier) so the overlay logic lives in exactly one place.
 */
import { competitionBase, DEFAULT_COMPETITION, EspnAdapter } from './adapters/espn';
import type { ProviderAdapter } from './adapters/types';
import { isFinished, isLive } from './normalize';
import {
  allFixtures,
  fixturesByGroup,
  groups,
  fixturesByTeam,
  LIVE_WINDOW_MS,
  nextFixtureForTeam,
} from './schedule';
import { rosterAtZero, type GroupStandings } from './standings';
import type { Match } from './types';

/**
 * The ESPN competition slug to fetch live state from. Defaults to the 2026
 * World Cup (`fifa.world`); override with CLAUDINHO_COMPETITION (e.g.
 * `fifa.friendly` to follow international friendlies during pre-tournament
 * testing). Only affects the *live* fetch — the bundled static schedule is
 * always the World Cup.
 */
export function resolveCompetition(explicit?: string): string {
  if (explicit) return explicit;
  if (typeof process !== 'undefined' && process.env?.CLAUDINHO_COMPETITION) {
    return process.env.CLAUDINHO_COMPETITION;
  }
  return DEFAULT_COMPETITION;
}

/** Construct a provider adapter for a `--source` name (default: espn). */
export function makeAdapter(source = 'espn'): ProviderAdapter {
  switch (source) {
    default: {
      const competition = resolveCompetition();
      const baseUrl =
        competition === DEFAULT_COMPETITION ? undefined : competitionBase(competition);
      return new EspnAdapter({ baseUrl });
    }
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
  const base = allFixtures();
  const day = dateISO.slice(0, 10);
  try {
    // A local calendar day can straddle two adjacent UTC dates (a 01:00Z
    // kickoff is the previous evening in the Americas). Callers group by the
    // *local* date, so fetch a ±1-day UTC window — one request, since ESPN
    // takes a date range — and merge by id. Fetching only `day` would leave a
    // boundary match showing from the static schedule with no live score.
    const live = adapter.fetchWindow
      ? await adapter.fetchWindow(shiftUtcDate(day, -1), shiftUtcDate(day, 1))
      : await adapter.fetchByDate(day);
    return { matches: mergeLive(base, live), degraded: false, source: adapter.name };
  } catch {
    return { matches: base, degraded: true };
  }
}

export interface StandingsResult {
  /** Group tables in group-letter order; each table's rows in standings order. */
  tables: GroupStandings[];
  /** True when no authoritative table was available and rows are a static roster. */
  degraded: boolean;
  /** The provider that served a real table (absent when degraded). */
  source?: string;
}

/**
 * Authoritative group tables, preferring the provider's cumulative standings and
 * FAILING CLOSED to a roster-at-zero (degraded) when none is available.
 *
 * Deliberately does NOT compute a table from a live-match window: that silently
 * drops earlier matchdays and reports a wrong, partial table (e.g. all-zeros for
 * a group not playing today) — the bug this replaced. A degraded roster is
 * honestly empty; a confidently-wrong table is the failure mode we refuse.
 *
 * An empty `tables` with `degraded: false` means the fetch succeeded but the
 * asked-for group isn't in it (caller renders "no such group").
 */
export async function getStandings(
  adapter: ProviderAdapter,
  group?: string,
): Promise<StandingsResult> {
  const want = group?.toUpperCase();
  if (adapter.fetchStandings) {
    try {
      const all = await adapter.fetchStandings();
      const tables = (want ? all.filter((t) => t.group === want) : all).sort((a, b) =>
        a.group.localeCompare(b.group),
      );
      return { tables, degraded: false, source: adapter.name };
    } catch {
      // fall through to the degraded roster
    }
  }
  const letters = want ? [want] : groups();
  const tables = letters
    .map((g) => ({ group: g, rows: rosterAtZero(fixturesByGroup(g)) }))
    .filter((t) => t.rows.length > 0);
  return { tables, degraded: true };
}

/** Shift a "YYYY-MM-DD" date by whole UTC days, returning "YYYY-MM-DD". */
function shiftUtcDate(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days))
    .toISOString()
    .slice(0, 10);
}

export interface MatchByIdResult {
  match?: Match;
  degraded: boolean;
  source?: string;
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
  const nowMs = now.getTime();
  const candidate = fixturesByTeam(code).find((m) => {
    const k = Date.parse(m.kickoff);
    return nowMs >= k && nowMs <= k + LIVE_WINDOW_MS + EXTRA_TIME_SLACK_MS;
  });
  if (candidate) {
    const r = await getMatchById(adapter, candidate.id);
    const m = r.match ?? candidate;
    if (!isFinished(m.status)) return { ...r, match: m };
    // Confirmed finished → the team's market story has moved on.
  }
  const next = nextFixtureForTeam(code, { from: now });
  return { match: next, degraded: false };
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
    const matches = adapter.fetchWindow
      ? (await adapter.fetchWindow(shiftUtcDate(day, -1), shiftUtcDate(day, 1))).filter((m) =>
          isLive(m.status),
        )
      : await adapter.fetchLive();
    return { matches, degraded: false, source: adapter.name };
  } catch {
    return { matches: [], degraded: true };
  }
}
