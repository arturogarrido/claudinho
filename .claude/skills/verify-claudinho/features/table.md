# table

## What it does

The standings of the competition you follow: the league's one table, the groups' tables, or one table by its key;
from the provider's standings feed, never computed from a match window.

## How a user reaches it

`claudinho table [KEY]` after `claudinho follow <alias>`; `--json` for the twin.

## How to drive it

- offline: `run --offline --follow premier-league --twin -- table`
  proves: exit 0; stdout contains "Live standings unavailable."; twin.degraded = true; twin.tables = []
- offline: `run --offline --follow world-cup --twin -- table`
  proves: exit 0; stdout contains "Live standings unavailable — showing the group roster."; twin.degraded = true; twin.tables.length = 12
- replay: a populated league table; a partial table ("may be incomplete"); missing tables (`incomplete`) (the next PR).

## What proves it

The `offline:` lines above, run by `packages/core/test/verify-cli.test.ts`.

## The gotchas paid for

- Off the bundle an outage is an empty, degraded answer with no attribution; on the bundle the roster at zero and the
  sentence that says so (offline: proven above, both).
- A table's `partial` and the inventory's `incomplete` are two facts (replay).
- The bundled roster is never injected under another competition (offline: the Premier League's empty table above).
