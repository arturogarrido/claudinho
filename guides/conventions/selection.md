# Conventions: the competition selection

This guide holds the narration behind the `AGENTS.md` "Conventions" bullet "The competition is decided ONCE, at the edge, and then travels as a value", moved out of `AGENTS.md` word for word. It also holds what `.cursor/rules/surface-parity.mdc` stated that no bullet does, under a heading naming the rule. `AGENTS.md` stays canonical.

## The competition is decided ONCE, at the edge, and then travels as a value

Twenty-four call sites used to re-resolve it mid-request.

## From `.cursor/rules/surface-parity.mdc`

### Every answer names its competition (the mode line and the `competition` key)

A saved mode line names no source (`World Cup`, not `World Cup · …`). A new competition-answering command or tool gets the line and the key; a new emit site spreads `selectionExtras`, never a hand-built key.

### The pinned team, and the ambient pick (a preference, never a filter)

The team-taking surfaces take, in order, the argument, `CLAUDINHO_TEAM`, the pin, on every surface: CLI `next`, `share next`, `markets next` (through `teamAsked`), MCP `get_next_fixture` with `team` omitted (`nextAsked`: the server's `CLAUDINHO_TEAM`, else the pin); the pin answers as a RESOLVED team (`nextFixtureForPin`: by its id, or by code for an id-less pin, believed on the bundled competition alone; never resolved again, no roster read). As a team to answer about, on MCP the pin reaches `get_next_fixture` alone, by design: `get_share_snippet` without a team and `get_market_signal` without one stay a date's answer; as the cry's tiebreak it reaches every tool that prints a match line (`get_today`, `get_live`, `get_match`, `get_next_fixture`) through `fmtOpts`, and `fixtures://` prints a phrase, never a cry. **World Cup exception of `follow --team`:** an unknown 3-letter code is refused (a pin must be a team the roster holds), where `next` passes one through as the escape hatch for other feeds. The ambient surfaces (the statusline's live line, syncing matchup and countdown; the hook's list; `vibe`'s segment) pick through ONE function, `pickAmbientMatch(matches, pick)` (`packages/cli/src/statusline.ts`), the pick being `CLAUDINHO_TEAM`'s code, else the pin when `CLAUDINHO_TEAM` is absent (present but unreadable on the hot path, a name off the bundle, it is still the override: no preference, never the pin): the picked team's matches FIRST, the others kept (the statusline shows the picked live match and counts the rest as `+N`; the hook lists them after it). **Parity exception, stated:** this replaced the statusline's filter-to-one and `vibe`'s filter (0.11 · 2.5b): with the picked team not live, the line shows what is, and with no fixture of the picked team ahead, the countdown is to anyone's. A new ambient surface asks `pickAmbientMatch`, never a filter of its own.
