# Conventions: verdicts

This guide holds the narration behind the `AGENTS.md` "Conventions" bullet "A verdict becomes output in ONE place", moved out of `AGENTS.md` word for word. Where a bullet kept the first clause of a sentence, the guide quotes that clause before the narration that followed it. It also holds what `.cursor/rules/surface-parity.mdc` stated that no bullet does, under a heading naming the rule. `AGENTS.md` stays canonical.

## A verdict becomes output in ONE place

(AGENTS.md keeps "A surface never forwards the field by hand at an emit site:") that is how `share --json` and `markets --json` each dropped a verdict their text carried, and how MCP `data` answered an unsupported competition exactly like an empty one.

## From `.cursor/rules/surface-parity.mdc`

### A verdict is forwarded by core, not by each surface

Pass the RESULT to them; do not name the verdict at an emit site (`packages/core/test/verdict.test.ts` fails when a surface's code spells `unsupported`, `noCompetition:`, `incomplete:`, `partial:`, `inapplicable:`, `unknownTeam:`, `rosterIncomplete:`, `betweenEditions:`, a verdict's sentence or i18n key, the horizon, window, "none read" or unserved sentence, a card's `emptyNote`/`installLine`, or a table's `partial` key). A table's structured form, with its `label` and its `partial` verdict, comes from `tableData`, and its unlocalized title from `tableTitle` (`packages/core/src/standings.ts`); a table argument is checked with `tableKeyArg` on every surface (the MCP tools check it through their input schema, which uses core's `TABLE_KEY_ARG`, the grammar `tableKeyArg` applies).
