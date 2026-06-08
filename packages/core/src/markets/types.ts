/**
 * Prediction-market "signal" model — a *sidecar* to Match, deliberately never
 * embedded in it. Market data has different freshness, reliability, failure,
 * and legal semantics than tournament facts, so it lives in its own folder and
 * is keyed back to a match by id. This keeps prediction-market context off the
 * hot paths (statusline, hook) by construction rather than by remembering a flag.
 *
 * Read-only by design: providers fetch public market data only — no wallet,
 * no auth, no order placement. Nothing here models trading.
 */
import type { Match } from '../types';

/** Which match result a priced line refers to (home win / draw / away win). */
export type MarketOutcomeKind = 'home' | 'draw' | 'away' | 'other';

/** One priced outcome of a match market. */
export interface MarketOutcome {
  kind: MarketOutcomeKind;
  /** Team code for 'home'/'away' (e.g. "MEX"); absent for draw/other. */
  teamCode?: string;
  /** Label as the source displays it (e.g. "Mexico", "Draw"). */
  label: string;
  /** Market-implied probability, normalized to [0,1] (sums to ~1 across a market). */
  probability: number;
}

/** How strongly the market leans toward its top outcome. */
export type FavoriteStrength = 'close' | 'slight' | 'clear';

/** The top outcome plus its strength bucket. */
export interface MarketFavorite {
  kind: 'home' | 'draw' | 'away';
  teamCode?: string;
  probability: number;
  strength: FavoriteStrength;
}

/** A normalized prediction-market reading for a single match. */
export interface MarketSignal {
  /** Claudinho match id this signal maps to. */
  matchId: string;
  /** Provider name (e.g. "polymarket"). */
  source: string;
  /**
   * Opaque source market id, for debugging and mapping only. Deliberately never
   * surfaced as a clickable link in v1 (see the no-outbound-links guardrail).
   */
  sourceMarketId?: string;
  /** When the source last priced the market (ISO 8601 UTC). */
  asOf: string;
  /** When Claudinho fetched it (ISO 8601 UTC). */
  fetchedAt: string;
  /** Priced outcomes, normalized so positive probabilities sum to ~1. */
  outcomes: MarketOutcome[];
  /** Top outcome, when one can be determined from a clean mapping. */
  favorite?: MarketFavorite;
  /** Source liquidity, when available (provider units; used only for gating). */
  liquidity?: number;
  /** Source 24h volume, when available (provider units). */
  volume24h?: number;
  /** True when the snapshot is older than the freshness window. */
  stale: boolean;
  /** True when the market does not map cleanly to the displayed home/draw/away result. */
  ambiguous: boolean;
}

/** Tunables for reliability gating and provider fetch behavior. */
export interface MarketSignalOptions {
  /** "Now" for staleness math; defaults to the current time. */
  now?: Date;
  /** Minimum source liquidity required to treat a signal as reliable. */
  minLiquidity?: number;
  /** Max age (ms) before a signal is considered stale. */
  maxAgeMs?: number;
  /**
   * Bypass reliability gates — used by the dedicated `markets` surface, which
   * may show a thin/stale market *with a caveat*. Default surfaces never set this.
   */
  includeUnreliable?: boolean;
  /**
   * Max total wall-clock (ms) for a batch `findSignals` before it stops early.
   * Keeps optional market enrichment from blocking core fixture output.
   */
  deadlineMs?: number;
  /** Per-request fetch timeout (ms) override for the provider. */
  timeoutMs?: number;
}

/**
 * Result of a batch lookup. `checked` is the set of match ids the provider
 * DEFINITIVELY resolved (reached the source and found no usable market, or the
 * fixture is unmappable) — distinct from matches that errored or were skipped by
 * the deadline. Callers negative-cache only `checked` ids, so a transient
 * provider/network failure never suppresses a valid signal.
 */
export interface MarketSignalsResult {
  signals: Map<string, MarketSignal>;
  checked: Set<string>;
}

/**
 * A prediction-market provider. A *separate* swap-point from ProviderAdapter
 * (which supplies match data): different cadence, reliability, and legal
 * posture. Implementations fetch public market data only.
 */
export interface MarketProvider {
  readonly name: string;
  /** Signal for one match, or undefined when nothing maps cleanly. */
  findSignal(match: Match, options?: MarketSignalOptions): Promise<MarketSignal | undefined>;
  /** Batch form; signals plus the set of definitively-checked ids. */
  findSignals(matches: Match[], options?: MarketSignalOptions): Promise<MarketSignalsResult>;
}
