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
  isResolvedNation,
  isTournamentComplete,
  LIVE_WINDOW_MS,
  mergeLive,
  nextFixtureForTeam,
  sanitizeMatchStrings,
  scoreline,
  type Match,
} from '@claudinho/core';
import { ageMs, type CacheState } from './cache';

// The live-window constant lives in core (shared with the market-relevance
// gate); re-exported here so existing call sites keep importing from this file.
export { LIVE_WINDOW_MS };
/** Don't display cached live scores older than this (avoid stale scores). */
export const DISPLAY_STALE_MS = 5 * 60_000;

/**
 * Shown once every bundled fixture has been played, in place of a permanent,
 * unexplained "⚽ —". English-only like the rest of the statusline (a deliberate
 * carve-out from the four-locale rule for the two ambient surfaces), and CTA-free
 * by design — no star ask, no URL on the hot path.
 */
export const TOURNAMENT_COMPLETE_LINE =
  '⚽ World Cup 2026 is complete · Thanks for vibing with Claudinho';

/**
 * Terminals whose renderer doesn't compose regional-indicator pairs into flag
 * emoji — they show the boxed letters instead (🇨🇭 → "CH", 🇧🇦 → "BA"), which is
 * noisier than the plain 3-letter code. We default these to codes.
 */
const FLAGLESS_TERMINALS = new Set(['WarpTerminal']);

/**
 * Whether to render emoji flags in the statusline/hook. Explicit CLAUDINHO_FLAGS
 * wins (on/off); otherwise auto — off on a terminal known not to render flag
 * emoji (e.g. Warp), on everywhere else. Pure given an env snapshot so callers
 * resolve it once and pass the boolean into the (env-free) render functions.
 */
export function flagsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.CLAUDINHO_FLAGS ?? '').trim().toLowerCase();
  if (v === 'off' || v === '0' || v === 'no' || v === 'false') return false;
  if (v === 'on' || v === '1' || v === 'yes' || v === 'true') return true;
  return !FLAGLESS_TERMINALS.has(env.TERM_PROGRAM ?? '');
}
/** Refresh the cache when it's older than this during a live window. */
export const LIVE_TTL_MS = 15_000;

/** Are we inside a potential live window for any fixture? (cheap, static) */
export function inLiveWindow(now = Date.now(), fixtures: Match[] = allFixtures()): boolean {
  return fixturesInLiveWindow(now, fixtures).length > 0;
}

/** Both nations known — i.e. not an unresolved bracket placeholder (🏳️). */
function isResolvedFixture(m: Match): boolean {
  return isResolvedNation(m.home) && isResolvedNation(m.away);
}

/**
 * Minimal Match shape the render paths rely on: `id` (mergeLive keying),
 * `kickoff` string (byKickoff sorts with localeCompare — a missing kickoff
 * throws), and both team codes. A cached element failing this is DROPPED, so a
 * partially-poisoned cache degrades to "that fixture is missing" instead of
 * throwing the whole statusline blank.
 */
function isMatchShaped(m: unknown): m is Match {
  const x = m as Match | null | undefined;
  return (
    !!x &&
    typeof x === 'object' &&
    typeof x.id === 'string' &&
    typeof x.kickoff === 'string' &&
    !!x.home?.code &&
    !!x.away?.code
  );
}

/**
 * The soonest upcoming RESOLVED fixture. Skips unresolved knockout placeholders
 * so the no-team statusline fails closed to "⚽ —" rather than leaking
 * "🏳️ vs 🏳️" once the group stage ends and every static fixture is a placeholder.
 */
function nextOverall(now: number, fixtures: Match[] = allFixtures()): Match | undefined {
  return [...fixtures]
    .sort(byKickoff)
    .find((m) => Date.parse(m.kickoff) >= now && isResolvedFixture(m));
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
  /** Render emoji flags (default true); false → 3-letter codes (flagless terminals). */
  flags?: boolean;
  now?: Date;
}

/** A team's compact token: emoji flag, or its 3-letter code when flags are off. */
function teamTok(t: { code: string; flag: string }, flags: boolean): string {
  return flags ? t.flag : t.code;
}

/** One match as a segment (no leading icon), e.g. "🇪🇸 1–1 🇮🇶 87'". */
function matchSegment(m: Match, compact: boolean, flags: boolean): string {
  const minute = m.status === 'HT' ? 'HT' : m.minute ? `${m.minute}'` : 'LIVE';
  if (!flags) {
    // Codes only — a flagless terminal would render the flag as boxed letters,
    // so the code already carries that info without the noise. Compact and
    // non-compact converge here (the code is the whole token).
    return `${m.home.code} ${scoreline(m)} ${m.away.code} ${minute}`;
  }
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
  return liveArr
    .filter(
      (m): m is Match =>
        !!m && typeof m === 'object' && isLive(m.status) && !!m.home?.code && !!m.away?.code,
    )
    // Mirror of the adapter's feed sanitizer: the statusline/hook render these
    // strings on every prompt, so a poisoned CACHE FILE (not just a poisoned
    // feed) must not inject ANSI/newlines into the terminal or Claude's context.
    .map(sanitizeMatchStrings);
}

export function renderPrompt(state: CacheState | undefined, opts: PromptOpts = {}): string {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const compact = opts.compact ?? true;
  const flags = opts.flags ?? true;
  const team = opts.team?.toUpperCase();

  const live = liveMatchesFromCache(state, nowMs);

  // The static bundle MERGED with the refresher's cached resolved knockout
  // fixtures — the bundle's KO slots are 🏳️ placeholders the hot path can't
  // resolve itself, so this overlay is how the statusline shows real pairings
  // (still NETWORK-FREE: reads only the cache). Used by both the syncing and
  // next-fixture branches below.
  // Sanitized like the live slice above — cached fixtures render on the
  // countdown/syncing lines, so they get the same poisoned-cache defense.
  // Malformed entries (null, {}, missing kickoff/teams) are dropped, never
  // allowed to throw the whole statusline blank downstream.
  const cachedFixtures = Array.isArray(state?.fixtures)
    ? (state!.fixtures as unknown[]).filter(isMatchShaped).map(sanitizeMatchStrings)
    : [];
  const schedule = cachedFixtures.length ? mergeLive(allFixtures(), cachedFixtures) : undefined;

  // With a team filter, show only that team's live match.
  if (team) {
    const mine = live.find((m) => m.home?.code === team || m.away?.code === team);
    if (mine) return `⚽ ${matchSegment(mine, compact, flags)}`;
  } else if (live.length > 0) {
    // No filter → show all live matches inline, separated by " · ".
    // CLAUDINHO_MAX caps how many render before the rest collapse to "+N".
    const max = opts.max && opts.max > 0 ? opts.max : live.length;
    const shown = live.slice(0, max);
    let line = '⚽ ' + shown.map((m) => matchSegment(m, compact, flags)).join(' · ');
    const overflow = live.length - shown.length;
    if (overflow > 0) line += ` +${overflow}`;
    return line;
  }

  // Cold/stale cache during a live window: a countdown here is actively
  // misleading — a match is on, and the static schedule alone tells us that.
  // Say "live · syncing" until the refresher lands a snapshot. A FRESH,
  // NON-DEGRADED snapshot with no live matches is trusted as-is (per the feed
  // nothing is in play — early FT, delay, postponement) and falls through to
  // the countdown; a degraded snapshot means "the fetch failed", not "the
  // feed said empty", so it must not bring the countdown back mid-match.
  const cacheFresh =
    !!state && state.degraded !== true && ageMs(state, nowMs) < DISPLAY_STALE_MS;
  if (!cacheFresh) {
    const win = fixturesInLiveWindow(nowMs, schedule).filter(
      (m) => !team || m.home.code === team || m.away.code === team,
    );
    const first = win[0];
    if (first) {
      const more = win.length - 1;
      // Drop the matchup when the in-window fixture is still a 🏳️ placeholder
      // (a knockout the overlay hasn't resolved) — never paste "🏳️ vs 🏳️"; just
      // say a match is on and we're syncing.
      const matchup = isResolvedFixture(first)
        ? `${teamTok(first.home, flags)} vs ${teamTok(first.away, flags)} `
        : '';
      return `⚽ ${matchup}live · syncing…` + (more > 0 ? ` +${more}` : '');
    }
  }

  // Nothing (relevant) live → next-fixture countdown over the merged schedule
  // (resolved knockout pairings show; unresolved 🏳️ slots are skipped, so this
  // fails closed to "⚽ —", never "🏳️ vs 🏳️").
  const next = team
    ? nextFixtureForTeam(team, { from: now, fixtures: schedule })
    : nextOverall(nowMs, schedule);
  if (next && isResolvedFixture(next)) {
    return `${teamTok(next.home, flags)} vs ${teamTok(next.away, flags)} in ${countdown(next.kickoff, now)}`;
  }

  // Tournament provably over (every bundled fixture's window has closed) → sign
  // off instead of a permanent, unexplained "⚽ —". Deliberately NO star CTA and
  // no URL: this is the hot path, which re-renders on every prompt forever, and
  // star CTAs are interactive-surface-only (see starNudge.ts / AGENTS.md). The
  // sign-off WITH the CTA lives on `today`/`live`/`next`, where a human reads it.
  // Note this is checked AFTER the countdown, so an eliminated team mid-tournament
  // (no next fixture, schedule not exhausted) still falls through to "⚽ —".
  if (isTournamentComplete(nowMs, schedule)) return TOURNAMENT_COMPLETE_LINE;

  return '⚽ —';
}
