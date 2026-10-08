# statusline (and the hook)

## What it does

The one-line ambient score for Claude Code's and Cursor's statusline (`claudinho prompt`), and the hook that puts
the live context into a prompt (`claudinho hook`). Both read the local micro-cache only, in under 150 ms, and never
the network; a refresher is spawned when the cache is stale, and that spawn is what the drive records.

## How a user reaches it

`claudinho init claude` or `init cursor` install them; the statusline runs `claudinho prompt` on every tick, the
hook on every prompt submit, after `claudinho follow <alias>`.

## How to drive it

- offline: `prompt --seed club --slug eng.1 --follow premier-league`
  proves: exit 0; stdout contains "⚽ ARS 2–1 CHE 50'"; spawns = 0; fetches = []
- offline: `prompt --seed none --follow premier-league`
  proves: exit 0; stdout contains "⚽ —"; spawns = 1; fetches = []
- offline: `prompt`
  proves: exit 0; stdout contains "⚽ claudinho follow"; spawns = 0; fetches = []
- offline: `hook --seed club --slug eng.1 --follow premier-league`
  proves: exit 0; stdout contains "[Claudinho — live football scores right now]"; stdout contains "Arsenal 2–1 Chelsea (50')"; spawns = 0; fetches = []
- offline: `hook`
  proves: exit 0; stdout is empty; spawns = 0; fetches = []

## What proves it

The `offline:` lines above, run by `packages/core/test/verify-cli.test.ts`. There is no replay line: the ambient
surfaces are cache-only.

## The gotchas paid for

- Never the network on the hot path: `fetches = []` on every drive above (offline: proven).
- A club by its code, no flag glyph: `ARS 2–1 CHE` (offline: proven).
- Nothing known is `⚽ —`; no choice is `⚽ claudinho follow` with no cache read; the hook prints nothing with no
  choice (offline: proven).
- A stale cache spawns exactly one refresher, recorded and never started here (offline: proven on the empty cache).
- A seeded line holds within the display window: the seed is stamped now.
