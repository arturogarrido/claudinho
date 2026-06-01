/** @claudinho/core — canonical model, adapters, and helpers. */
export type * from './types';

export { flagEmoji, nationToFlag, nationToRegion } from './flags';
export { resolveTz, formatKickoff, countdown, localDate } from './time';
export type { FormatOpts } from './time';
export { outcomeFromScore, isLive, isFinished, scoreline, byKickoff } from './normalize';

export {
  allFixtures,
  fixturesByDate,
  fixturesByTeam,
  fixturesByGroup,
  nextFixtureForTeam,
  groups,
} from './schedule';

export { computeStandings } from './standings';
export type { StandingRow } from './standings';

export type { ProviderAdapter, ProviderCapabilities } from './adapters/types';
export { EspnAdapter, mapEspnEvent } from './adapters/espn';
export type { EspnAdapterOptions, MapContext } from './adapters/espn';

export {
  makeAdapter,
  mergeLive,
  getMatchesForDate,
  getLiveMatches,
} from './live';
export type { LiveResult } from './live';
