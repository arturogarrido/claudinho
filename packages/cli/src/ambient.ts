/**
 * The ambient reader of `claudinho ambient --json`: the statusline's line, the
 * hook's block and the structured twin of what they read, from one cache
 * snapshot. Its own module, beside the two renderers it calls
 * (`statusline.ts`, `hook.ts`), so neither renderer imports the other. The hot
 * path's rules: pure, no network, no market, no file read.
 */
import type { AmbientMatch, AmbientView, Pin } from '@claudinho/core';
import { isPinnedSide } from '@claudinho/core';
import { type CacheState, validStamp } from './cache';
import { renderHook } from './hook';
import {
  countdownFixture,
  countdownSchedule,
  DISPLAY_STALE_MS,
  defaultTeamKind,
  isPicked,
  liveMatchesFromCache,
  pickAmbientMatch,
  type PromptOpts,
  renderPrompt,
} from './statusline';

/** What the ambient view reads beyond the line's options. */
export interface AmbientOpts extends PromptOpts {
  /**
   * The SAVED pin (`claudinho follow <alias> --team`, `cfg.pin`): the side a
   * record's `pinned` names, whatever `pick` prefers (`CLAUDINHO_TEAM`'s code
   * picks a match; it never pins one). Absent: the pin `pick` carries, if any.
   */
  pin?: Pin;
}

/** The ambient view as the cache gives it: the command adds the selection, the disclaimer and the pick. */
export type AmbientRead = Omit<AmbientView, 'competition' | 'disclaimer' | 'pick' | 'pickUnreadable'>;

/**
 * THE ambient reader of `claudinho ambient --json` (core's `AmbientView`, less
 * what the command knows): the line `prompt` prints and the block `hook`
 * prints (their own renderers, with the SAME options and one clock), and the
 * structured twin of what they read: the live list from the same reader
 * (`liveMatchesFromCache`: the display window, the examine cap, no `events`),
 * ordered by the one preference (`pickAmbientMatch`), each record marked
 * `picked` (the preference's side) and `pinned` (the saved pin's, by core's
 * `isPinnedSide`), with the reader's own `total`/`shown`/`truncated`/
 * `complete`; the fixture the countdown names; the snapshot's own facts and
 * the deadline of its live scores. Pure and total like `renderPrompt`: no
 * network, no market, no file read, and a malformed snapshot never throws.
 */
export function ambientView(state: CacheState | undefined, opts: AmbientOpts = {}): AmbientRead {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const defaultCompetition = opts.defaultCompetition ?? true;
  const kind = opts.teamKind ?? defaultTeamKind(opts.defaultCompetition);
  const pin = opts.pin ?? (opts.pick && 'team' in opts.pick ? opts.pick.team : undefined);
  const read = { ...opts, now };

  const list = liveMatchesFromCache(state, nowMs, kind);
  const items: AmbientMatch[] = pickAmbientMatch(list.items, opts.pick).map((m) => ({
    ...m,
    picked: isPicked(m, opts.pick),
    pinned: pin !== undefined && (isPinnedSide(m.home, pin) || isPinnedSide(m.away, pin)),
  }));
  const context = renderHook(state, read);
  const { schedule } = countdownSchedule(state, defaultCompetition, kind);
  // The snapshot's stamp, re-emitted canonically, and the instant its live
  // scores stop being shown; neither without a stamp that is one.
  const stamp = state && validStamp(state.updatedAt) ? Date.parse(state.updatedAt) : undefined;
  const staleAt = stamp === undefined ? undefined : new Date(stamp + DISPLAY_STALE_MS);
  return {
    line: renderPrompt(state, read),
    context: context === '' ? null : context,
    live: { items, total: list.total, shown: list.shown, truncated: list.truncated, complete: list.complete },
    next: countdownFixture(nowMs, schedule, opts.pick) ?? null,
    degraded: state?.degraded === true,
    source: typeof state?.source === 'string' ? state.source : null,
    updatedAt: stamp === undefined ? null : new Date(stamp).toISOString(),
    staleAfter: staleAt === undefined || Number.isNaN(staleAt.getTime()) ? null : staleAt.toISOString(),
  };
}
