/**
 * The ambient reader of `claudinho ambient --json`: the statusline's line, the
 * hook's block and the structured twin of what they read, from one cache
 * snapshot. Its own module, beside the two renderers it calls
 * (`statusline.ts`, `hook.ts`), so neither renderer imports the other. The hot
 * path's rules: pure, no network, no market, no file read.
 */
import type { AmbientMatch, AmbientView, Pin } from '@claudinho/core';
import { isPinnedSide } from '@claudinho/core';
import { type CacheState, stampAgeMs } from './cache';
import { renderHook } from './hook';
import {
  countdownFixture,
  countdownSchedule,
  DISPLAY_STALE_MS,
  defaultTeamKind,
  isPicked,
  liveMatchesFromCache,
  liveWhole,
  pickAmbientMatch,
  type PromptOpts,
  renderPrompt,
  syncingWindow,
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
 * `complete`; whether that list is `current` (a believed snapshot's inside
 * its display window, not degraded, its read whole as the snapshot states,
 * the line not syncing: the one rule, `syncingWindow`);
 * the fixture the countdown names; the snapshot's own facts and the deadline
 * of its live scores, its stamp judged by the reader's own rule
 * (`stampAgeMs`). Pure and total like `renderPrompt`: no network, no market,
 * no file read, and a malformed snapshot never throws.
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
  const { cachedFixtures, schedule } = countdownSchedule(state, defaultCompetition, kind);
  // The snapshot's stamp by the reader's own rule (`stampAgeMs`, as
  // `liveMatchesFromCache` judges it): one further in the future than the
  // skew allowance is not believed, and gives neither a stamp nor a deadline.
  // A believed one is re-emitted canonically, with the instant its live
  // scores stop being shown.
  const age = stampAgeMs(state?.updatedAt, nowMs);
  const stamp = state && Number.isFinite(age) ? Date.parse(state.updatedAt) : undefined;
  const staleAt = stamp === undefined ? undefined : new Date(stamp + DISPLAY_STALE_MS);
  // The list is current when the reader's window holds the snapshot, the
  // snapshot is not degraded (as the line's own rule has it: a degraded
  // snapshot means the fetch failed, not that the feed said nothing; a live
  // record it still carries is listed, best effort, and is not current), the
  // snapshot SAYS the read that filled its live slice was whole
  // (`liveComplete: true`; one that says nothing, written before the field,
  // is not current until the next refresh), and the line is not syncing
  // (asked, like the line asks it, only with no live match read).
  const syncing =
    list.items.length === 0 &&
    syncingWindow(state, nowMs, liveWhole(list.complete, state), defaultCompetition, cachedFixtures, schedule, opts.pick) !==
      undefined;
  return {
    line: renderPrompt(state, read),
    context: context === '' ? null : context,
    live: { items, total: list.total, shown: list.shown, truncated: list.truncated, complete: list.complete },
    current:
      stamp !== undefined && age < DISPLAY_STALE_MS && state?.degraded !== true && state?.liveComplete === true && !syncing,
    next: countdownFixture(nowMs, schedule, opts.pick) ?? null,
    degraded: state?.degraded === true,
    source: typeof state?.source === 'string' ? state.source : null,
    updatedAt: stamp === undefined ? null : new Date(stamp).toISOString(),
    staleAfter: staleAt === undefined || Number.isNaN(staleAt.getTime()) ? null : staleAt.toISOString(),
  };
}
