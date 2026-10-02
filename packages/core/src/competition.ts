import { DEFAULT_COMPETITION } from './adapters/espn';

export { STANDINGS_SHAPE } from './adapters/espn';
import { allFixtures } from './schedule';
import type { SeasonInfo } from './types';

/**
 * THE EDGE. The one function that lets the environment decide which
 * competition a request is for: an explicit choice wins, then
 * `CLAUDINHO_COMPETITION` (e.g. `eng.1`, `uefa.champions`, `fifa.friendly`),
 * then the 2026 World Cup.
 *
 * It is called where a request ENTERS — the CLI's option resolution, the MCP
 * server building a request's adapter — and nowhere else. From there the
 * competition travels as a value (on the config, on the adapter), so nothing
 * further down can re-read the environment and answer for a different
 * competition halfway through. `core/test/selection-identity.test.ts` fails if
 * a call appears anywhere else.
 */
export function resolveCompetition(explicit?: string): string {
  if (explicit) return explicit;
  if (typeof process !== 'undefined' && process.env?.CLAUDINHO_COMPETITION) {
    return process.env.CLAUDINHO_COMPETITION;
  }
  return DEFAULT_COMPETITION;
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
