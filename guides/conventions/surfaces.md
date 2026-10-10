# Conventions: the surfaces

No sentence of the `AGENTS.md` "Conventions" bullets this guide serves ("Bound the WORK, not just the output", "Static data (schedule, groups, flags) ships bundled in clients", "The statusline and hook are English-only by design", "Shareable snippets" and "Star CTAs are human-interactive-only") moved: each is a rule, a pointer, a list or a number, and stays in `AGENTS.md`. It also holds what `.cursor/rules/trust-boundary.mdc` and `.cursor/rules/surface-parity.mdc` stated that no bullet does, under a heading naming the rule. `AGENTS.md` stays canonical.

## From `.cursor/rules/trust-boundary.mdc`

### Rules

- **Bound the work, not just the output.** `total` is exact only when `complete` is true, so incomplete hot-path scans use a nonnumeric `more` marker rather than guessing how many valid records remain. MCP response limiting preflights depth, width, entries, containers, and aggregate text before serialization or recursive shrinking; a byte cap alone does not bound the CPU and allocation spent discovering that a payload is too large.

## From `.cursor/rules/surface-parity.mdc`

### The flair slot of a match line

The flair slot of a match line comes from core alike on CLI (`today`, `live`, `next`, `match`) and MCP (`get_today`, `get_live`, `get_match`, `get_next_fixture`): a list through ONE rule, `matchFlairs` (a row whose side carries a rally cry prints the cry and reserves no phrase; the other rows get distinct phrases while the bank allows), one line through `matchFlair` (the list of one). Between two sides that both carry a cry the pin decides, on both surfaces (CLI `cfg.pin`, MCP `choiceOf(args).pin` through `fmtOpts`; matched by core's one pin predicate, `isPinnedSide`), else the home side's; `CLAUDINHO_TEAM` is not the cry's tiebreak (it is the team-taking commands' query, and the statusline's and the hook's preference, below). A postponed or cancelled line carries no cry (nor a phrase); `--flavor subtle` prints goals, full time, draws, and the cries; `fixtures://` prints a phrase, never a cry (it states no team kind). Share cards and the ambient surfaces carry none.

### What release:qa renders

`scripts/release-qa.sh` exercises CLI + share rendering across locales and timezones, the World Cup pass then a club render (the Premier League in a temporary config and cache of its own: `today`, `live`, `next Arsenal`, both tables, the `share next` card, the Portuguese table, a seeded `prompt` that must start no refresher); MCP arg threading is **not** rendered there: guard it with unit tests.

### Format opts invariant

```typescript
// ❌ BAD — locale only; tz silently drops to server local
formatBracketList(view, { footer: false, locale: args.lang });

// ✅ GOOD
formatBracketList(view, { footer: false, locale: args.lang, tz: args.tz });
// or reuse fmtOpts(args, competition, now) where shapes align: the request's ONE clock
// (`args.now`, else the adapter's read clock), read once per request, is a required
// field of the line's options, so a line built without it does not compile
```

### Regression tests

When adding a format option (e.g. `date: true` on `formatKickoff`):

- Add a **core** unit test for the option.
- Add an **MCP tool test** proving `tz` changes output (e.g. UTC vs `America/Mexico_City` on a cross-midnight kickoff).
- Update share tests if `formatShareBracket` / compact lines are affected.
