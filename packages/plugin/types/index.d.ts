/**
 * The contract of the claudinho plugin: what it keeps in the session (`$.state`), each value under
 * `PluginState.claudinho`. Everything is read from `claudinho ambient --json`, the installed CLI's view of its
 * local cache, and the match pane's rows from `claudinho match <id> --json`; the plugin never fetches (the CLI does). A view is readable when it carries its `live` list and says what its line
 * is, `idle` and `empty` as two booleans (`@claudinho/cli` 0.11.2 or later); anything else (the first-run object, the
 * fallback object, a view from an older CLI) is no view: hidden, never current, the baseline kept.
 */

/**
 * The band's line as the CLI fitted it, or null when there is nothing to show, the last run failed, or a run found no
 * surface that draws the band (none attached, or the roster could not be read).
 */
export type ClaudinhoBand = { text: string } | null

/**
 * The band's pace: when the last run started (the clock's milliseconds) and whether the CLI said its answer was idle
 * (the first-run object, nothing chosen; or a view whose `idle` is true, the edition over), which is read once per
 * five minutes instead of every fire. `ranAt` is read only while `idle` is true; `{ ranAt: 0, idle: false }` is what a
 * clear leaves (a run that found no surface that draws the band, or the last such surface detached).
 */
export type ClaudinhoPace = { ranAt: number; idle: boolean }

/** One live match as the toasts remember it: its id and its two tallies (the words are the CLI's record's own `line`). */
export type ClaudinhoTally = {
  id: string
  score?: { home: number; away: number }
  shootout?: { home: number; away: number }
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
 * The goal celebration's record: the last goal's toast line (`⚽` and the CLI's record line), when the run that saw it
 * decided it (the clock's milliseconds), the competition of the view it was decided in (its `competition.slug`, `''`
 * when it states none), the match's id, and that match's regulation and shootout tallies in the view the goal was
 * decided on (each when present: its own evidence). Its four writers, in a run's order: any answer naming another
 * competition, or none, current or not (a view, or the first-run object; the fallback object names none and leaves
 * it), nulls it; its match's score changing in any later current view (a tally both carry differing
 * from the record's: a correction, or a later goal the plugin did not see as one; by `id`, whatever the `toasts`
 * filter; an absent match or tally is no news) nulls it; the run's last goal writes it (a run a clear superseded writes nothing; never under
 * `celebrate: off`); and the band's clear nulls it. The draw's guard: a record another module load wrote (its `at` not
 * this load's) is never played; it stays in state until a goal or a clear replaces it. A played or expired record also
 * stays until the next goal replaces it (the draw ignores it). The draw reads it; its frames are not state.
 */
export type ClaudinhoCelebration = {
  text: string
  at: number
  slug: string
  id: string
  score?: { home: number; away: number }
  shootout?: { home: number; away: number }
} | null

/**
 * The match pane's generation: a number that only grows, never null, read by the pane's writers to tell an answer
 * from before a close or a reopen. Its two writers: `/claudinho match` binding a match (+1) and the `ui.close` hook for
 * the pane `match` (+1).
 */
export type ClaudinhoPaneGen = number

/**
 * The match pane's value (`/claudinho match`), read by the pane's draw alone: the generation it was written under, the
 * competition (`slug`) and match `id` it is bound to, what the last `claudinho match <id> --json` read said (`rows`:
 * one JSON value whose `lines` is an array of strings; `noView`: one JSON value without such `lines`; `failed`: no
 * answer), the CLI's rows (at most 150, each cut at 600 characters) and its `attribution` and `disclaimer` (each a
 * non-empty string cut at 1,000 characters, else absent), whether the last re-read failed (the rows kept from the read
 * before it), and the fields the re-reads decide by: the answered match's `status` and `kickoff` (null with no match),
 * and whether that status is final (`FT`, `POSTPONED`, `CANCELLED`). Its writers: the open (a new generation), a
 * re-read only while its generation is the binding's (a failed one keeps the rows and sets `refreshFailed`), and the
 * `ui.close` hook, which nulls it. Null before the first open and after a close.
 */
export type ClaudinhoPane = {
  gen: number
  slug: string
  id: string
  kind: 'rows' | 'noView' | 'failed'
  lines: string[]
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
