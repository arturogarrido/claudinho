import type { GroupStandings } from '../standings';
import type { Match } from '../types';

/** Capabilities a provider advertises so callers can pick a strategy. */
export interface ProviderCapabilities {
  /** True if the provider can push events (websocket/SSE) vs poll-only. */
  push: boolean;
  /** Rough event->feed latency hint, in seconds (for poll-cadence tuning). */
  latencyHintSec: number;
}

/**
 * The single swap-point for data vendors. Every provider (ESPN, API-Football,
 * Goalserve, …) implements this and maps INTO the canonical Match model, so the
 * vendor choice stays a one-module decision.
 */
export interface ProviderAdapter {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;

  /** All fixtures/results for a single calendar date (provider's timezone semantics). */
  fetchByDate(dateISO: string): Promise<Match[]>;

  /** Currently in-progress matches (poll path). */
  fetchLive(): Promise<Match[]>;

  /** Optional inclusive date-range fetch (used for schedule generation). */
  fetchWindow?(startDate: string, endDate: string): Promise<Match[]>;

  /**
   * Optional authoritative group tables (cumulative across the group stage).
   * Returned in standings order per group. Providers that can't supply a real
   * table omit this; callers then fall back (degraded) to a roster at zero —
   * never a wrong, partial table computed from a narrow live window.
   */
  fetchStandings?(): Promise<GroupStandings[]>;

  /** Optional push subscription (websocket/SSE providers). Returns an unsubscribe fn. */
  subscribe?(onBatch: (matches: Match[]) => void): () => void;
}
