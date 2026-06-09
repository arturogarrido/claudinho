# Claudinho ⚽

[![CI](https://github.com/arturogarrido/claudinho/actions/workflows/ci.yml/badge.svg)](https://github.com/arturogarrido/claudinho/actions/workflows/ci.yml) [![#VibingLaVidaLoca](https://img.shields.io/badge/%23VibingLaVidaLoca-⚽-ff5a5f)](https://github.com/arturogarrido/claudinho)

**The 2026 men's football tournament, right in your dev environment.**

Live scores, fixtures, group tables, and prediction-market odds — in your terminal, your Claude Code statusline, and any MCP client. Installed in one line.

> ⚠️ **Not affiliated with, endorsed by, or connected to FIFA or Anthropic.**
> Claudinho is an independent, open-source fan project. It displays factual match data
> (scores, fixtures, standings) and uses emoji flags only — no logos, emblems, kits,
> broadcast footage, or player likenesses.

## Why

During a month-long global tournament, checking scores means breaking flow. Claudinho brings the matches to where developers already live.

## Surfaces

- **CLI** — `claudinho today`, `claudinho live`, `claudinho next MEX`, `claudinho table`, `claudinho markets`, `claudinho share` (and `claudinho vibe` 😎)
- **Claude Code statusline** — all live scores inline while you code
- **MCP server** — ask your agent about matches mid-task, or for a copy-pasteable match card (Claude Code, Cursor, Codex, Windsurf, Zed, …)
- **Score-aware Claude** — a `UserPromptSubmit` hook that drops the live score into Claude's context during matches
- **Prediction-market signals** — read-only "who's favored" odds (via Polymarket), shown when a reliable market is available. **Informational only — not betting advice;** opt out with `--no-markets` / `CLAUDINHO_MARKETS=off`
- **Shareable snippets** — `claudinho share` emits a polished, copy-pasteable match card (terminal, Slack, X, READMEs) with a subtle install cue and `#VibingLaVidaLoca` — `--copy` drops it straight on your clipboard

Speaks `en` / `es` / `pt` / `fr`, with optional localized commentary flair (`¡GOOOOL!`) you can dial down or off.

_Planned:_ a desktop **notifier** (goal/kickoff/FT alerts) and an **AI pundit** (daily predictions with a public accuracy scorecard).

## Install

> ✅ **Live on npm** — [`@claudinho/cli`](https://www.npmjs.com/package/@claudinho/cli) · [`@claudinho/mcp`](https://www.npmjs.com/package/@claudinho/mcp)

```bash
# MCP (Claude Code) — also works in Cursor (.cursor/mcp.json) & Codex (~/.codex/config.toml)
claude mcp add claudinho -- npx -y @claudinho/mcp

# CLI (installs the `claudinho` binary)
npm i -g @claudinho/cli   # then: claudinho today
```

## License

MIT © 2026 Arturo Garrido

---

_Built while watching the games._ **#VibingLaVidaLoca** ⚽
