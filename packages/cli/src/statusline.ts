/**
 * Statusline rendering — the HOT PATH. Pure, synchronous, no network: it reads
 * a cached snapshot and the static schedule and returns one compact line.
 * Live scores come from the cache (refreshed out of band); the countdown to the
 * next fixture is computed live from the static kickoff time, so it ticks for
 * free on every render even with no refresh.
 */
import {
  allFixtures,
  byKickoff,
  countdown,
  isLive,
  nextFixtureForTeam,
  scoreline,
  type Match,
} from '@claudinho/core';
import { ageMs, type CacheState } from './cache';

/** A fixture is potentially live from kickoff until ~kickoff + 140 min. */
export const LIVE_WINDOW_MS = 140 * 60_000;
/** Don't display cached live scores older than this (avoid stale scores). */
export const DISPLAY_STALE_MS = 5 * 60_000;
/** Refresh the cache when it's older than this during a live window. */
export const LIVE_TTL_MS = 15_000;

/** Are we inside a potential live window for any fixture? (cheap, static) */
export function inLiveWindow(now = Date.now(), fixtures: Match[] = allFixtures()): boolean {
  for (const m of fixtures) {
    const k = Date.parse(m.kickoff);
    if (now >= k && now <= k + LIVE_WINDOW_MS) return true;
  }
  return false;
}

/** The soonest upcoming fixture across the whole tournament. */
function nextOverall(now: number, fixtures: Match[] = allFixtures()): Match | undefined {
  return [...fixtures].sort(byKickoff).find((m) => Date.parse(m.kickoff) >= now);
}

export interface PromptOpts {
  /** Preferred team code (e.g. "MEX"); prioritizes that team's match. */
  team?: string;
  /** Compact (flags + score only). When false, includes 3-letter codes. */
  compact?: boolean;
  now?: Date;
}

function liveLine(m: Match, compact: boolean, others: number, team?: string): string {
  const minute = m.status === 'HT' ? 'HT' : m.minute ? `${m.minute}'` : 'LIVE';
  const home = compact ? m.home.flag : `${m.home.flag} ${m.home.code}`;
  const away = compact ? m.away.flag : `${m.away.code} ${m.away.flag}`;
  let s = `⚽ ${home} ${scoreline(m)} ${away} ${minute}`;
  if (!team && others > 0) s += ` +${others}`;
  return s;
}

/**
 * Render the one-line status. Pure: given a cache snapshot and options, returns
 * the string. Never throws on bad input.
 */
/**
 * The live matches we can trust from a cache snapshot: cache must be recent,
 * `live` must be an array, and each entry must be a well-formed match. Guards
 * against a corrupt cache (?? only catches null/undefined) so callers never
 * throw on bad input. Returns [] when there's nothing trustworthy/live.
 */
export function liveMatchesFromCache(
  state: CacheState | undefined,
  nowMs = Date.now(),
): Match[] {
  const fresh = state && ageMs(state, nowMs) < DISPLAY_STALE_MS;
  const liveArr = fresh && Array.isArray(state?.live) ? state!.live : [];
  return liveArr.filter(
    (m): m is Match =>
      !!m && typeof m === 'object' && isLive(m.status) && !!m.home?.code && !!m.away?.code,
  );
}

export function renderPrompt(state: CacheState | undefined, opts: PromptOpts = {}): string {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const compact = opts.compact ?? true;
  const team = opts.team?.toUpperCase();

  const live = liveMatchesFromCache(state, nowMs);

  let pick: Match | undefined;
  if (team) pick = live.find((m) => m.home?.code === team || m.away?.code === team);
  if (!pick && !team) pick = live[0];

  if (pick) return liveLine(pick, compact, live.length - 1, team);

  // Nothing (relevant) live → next-fixture countdown (pure static).
  const next = team ? nextFixtureForTeam(team, { from: now }) : nextOverall(nowMs);
  if (next) {
    return `${next.home.flag} vs ${next.away.flag} in ${countdown(next.kickoff, now)}`;
  }
  return '⚽ —';
}
