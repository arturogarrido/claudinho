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
import { cacheDir, writeFileAtomic } from './paths';

export { cacheDir } from './paths';

/**
 * Cache schema version, stamped into every write. A file with a different (or
 * absent, i.e. pre-versioning) version is treated as ABSENT: with releases
 * shipping near-daily, an old binary's snapshot must never be blind-cast into a
 * new binary's shape — the refresher simply rebuilds it on the next cycle.
 */
export const CACHE_VERSION = 2;

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

/**
 * Read the cached state for a scope, or undefined if missing/corrupt/
 * version-mismatched (never throws).
 */
export function readState(
  source = 'espn',
  competition = DEFAULT_COMPETITION,
): CacheState | undefined {
  try {
    const s = JSON.parse(
      readFileSync(cachePath(source, competition), 'utf8'),
    ) as CacheState;
    return s.version === CACHE_VERSION ? s : undefined;
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
export function backoffActive(state: CacheState | undefined, now = Date.now()): boolean {
  if (!state?.backoffUntil) return false;
  const t = Date.parse(state.backoffUntil);
  return Number.isFinite(t) && now < t;
}

/** Age of the latest fixtures ATTEMPT in ms (Infinity if never attempted). */
export function fixturesAttemptAgeMs(
  state: CacheState | undefined,
  now = Date.now(),
): number {
  if (!state?.fixturesAttemptedAt) return Infinity;
  const t = Date.parse(state.fixturesAttemptedAt);
  return Number.isFinite(t) ? now - t : Infinity;
}

/** Age of the cache in ms (Infinity if absent/unparseable). */
export function ageMs(state: CacheState | undefined, now = Date.now()): number {
  if (!state) return Infinity;
  const t = Date.parse(state.updatedAt);
  return Number.isFinite(t) ? now - t : Infinity;
}

/**
 * Age of the cached knockout `fixtures` in ms (Infinity if never fetched). Its
 * own clock — `fixtures` refreshes on a slower cadence than `live`, so a fresh
 * live write must not make stale fixtures look fresh (or vice-versa).
 */
export function fixturesAgeMs(state: CacheState | undefined, now = Date.now()): number {
  if (!state?.fixturesUpdatedAt) return Infinity;
  const t = Date.parse(state.fixturesUpdatedAt);
  return Number.isFinite(t) ? now - t : Infinity;
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
    if (Number.isFinite(written)) return now - written;
  } catch {
    return Infinity; // no lock
  }
  // Lock exists but content is unparseable — fall back to mtime.
  try {
    return now - statSync(lp).mtimeMs;
  } catch {
    return Infinity;
  }
}

/** True if a refresher currently holds a non-stale lock. */
export function isLockFresh(now = Date.now()): boolean {
  return lockAgeMs(now) < LOCK_STALE_MS;
}

/** Acquire the refresh lock (atomic O_EXCL). Steals a stale lock. */
export function acquireLock(now = Date.now()): boolean {
  mkdirSync(cacheDir(), { recursive: true });
  const lp = lockPath();
  try {
    const fd = openSync(lp, 'wx'); // O_CREAT | O_EXCL
    try {
      writeSync(fd, `${process.pid} ${now}`);
    } finally {
      closeSync(fd);
    }
    return true;
  } catch {
    // Lock exists. Steal it only if it's stale (by written timestamp / mtime).
    if (lockAgeMs(now) > LOCK_STALE_MS) {
      try {
        rmSync(lp, { force: true });
      } catch {
        return false; // lost the race to remove it
      }
      // One retry; if someone else grabbed it first, give up (no recursion loop).
      try {
        const fd = openSync(lp, 'wx');
        try {
          writeSync(fd, `${process.pid} ${now}`);
        } finally {
          closeSync(fd);
        }
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

export function releaseLock(): void {
  try {
    rmSync(lockPath(), { force: true });
  } catch {
    /* ignore */
  }
}
