/**
 * Cache refresher — the COLD PATH. Runs as a detached child spawned by the
 * statusline (or as a standalone). Acquires a lock, fetches live state only
 * during a live window, and atomically writes the cache. Network happens here
 * and only here, never on the statusline hot path.
 */
import { spawn } from 'node:child_process';
import { EspnAdapter, type Match } from '@claudinho/core';
import {
  acquireLock,
  ageMs,
  isLockFresh,
  readState,
  releaseLock,
  writeState,
} from './cache';
import { inLiveWindow, LIVE_TTL_MS } from './statusline';

/** Don't re-fetch if the cache is younger than this (anti-stampede). */
const MIN_REFRESH_MS = 12_000;

export interface RefreshOpts {
  source?: string;
  now?: Date;
}

/** Perform one refresh cycle (idempotent, lock-guarded). */
export async function runRefresh(opts: RefreshOpts = {}): Promise<void> {
  const now = opts.now ?? new Date();
  const source = opts.source ?? 'espn';

  // Skip if a recent refresh already produced fresh data.
  if (ageMs(readState(), now.getTime()) < MIN_REFRESH_MS) return;
  if (!acquireLock()) return;
  try {
    let live: Match[] = [];
    let degraded = false;

    if (inLiveWindow(now.getTime())) {
      try {
        // Skip group enrichment: the statusline doesn't need group letters,
        // so we avoid the extra standings request on this hot loop.
        const adapter = new EspnAdapter({ enrichGroups: false });
        live = await adapter.fetchLive();
      } catch {
        degraded = true;
      }
    }

    writeState({ updatedAt: now.toISOString(), live, degraded, source });
  } finally {
    releaseLock();
  }
}

/**
 * Decide whether a refresh is warranted right now (live window + stale cache +
 * nobody already refreshing).
 */
export function shouldRefresh(now = Date.now()): boolean {
  if (!inLiveWindow(now)) return false;
  if (isLockFresh(now)) return false;
  return ageMs(readState(), now) > LIVE_TTL_MS;
}

/**
 * Fire-and-forget a detached refresher process. Returns immediately; the child
 * outlives this process and writes the cache for the next render.
 */
export function spawnRefresh(source: string): void {
  try {
    const entry = process.argv[1];
    if (!entry) return;
    const child = spawn(process.execPath, [entry, '_refresh', '--source', source], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    /* best effort — never break the hot path */
  }
}
