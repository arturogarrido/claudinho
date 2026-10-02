## Summary

<!-- What changed and why (1–3 bullets) -->

-

## Scope and acceptance

<!-- For user-facing features: write 3–5 user-observable acceptance criteria and explicit
exclusions before implementation; include them here before the first commit. If there is
no PR yet, draft this description locally. For other changes, state the intended outcome. -->

- Acceptance:
- Out of scope:

## Test plan

<!-- Follow AGENTS.md → Validation scope. Mark inapplicable checks N/A with a reason;
record actual results and any blocked checks. A skipped check is not a pass. -->

- [ ] Prose-only changes: `git diff --check`, local links, stated contracts, and the `node --input-type=module` block in [AGENTS.md's private-document boundary check](https://github.com/arturogarrido/claudinho/blob/main/AGENTS.md#private-document-boundary-check) pass
- [ ] Code/dependency/executable-config changes: `pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm lint` all green locally (same order as CI — build first), plus relevant smoke/pack checks
- [ ] New/changed behavior covered by meaningful tests, including failure modes
- [ ] User-facing behavior: `pnpm release:qa` run after build and output inspected

### Data-heavy / bracket / schedule PRs

- [ ] Bundled `schedule.*.json` is resultless (no scores; knockout slots are placeholders only)
- [ ] `gen:schedule` validation passes (no real nation flags in knockout fixtures)
- [ ] Degraded bundle path: no `confirmed` advancement without live knockout data
- [ ] Knockout edge case: FT draw + penalties (`winnerCode`) advances winner
- [ ] Live knockout pairing wins over disagreeing bundled feeder refs; feeder projection is used only when the target fixture is absent (`bracket-resolve.test.ts`)
- [ ] Provider `source` set on every hybrid live path (knockout + standings)
- [ ] Share/MCP/CLI user-visible text: attribution and degraded notices appear once
- [ ] **Knockout surfaces live-resolve, never the skeleton:** any team-facing surface (bracket / next / share / each MCP tool) reaches the live overlay and renders real nations, not `🏳️` placeholders — covered by `packages/{cli,mcp}/test/knockout-surface-coverage.test.ts` (a NEW surface is added to that test). **Statusline** indirect-resolves via refresher → `CacheState.fixtures` (hot-path fail-closed; `statusline.test.ts` / `refresh.test.ts`). See `.cursor/rules/surface-parity.mdc`.
- [ ] **Surface parity:** MCP tools pass `tz` / `locale` to core formatters (see `.cursor/rules/surface-parity.mdc`)
- [ ] Adversarial cases from `.cursor/rules/bundle-bracket-pr.mdc` covered by tests where applicable

### Bracket / formatting PRs — release QA (after build)

- [ ] `pnpm release:qa` — all tripwires pass (calendar month on kickoffs, tz differs UTC vs Asia/Tokyo, share disclaimer present)
- [ ] `packages/mcp/test/tools.test.ts` green for any MCP tool you touched (esp. `toolGetBracket` tz)

### Release / docs

- [ ] No **private** paths committed (`docs/`, `CLAUDE.local.md`, `.env`) — engineering updates go in `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/`, README, or MCP descriptions
- [ ] Review fixes for the same feature batched in this PR (avoid follow-up patch releases)

### Assumptions

<!-- List any data/layout assumptions you could not verify against live ESPN responses -->

-
