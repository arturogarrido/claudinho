/**
 * Probability normalization + the reliability gate. `isReliableMarketSignal` is
 * the single primitive every default-on surface keys off: "show only when
 * reliable, otherwise omit silently."
 */
import { isFinished, isLive } from '../normalize';
import { LIVE_WINDOW_MS } from '../schedule';
import type { Match } from '../types';
import type {
  FavoriteStrength,
  MarketFavorite,
  MarketOutcome,
  MarketSignal,
  MarketSignalOptions,
} from './types';

/** Default freshness window: a signal older than this is stale (15 minutes). */
export const DEFAULT_MAX_AGE_MS = 15 * 60_000;

/**
 * Market signals are pre-match and in-play reads. Once a match has finished —
 * status `FT`, or (for static fixtures that never get a live overlay) once its
 * live window has long passed — a "favorite" is resolved history: showing
 * "markets favor X 100%" after full time reads as a bug, not information.
 * An unparseable kickoff fails open (the reliability gate still applies).
 */
export function marketRelevant(match: Match, now: Date = new Date()): boolean {
  // A live overlay outranks the time window in BOTH directions: a match in
  // extra time runs past kickoff+140min and its in-play read stays legitimate,
  // while an early FT ends relevance before the window does.
  if (isLive(match.status)) return true;
  if (isFinished(match.status)) return false;
  const k = Date.parse(match.kickoff);
  return !Number.isFinite(k) || now.getTime() <= k + LIVE_WINDOW_MS;
}

/**
 * Re-scale outcome probabilities so the positive ones sum to 1. This removes
 * market "vig" (raw prices sum to >1) and is scale-agnostic: inputs may be
 * 0..1 or 0..100 and the result is a clean [0,1] distribution. Non-finite or
 * non-positive inputs collapse to 0.
 */
export function normalizeOutcomes(outcomes: MarketOutcome[]): MarketOutcome[] {
  const sum = outcomes.reduce(
    (s, o) => s + (Number.isFinite(o.probability) && o.probability > 0 ? o.probability : 0),
    0,
  );
  if (sum <= 0) return outcomes.map((o) => ({ ...o, probability: 0 }));
  return outcomes.map((o) => ({
    ...o,
    probability:
      Number.isFinite(o.probability) && o.probability > 0 ? o.probability / sum : 0,
  }));
}

/** Bucket a favorite's probability into a strength label. */
export function favoriteStrength(probability: number): FavoriteStrength {
  if (probability >= 0.65) return 'clear';
  if (probability >= 0.52) return 'slight';
  return 'close';
}

/** Pick the top home/draw/away outcome as the favorite, if one exists. */
export function deriveFavorite(outcomes: MarketOutcome[]): MarketFavorite | undefined {
  let top: MarketOutcome | undefined;
  for (const o of outcomes) {
    if (o.kind === 'other') continue;
    if (!top || o.probability > top.probability) top = o;
  }
  if (!top || top.probability <= 0 || top.kind === 'other') return undefined;
  return {
    kind: top.kind,
    teamCode: top.teamCode,
    probability: top.probability,
    strength: favoriteStrength(top.probability),
  };
}

/**
 * Does this market cleanly price the displayed home/draw/away result? Rejects
 * "to advance"/"to win tournament"-style markets (an 'other' outcome), markets
 * whose team codes don't match the fixture, and group-stage markets missing a
 * draw line (a 90' group result must price the draw).
 */
export function mapsCleanly(match: Match, outcomes: MarketOutcome[]): boolean {
  if (outcomes.some((o) => o.kind === 'other')) return false;
  const home = outcomes.find((o) => o.kind === 'home');
  const away = outcomes.find((o) => o.kind === 'away');
  const draw = outcomes.find((o) => o.kind === 'draw');
  if (!home || !away) return false;
  if (home.teamCode && home.teamCode.toUpperCase() !== match.home.code.toUpperCase()) {
    return false;
  }
  if (away.teamCode && away.teamCode.toUpperCase() !== match.away.code.toUpperCase()) {
    return false;
  }
  if (match.stage === 'GROUP' && !draw) return false;
  return true;
}

/**
 * Is a (possibly cached/looked-up) signal safe to RENDER for THIS fixture? A
 * signal is keyed and stored by match id, but display labels are taken from the
 * *current* Match — so a cached signal must be re-checked against the fixture
 * actually being shown. The guard: same match id AND the outcomes still map to
 * the fixture's real teams. This fails closed when a knockout slot the feed
 * resolved earlier later degrades back to a 🏳️ placeholder (the signal's own
 * `ambiguous` flag was decided at fetch time, against the resolved match, so it
 * can't catch this on its own).
 */
export function marketSignalRendersFor(match: Match, signal: MarketSignal): boolean {
  return signal.matchId === match.id && mapsCleanly(match, signal.outcomes);
}

/** Sanity check: ≥2 priced outcomes whose probabilities sum to ~1. */
export function hasSaneDistribution(outcomes: MarketOutcome[]): boolean {
  const priced = outcomes.filter((o) => Number.isFinite(o.probability) && o.probability > 0);
  if (priced.length < 2) return false;
  const sum = priced.reduce((s, o) => s + o.probability, 0);
  return sum > 0.97 && sum < 1.03;
}

/** Is the signal older than the freshness window? Unparseable timestamps are stale. */
export function isStaleSignal(
  signal: MarketSignal,
  options: MarketSignalOptions = {},
): boolean {
  const maxAge = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const asOf = Date.parse(signal.asOf);
  if (!Number.isFinite(asOf)) return true;
  const now = (options.now ?? new Date()).getTime();
  return now - asOf > maxAge;
}

/**
 * The load-bearing gate. A signal is reliable only when it is unambiguous, has
 * a determinable favorite, is a sane distribution, is fresh, and (when a floor
 * is configured) liquid enough. `includeUnreliable` bypasses all of it.
 */
export function isReliableMarketSignal(
  signal: MarketSignal,
  options: MarketSignalOptions = {},
): boolean {
  if (options.includeUnreliable) return true;
  if (signal.ambiguous) return false;
  if (!signal.favorite) return false;
  if (!hasSaneDistribution(signal.outcomes)) return false;
  if (signal.stale || isStaleSignal(signal, options)) return false;
  if (options.minLiquidity != null) {
    if (signal.liquidity == null || signal.liquidity < options.minLiquidity) return false;
  }
  return true;
}

/** Inputs a provider supplies to build a normalized, gated signal. */
export interface BuildSignalInput {
  match: Match;
  source: string;
  sourceMarketId?: string;
  asOf: string;
  fetchedAt?: string;
  /** Raw outcomes (any positive scale); normalized internally. */
  outcomes: MarketOutcome[];
  liquidity?: number;
  volume24h?: number;
  /** Force-flag as ambiguous (e.g. the source title didn't parse to a clean result). */
  ambiguous?: boolean;
  now?: Date;
  maxAgeMs?: number;
}

/**
 * Construct a normalized MarketSignal from a provider's raw parts. Centralizes
 * normalization, clean-mapping detection, favorite derivation, and staleness so
 * every provider produces identically-shaped, gate-ready signals.
 */
export function buildMarketSignal(input: BuildSignalInput): MarketSignal {
  const outcomes = normalizeOutcomes(input.outcomes);
  const ambiguous = input.ambiguous === true || !mapsCleanly(input.match, outcomes);
  const favorite = ambiguous ? undefined : deriveFavorite(outcomes);
  const signal: MarketSignal = {
    matchId: input.match.id,
    source: input.source,
    sourceMarketId: input.sourceMarketId,
    asOf: input.asOf,
    fetchedAt: input.fetchedAt ?? new Date().toISOString(),
    outcomes,
    favorite,
    liquidity: input.liquidity,
    volume24h: input.volume24h,
    stale: false,
    ambiguous,
  };
  signal.stale = isStaleSignal(signal, { now: input.now, maxAgeMs: input.maxAgeMs });
  return signal;
}
