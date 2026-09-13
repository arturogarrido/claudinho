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
