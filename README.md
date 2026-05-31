# Claudinho ⚽

**The 2026 football tournament, right in your dev environment.**

Live scores, fixtures, and group tables in your terminal, your Claude Code statusline, and any MCP client — installed in one line. Plus an AI pundit that makes public predictions and keeps an honest scorecard.

> ⚠️ **Not affiliated with, endorsed by, or connected to FIFA or Anthropic.**
> Claudinho is an independent, open-source fan project. It displays factual match data
> (scores, fixtures, standings) and uses emoji flags only — no logos, emblems, kits,
> broadcast footage, or player likenesses.

## Why

During a month-long global tournament, checking scores means breaking flow. Claudinho brings the matches to where developers already live.

## Surfaces

- **CLI** — `claudinho today`, `claudinho live`, `claudinho next MEX`, `claudinho table`
- **Claude Code statusline** — a live score line while you code
- **MCP server** — ask your agent about matches mid-task (Claude Code, Cursor, Codex, Windsurf, Zed, …)
- **Notifier** — desktop notifications on goals, kickoffs, full-time
- **AI pundit** — daily predictions with a public, running accuracy scorecard

## Install

> 🚧 **Pre-launch.** Packages publish at tournament kickoff — **June 11, 2026**.

```bash
# MCP (Claude Code) — also works in Cursor (.cursor/mcp.json) & Codex (~/.codex/config.toml)
claude mcp add claudinho -- npx -y @claudinho/mcp

# CLI (installs the `claudinho` binary)
npm i -g @claudinho/cli   # then: claudinho today
```

## How it scales

Thin, open-source clients talk to a small edge gateway that polls a live data feed **once for everyone** and fans results out over a CDN. The schedule (fixtures, groups, venues, kickoffs) is static and bundled in the client; only live match state hits the network. Cost stays flat from one user to millions.

## Status

In active development ahead of the **June 11, 2026** kickoff. See **[docs/PRD.md](docs/PRD.md)** for the full product + technical spec.

## License

MIT © 2026 Arturo Garrido
