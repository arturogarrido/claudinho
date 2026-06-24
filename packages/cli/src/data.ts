/**
 * The CLI's data access is the shared live-overlay layer from core. Kept as a
 * re-export so existing CLI imports/tests stay stable while the implementation
 * lives in exactly one place (@claudinho/core).
 */
export {
  makeAdapter,
  mergeLive,
  getMatchesForDate,
  getLiveMatches,
  getStandings,
  getBracket,
  type LiveResult,
  type StandingsResult,
  type BracketResult,
} from '@claudinho/core';
