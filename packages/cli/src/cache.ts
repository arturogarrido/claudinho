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
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Match } from '@claudinho/core';

/** The cached snapshot. `live` holds in-progress matches at `updatedAt`. */
export interface CacheState {
  updatedAt: string; // ISO 8601
  live: Match[];
  degraded: boolean;
  source: string;
}

const LOCK_STALE_MS = 60_000;

export function cacheDir(): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(base, 'claudinho');
}

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

/** Atomically write the cached state. */
export function writeState(state: CacheState): void {
  const dir = cacheDir();
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `state.${process.pid}.tmp`);
  writeFileSync_(tmp, JSON.stringify(state));
  renameSync(tmp, cachePath()); // atomic on the same filesystem
}

// Small helper to avoid importing writeFileSync separately from writeSync use.
function writeFileSync_(path: string, data: string): void {
  const fd = openSync(path, 'w');
  try {
    writeSync(fd, data);
  } finally {
    closeSync(fd);
  }
}

/** Age of the cache in ms (Infinity if absent/unparseable). */
export function ageMs(state: CacheState | undefined, now = Date.now()): number {
  if (!state) return Infinity;
  const t = Date.parse(state.updatedAt);
  return Number.isFinite(t) ? now - t : Infinity;
}

/** True if a refresher currently holds a fresh lock. */
export function isLockFresh(now = Date.now()): boolean {
  try {
    return now - statSync(lockPath()).mtimeMs < LOCK_STALE_MS;
  } catch {
    return false;
  }
}

/** Acquire the refresh lock (atomic O_EXCL). Steals a stale lock. */
export function acquireLock(): boolean {
  mkdirSync(cacheDir(), { recursive: true });
  const lp = lockPath();
  try {
    const fd = openSync(lp, 'wx'); // O_CREAT | O_EXCL
    try {
      writeSync(fd, `${process.pid} ${Date.now()}`);
    } finally {
      closeSync(fd);
    }
    return true;
  } catch {
    try {
      if (Date.now() - statSync(lp).mtimeMs > LOCK_STALE_MS) {
        rmSync(lp, { force: true });
        return acquireLock();
      }
    } catch {
      /* lost a race; treat as not acquired */
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
