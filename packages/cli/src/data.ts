/**
 * Data layer for the CLI: the static bundled schedule is the base truth; live
 * state from the provider is merged over it by match id. This keeps the common
 * path fast/offline and only hits the network for live/result state.
 */
import {
  EspnAdapter,
  allFixtures,
  type Match,
  type ProviderAdapter,
} from '@claudinho/core';

export function makeAdapter(source: string): ProviderAdapter {
  switch (source) {
    case 'espn':
    default:
      return new EspnAdapter();
  }
}

/** Index matches by id for quick overlay. */
function indexById(matches: Match[]): Map<string, Match> {
  return new Map(matches.map((m) => [m.id, m]));
}

/**
 * Merge live matches over the static base. Live entries replace base entries
 * with the same id; ids unknown to the base (shouldn't happen for the
 * tournament, but be safe) are appended.
 */
export function mergeLive(base: Match[], live: Match[]): Match[] {
  const byId = indexById(base);
  for (const m of live) byId.set(m.id, m);
  return [...byId.values()];
}

/**
 * Fetch matches for a date, preferring live provider data and falling back to
 * the static schedule on any network/provider error (graceful degradation).
 */
export async function getMatchesForDate(
  adapter: ProviderAdapter,
  dateISO: string,
): Promise<{ matches: Match[]; degraded: boolean }> {
  const base = allFixtures();
  try {
    const live = await adapter.fetchByDate(dateISO);
    return { matches: mergeLive(base, live), degraded: false };
  } catch {
    return { matches: base, degraded: true };
  }
}

/** Fetch currently-live matches; empty + degraded flag on error. */
export async function getLiveMatches(
  adapter: ProviderAdapter,
): Promise<{ matches: Match[]; degraded: boolean }> {
  try {
    return { matches: await adapter.fetchLive(), degraded: false };
  } catch {
    return { matches: [], degraded: true };
  }
}
