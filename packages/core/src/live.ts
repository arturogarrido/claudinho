/**
 * Shared live-data access: the static bundled schedule is the base truth; live
 * provider state is merged over it by match id. Used by every client (CLI, MCP,
 * notifier) so the overlay logic lives in exactly one place.
 */
import { EspnAdapter } from './adapters/espn';
import type { ProviderAdapter } from './adapters/types';
import { allFixtures } from './schedule';
import type { Match } from './types';

/** Construct a provider adapter for a `--source` name (default: espn). */
export function makeAdapter(source = 'espn'): ProviderAdapter {
  switch (source) {
    case 'espn':
    default:
      return new EspnAdapter();
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
  try {
    const live = await adapter.fetchByDate(dateISO);
    return { matches: mergeLive(base, live), degraded: false };
  } catch {
    return { matches: base, degraded: true };
  }
}

/** Currently-live matches; empty + degraded on error. */
export async function getLiveMatches(adapter: ProviderAdapter): Promise<LiveResult> {
  try {
    return { matches: await adapter.fetchLive(), degraded: false };
  } catch {
    return { matches: [], degraded: true };
  }
}
