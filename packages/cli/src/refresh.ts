/**
 * Cache refresher — the COLD PATH. Runs as a detached child spawned by the
 * statusline (or as a standalone). Acquires a lock, fetches live state only
 * during a live window, and atomically writes the cache. Network happens here
 * and only here, never on the statusline hot path.
 */
import { spawn } from 'node:child_process';
import {
  allFixtures,
  byKickoff,
  DEFAULT_COMPETITION,
  EspnAdapter,
  getKnockoutFixtures,
  getLiveMatches,
  makeAdapter,
  resolveCompetition,
  type Match,
  type ProviderAdapter,
} from '@claudinho/core';
import {
  acquireLock,
  ageMs,
  type CacheState,
  fixturesAgeMs,
  isLockFresh,
  readState,
  releaseLock,
  writeState,
} from './cache';
import { inLiveWindow, LIVE_TTL_MS } from './statusline';

/** Don't re-fetch if the cache is younger than this (anti-stampede). */
const MIN_REFRESH_MS = 12_000;

/**
 * Knockout pairings change only when a match finishes, so the cached resolved
 * `fixtures` refresh on a much slower cadence than live scores — a few-minute lag
 * on a multi-day countdown is invisible, and this bounds the off-live-window
 * polling the statusline triggers to ~4 fetches/hour.
 */
const FIXTURES_TTL_MS = 15 * 60_000;

/**
 * BUT a successful fetch that returns ZERO resolved fixtures (ESPN hasn't filed
 * the pairings yet — the phase boundary, or the first poll as knockouts lock in)
 * must NOT suppress re-polling for the full 15min, or the statusline sits on
 * "⚽ —" long after the pairings appear. So an empty result is trusted only
 * briefly. (A provider ERROR is different — handled fail-closed by keeping the
 * prior cache; this is about a real-but-empty success.)
 */
const FIXTURES_EMPTY_TTL_MS = 60_000;

/**
 * Whether the cached knockout `fixtures` are stale enough to refetch. Uses the
 * short empty-TTL when the cache holds no resolved fixtures (re-poll soon at the
 * boundary), the long TTL once it holds some (pairings are stable).
 */
function fixturesStale(state: CacheState | undefined, now: number): boolean {
  const ttl = (state?.fixtures?.length ?? 0) > 0 ? FIXTURES_TTL_MS : FIXTURES_EMPTY_TTL_MS;
  return fixturesAgeMs(state, now) >= ttl;
}

/** The soonest upcoming static fixture (cheap; bundle is in memory). */
function nextStaticUpcoming(nowMs: number): Match | undefined {
  return [...allFixtures()].sort(byKickoff).find((m) => Date.parse(m.kickoff) >= nowMs);
}

/**
 * We're in the knockout phase (and on the default competition, the only one with
 * a bundled bracket) when the next upcoming fixture is a knockout — that's
 * exactly when the statusline needs live-resolved pairings the bundle lacks.
 */
export function inKnockoutPhase(nowMs: number): boolean {
  if (resolveCompetition() !== DEFAULT_COMPETITION) return false;
  const next = nextStaticUpcoming(nowMs);
  return !!next && next.stage !== 'GROUP' && next.stage !== 'FRIENDLY';
}

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
  const nowMs = now.getTime();
  const source = opts.source ?? 'espn';
  const competition = resolveCompetition();

  const cached = readState();
  // A snapshot from a different source/competition can't be reused — start fresh
  // (and refetch both parts) so e.g. a friendlies cache never bleeds into the WC.
  const sameScope =
    !!cached && cached.source === source && cached.competition === competition;
  const base: CacheState | undefined = sameScope ? cached : undefined;

  // Two INDEPENDENT cadences: live scores (~12s, only in a live window) and
  // resolved knockout fixtures (~15min, only in the knockout phase). Each part
  // skips if its own slice is still fresh — a live write must not block a due
  // fixtures fetch, or vice-versa.
  const needLive =
    liveWindowActive(nowMs) && (!base || ageMs(base, nowMs) >= MIN_REFRESH_MS);
  const needFixtures = inKnockoutPhase(nowMs) && fixturesStale(base, nowMs);
  if (!needLive && !needFixtures) return;

  if (!acquireLock()) return;
  try {
    // Carry the slice we're NOT refreshing this cycle so a fixtures-only refresh
    // doesn't drop live (and vice-versa).
    let live: Match[] = base?.live ?? [];
    let degraded = base?.degraded ?? false;
    let updatedAt = base?.updatedAt ?? now.toISOString();
    let fixtures = base?.fixtures;
    let fixturesUpdatedAt = base?.fixturesUpdatedAt;

    if (needLive) {
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
      updatedAt = now.toISOString();
    }

    if (needFixtures) {
      // Fail closed: getKnockoutFixtures returns degraded on a provider error —
      // KEEP the prior cached fixtures + timestamp rather than caching an empty
      // list as a real "no knockouts" (a transient outage must never read as
      // "your team is out"). Only a SUCCESSFUL fetch updates the slice + clock.
      try {
        const r = await getKnockoutFixtures(liveAdapter(), now);
        if (!r.degraded) {
          fixtures = r.fixtures;
          fixturesUpdatedAt = now.toISOString();
        }
      } catch {
        /* keep prior fixtures + timestamp; retry next cycle */
      }
    }

    writeState({
      updatedAt,
      live,
      degraded,
      source,
      competition,
      ...(fixtures ? { fixtures } : {}),
      ...(fixturesUpdatedAt ? { fixturesUpdatedAt } : {}),
    });
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
 * Decide whether to refresh the cached knockout `fixtures` — the trigger that
 * keeps the statusline's next-match countdown live OUTSIDE live windows (when
 * `shouldRefresh` is false). True only in the knockout phase, when the cached
 * fixtures are stale, and nobody's already refreshing. Pass the already-read
 * `state` to avoid a second cache read on the hot path.
 */
export function shouldRefreshFixtures(
  now = Date.now(),
  state: CacheState | undefined = readState(),
): boolean {
  if (!inKnockoutPhase(now)) return false;
  if (isLockFresh(now)) return false;
  return fixturesStale(state, now);
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
