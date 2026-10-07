# today

## What it does

The fixtures of one calendar day for the competition you follow, with live scores where the provider serves them,
and the day's verdicts (nothing chosen, between editions, a read that was not whole) said as sentences and as
`--json` keys.

## How a user reaches it

`claudinho today [YYYY-MM-DD]` after `claudinho follow <alias>` (or with `--competition <alias>`, or
`CLAUDINHO_COMPETITION`); `--json` for the structured twin; `--tz` for the viewer's zone.

## How to drive it

- offline: `run --offline --follow premier-league --twin -- today 2026-10-07`
  proves: exit 0; stdout contains "Couldn't reach the data provider — no fixtures confirmed for 2026-10-07."; stdout contains "Live scores unavailable right now — couldn't reach the data provider."; twin.degraded = true; twin.source = null; twin.matches = []; fetches all blocked
- offline: `run --offline --follow world-cup --twin -- today 2026-10-07`
  proves: exit 0; stdout contains "No matches scheduled for this date."; stdout contains "Live scores unavailable — showing the bundled schedule."; twin.degraded = true; twin.source = null; twin.matches = []
- offline: `run --offline --twin -- today 2026-10-07`
  proves: exit 1; stderr contains "No competition chosen"; stdout is empty; twin.noCompetition = true; twin.competition = null; fetches = []
- replay: a day with fixtures and their scores; a partial read ("may be incomplete"); between editions (the next PR).

## What proves it

The `offline:` lines above, each run by `packages/core/test/verify-cli.test.ts`. The replay lines name what a
recorded feed must prove and are not asserted yet.

## The gotchas paid for

- Nothing chosen is a verdict, never a default: the "No competition chosen" sentence, exit 1, `noCompetition: true`
  (offline: proven above).
- Off the bundled competition a failed day says the provider could not be reached and confirms no fixture; on the
  bundle it shows the bundled schedule and says so (offline: proven above, both).
- A read that was not whole says "may be incomplete" and never "none" (replay).
- Between editions the day says the edition ended (replay).
- The structured twin carries every verdict the text says (AGENTS.md, the verdict bullet; offline: `degraded`,
  `noCompetition` proven above).
