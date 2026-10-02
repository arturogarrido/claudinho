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
- Follow `AGENTS.md` → "Working agreement", "Validation scope", and "Pre-PR self-review".
  They define completion, checks by change type, and when an independent reviewer is required.
- **After a push to a branch with CI**, confirm the run's `headSha` matches the pushed commit,
  wait for completion, and report the per-job result. A successful watch command alone is not
  proof that a queued run passed.
