/**
 * Shared live-data access: the static bundled schedule is the base truth; live
 * provider state is merged over it by match id. Used by every client (CLI, MCP,
 * notifier) so the overlay logic lives in exactly one place.
 */
import { competitionBase, DEFAULT_COMPETITION, EspnAdapter } from './adapters/espn';
import type { ProviderAdapter } from './adapters/types';
import { allFixtures } from './schedule';
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
    case 'espn':
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
    return { matches: mergeLive(base, live), degraded: false };
  } catch {
    return { matches: base, degraded: true };
  }
}

/** Shift a "YYYY-MM-DD" date by whole UTC days, returning "YYYY-MM-DD". */
function shiftUtcDate(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days))
    .toISOString()
    .slice(0, 10);
}

/** Currently-live matches; empty + degraded on error. */
export async function getLiveMatches(adapter: ProviderAdapter): Promise<LiveResult> {
  try {
    return { matches: await adapter.fetchLive(), degraded: false };
  } catch {
    return { matches: [], degraded: true };
  }
}
