# CLAUDE.md

This project uses **AGENTS.md** as the primary agent guide. Read it first:

@AGENTS.md

## Claude Code specifics

- The statusline command must return in **<150ms** and **never** hit the network on the hot path — read from the local micro-cache.
- Local MCP dev loop:
  ```bash
  pnpm -F @claudinho/mcp build
  claude mcp add claudinho-dev -- node packages/mcp/dist/index.js
  ```
- When changing shared types, update `@claudinho/core` and run `pnpm -r typecheck` before committing.
- Run `pnpm lint` (Biome) before committing; CI gates on it. The setup is lint-only (no formatter) — keep style consistent with the surrounding code.
- **Before declaring any change "done," run the "Pre-PR self-review" rubric in `AGENTS.md`** — verify external API shapes against a *real* response (fixtures included); apply the change to every surface (CLI text **and** `--json`, MCP `data` **and** text, READMEs); audit against the Hard Constraints (existing code too); do an adversarial failure-mode pass (fail-closed; never cache transient errors); and bound default-on latency. For money/legal/external-API changes, do an independent reviewer pass and self-classify findings **P1/P2/P3**.
- **After any push to a branch with CI, always watch the run and confirm it's green** (`gh run watch <id> --exit-status`); report the per-job result. Don't consider a push "done" until CI passes.
