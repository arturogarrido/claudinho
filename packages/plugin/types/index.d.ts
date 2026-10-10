/**
 * The contract of the claudinho plugin: what it keeps in the session (`$.state`), each value under
 * `PluginState.claudinho`. Everything is read from `claudinho ambient --json`, the installed CLI's view of its
 * local cache; the plugin never fetches.
 */

/** The band's line as the CLI fitted it, or null when there is nothing to show (or the last run failed). */
export type ClaudinhoBand = { text: string } | null

/**
 * The band's pace: when the last run started (the clock's milliseconds) and whether the CLI said its answer was idle
 * (the first-run object, nothing chosen; or a view whose `idle` is true, the edition over), which is read once per
 * five minutes instead of every fire.
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

declare module 'claude-code' {
  interface PluginState {
    claudinho: {
      band: ClaudinhoBand
      pace: ClaudinhoPace
      baseline: ClaudinhoBaseline
      context: ClaudinhoContext
    }
  }
}
