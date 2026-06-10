# Claudinho ⚽

[![CI](https://github.com/arturogarrido/claudinho/actions/workflows/ci.yml/badge.svg)](https://github.com/arturogarrido/claudinho/actions/workflows/ci.yml)
[![npm: @claudinho/cli](https://img.shields.io/npm/v/@claudinho/cli?label=%40claudinho%2Fcli&color=cb3837)](https://www.npmjs.com/package/@claudinho/cli)
[![npm: @claudinho/mcp](https://img.shields.io/npm/v/@claudinho/mcp?label=%40claudinho%2Fmcp&color=cb3837)](https://www.npmjs.com/package/@claudinho/mcp)
[![node](https://img.shields.io/node/v/@claudinho/cli?color=5fa04e)](https://nodejs.org)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![#VibingLaVidaLoca](https://img.shields.io/badge/%23VibingLaVidaLoca-⚽-ff5a5f)](https://github.com/arturogarrido/claudinho)

**Live scores for the 2026 men's football tournament — in your terminal, your Claude Code statusline, and any MCP client.** No API key, no signup; all 104 fixtures ship bundled, so the schedule works offline.

<!-- HERO: uncomment when .github/assets/hero.gif lands
<p align="center">
  <img src=".github/assets/hero.gif" alt="Claudinho — live score flipping in the Claude Code statusline while coding" width="800">
</p>
-->

```bash
npx @claudinho/cli today      # try it in 10 seconds — no install, no key
```

While matches are live, your Claude Code statusline reads:

```text
⚽ 🇳🇴 1–1 🇫🇷 87' · 🇸🇳 1–2 🇮🇶 86'
```

And `claudinho share` prints a card made for the group chat:

<!-- DEMO CARD: verbatim output of `claudinho share next MEX --tz America/Mexico_City`.
     REGENERATE immediately before merging — the market block is gate-conditional
     and the numbers drift. Never hand-edit. -->
```text
Next up for Mexico

🇲🇽 Mexico vs South Africa 🇿🇦
Jun 11 · 13:00 America/Mexico_City
Estadio Banorte, Mexico City, Mexico

Prediction markets favor Mexico.
Mexico 69% · Draw 20% · South Africa 10%
Source: Polymarket · updated 07:54 UTC · informational only

#VibingLaVidaLoca · Independent fan project · not affiliated with FIFA or Anthropic.
Try it: npx @claudinho/cli next MEX
```

> ⚠️ **Not affiliated with, endorsed by, or connected to FIFA or Anthropic.**
> Claudinho is an independent, open-source fan project. It displays factual match data
> (scores, fixtures, standings) and uses emoji flags only — no logos, emblems, kits,
> broadcast footage, or player likenesses.

## Install

### Just the CLI

```bash
npm i -g @claudinho/cli
claudinho today
claudinho next MEX --tz America/Mexico_City --lang es
```

### Claude Code — statusline, score-aware hook, MCP

```bash
npm i -g @claudinho/cli
claudinho init-statusline    # live scores inline while you code (<150ms, cache-only)
claudinho init-hook          # Claude knows the score during matches (silent off-match)
claude mcp add claudinho -- npx -y @claudinho/mcp
```

Both `init-*` commands back up `~/.claude/settings.json` first and are idempotent.
Restart Claude Code to activate.

### Other MCP clients — Cursor, Codex, Claude Desktop, Windsurf, Zed, VS Code

```bash
codex mcp add claudinho -- npx -y @claudinho/mcp    # Codex CLI
```

Everything else takes the standard stdio config:

```json
{ "mcpServers": { "claudinho": { "command": "npx", "args": ["-y", "@claudinho/mcp"] } } }
```

## Surfaces

- **CLI** — `today`, `live`, `next MEX`, `table`, `match <id>`, `markets`, `share` (and `vibe` 😎). `--json` on everything; TZ-aware via `--tz`.
- **Claude Code statusline** — every live score inline; reads a local micro-cache, never blocks on the network. Also works in tmux/Starship via `claudinho prompt`.
- **Score-aware Claude** — a `UserPromptSubmit` hook that drops the live score into Claude's context during matches; zero tokens off-match.
- **MCP server** — 7 read-only tools (`get_today`, `get_live`, `get_match`, `get_next_fixture`, `get_standings`, `get_market_signal`, `get_share_snippet`) plus `my_team` / `tournament_today` prompts.
- **Prediction-market signals** — a read-only "who's favored" line (market-implied percentages, Source: Polymarket), shown only when a reliable market exists. **Informational only — not betting advice.** Opt out: `--no-markets` / `CLAUDINHO_MARKETS=off`.
- **Shareable cards** — `claudinho share next MEX --copy` puts a plain-text match card on your clipboard.

Speaks `en` / `es` / `pt` / `fr`, with optional localized commentary flair (`¡GOOOOL!`) — dial it down with `--flavor subtle|off`.

_Planned (not shipped yet):_ a desktop notifier and an AI pundit with a public accuracy scorecard.

## FAQ

**Do I need an API key or account?** No. Nothing to sign up for; `npx` and done.

**Does it work offline?** The schedule, `next`, and group skeletons do — all 104 fixtures are bundled. Only live scores hit the network.

**Where does the data come from?** Live scores from ESPN's public scoreboard (attributed in output as `Live data: ESPN`); market signals from Polymarket public data. Rate limits respected.

**Is the market line betting advice?** No. It's read-only, informational-only market data with attribution — no trading, no links — and it never appears on the statusline or hook.

**Why no crests, kits, or player photos?** Legal-clean by design: facts and emoji flags only.

**Windows?** Works, but flag emoji rendering varies by terminal — best on macOS/Linux.

## License

MIT © 2026 Arturo Garrido. All three packages publish with npm provenance via OIDC trusted publishing.

---

_Built while watching the games._ **#VibingLaVidaLoca** ⚽
