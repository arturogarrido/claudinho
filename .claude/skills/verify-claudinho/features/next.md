# next

## What it does

The next fixture of a team: a nation by name or code on the World Cup, a club by name or code on a club
competition, the pinned team with no argument. "Next" is never "now": the fixture, its date and its state are
relayed as returned.

## How a user reaches it

`claudinho next [<team>]` after `claudinho follow <alias> [--team <name>]`; `--json` for the twin.

## How to drive it

- offline: `run --offline --follow premier-league --twin -- next Arsenal`
  proves: exit 0; stdout contains "Next up for Arsenal"; stdout contains "Live scores unavailable right now — couldn't reach the data provider."; twin.degraded = true
- replay: a resolved fixture with its date and state; a knockout slot that must show real nations, never a placeholder; the horizon ("no fixture within the next 14 days") after a whole read (the next PR).

## What proves it

The `offline:` line above, run by `packages/core/test/verify-cli.test.ts`.

## The gotchas paid for

- An empty answer keeps its header and says the outage; it never invents a fixture (offline: proven above).
- A knockout slot shows real nations from the live overlay, never the bundle's placeholder (replay; AGENTS.md
  "Knockout/team-facing surfaces MUST live-resolve").
- The horizon is the answer's own sentence, not a verdict (replay).
