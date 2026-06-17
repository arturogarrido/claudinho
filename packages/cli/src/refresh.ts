/**
 * Cache refresher — the COLD PATH. Runs as a detached child spawned by the
 * statusline (or as a standalone). Acquires a lock, fetches live state only
 * during a live window, and atomically writes the cache. Network happens here
 * and only here, never on the statusline hot path.
 */
import { spawn } from 'node:child_process';
import {
  DEFAULT_COMPETITION,
  EspnAdapter,
  getLiveMatches,
  makeAdapter,
  resolveCompetition,
  type Match,
  type ProviderAdapter,
} from '@claudinho/core';
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

/**
 * Whether to attempt a live fetch right now.
 *
 * For the World Cup we gate on the bundled static schedule (no pointless polling
 * 23h/day). But that schedule only knows World Cup fixtures — so when a
 * different competition is selected (e.g. CLAUDINHO_COMPETITION=fifa.friendly),
 * we can't know its windows statically and simply always allow the fetch.
 */
function liveWindowActive(nowMs: number): boolean {
  if (resolveCompetition() !== DEFAULT_COMPETITION) return true;
  return inLiveWindow(nowMs);
}

/** The live-fetch adapter, honoring CLAUDINHO_COMPETITION (group enrichment off). */
function liveAdapter(): ProviderAdapter {
  const competition = resolveCompetition();
  if (competition === DEFAULT_COMPETITION) {
    // Default WC path: skip the standings request the statusline doesn't need.
    return new EspnAdapter({ enrichGroups: false });
  }
  // Non-default competition: build via makeAdapter so the slug is applied.
  return makeAdapter('espn');
}

export interface RefreshOpts {
  source?: string;
  now?: Date;
}

/** Perform one refresh cycle (idempotent, lock-guarded). */
export async function runRefresh(opts: RefreshOpts = {}): Promise<void> {
  const now = opts.now ?? new Date();
  const source = opts.source ?? 'espn';
  const competition = resolveCompetition();

  // Skip only if a recent refresh already produced fresh data *for this same
  // source + competition*; otherwise re-fetch (e.g. the competition changed).
  const cached = readState();
  if (
    cached &&
    cached.source === source &&
    cached.competition === competition &&
    ageMs(cached, now.getTime()) < MIN_REFRESH_MS
  ) {
    return;
  }
  if (!acquireLock()) return;
  try {
    let live: Match[] = [];
    let degraded = false;

    if (liveWindowActive(now.getTime())) {
      // Use the domain helper, not adapter.fetchLive() directly: it fetches a
      // ±1-day window around `now` so a late kickoff filed under the provider's
      // adjacent day bucket is still detected (see core getLiveMatches). Without
      // this the statusline cache reads empty mid-match and shows a countdown.
      // getLiveMatches fails closed internally; the try also guards adapter
      // construction so any error degrades rather than skipping the cache write.
      try {
        const r = await getLiveMatches(liveAdapter(), now);
        live = r.matches;
        degraded = r.degraded;
      } catch {
        degraded = true;
      }
    }

    writeState({ updatedAt: now.toISOString(), live, degraded, source, competition });
  } finally {
    releaseLock();
  }
}

/**
 * Decide whether a refresh is warranted right now (live window + stale cache +
 * nobody already refreshing).
 */
export function shouldRefresh(now = Date.now()): boolean {
  if (!liveWindowActive(now)) return false;
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
