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
  isTournamentWindowOver,
  LIVE_WINDOW_MS,
  mergeLive,
  nextFixtureForTeam,
  displayWidth,
  parseCachedMatch,
  parsedValue,
  type BoundedList,
  truncateVisible,
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
   * Capped at DEFAULT_MAX_SEGMENTS regardless — this is a one-line surface.
   */
  max?: number;
  /** Render emoji flags (default true); false → 3-letter codes (flagless terminals). */
  flags?: boolean;
  now?: Date;
  /**
   * Whether the bundled (World Cup) schedule actually describes what we're
   * following. False when `CLAUDINHO_COMPETITION` points elsewhere, which makes
   * the bundle's "every window has elapsed" answer meaningless — so the
   * post-tournament sign-off is suppressed and we fall back to `⚽ —`.
   * Resolved by the caller (this module stays env-free, like `flags`).
   */
  defaultCompetition?: boolean;
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
/**
 * Cache records the hot path will sanitize. Far above any real matchday (12),
 * and the ceiling on how much work a cache file can make the statusline do.
 *
 * A cache holding more live matches than this is already lying — an attacker
 * with write access could equally have deleted the real fixture — so the
 * trade-off is bounded work against a hypothetical hidden record, and work
 * wins on a surface that renders on every prompt.
 */
export const MAX_LIVE_CONSIDERED = 64;

/**
 * Records we are willing to SEAL before giving up, however many look live.
 *
 * Higher than the result cap so junk cannot crowd out a real match, but finite
 * so a poisoned cache cannot make the hot path scale with the file.
 */
const MAX_LIVE_EXAMINED = 512;

/**
 * Cached knockout fixtures, sealed until we have enough — NOT sliced first.
 *
 * The sibling of the live-list bug, and it survived the round that fixed that
 * one: this took the first 64 records passing a cheap shape test and sealed
 * those, so 64 malformed shapes could hide the first real resolved pairing and
 * the statusline fell back to "⚽ —" with a confirmed tie sitting in the cache.
 * Bound the CANDIDATES examined, not the RESULTS kept.
 *
 * `events: false` — this surface renders a scoreline, not a timeline, and
 * sealing per-event labels is the dominant cost on a 150ms budget.
 */
function sealFixtures(raw: unknown): BoundedList<Match> {
  if (raw === undefined) {
    return { items: [], total: 0, shown: 0, truncated: false, complete: true };
  }
  if (!Array.isArray(raw)) {
    return { items: [], total: 0, shown: 0, truncated: false, complete: false };
  }
  const out: Match[] = [];
  let inspected = 0;
  let readable = true;
  for (const rec of raw) {
    if (out.length >= MAX_LIVE_CONSIDERED || inspected >= MAX_LIVE_EXAMINED) break;
    inspected++;
    if (!isMatchShaped(rec)) {
      readable = false;
      continue;
    }
    const sealed = parsedValue(parseCachedMatch(rec, { events: false }));
    if (sealed) out.push(sealed);
    else readable = false;
  }
  const exhausted = inspected === raw.length;
  const complete = exhausted && readable;
  return {
    items: out,
    // Exact only when complete; otherwise this is the number actually sealed.
    // Callers use a nonnumeric marker for an incomplete scan.
    total: out.length,
    shown: out.length,
    truncated: !exhausted,
    complete,
  };
}

export function liveMatchesFromCache(
  state: CacheState | undefined,
  nowMs = Date.now(),
): BoundedList<Match> {
  const fresh = state && ageMs(state, nowMs) < DISPLAY_STALE_MS;
  const rawLive = fresh ? state?.live : [];
  if (!Array.isArray(rawLive)) {
    return { items: [], total: 0, shown: 0, truncated: false, complete: false };
  }
  const liveArr = rawLive;

  // SEAL UNTIL WE HAVE ENOUGH — do not slice first and seal the slice.
  //
  // Sealing is grapheme-level over ~8 fields, so it cannot run on every record
  // of an unbounded file (measured 2,487ms at 20,000 records against a 150ms
  // budget). The previous fix took the first 64 records passing a CHEAP shape
  // test and sealed those — which meant 64 records that merely LOOK live, and
  // seal to nothing, consumed the whole budget and hid a real live match behind
  // them. The statusline showed a countdown while a match was being played,
  // which is the failure this surface exists to avoid.
  //
  // Bounding the CANDIDATES examined keeps the work bounded; bounding the
  // RESULTS keeps a real match from being crowded out by junk.
  const out: Match[] = [];
  let inspected = 0;
  let readable = true;
  for (let i = 0; i < liveArr.length; i++) {
    if (out.length >= MAX_LIVE_CONSIDERED || inspected >= MAX_LIVE_EXAMINED) break;
    inspected++;
    const raw = liveArr[i];
    if (!raw || typeof raw !== 'object') {
      readable = false;
      continue;
    }
    const m = raw as Match;
    // Cheap test first: it costs nothing and skips most junk without sealing.
    if (!isLive(m.status) || !m.home?.code || !m.away?.code) {
      readable = false;
      continue;
    }
    const sealed = parsedValue(parseCachedMatch(m, { events: false }));
    if (sealed) out.push(sealed);
    else readable = false;
  }
  const exhausted = inspected === liveArr.length;
  const complete = exhausted && readable;

  return {
    items: out,
    total: out.length,
    shown: out.length,
    truncated: !exhausted,
    // False when we stopped early or a record was unreadable. In either case an
    // empty list must not render as the authoritative "nothing is on".
    complete,
  };
}

/**
 * Live-match segments rendered before the rest collapse to "+N". A World Cup
 * matchday peaks well below this; the cap exists so a poisoned cache cannot
 * decide how long the user's prompt line is.
 */
const DEFAULT_MAX_SEGMENTS = 8;

/**
 * Hard ceiling on the whole rendered line, in display columns.
 *
 * The statusline's contract is a single short line in someone's prompt. Every
 * field is capped, but nothing capped the LINE — a poisoned cache produced a
 * ~850 KB single line. Applied as a wrapper over every branch rather than at
 * each `return`, so a branch added later cannot forget it.
 */
const MAX_LINE_COLUMNS = 200;

export function renderPrompt(state: CacheState | undefined, opts: PromptOpts = {}): string {
  return truncateVisible(renderPromptLine(state, opts), MAX_LINE_COLUMNS);
}

function renderPromptLine(state: CacheState | undefined, opts: PromptOpts = {}): string {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const defaultCompetition = opts.defaultCompetition ?? true;
  const compact = opts.compact ?? true;
  const flags = opts.flags ?? true;
  const team = opts.team?.toUpperCase();

  const liveList = liveMatchesFromCache(state, nowMs);
  const live = liveList.items;

  // The static bundle MERGED with the refresher's cached resolved knockout
  // fixtures — the bundle's KO slots are 🏳️ placeholders the hot path can't
  // resolve itself, so this overlay is how the statusline shows real pairings
  // (still NETWORK-FREE: reads only the cache). Used by both the syncing and
  // next-fixture branches below.
  // Sanitized like the live slice above — cached fixtures render on the
  // countdown/syncing lines, so they get the same poisoned-cache defense.
  // Malformed entries (null, {}, missing kickoff/teams) are dropped, never
  // allowed to throw the whole statusline blank downstream.
  const cachedFixtureList = sealFixtures(state?.fixtures);
  // A partial fixture overlay cannot prove a pairing is absent, but every
  // sealed pairing it does contain is safe to display.
  const cachedFixtures = [...cachedFixtureList.items];
  const schedule = cachedFixtures.length ? mergeLive(allFixtures(), cachedFixtures) : undefined;

  // With a team filter, show only that team's live match.
  if (team) {
    const mine = live.find((m) => m.home?.code === team || m.away?.code === team);
    if (mine) return `⚽ ${matchSegment(mine, compact, flags)}`;
  } else if (live.length > 0) {
    // No filter → show live matches inline, separated by " · ".
    // CLAUDINHO_MAX caps how many render before the rest collapse to "+N", but
    // it is opt-IN: with no filter and no env var, `max` defaulted to
    // live.length, so the count was UNBOUNDED. A poisoned cache listing 500
    // matches produced a single ~850 KB "line", and this surface's entire
    // contract is that it is one short line in the user's prompt.
    const max = opts.max && opts.max > 0 ? Math.min(opts.max, DEFAULT_MAX_SEGMENTS) : DEFAULT_MAX_SEGMENTS;
    const shown = live.slice(0, max);
    // "+N" is only used when the reader finished and therefore knows the exact
    // set. An incomplete scan gets a nonnumeric marker: unexamined records may
    // be junk or valid matches, so no exact count exists.
    const overflow = live.length - shown.length;
    const marker = !liveList.complete ? ' +more' : overflow > 0 ? ` +${overflow}` : '';
    // The overflow marker is the honest part of this line — it is what says the
    // list is incomplete — so it must survive the width cap. Truncating the
    // whole line afterwards cut the marker off the end, turning a truncated
    // list back into one that looks complete. Reserve its room and append it.
    const body = '⚽ ' + shown.map((m) => matchSegment(m, compact, flags)).join(' · ');
    return truncateVisible(body, MAX_LINE_COLUMNS - displayWidth(marker)) + marker;
  }

  // Cold/stale cache during a live window: a countdown here is actively
  // misleading — a match is on, and the static schedule alone tells us that.
  // Say "live · syncing" until the refresher lands a snapshot. A FRESH,
  // NON-DEGRADED snapshot with no live matches is trusted as-is (per the feed
  // nothing is in play — early FT, delay, postponement) and falls through to
  // the countdown; a degraded snapshot means "the fetch failed", not "the
  // feed said empty", so it must not bring the countdown back mid-match.
  const cacheFresh =
    !!state &&
    state.degraded !== true &&
    ageMs(state, nowMs) < DISPLAY_STALE_MS;
  // An incomplete scan only justifies "syncing" when the schedule says a match
  // may actually be on. On a quiet morning (or after the tournament), cache
  // junk must not turn into a false live-score outage claim.
  if (!cacheFresh || !liveList.complete) {
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
  // Gated on the DEFAULT competition: the bundled schedule describes the World
  // Cup, so with CLAUDINHO_COMPETITION pointing elsewhere its "windows elapsed"
  // answer says nothing about that feed — signing off there would be a permanent
  // wrong line on a live competition. Falls back to "⚽ —".
  if (defaultCompetition && isTournamentWindowOver(nowMs, schedule)) {
    return TOURNAMENT_COMPLETE_LINE;
  }

  return '⚽ —';
}
