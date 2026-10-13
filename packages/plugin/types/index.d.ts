/**
 * The contract of the claudinho plugin: what it keeps in the session (`$.state`), each value under
 * `PluginState.claudinho`. Everything is read from `claudinho ambient --json`, the installed CLI's view of its
 * local cache; the plugin never fetches. A view is readable when it carries its `live` list and says what its line
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
 * decided it (the clock's milliseconds) and the match's id. Its four writers, in a run's order: a current view of
 * another competition nulls it; a correction of its match (a compared tally that fell, by `id`, whatever the `toasts`
 * filter) nulls it; the run's last goal writes it (a run a clear superseded writes nothing; never under
 * `celebrate: off`); and the band's clear nulls it. The draw's guard: a record another module load wrote (its `at` not
 * this load's) is never played; it stays in state until a goal or a clear replaces it. A played or expired record also
 * stays until the next goal replaces it (the draw ignores it). The draw reads it; its frames are not state.
 */
export type ClaudinhoCelebration = { text: string; at: number; id: string } | null

declare module 'claude-code' {
  interface PluginState {
    claudinho: {
      band: ClaudinhoBand
      pace: ClaudinhoPace
      baseline: ClaudinhoBaseline
      context: ClaudinhoContext
      celebration: ClaudinhoCelebration
    }
  }
}
