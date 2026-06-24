## Summary

<!-- What changed and why (1–3 bullets) -->

-

## Test plan

- [ ] `pnpm lint && pnpm test && pnpm build` all green locally
- [ ] New/changed behavior covered by tests (not only happy path)

### Data-heavy / bracket / schedule PRs

- [ ] Bundled `schedule.*.json` is resultless (no scores; knockout slots are placeholders only)
- [ ] `gen:schedule` validation passes (no real nation flags in knockout fixtures)
- [ ] Degraded bundle path: no `confirmed` advancement without live knockout data
- [ ] Knockout edge case: FT draw + penalties (`winnerCode`) advances winner
- [ ] Bracket index ↔ ESPN winner refs verified (guard test if assumption can't be live-checked)
- [ ] Provider `source` set on every hybrid live path (knockout + standings)
- [ ] Share/MCP/CLI user-visible text: attribution and degraded notices appear once

### Assumptions

<!-- List any data/layout assumptions you could not verify against live ESPN responses -->

-
