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
  /**
   * The competition this adapter fetches (a provider slug, e.g. `fifa.world`,
   * `eng.1`). An adapter serves exactly one, decided when it is built, and
   * everything below the edge asks the ADAPTER — never the environment — which
   * competition a request is for. That is what keeps a request from changing
   * its mind halfway through, and what lets "does the bundled schedule apply?"
   * be a question about a value.
   */
  readonly competition: string;
  readonly capabilities: ProviderCapabilities;
  /**
   * Expected group-table scope for omission checks. Omit when the competition's
   * full group set is not known in advance.
   */
  readonly expectedStandingsGroups?: readonly string[];
  /**
   * Groups whose degraded roster may be derived from the bundled schedule.
   * This is deliberately separate from expected scope: a custom competition
   * can have known groups without sharing the bundled World Cup teams.
   */
  readonly standingsFallbackGroups?: readonly string[];

  /**
   * All fixtures/results for a single calendar date (provider's timezone
   * semantics). What a provider knows about a response — the season it
   * belongs to, whether every record in it could be read — it attaches to the
   * returned array (`attachFetchMeta`); callers read it with `fetchMeta`. The
   * same holds for every fetch below.
   */
  fetchByDate(dateISO: string): Promise<Match[]>;

  /** Currently in-progress matches (poll path). */
  fetchLive(): Promise<Match[]>;

  /** Optional inclusive date-range fetch (used for schedule generation). */
  fetchWindow?(startDate: string, endDate: string): Promise<Match[]>;

  /**
   * Optional: the provider's calendar day (`YYYY-MM-DD`) for an instant, i.e.
   * the day a fixture kicking off then is filed under (ESPN: US/Eastern). A
   * caller that counts a span in days counts THESE days when the adapter states
   * them, and UTC days otherwise.
   */
  bucketDay?(instant: Date): string;

  /**
   * Optional authoritative group tables (cumulative across the group stage).
   * Returned in standings order per group. Providers that can't supply a real
   * table omit this; callers then fail closed (degraded), using a roster at zero
   * only when `standingsFallbackGroups` declares bundled-schedule compatibility
   * — never a wrong, partial table computed from a narrow live window.
   */
  fetchStandings?(): Promise<GroupStandings[]>;

  /** Optional push subscription (websocket/SSE providers). Returns an unsubscribe fn. */
  subscribe?(onBatch: (matches: Match[]) => void): () => void;

  /**
   * Optional: the most recent request failure, cleared when a new request
   * starts (best-effort under concurrency). Lets a caller whose result path
   * fails closed to `degraded` booleans still distinguish a throttle/block
   * (`throttled` — persist a backoff, hammering makes it worse) from an
   * ordinary blip (retry on the normal cadence).
   */
  readonly lastError?: {
    readonly kind: string;
    readonly status?: number;
    readonly throttled?: boolean;
    /** For a throttle: how long the adapter will refuse to fetch (bounded). */
    readonly retryAfterMs?: number;
  };

  /** Optional: epoch ms until which the adapter refuses requests (a retained throttle). */
  readonly cooldownUntil?: number;

  /**
   * Optional: arm the throttle window from outside — a fresh process reading
   * the backoff its refresher persisted. Inside the window every call fails as
   * a throttle without a request.
   */
  armCooldown?(untilMs: number): void;

  /** Optional: be told when the throttle window is armed or extended. Returns unsubscribe. */
  onCooldown?(listener: (untilMs: number) => void): () => void;
}
