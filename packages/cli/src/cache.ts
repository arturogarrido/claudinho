/**
 * Local micro-cache shared by the statusline (reader) and the refresher
 * (writer). The statusline hot path only ever READS this file; it must be tiny
 * and fast. Writes are atomic (tmp + rename) so a reader never sees a partial
 * file. A lockfile serializes refreshers to prevent stampedes.
 */
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_COMPETITION, type Match } from '@claudinho/core';
import { randomBytes } from 'node:crypto';
import { cacheDir, writeFileAtomic } from './paths';

export { cacheDir } from './paths';

/**
 * Cache schema version, stamped into every write. A file with a different (or
 * absent, i.e. pre-versioning) version is treated as ABSENT: with releases
 * shipping near-daily, an old binary's snapshot must never be blind-cast into a
 * new binary's shape — the refresher simply rebuilds it on the next cycle.
 */
export const CACHE_VERSION = 2;

/** Hard byte ceiling before JSON parsing on the statusline hot path. */
export const MAX_STATE_BYTES = 1024 * 1024;
/** Far above any real live/knockout snapshot, but finite before traversal. */
const MAX_STATE_RECORDS = 1024;

/** The cached snapshot. `live` holds in-progress matches at `updatedAt`. */
export interface CacheState {
  /** Schema version (see {@link CACHE_VERSION}); stamped by writeState. */
  version?: number;
  updatedAt: string; // ISO 8601
  live: Match[];
  degraded: boolean;
  source: string;
  /** Competition slug the live data was fetched for (e.g. "fifa.world"). */
  competition: string;
  /**
   * RESOLVED upcoming knockout fixtures (both nations known), so the hot-path
   * statusline can show a real next-match countdown the static bundle can't
   * provide (its KO slots are placeholders). Refreshed on a SEPARATE, slower
   * cadence than `live` (pairings change only when a match finishes), tracked by
   * `fixturesUpdatedAt`. Absent until the refresher first populates it.
   */
  fixtures?: Match[];
  /** ISO 8601 timestamp of the last successful `fixtures` fetch. */
  fixturesUpdatedAt?: string;
  /**
   * ISO 8601 timestamp of the last fixtures fetch ATTEMPT (success or failure).
   * Throttles failure retries: a failed fetch leaves `fixturesUpdatedAt`
   * untouched (fail-closed), which used to degrade the intended 15-min cadence
   * into a retry every lock cycle (~15s) for the whole outage.
   */
  fixturesAttemptedAt?: string;
  /**
   * ISO 8601: the provider throttled/blocked us (429/403) — no refresh of any
   * kind until this passes. Hammering a block at the live cadence makes it
   * worse; the statusline meanwhile fails closed (stale → countdown/`⚽ —`).
   */
  backoffUntil?: string;
}

const LOCK_STALE_MS = 60_000;

/**
 * Per-scope cache file. The default scope (espn + the bundled World Cup) keeps
 * the legacy `state.json` name — no migration for the installed base — while
 * any other source/competition gets its own slot, so two sessions with
 * different `CLAUDINHO_COMPETITION` values stop thrashing a single file
 * (previously: ping-ponged full refetches plus a refresher spawn per statusline
 * tick on both sides). The slug is sanitized: the competition comes from an env
 * var and must never influence the path beyond a flat filename.
 */
export function cachePath(source = 'espn', competition = DEFAULT_COMPETITION): string {
  if (source === 'espn' && competition === DEFAULT_COMPETITION) {
    return join(cacheDir(), 'state.json');
  }
  const slug = `${source}.${competition}`.replace(/[^a-zA-Z0-9._-]/g, '_');
  return join(cacheDir(), `state.${slug}.json`);
}

function lockPath(): string {
  return join(cacheDir(), 'refresh.lock');
}

function validStamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/,
  );
  if (!match) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  const canonical = `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`;
  return new Date(parsed).toISOString() === canonical;
}

function validScope(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[a-zA-Z0-9._-]+$/.test(value)
  );
}

/** Validate only the envelope here; each Match is sealed lazily by its reader. */
function isCacheState(value: unknown): value is CacheState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const s = value as Record<string, unknown>;
  if (s.version !== CACHE_VERSION) return false;
  if (!validStamp(s.updatedAt) || typeof s.degraded !== 'boolean') return false;
  if (!validScope(s.source) || !validScope(s.competition)) return false;
  if (!Array.isArray(s.live) || s.live.length > MAX_STATE_RECORDS) return false;
  if (
    s.fixtures !== undefined &&
    (!Array.isArray(s.fixtures) || s.fixtures.length > MAX_STATE_RECORDS)
  ) {
    return false;
  }
  for (const key of [
    'fixturesUpdatedAt',
    'fixturesAttemptedAt',
    'backoffUntil',
  ] as const) {
    if (s[key] !== undefined && !validStamp(s[key])) return false;
  }
  return true;
}

/**
 * Read the cached state for a scope, or undefined if missing/corrupt/
 * version-mismatched (never throws).
 */
export function readState(
  source = 'espn',
  competition = DEFAULT_COMPETITION,
): CacheState | undefined {
  try {
    const path = cachePath(source, competition);
    const info = statSync(path);
    if (!info.isFile() || info.size > MAX_STATE_BYTES) return undefined;
    const bytes = readFileSync(path);
    // Re-check the bytes actually read: the stat and read are separate syscalls,
    // so a concurrently replaced file must not bypass the pre-parse ceiling.
    if (bytes.byteLength > MAX_STATE_BYTES) return undefined;
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    return isCacheState(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read the cache only if it was produced for the *current* source + competition.
 * The per-scope filename already isolates scopes; the embedded-field check stays
 * as defense in depth (e.g. a hand-copied file must still not bleed across).
 */
export function readCurrentState(
  source: string,
  competition: string,
): CacheState | undefined {
  const s = readState(source, competition);
  return s && s.source === source && s.competition === competition ? s : undefined;
}

/** Atomically write the cached state (version-stamped, to its scope's file). */
export function writeState(state: CacheState): void {
  writeFileAtomic(
    cachePath(state.source, state.competition),
    JSON.stringify({ ...state, version: CACHE_VERSION }),
  );
}

/** True while a persisted provider backoff (429/403) is in effect. */
/** Longest a provider backoff may hold, whatever the file claims. */
const MAX_BACKOFF_MS = 30 * 60_000;

export function backoffActive(state: CacheState | undefined, now = Date.now()): boolean {
  if (!state?.backoffUntil) return false;
  const t = Date.parse(state.backoffUntil);
  if (!Number.isFinite(t)) return false;
  // BOUNDED. `now < t` alone let a `backoffUntil` of 2099 suppress every
  // refresh forever — a permanent silence written by whoever last wrote the
  // file. The real backoff is 5-6 minutes; anything past the ceiling is not a
  // backoff we wrote.
  return now < t && t - now <= MAX_BACKOFF_MS;
}

/** Age of the latest fixtures ATTEMPT in ms (Infinity if never attempted). */
export function fixturesAttemptAgeMs(
  state: CacheState | undefined,
  now = Date.now(),
): number {
  return stampAgeMs(state?.fixturesAttemptedAt, now);
}

/** Age of the cache in ms (Infinity if absent/unparseable). */
/** Tolerated clock skew between writing a snapshot and reading it back. */
const FUTURE_SKEW_MS = 60_000;

/**
 * How old a cache timestamp is, or Infinity if we cannot trust it.
 *
 * A stamp in the FUTURE is not fresh, it is wrong. Returned as a negative age
 * it compares below every staleness threshold, so a value dated 2099 reads as
 * current forever and no refresh supersedes it — fail-OPEN on exactly the
 * fields that decide whether we trust the file. Ordinary skew between writing
 * and reading is tolerated; a meaningful lead is not.
 *
 * EVERY age question goes through here. Fixing only `updatedAt` left the
 * siblings — the fixtures attempt stamp, the market entries — open to the same
 * value, which is the "fixed one instance, not the class" mistake again.
 */
export function stampAgeMs(value: string | undefined, now: number): number {
  if (!value) return Infinity;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return Infinity;
  const age = now - t;
  return age < -FUTURE_SKEW_MS ? Infinity : age;
}

export function ageMs(state: CacheState | undefined, now = Date.now()): number {
  return stampAgeMs(state?.updatedAt, now);
}

/**
 * Age of the cached knockout `fixtures` in ms (Infinity if never fetched). Its
 * own clock — `fixtures` refreshes on a slower cadence than `live`, so a fresh
 * live write must not make stale fixtures look fresh (or vice-versa).
 */
export function fixturesAgeMs(state: CacheState | undefined, now = Date.now()): number {
  return stampAgeMs(state?.fixturesUpdatedAt, now);
}

/**
 * Age of the lock in ms. Uses the timestamp written *inside* the lock
 * (authoritative — survives copies/touch) and falls back to the file mtime.
 * Returns Infinity if there's no lock.
 */
function lockAgeMs(now = Date.now()): number {
  const lp = lockPath();
  try {
    const contents = readFileSync(lp, 'utf8');
    const written = Number.parseInt(contents.split(/\s+/)[1] ?? '', 10);
    // Through the shared guard: a lock written in the future never went
    // stale, so it held the refresher silent forever.
    if (Number.isFinite(written)) return stampAgeMs(new Date(written).toISOString(), now);
  } catch {
    return Infinity; // no lock
  }
  // Lock exists but its content is unparseable — fall back to mtime, THROUGH
  // the same guard. Bypassing it here meant an unreadable lock dated 2099 was
  // permanently fresh and never released: `isLockFresh()` true and
  // `acquireLock()` false, forever. Third time a timestamp fix has missed a
  // sibling, which is why every one of them now routes through `stampAgeMs`.
  try {
    return stampAgeMs(new Date(statSync(lp).mtimeMs).toISOString(), now);
  } catch {
    return Infinity;
  }
}

/** True if a refresher currently holds a non-stale lock. */
export function isLockFresh(now = Date.now()): boolean {
  return lockAgeMs(now) < LOCK_STALE_MS;
}

/**
 * The lock's owner token: `<pid> <stamp> <nonce>`. The stamp stays the second
 * field so `lockAgeMs` keeps reading it; the nonce makes the token unguessable
 * so ownership cannot be spoofed by pid reuse.
 */
export type LockToken = string;

/** The token this process last acquired through the no-argument API. */
let heldToken: LockToken | undefined;

function readLockToken(): string | undefined {
  try {
    return readFileSync(lockPath(), 'utf8').trim();
  } catch {
    return undefined;
  }
}

function writeExclusive(lp: string, token: LockToken): boolean {
  try {
    const fd = openSync(lp, 'wx'); // O_CREAT | O_EXCL
    try {
      writeSync(fd, token);
    } finally {
      closeSync(fd);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Claim the refresh lock (atomic O_EXCL), stealing a stale one. Returns the
 * owner token, which `holdsLock`, `publishState` and `releaseLock` require —
 * audit A10: a release without ownership used to unlink whatever lock was
 * there, so a stale owner waking up removed its SUCCESSOR's lock and a third
 * refresher was admitted while the successor still ran.
 * REMAINING (0.11, 2.6): the stale-check-then-unlink below is still a race
 * window; a true cross-process coordinator closes it.
 */
export function claimLock(now = Date.now()): LockToken | undefined {
  mkdirSync(cacheDir(), { recursive: true });
  const lp = lockPath();
  const token = `${process.pid} ${now} ${randomBytes(6).toString('hex')}`;
  if (writeExclusive(lp, token)) return token;
  // Lock exists. Steal it only if it's stale (by written timestamp / mtime).
  if (lockAgeMs(now) > LOCK_STALE_MS) {
    try {
      rmSync(lp, { force: true });
    } catch {
      return undefined; // lost the race to remove it
    }
    // One retry; if someone else grabbed it first, give up (no recursion loop).
    return writeExclusive(lp, token) ? token : undefined;
  }
  return undefined;
}

/** True while the lock file still carries this token (default: this process's). */
export function holdsLock(token: LockToken | undefined = heldToken): boolean {
  return token !== undefined && readLockToken() === token;
}

/** Acquire the refresh lock for this process (the no-argument API). */
export function acquireLock(now = Date.now()): boolean {
  const token = claimLock(now);
  if (token) heldToken = token;
  return token !== undefined;
}

/** Release the lock — a no-op for anyone but its current holder. */
export function releaseLock(token: LockToken | undefined = heldToken): void {
  if (!holdsLock(token)) return;
  try {
    rmSync(lockPath(), { force: true });
  } catch {
    /* ignore */
  }
  if (token === heldToken) heldToken = undefined;
}

/**
 * Publish a snapshot only while the lock is still ours (audit A10). This is an
 * OWNERSHIP CHECK, not atomic fencing: a takeover that lands between the check
 * and the write still lets a stale owner's snapshot land. It narrows the
 * window a refresher that lost its lease has to overwrite its successor; a
 * cross-process coordinator with atomic fencing (0.11, 2.6) closes it.
 * Returns whether the write happened.
 */
export function publishState(state: CacheState, token: LockToken | undefined = heldToken): boolean {
  if (!holdsLock(token)) return false;
  writeState(state);
  return true;
}
