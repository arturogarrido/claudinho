import { DEFAULT_COMPETITION } from './adapters/espn';

/**
 * The ESPN competition slug to fetch live state from. Defaults to the 2026
 * World Cup (`fifa.world`); override with CLAUDINHO_COMPETITION (e.g.
 * `eng.1`, `uefa.champions`, `fifa.friendly`). Only affects the *live* fetch —
 * the bundled static schedule is always the World Cup.
 *
 * Lives in its own module so that both the live layer and the market sidecar
 * read the ONE resolver without importing each other.
 */
export function resolveCompetition(explicit?: string): string {
  if (explicit) return explicit;
  if (typeof process !== 'undefined' && process.env?.CLAUDINHO_COMPETITION) {
    return process.env.CLAUDINHO_COMPETITION;
  }
  return DEFAULT_COMPETITION;
}

/** The competition whose schedule ships bundled in the clients: the 2026 World Cup. */
export const BUNDLE_COMPETITION = DEFAULT_COMPETITION;

/**
 * True when the bundled World Cup schedule applies to the active competition.
 * Off the bundle, every path built on the skeleton (date merge, `match <id>`,
 * `next`, the bracket, the knockout-fixture cache, the market fixture) must
 * not read it: an empty foreign day showed 104 World Cup fixtures with foreign
 * attribution (audit A03). Real per-competition support is 0.11 (2.1).
 */
export function bundleApplies(competition = resolveCompetition()): boolean {
  return competition === BUNDLE_COMPETITION;
}
