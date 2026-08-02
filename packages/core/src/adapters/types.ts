import type { GroupStandings } from '../standings';
import type { Match } from '../types';

/**
 * An array-compatible provider batch carries the records we could read and
 * whether the provider payload was read in full. Keeping the array surface is
 * deliberate: existing `ProviderAdapter` consumers can still iterate, index,
 * and call array methods after this completeness contract was added.
 * `complete: false` is not an empty answer: domain callers fail closed rather
 * than presenting the readable prefix as authoritative.
 */
export interface ProviderBatch<T> extends Array<T> {
  /** Alias retained for boundary-aware callers; non-enumerable at runtime. */
  readonly items: T[];
  readonly complete: boolean;
}

/**
 * Bare arrays remain accepted for injected/third-party adapters and mean
 * "complete". Both sides of the union are arrays, preserving the original
 * public adapter API for consumers that call `.filter()`, iterate, or index.
 */
export type ProviderResult<T> = T[] | ProviderBatch<T>;

/**
 * Decorate an array with a non-enumerable completeness verdict and `items`
 * alias. JSON and ordinary array consumers still see exactly an array.
 */
export function providerBatch<T>(
  result: readonly T[],
  complete?: boolean,
): ProviderBatch<T>;
export function providerBatch(result: unknown, complete?: boolean): ProviderBatch<unknown>;
export function providerBatch<T>(
  result: ProviderResult<T> | unknown,
  complete?: boolean,
): ProviderBatch<T> {
  if (!Array.isArray(result)) return providerBatch<T>([], false);

  const ownVerdict = Object.hasOwn(result, 'complete')
    ? (result as { complete?: unknown }).complete
    : undefined;
  const verdict =
    complete ?? (ownVerdict === undefined ? true : typeof ownVerdict === 'boolean' && ownVerdict);
  if (
    complete === undefined &&
    ownVerdict === verdict &&
    (result as { items?: unknown }).items === result
  ) {
    return result as ProviderBatch<T>;
  }

  const batch = [...(result as readonly T[])] as ProviderBatch<T>;
  Object.defineProperties(batch, {
    complete: { value: verdict, enumerable: false },
    items: { value: batch, enumerable: false },
  });
  return batch;
}

/**
 * Records from a complete provider answer. Throws on an incomplete batch so
 * the existing domain-level catch paths produce honest degraded output.
 */
export function completeProviderItems<T>(result: ProviderResult<T>): T[] {
  const batch = providerBatch(result);
  if (!batch.complete) throw new Error('Provider payload was incomplete');
  return [...batch];
}

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
  fetchByDate(dateISO: string): Promise<ProviderResult<Match>>;

  /** Currently in-progress matches (poll path). */
  fetchLive(): Promise<ProviderResult<Match>>;

  /** Optional inclusive date-range fetch (used for schedule generation). */
  fetchWindow?(startDate: string, endDate: string): Promise<ProviderResult<Match>>;

  /**
   * Optional authoritative group tables (cumulative across the group stage).
   * Returned in standings order per group. Providers that can't supply a real
   * table omit this; callers then fall back (degraded) to a roster at zero —
   * never a wrong, partial table computed from a narrow live window.
   */
  fetchStandings?(): Promise<ProviderResult<GroupStandings>>;

  /** Optional push subscription (websocket/SSE providers). Returns an unsubscribe fn. */
  subscribe?(onBatch: (matches: ProviderResult<Match>) => void): () => void;

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
  };
}
