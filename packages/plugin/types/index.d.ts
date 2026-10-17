/**
 * The contract of the claudinho plugin: what it keeps in the session (`$.state`), each value under
 * `PluginState.claudinho`. Everything is read from `claudinho ambient --json`, the installed CLI's view of its
 * local cache, and the match pane's rows from `claudinho match <id> --json`; the plugin never fetches (the CLI does). A view is readable when it carries its `live` list and says what its line
 * is, `idle` and `empty` as two booleans (`@claudinho/cli` 0.11.2 or later); anything else (the first-run object, the
 * fallback object, a view from an older CLI) is no view: hidden, never current, the baseline kept.
 */

/**
 * The band's line as the CLI fitted it, or null when there is nothing to show, the last run failed, or a run found no
 * surface that draws the band (none attached, or the roster could not be read). `parts`: the CLI's `lineParts` (at most
 * 64, each a text and, for a score token the fit kept whole, the style `strong`), kept only when their texts joined
 * equal `text` exactly; the band then draws each `strong` part bold. Absent (an older CLI, or parts that do not join to
 * the line): the plain line.
 */
export type ClaudinhoBand = { text: string; parts?: Array<{ text: string; style?: 'strong' }> } | null

/**
 * The band's pace: when the last run started (the clock's milliseconds) and whether the CLI said its answer was idle
 * (the first-run object, nothing chosen; or a view whose `idle` is true, the edition over), which is read once per
 * five minutes instead of every fire. `ranAt` is read only while `idle` is true; `{ ranAt: 0, idle: false }` is what a
 * clear leaves (a run that found no surface that draws the band, or the last such surface detached).
 */
export type ClaudinhoPace = { ranAt: number; idle: boolean }

/**
 * The identity of a live record's `lastGoal` (CLI 0.12.0): the goal's kind, its minute and added time, the side it
 * counted for, and the player when named. Two `lastGoal` objects are the same goal when every field is equal; a
 * `lastGoal` the previous current view already carried is not the goal that made a new score.
 */
export type ClaudinhoGoal = {
  type: 'GOAL' | 'OWN_GOAL' | 'PEN'
  minute: number
  added?: number
  side: 'home' | 'away'
  player?: string
}

/**
 * One live match as the toasts remember it: its id, its two tallies, and (a record that carries `names`, CLI 0.12.0)
 * its `lastGoal` identity when it had one. A record without `names` (CLI 0.11.2) keeps no `lastGoal`: its toast is
 * the CLI's record's own `line`, and the plugin reads neither field for it.
 */
export type ClaudinhoTally = {
  id: string
  score?: { home: number; away: number }
  shootout?: { home: number; away: number }
  lastGoal?: ClaudinhoGoal
}

/**
 * The toasts' baseline: the last CURRENT view's live matches, under its competition. Replaced by every current view,
 * kept through a view that is not current and through a failed run (a change across the gap is said at the next
 * current view); null before the first current view.
 */
export type ClaudinhoBaseline = { slug: string; items: ClaudinhoTally[] } | null

/**
 * The prompt context's record: the last CURRENT view's context block (null when it had none), its own display
 * deadline (`staleAfter`, ISO 8601, or null) and when its run started. Cleared by a view that is not current, kept
 * through a failed run.
 */
export type ClaudinhoContext = { context: string | null; staleAfter: string | null; ranAt: number } | null

/**
 * One play of the goal celebration, by its kind, each with its own length on screen:
 * - `banner` (3 s): a view whose record carries no `names` (CLI 0.11.2), today's frames: a ball crossing a row, a
 *   "GOAL" banner growing, then `text`, the goal's toast line (`⚽` and the CLI's record line);
 * - `goal` (3 s): a goal toast for the pinned side (with no `pinnedSide`, any goal toast): the mascot, the ball crossing
 *   the top row, `GOAL!` and `team` on the middle row, `detail` on the bottom row (the scorer and the goal's minute,
 *   `own goal` and the minute, or the record's clock minute alone); `minute` is the one-row form's minute;
 * - `fulltime` (5 s): full time for the pinned side on a win or a draw: the mascot beside `Full time · <result>`,
 *   `result` being `<team> win` or `Draw`.
 */
export type ClaudinhoPlay =
  | { kind: 'banner'; text: string }
  | { kind: 'goal'; team: string; minute: string; detail: string }
  | { kind: 'fulltime'; result: string }

/**
 * The goal celebration's record: its first play (its `kind` and that kind's fields) and `queue`, the plays after it
 * (at most one: full time's, behind a goal decided in the same read, its own 5 s), played one after the other as one
 * stretch; when the run that saw it decided it (the clock's milliseconds), the competition of the view it was decided
 * in (its `competition.slug`, `''` when it states none), the match's id, and that match's regulation and shootout
 * tallies in the view it was decided on (each when present: its own evidence; a finished record's at full time). Both
 * plays are under one hold while Claude works and one 60-second drop counted from `at`. Its four writers, in a run's
 * order: any answer naming another competition, or none, current or not (a view, or the first-run object; the fallback
 * object names none and leaves it), nulls it; its match's score changing in any later current view (by `id`, in the
 * live list or the finished list, whatever the `toasts` filter: a tally both carry differing from the record's, a
 * correction or a later goal the plugin did not see as one; an absent match or tally is no news) nulls it, both
 * plays with it; a full-time play is kept only while each later current view lists its match in `finished` with the
 * same `result` text: a current view listing it live again, listing it nowhere, or giving another result (or none)
 * drops that play (the record when the play is its own, its `queue` when it follows a goal, the goal play then kept
 * under the rules above); the run's last match with a play writes it (a run a clear superseded writes nothing; never under `celebrate:
 * off`); and the band's clear nulls it. The draw's guard: a record another module load wrote (its `at` not this
 * load's) is never played; it stays in state until a goal or a clear replaces it. A played or expired record also
 * stays until the next one replaces it (the draw ignores it). The draw reads it; its frames are not state.
 */
export type ClaudinhoCelebration =
  | (ClaudinhoPlay & {
      at: number
      slug: string
      id: string
      score?: { home: number; away: number }
      shootout?: { home: number; away: number }
      queue?: ClaudinhoPlay[]
    })
  | null

/** One part of a pane row: its text and its style (`strong` bold, `dim` dimmed, `accent` and `flair` the theme's
 * `success` colour, `quote` dimmed italic; none: plain). */
export type ClaudinhoPanePart = { text: string; style?: 'strong' | 'dim' | 'accent' | 'quote' | 'flair' }
/** One pane row: its parts, in order. */
export type ClaudinhoPaneRow = ClaudinhoPanePart[]

/**
 * The match pane's generation: a number that only grows, never null, which a new binding takes its own value from
 * (a reload starts the module's values over; this number does not). Its two writers: `/claudinho match` binding a
 * match (+1) and the `ui.close` hook for the pane `match` (+1). What fences an answer from before a close or a reopen
 * is the module's binding and the pane value's own `gen`, both checked inside the write.
 */
export type ClaudinhoPaneGen = number

/**
 * The match pane's value (`/claudinho match`), read by the pane's draw alone: the generation it was written under, the
 * competition (`slug`) and match `id` it is bound to, what the last `claudinho match <id> --json` read said (`rows`:
 * one JSON value whose `lines` is an array of strings; `noView`: one JSON value without such `lines`; `failed`: no
 * answer), the CLI's `lines` (at most 150, each cut at 600 characters), its styled `rows` when it printed them (CLI
 * 0.12.0: each row the parts of the line at its index, kept only when every row's parts join to that line; at most 150
 * rows of at most 64 parts, each row cut at 600 characters; a style the plugin does not draw is a plain part), beside
 * them each row's `roles` (the CLI's `rows[i].role` at the same index when it is 1 to 32 lowercase letters, else null;
 * written with `rows` alone, so a value from a plugin load before them has none and the pane draws it as before) and
 * its `attribution` and `disclaimer` (each a
 * non-empty string cut at 1,000 characters, else absent), whether the last re-read failed (the rows kept from the read
 * before it), and the fields the re-reads decide by: the answered match's `status` and `kickoff` (null with no match),
 * and whether that status is final (`FT`, `POSTPONED`, `CANCELLED`). Its writers: the open, twice under its new
 * generation (first a provisional value before its read, `rows` holding the view's line and its footer, with no status
 * or kickoff; then its read's answer, while its binding is still the module's), a re-read only while its generation is
 * the binding's (a failed one keeps the rows and sets `refreshFailed`), and the
 * `ui.close` hook, which nulls it. Null before the first open and after a close.
 */
export type ClaudinhoPane = {
  gen: number
  slug: string
  id: string
  kind: 'rows' | 'noView' | 'failed'
  lines: string[]
  rows?: ClaudinhoPaneRow[]
  roles?: Array<string | null>
  attribution?: string
  disclaimer?: string
  refreshFailed: boolean
  status: string | null
  kickoff: string | null
  final: boolean
} | null

declare module 'claude-code' {
  interface PluginState {
    claudinho: {
      band: ClaudinhoBand
      pace: ClaudinhoPace
      baseline: ClaudinhoBaseline
      context: ClaudinhoContext
      celebration: ClaudinhoCelebration
      paneGen: ClaudinhoPaneGen
      pane: ClaudinhoPane
    }
  }
}
