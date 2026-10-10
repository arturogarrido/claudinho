# Conventions: the bundle and the bracket

This guide holds the narration behind the `AGENTS.md` "Conventions" bullets "The live fixture's pairing wins over the static topology's winner-refs" and "Knockout/team-facing surfaces MUST live-resolve", moved out of `AGENTS.md` word for word and in the bullets' order. It also holds what `.cursor/rules/bundle-bracket-pr.mdc` and `.cursor/rules/surface-parity.mdc` stated that no bullet does, under a heading naming the rule. `AGENTS.md` stays canonical.

## The live fixture's pairing wins over the static topology's winner-refs

This is deliberate: the bundled winner-ref indices (parsed from ESPN's placeholder slot labels at generation time) do **not** reliably correspond to ESPN's actual R32→R16 feeder assignment, so projecting from them rendered **wrong R16 pairings** (v0.8.16 P1: "Paraguay vs Mexico" instead of the real ties).

## Knockout/team-facing surfaces MUST live-resolve

This is Claudinho's most recurring bug: the *same* root cause shipped as v0.8.2 (R32 seeds), v0.8.6 (third-place slots), and v0.8.7 (next fixture) — three hotfixes, three different surfaces.

## From `.cursor/rules/bundle-bracket-pr.mdc`

### Bundled schedule invariant

- Test degraded `getBracket()` on the bundle: seed/winner slots stay `tbd`, never `confirmed`.

### Knockout resolution

- Advance winners from **score OR `winnerCode`** (ESPN `competitor.winner` for penalties).
- Always test FT draw + `winnerCode` — routine in knockouts.
- Group slots project from live standings once **≥1 match played** (`hasGroupStarted`); **`confirmed`** when every team has played a full round-robin (`played >= n - 1` for `n` teams); **`(proj.)`** only mid-group. TBD at 0 games or when standings are degraded.

### Topology indexing

- Assign each bundled match's 1-based index within its stage by ascending numeric ESPN event id (`orderByBracketIndex` in `packages/core/src/bracket/build.ts`), never by kickoff sort order.
- Keep the disagreeing-feeder `P1 GUARD` in `packages/core/test/bracket-resolve.test.ts` green, and cover the feeder fallback when the target fixture is absent. See `AGENTS.md` → Conventions.

### Live hybrid paths

- When knockout fetch fails but standings succeed: set `source` from standings provider.
- Share/MCP: inner `formatBracketList({ footer: false })`, outer layer adds attribution/notices **once**.
- CLI/MCP wrappers: option types must match the formatter (`ShareBracketOptions`, not `ShareSnippetOptions`).
- **Surface parity:** see `.cursor/rules/surface-parity.mdc` — every bracket formatter path passes `tz` + `locale`; statusline knockouts indirect-resolve via cached `getKnockoutFixtures` (hot path fail-closed).

### Pre-merge QA

After `pnpm -r build`, run **`pnpm release:qa`** (`scripts/release-qa.sh`). Eyeball every section; tripwires at the end encode the 0.8.x bracket regressions (calendar month, tz threading, share disclaimer).

## From `.cursor/rules/surface-parity.mdc`

### Knockout surfaces live-resolve

The bundled schedule's knockout slots are **resultless placeholders** (codes like `2A`/`2B`, flag `🏳️`). **Knockout live-resolve regressions** shipped repeatedly in different surfaces (root cause: skeleton reads, cache gaps, or both):

- v0.8.2 — R32 pre-draw seeds rendered static, didn't live-resolve.
- v0.8.6 — bracket third-place slots never read the merged live `match.home/away`.
- v0.8.7 — `next` / `share next` / MCP next-fixture resolvers read only the static bundle.
- v0.8.8 — statusline next-match countdown read the static bundle (`🏳️ vs 🏳️` / `⚽ —` in knockouts).
- v0.8.9 — empty fixtures cache stamped the full 15min TTL at phase boundaries; stale-cache `live · syncing…` still read the skeleton.

**Exception — statusline:** hot path cannot fetch; the cold-path refresher calls `getKnockoutFixtures` and caches to `CacheState.fixtures`; `renderPrompt` merges that slice over the bundle (countdown **and** `live · syncing…`), never leaking 🏳️. **Exception — MCP `fixtures://{date}` resource:** deliberately static ("Static fixture list"; a resource URI carries no tz and gets no live overlay) — do not "fix" it to live-resolve without a maintainer decision; agents use `get_today`/`get_bracket` for resolved pairings.

**Executable guard:** `packages/{cli,mcp}/test/knockout-surface-coverage.test.ts` pins one fake resolved tie (Mexico vs Ecuador) and asserts every surface renders the real nations, not `🏳️` (the statusline and `ambient` from a seeded cache). Its sibling `packages/{cli,mcp}/test/club-surface-coverage.test.ts` puts a Premier League fixture (live, and scheduled) through every surface: a club renders by its name or code with nothing in a flag's place, no nation rename, no "Friendly" in four locales, the written stage ("League", "Play-offs", the provider's words for an unknown round), no `flag` key in `--json`/`data`. **`statusline.test.ts` / `refresh.test.ts`** cover syncing + empty-cache TTL on the bundled competition; off it, **`statusline-off-bundle.test.ts` / `refresher-discovery.test.ts`** cover the syncing line, the countdown and the cycle that fills the schedule slice.
