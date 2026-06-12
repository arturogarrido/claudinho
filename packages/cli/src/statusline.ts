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
  fixturesInLiveWindow,
  isLive,
  LIVE_WINDOW_MS,
  nextFixtureForTeam,
  scoreline,
  type Match,
} from '@claudinho/core';
import { ageMs, type CacheState } from './cache';

// The live-window constant lives in core (shared with the market-relevance
// gate); re-exported here so existing call sites keep importing from this file.
export { LIVE_WINDOW_MS };
/** Don't display cached live scores older than this (avoid stale scores). */
export const DISPLAY_STALE_MS = 5 * 60_000;
/** Refresh the cache when it's older than this during a live window. */
export const LIVE_TTL_MS = 15_000;

/** Are we inside a potential live window for any fixture? (cheap, static) */
export function inLiveWindow(now = Date.now(), fixtures: Match[] = allFixtures()): boolean {
  return fixturesInLiveWindow(now, fixtures).length > 0;
}

/** The soonest upcoming fixture across the whole tournament. */
function nextOverall(now: number, fixtures: Match[] = allFixtures()): Match | undefined {
  return [...fixtures].sort(byKickoff).find((m) => Date.parse(m.kickoff) >= now);
}

export interface PromptOpts {
  /** Preferred team code (e.g. "MEX"); when set, shows only that team's match. */
  team?: string;
  /** Compact (flags + score only). When false, includes 3-letter codes. */
  compact?: boolean;
  /**
   * Max live matches to show inline before collapsing the rest into "+N".
   * Default: show all. (CLAUDINHO_MAX caps it for busy days.)
   */
  max?: number;
  now?: Date;
}

/** One match as a segment (no leading icon), e.g. "🇪🇸 1–1 🇮🇶 87'". */
function matchSegment(m: Match, compact: boolean): string {
  const minute = m.status === 'HT' ? 'HT' : m.minute ? `${m.minute}'` : 'LIVE';
  const home = compact ? m.home.flag : `${m.home.flag} ${m.home.code}`;
  const away = compact ? m.away.flag : `${m.away.code} ${m.away.flag}`;
  return `${home} ${scoreline(m)} ${away} ${minute}`;
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

  // With a team filter, show only that team's live match.
  if (team) {
    const mine = live.find((m) => m.home?.code === team || m.away?.code === team);
    if (mine) return `⚽ ${matchSegment(mine, compact)}`;
  } else if (live.length > 0) {
    // No filter → show all live matches inline, separated by " · ".
    // CLAUDINHO_MAX caps how many render before the rest collapse to "+N".
    const max = opts.max && opts.max > 0 ? opts.max : live.length;
    const shown = live.slice(0, max);
    let line = '⚽ ' + shown.map((m) => matchSegment(m, compact)).join(' · ');
    const overflow = live.length - shown.length;
    if (overflow > 0) line += ` +${overflow}`;
    return line;
  }

  // Cold/stale cache during a live window: a countdown here is actively
  // misleading — a match is on, and the static schedule alone tells us that.
  // Say "live · syncing" until the refresher lands a snapshot. A FRESH snapshot
  // with no live matches is trusted as-is (per the feed nothing is in play —
  // early FT, delay, postponement) and falls through to the countdown.
  const cacheFresh = !!state && ageMs(state, nowMs) < DISPLAY_STALE_MS;
  if (!cacheFresh) {
    const win = fixturesInLiveWindow(nowMs).filter(
      (m) => !team || m.home.code === team || m.away.code === team,
    );
    const first = win[0];
    if (first) {
      const more = win.length - 1;
      return (
        `⚽ ${first.home.flag} vs ${first.away.flag} live · syncing…` +
        (more > 0 ? ` +${more}` : '')
      );
    }
  }

  // Nothing (relevant) live → next-fixture countdown (pure static).
  const next = team ? nextFixtureForTeam(team, { from: now }) : nextOverall(nowMs);
  if (next) {
    return `${next.home.flag} vs ${next.away.flag} in ${countdown(next.kickoff, now)}`;
  }
  return '⚽ —';
}
