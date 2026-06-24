## Summary

<!-- What changed and why (1–3 bullets) -->

-

## Test plan

- [ ] `pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm lint` all green locally (same order as CI — build first)
- [ ] New/changed behavior covered by tests (not only happy path)

### Data-heavy / bracket / schedule PRs

- [ ] Bundled `schedule.*.json` is resultless (no scores; knockout slots are placeholders only)
- [ ] `gen:schedule` validation passes (no real nation flags in knockout fixtures)
- [ ] Degraded bundle path: no `confirmed` advancement without live knockout data
- [ ] Knockout edge case: FT draw + penalties (`winnerCode`) advances winner
- [ ] Bracket index ↔ ESPN winner refs verified (guard test if assumption can't be live-checked)
- [ ] Provider `source` set on every hybrid live path (knockout + standings)
- [ ] Share/MCP/CLI user-visible text: attribution and degraded notices appear once
- [ ] **Surface parity:** MCP tools pass `tz` / `locale` to core formatters (see `.cursor/rules/surface-parity.mdc`)
- [ ] Adversarial cases from `.cursor/rules/bundle-bracket-pr.mdc` covered by tests where applicable

### Bracket / formatting PRs — release QA (after build)

- [ ] `pnpm release:qa` — all tripwires pass (calendar month on kickoffs, tz differs UTC vs Asia/Tokyo, share disclaimer present)
- [ ] `packages/mcp/test/tools.test.ts` green for any MCP tool you touched (esp. `toolGetBracket` tz)

### Release / docs

- [ ] No gitignored paths committed (`docs/`, `AGENTS.md`, `CLAUDE.md`) — update README / MCP descriptions / cursor rules instead
- [ ] Review fixes for the same feature batched in this PR (avoid follow-up patch releases)

### Assumptions

<!-- List any data/layout assumptions you could not verify against live ESPN responses -->

-
