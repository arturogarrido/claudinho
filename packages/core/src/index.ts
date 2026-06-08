/** @claudinho/core — canonical model, adapters, and helpers. */
export type * from './types';

export { flagEmoji, nationToFlag, nationToRegion } from './flags';
export { resolveTz, formatKickoff, countdown, localDate } from './time';
export type { FormatOpts } from './time';
export { isValidTimeZone, isValidDate } from './validate';
export { outcomeFromScore, isLive, isFinished, scoreline, matchLocation, byKickoff } from './normalize';
export {
  matchFlavor,
  asFlavorLevel,
  isFlavorLevel,
  DEFAULT_FLAVOR,
  FLAVOR_LEVELS,
} from './flavor';
export type { FlavorLevel } from './flavor';

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
  resolveCompetition,
} from './live';
export type { LiveResult } from './live';
export { DEFAULT_COMPETITION, competitionBase } from './adapters/espn';

// Prediction-market signals (read-only sidecar; never embedded in Match).
export type {
  MarketProvider,
  MarketSignal,
  MarketSignalsResult,
  MarketOutcome,
  MarketOutcomeKind,
  MarketFavorite,
  FavoriteStrength,
  MarketSignalOptions,
} from './markets/types';
export {
  normalizeOutcomes,
  deriveFavorite,
  favoriteStrength,
  mapsCleanly,
  hasSaneDistribution,
  isStaleSignal,
  isReliableMarketSignal,
  buildMarketSignal,
  DEFAULT_MAX_AGE_MS,
} from './markets/normalize';
export type { BuildSignalInput } from './markets/normalize';
export {
  marketFavoriteText,
  marketProbabilityText,
  marketAttributionText,
  marketSourceLabel,
  marketLine,
  marketBlock,
} from './markets/format';
export {
  makeMarketProvider,
  resolveMarketSource,
  getMarketSignal,
  getMarketSignals,
} from './markets/provider';
export { FakeMarketProvider } from './markets/fake';
export type { FakeMarketProviderOptions } from './markets/fake';
export { PolymarketProvider } from './markets/polymarket';
export type {
  PolymarketProviderOptions,
  MarketMapping,
  MarketMappingTable,
} from './markets/polymarket';
