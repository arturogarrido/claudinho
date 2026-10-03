/** @claudinho/core — canonical model, adapters, and helpers. */
export type * from './types';

export { flagEmoji, nationToFlag, nationToRegion } from './flags';
export { t, normalizeLang, stageLabelI18n } from './i18n';
export type { Lang } from './i18n';
export { resolveTz, formatKickoff, formatDate, formatTime, countdown, localDate } from './time';
export type { FormatOpts } from './time';
export { isValidTimeZone, isValidDate } from './validate';
export { displayWidth, padVisible, truncateVisible } from './text';
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
  isUpcoming,
  fixturesInLiveWindow,
  isTournamentWindowOver,
  LIVE_WINDOW_MS,
  KNOCKOUT_EXTRA_TIME_MS,
  liveWindowMsFor,
  groups,
  sanitizeBundledFixture,
} from './schedule';

export {
  allTeams,
  lookupTeam,
  nationArg,
  resolveClub,
  rosterFor,
  type ClubResolution,
  type Roster,
  type TeamInfo,
  type TeamLookup,
} from './teams';

export { computeStandings, tableData, tableKeyArg, tableTitle, TABLE_KEY_ARG } from './standings';
export type { StandingRow, GroupStandings, TableData } from './standings';

export type { FetchWindowOptions, ProviderAdapter, ProviderCapabilities } from './adapters/types';
export {
  EspnAdapter,
  MAX_RESPONSE_BYTES,
  mapEspnEvent,
  parseStandings,
  ProviderError,
  STANDINGS_SHAPE,
} from './adapters/espn';
export type { EspnAdapterOptions, MapContext, ProviderErrorKind } from './adapters/espn';
export { DEFAULT_COOLDOWN_MS, MAX_COOLDOWN_MS, retryAfterMs } from './adapters/espn';
export { readJsonBounded, ResponseTooLargeError } from './adapters/http';

export {
  makeAdapter,
  KNOWN_SOURCES,
  isKnownSource,
  knockoutWindow,
  mergeLive,
  getMatchesForDate,
  getLiveMatches,
  getLiveRead,
  getScheduleAhead,
  scheduleSpan,
  SCHEDULE_AHEAD_DAYS,
  SCHEDULE_LOOKBACK_DAYS,
  EARLIER_RECORD_NOTE,
  getMatchById,
  getStandings,
  getBracket,
  getNextFixtureForTeam,
  getKnockoutFixtures,
  marketFixtureForTeam,
  liveSourceLabel,
} from './live';
export type {
  LiveResult,
  LiveReadResult,
  ScheduleAheadResult,
  MatchByIdResult,
  NextFixtureResult,
  KnockoutFixturesResult,
  StandingsResult,
} from './live';
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
  marketSignalRendersFor,
  marketDisplayable,
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
  MARKETS_SCOPE_NOTE,
  marketSourceLabel,
  marketLine,
  marketBlock,
} from './markets/format';
export {
  makeMarketProvider,
  MARKET_COMPETITIONS,
  marketsCoverCompetition,
  marketScopeVerdict,
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
// Share cards, assembled once for every surface (title, empty note, run cue,
// attribution, and the verdict the card carries).
export {
  bracketShareCard,
  dateShareCard,
  liveShareCard,
  matchShareCard,
  matchNoneReadSentence,
  matchWindowSentence,
  nextHorizonSentence,
  nextNoneReadSentence,
  nextShareCard,
  tableShareCard,
} from './share/cards';
export type {
  BracketShareCard,
  MatchShareCard,
  ShareCardContext,
  ShareCardMarket,
  ShareCardView,
  TableShareCard,
} from './share/cards';
// The one place a verdict (e.g. "not available for this competition") becomes
// a structured key and a localized sentence.
export { verdictExtras, verdictNotice, verdictQualifiers } from './verdict';
export type { BetweenEditions, VerdictExtras, VerdictSource } from './verdict';

export { buildBracketTopology, matchKey } from './bracket/build';
export { parseTeamSlot } from './bracket/parse';
export { buildBracketView } from './bracket/resolve';
export { isResolvedNation } from './bracket/placeholders';
export { loadBracketTopology } from './bracket/topology';
export {
  formatBracketList,
  formatBracketTree,
  formatBracketMatchLine,
  formatBracketCompactLine,
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

// The trust boundary. Only the batch vocabulary is re-exported: the parse
// constructors are for adapters and cache readers inside core, not for
// surfaces. (`export *` would also collide with sanitize's canonicalTimestamp.)
export {
  type BatchResolution,
  type BoundedList,
  type ParseResult,
  type Selection,
  MAX_LABEL_COLUMNS,
  ambiguous,
  bounded,
  cacheableKeys,
  definitiveNone,
  emptyBatch,
  isCacheable,
  humanLabel,
  malformed,
  parsedValue,
  parseCachedMarketSignal,
  parseCachedMatch,
  parseCachedMatches,
  resolvedValues,
  productFlag,
  selectOne,
  sealMarketSignal,
  sealMatch,
  sealSeason,
  unresolved,
  valid,
  type ScheduleEntry,
  hasLiveWindow,
  MAX_SCHEDULE_INDEX,
  parseCachedScheduleIndex,
  scheduleEntryOf,
  sealScheduleEntry,
} from './trust';
export {
  BUNDLE_COMPETITION,
  bracketCapability,
  bundleApplies,
  bundleSeasonYear,
  NO_BRACKET,
  resolveCompetition,
} from './competition';
export { attachFetchMeta, fetchMeta, type FetchMeta } from './adapters/meta';
