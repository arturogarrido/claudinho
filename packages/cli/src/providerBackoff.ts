/**
 * Interactive commands and the persisted provider backoff (audit A12).
 *
 * The ambient refresher already honours the cache's `backoffUntil`, but every
 * interactive command built a fresh adapter and fetched regardless — a user
 * (or an agent retrying a tool) kept contacting an upstream that had asked us
 * to wait. Now the CLI pre-arms its adapter from the persisted backoff (zero
 * requests inside the window, honest degraded output) and persists a throttle
 * it meets itself, so the next process, and the refresher, honour it too.
 *
 * A throttle always has somewhere to be written (0.11, 2.6a). Under the
 * refresh lock it goes into the snapshot, and it always goes to the scope's
 * note, which needs no lock: a refresher can hold the lock for as long as a
 * request can take, the publish can be refused or its write fail, the snapshot
 * can be unreadable, and a reader of another format rejects the snapshot whole.
 * It used to be dropped, and the next refresh asked the provider that had just
 * said stop. Every writer keeps the later of the deadlines it believes: the
 * backoff in effect, the note included.
 */
import type { ProviderAdapter } from '@claudinho/core';
import {
  backoffInEffect,
  type CacheState,
  claimLock,
  ensureBackoffVisible,
  publishState,
  readCurrentState,
  releaseLock,
} from './cache';

/**
 * Persist an absolute cooldown deadline: as the snapshot's `backoffUntil`
 * under the lock, then in the scope's note (unless the note already holds one
 * at least as late). Returns whether the note holds it, where every reader of
 * every format finds it: a write that failed, was refused, or cannot be read
 * back must NOT be remembered as persisted (review round 2 on #128; round 2 on
 * 2.6a for the refused and the unreadable snapshot).
 */
function persistBackoff(source: string, competition: string, until: number, nowMs: number): boolean {
  // Never wait, never clobber an unowned snapshot. A refresher may hold the
  // lock for as long as its requests take, and this command may be gone by
  // then: the deadline goes to the note instead, which the refresher (and
  // every other reader of a backoff) reads beside the snapshot.
  const token = claimLock(nowMs);
  if (token) {
    try {
      const base: CacheState = readCurrentState(source, competition) ?? {
        updatedAt: new Date(nowMs).toISOString(),
        live: [],
        degraded: true, // the provider refused us — never claim otherwise
        source,
        competition,
      };
      // The later of this one and the backoff in effect (the snapshot's and the
      // note's, each if believed): a shorter throttle (another command's, a
      // moment later) must not replace a longer one, wherever that one is, and
      // a stored value nobody believes must not outrank a real one.
      const inEffect = backoffInEffect(base, source, competition, nowMs);
      const later = inEffect !== undefined && inEffect > until ? inEffect : until;
      try {
        publishState({ ...base, backoffUntil: new Date(later).toISOString() }, token, nowMs);
      } catch {
        // A publish that THROWS (a failed atomic write) published nothing:
        // the note below is where the deadline goes, as for a refused one.
        // Thrown on, it would also leave this listener and become the
        // command's error in place of the provider's throttle.
      }
    } finally {
      releaseLock(token);
    }
  }
  // Refused, failed, unreadable or never tried: what counts is what a reader will find.
  return ensureBackoffVisible(source, competition, until, nowMs);
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
  // The adapter states the competition it serves; the backoff is its scope's.
  const competition = adapter.competition;
  const nowMs = now.getTime();
  const state = readCurrentState(source, competition);
  // ONE validation decides both the pre-arm and what counts as already
  // persisted: a deadline that is not believed (past its bound, unparseable)
  // is neither armed nor trusted, so a real throttle can replace it (review
  // round 2 on #128). The backoff in effect is the later of the snapshot's
  // and the scope's note.
  const accepted = backoffInEffect(state, source, competition, nowMs);
  if (accepted !== undefined) adapter.armCooldown?.(accepted);
  // Persist from the adapter's RETAINED window, never from `lastError`: with
  // two concurrent requests a 500 can land after a 429 and become lastError
  // while the cooldown stands, and a 429 can arrive after this command's own
  // call already returned (review P2 on #128). Every armed or extended window
  // is persisted once — and only a deadline a reader will FIND counts: one
  // that reached neither a readable snapshot nor the note is retried by the
  // next chance.
  let persisted = accepted;
  const persistIfNewer = (until: number) => {
    if (!(until > nowMs) || (persisted !== undefined && until <= persisted)) return;
    if (persistBackoff(source, competition, until, nowMs)) persisted = until;
  };
  adapter.onCooldown?.(persistIfNewer);
  const afterCall = () => {
    const until = adapter.cooldownUntil;
    if (until !== undefined) persistIfNewer(until);
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
