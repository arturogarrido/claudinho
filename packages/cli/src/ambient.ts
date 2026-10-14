/**
 * The ambient reader of `claudinho ambient --json`: the statusline's line, the
 * hook's block and the structured twin of what they read, from one cache
 * snapshot. Its own module, beside the two renderers it calls
 * (`statusline.ts`, `hook.ts`), so neither renderer imports the other. The hot
 * path's rules: pure, no network, no market, no file read.
 */
import type { AmbientFinishedMatch, AmbientMatch, AmbientView, Match, Pin, TeamKind } from '@claudinho/core';
import { isPinnedSide, parseCachedMatch, parsedValue, sealEvent, takeBounded } from '@claudinho/core';
import { type CacheState, stampAgeMs, validStamp } from './cache';
import { hookLine, hookNames, renderHook } from './hook';
import { FINISHED_TTL_MS, MAX_PLAY } from './play';
import {
  countdownFixture,
  countdownSchedule,
  DISPLAY_STALE_MS,
  defaultTeamKind,
  isPicked,
  liveRecordsFromCache,
  liveWhole,
  NOTHING_KNOWN_LINE,
  pickAmbientMatch,
  promptLine,
  type PromptOpts,
  syncingWindow,
  TOURNAMENT_COMPLETE_LINE,
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

/** The ambient view as the cache gives it: the command adds the selection, the disclaimer, the attribution and the pick. */
export type AmbientRead = Omit<AmbientView, 'competition' | 'disclaimer' | 'attribution' | 'pick' | 'pickUnreadable'>;

/** The side of a record the saved pin names (core's `isPinnedSide`, home first), or `null`. */
function pinnedSideOf(m: Match, pin: Pin | undefined): 'home' | 'away' | null {
  if (pin === undefined) return null;
  if (isPinnedSide(m.home, pin)) return 'home';
  return isPinnedSide(m.away, pin) ? 'away' : null;
}

/**
 * The snapshot's finished records (its record of play's `finished`, see
 * `play.ts`), as the ambient view lists them: only from a snapshot inside its
 * display window (`fresh`) whose live read was whole; bounded before any
 * per-entry work; each entry for `FINISHED_TTL_MS` from its own stamp by the
 * reader's clock (a stamp in the future is not believed); each record sealed
 * by the live records' constructor (`events: false`, the competition's kind),
 * status `FT` with a score; never one the live list holds, never one id twice.
 * A malformed slice or entry lists nothing for it, and never throws.
 */
function finishedFromCache(
  state: CacheState | undefined,
  fresh: boolean,
  nowMs: number,
  kind: TeamKind,
  live: ReadonlySet<string>,
): Match[] {
  if (!fresh || state?.liveComplete !== true) return [];
  const play = state.play as unknown;
  if (!play || typeof play !== 'object' || Array.isArray(play)) return [];
  const out: Match[] = [];
  const ids = new Set<string>();
  for (const raw of takeBounded<unknown>((play as { finished?: unknown }).finished, MAX_PLAY)) {
    if (!raw || typeof raw !== 'object') continue;
    const { match, at } = raw as { match?: unknown; at?: unknown };
    if (!validStamp(at)) continue;
    const atMs = Date.parse(at);
    if (atMs > nowMs || nowMs - atMs >= FINISHED_TTL_MS) continue;
    const sealed = parsedValue(parseCachedMatch(match, { events: false, teamKind: kind }));
    if (sealed?.status !== 'FT' || !sealed.score || live.has(sealed.id) || ids.has(sealed.id)) continue;
    ids.add(sealed.id);
    out.push(sealed);
  }
  return out;
}

/**
 * THE ambient reader of `claudinho ambient --json` (core's `AmbientView`, less
 * what the command knows): the line `prompt` prints and the block `hook`
 * prints (their own renderers, with the SAME options and one clock), what that
 * line IS (`idle`, `empty`: from the one render, before the width's cut), and the
 * structured twin of what they read: the live list from the same reader
 * (`liveMatchesFromCache`: the display window, the examine cap, no `events`),
 * ordered by the one preference (`pickAmbientMatch`), each record marked
 * `picked` (the preference's side) and `pinned` (the saved pin's, by core's
 * `isPinnedSide`, with `pinnedSide` naming which) and carrying the hook's own
 * names and line for it (`hookNames`, `hookLine`, the formatter `claudinho
 * hook` prints with) and its stored `lastGoal` re-sealed (core's `sealEvent`),
 * with the reader's own `total`/`shown`/`truncated`/`complete`; the line's
 * parts as the fitter placed them (`lineParts`); the record of play's
 * finished matches, from a fresh snapshot whose live read was whole
 * (`finished`); whether that list is `current` (a believed snapshot's inside
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
  // The hook's own options for each record's line: the same flags, and its
  // roster names on the bundled competition.
  const hookOpts = { flags: opts.flags ?? true, pin: defaultCompetition };

  const { list, sources } = liveRecordsFromCache(state, nowMs, kind);
  // Each sealed record's stored `lastGoal`, re-sealed by core's one event
  // constructor (one object per listed record, at most the list's cap); any
  // other value is null.
  const lastGoals = new Map<Match, AmbientMatch['lastGoal']>();
  list.items.forEach((m, i) => {
    const raw = (sources[i] as { lastGoal?: unknown } | undefined)?.lastGoal;
    lastGoals.set(m, raw === undefined || raw === null ? null : sealEvent(raw));
  });
  const items: AmbientMatch[] = pickAmbientMatch(list.items, opts.pick).map((m) => ({
    ...m,
    picked: isPicked(m, opts.pick),
    pinned: pin !== undefined && (isPinnedSide(m.home, pin) || isPinnedSide(m.away, pin)),
    pinnedSide: pinnedSideOf(m, pin),
    names: hookNames(m, defaultCompetition),
    line: hookLine(m, hookOpts),
    lastGoal: lastGoals.get(m) ?? null,
  }));
  // ONE render of the line: what it is is read before the width's cut (a
  // narrow band cuts the text, never what the view says of it).
  const prompt = promptLine(state, read);
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
  // The finished records, by the live list's own freshness rule (its window).
  const finished: AmbientFinishedMatch[] = finishedFromCache(
    state,
    stamp !== undefined && age < DISPLAY_STALE_MS,
    nowMs,
    kind,
    new Set(list.items.map((m) => m.id)),
  ).map((m) => ({ ...m, pinnedSide: pinnedSideOf(m, pin), names: hookNames(m, defaultCompetition), line: hookLine(m, hookOpts) }));
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
    line: prompt.line,
    lineParts: prompt.parts,
    idle: prompt.unfitted === TOURNAMENT_COMPLETE_LINE,
    empty: prompt.unfitted === NOTHING_KNOWN_LINE,
    context: context === '' ? null : context,
    live: { items, total: list.total, shown: list.shown, truncated: list.truncated, complete: list.complete },
    finished,
    current:
      stamp !== undefined && age < DISPLAY_STALE_MS && state?.degraded !== true && state?.liveComplete === true && !syncing,
    next: countdownFixture(nowMs, schedule, opts.pick) ?? null,
    degraded: state?.degraded === true,
    source: typeof state?.source === 'string' ? state.source : null,
    updatedAt: stamp === undefined ? null : new Date(stamp).toISOString(),
    staleAfter: staleAt === undefined || Number.isNaN(staleAt.getTime()) ? null : staleAt.toISOString(),
  };
}
