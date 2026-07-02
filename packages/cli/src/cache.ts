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
import type { Match } from '@claudinho/core';
import { cacheDir, writeFileAtomic } from './paths';

export { cacheDir } from './paths';

/** The cached snapshot. `live` holds in-progress matches at `updatedAt`. */
export interface CacheState {
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
}

const LOCK_STALE_MS = 60_000;

export function cachePath(): string {
  return join(cacheDir(), 'state.json');
}

function lockPath(): string {
  return join(cacheDir(), 'refresh.lock');
}

/** Read the cached state, or undefined if missing/corrupt (never throws). */
export function readState(): CacheState | undefined {
  try {
    return JSON.parse(readFileSync(cachePath(), 'utf8')) as CacheState;
  } catch {
    return undefined;
  }
}

/**
 * Read the cache only if it was produced for the *current* source + competition.
 * A snapshot fetched under a different `CLAUDINHO_COMPETITION` (e.g. friendlies)
 * must never bleed into a World-Cup statusline/hook, even while it's fresh.
 */
export function readCurrentState(
  source: string,
  competition: string,
): CacheState | undefined {
  const s = readState();
  return s && s.source === source && s.competition === competition ? s : undefined;
}

/** Atomically write the cached state. */
export function writeState(state: CacheState): void {
  writeFileAtomic(cachePath(), JSON.stringify(state));
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
