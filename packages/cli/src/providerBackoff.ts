/**
 * Interactive commands and the persisted provider backoff (audit A12).
 *
 * The ambient refresher already honours the cache's `backoffUntil`, but every
 * interactive command built a fresh adapter and fetched regardless — a user
 * (or an agent retrying a tool) kept contacting an upstream that had asked us
 * to wait. Now the CLI pre-arms its adapter from the persisted backoff (zero
 * requests inside the window, honest degraded output) and persists a throttle
 * it meets itself, so the next process, and the refresher, honour it too.
 * REMAINING (0.11, 2.6): a cross-process admission layer with a request budget.
 */
import { type ProviderAdapter, resolveCompetition } from '@claudinho/core';
import {
  backoffActive,
  type CacheState,
  claimLock,
  publishState,
  readCurrentState,
  readState,
  releaseLock,
} from './cache';

const DEFAULT_PERSIST_MS = 5 * 60_000;

/** Persist the adapter's cooldown as the cache's `backoffUntil`, fenced by the lock. */
function persistBackoff(
  adapter: ProviderAdapter,
  source: string,
  competition: string,
  nowMs: number,
): void {
  const until = adapter.cooldownUntil ?? nowMs + DEFAULT_PERSIST_MS;
  // The refresher may be mid-write; it persists its own throttle, so skipping
  // here loses nothing. Never wait, never clobber an unowned snapshot.
  const token = claimLock(nowMs);
  if (!token) return;
  try {
    const prior = readState(source, competition);
    const base: CacheState =
      prior && prior.source === source && prior.competition === competition
        ? prior
        : {
            updatedAt: new Date(nowMs).toISOString(),
            live: [],
            degraded: true, // the provider refused us — never claim otherwise
            source,
            competition,
          };
    publishState({ ...base, backoffUntil: new Date(until).toISOString() }, token);
  } finally {
    releaseLock(token);
  }
}

/**
 * Wrap an adapter for one interactive command: arm it from the persisted
 * backoff, and persist any throttle it meets. Reads one small cache file; not
 * on the statusline/hook hot path (those read the cache directly).
 */
export function withPersistedBackoff(
  adapter: ProviderAdapter,
  source: string,
  now: Date = new Date(),
): ProviderAdapter {
  const competition = resolveCompetition();
  const nowMs = now.getTime();
  const state = readCurrentState(source, competition);
  if (state?.backoffUntil && backoffActive(state, nowMs)) {
    adapter.armCooldown?.(Date.parse(state.backoffUntil));
  }
  const afterCall = () => {
    if (adapter.lastError?.throttled) persistBackoff(adapter, source, competition, nowMs);
  };
  return new Proxy(adapter, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value === 'function' && typeof prop === 'string' && prop.startsWith('fetch')) {
        return async (...args: unknown[]) => {
          try {
            return await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          } finally {
            afterCall();
          }
        };
      }
      return value;
    },
  });
}
