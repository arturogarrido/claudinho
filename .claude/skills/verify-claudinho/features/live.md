# live

## What it does

The matches in play right now for the competition you follow, across a season turn when the window spans one.

## How a user reaches it

`claudinho live` after `claudinho follow <alias>`; `--json` for the twin.

## How to drive it

- offline: `run --offline --follow premier-league --twin -- live`
  proves: exit 0; stdout contains "Live scores unavailable right now — couldn't reach the data provider."; twin.degraded = true
- replay: a match in play with its minute and score; a club with no flag and nothing in its place; "no match in play was read" after a read that was not whole (the next PR).

## What proves it

The `offline:` line above, run by `packages/core/test/verify-cli.test.ts`.

## The gotchas paid for

- An outage is said as an outage, with `degraded: true` in the twin, never an empty list (offline: proven above).
- A club has no flag and NOTHING in its place: no code, no glyph (replay).
- An empty body after a read that was not whole says nothing was READ (replay).
