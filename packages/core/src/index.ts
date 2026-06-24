/** @claudinho/core — canonical model, adapters, and helpers. */
export type * from './types';

export { flagEmoji, nationToFlag, nationToRegion } from './flags';
export { t, normalizeLang, stageLabelI18n } from './i18n';
export type { Lang } from './i18n';
export { resolveTz, formatKickoff, formatDate, formatTime, countdown, localDate } from './time';
export type { FormatOpts } from './time';
export { isValidTimeZone, isValidDate } from './validate';
export {
  outcomeFromScore,
  isLive,
  isFinished,
  scoreline,
  matchLocation,
  byKickoff,
  stageLabel,
} from './normalize';
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
  currentOrNextFixtureForTeam,
  fixturesInLiveWindow,
  LIVE_WINDOW_MS,
  groups,
  sanitizeBundledFixture,
} from './schedule';

export { computeStandings } from './standings';
export type { StandingRow, GroupStandings } from './standings';

export type { ProviderAdapter, ProviderCapabilities } from './adapters/types';
export { EspnAdapter, mapEspnEvent, parseStandings } from './adapters/espn';
export type { EspnAdapterOptions, MapContext } from './adapters/espn';

export {
  makeAdapter,
  mergeLive,
  getMatchesForDate,
  getLiveMatches,
  getMatchById,
  getStandings,
  getBracket,
  marketFixtureForTeam,
  resolveCompetition,
  liveSourceLabel,
} from './live';
export type { LiveResult, MatchByIdResult, StandingsResult } from './live';
export type { BracketResult, BracketView } from './bracket/types';
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
  marketRelevant,
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

// Shareable terminal snippets (pure text artifacts; composes Match + the market
// copy bank). The non-affiliation disclaimer is non-optional in every snippet.
export { formatShareSnippet, formatShareTable, SHARE_HASHTAG, SHARE_DISCLAIMER } from './share/format';
export type {
  ShareStyle,
  ShareSnippetInput,
  ShareSnippetOptions,
  ShareTableInput,
} from './share/format';

export { buildBracketTopology, matchKey } from './bracket/build';
export { parseTeamSlot } from './bracket/parse';
export { buildBracketView } from './bracket/resolve';
export { loadBracketTopology } from './bracket/topology';
export {
  formatBracketList,
  formatBracketTree,
  formatBracketMatchLine,
  formatShareBracket,
} from './bracket/format';
export type {
  BracketTopology,
  BracketMatchNode,
  SlotRef,
  ResolvedParticipant,
  BracketMatchView,
} from './bracket/types';
export { BRACKET_STAGE_ORDER } from './bracket/types';
export type { BracketFormatOpts, ShareBracketInput, ShareBracketOptions } from './bracket/format';
