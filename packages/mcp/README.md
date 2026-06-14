# @claudinho/mcp ⚽

**An MCP server for the 2026 men's football tournament.** Ask your agent about live
scores, fixtures, group standings, and the prediction-market read — in Claude Code,
Cursor, Codex, Claude Desktop, Windsurf, Zed, VS Code, or any MCP client (stdio).

> ⚠️ **Not affiliated with, endorsed by, or connected to FIFA or Anthropic.**
> Claudinho is an independent, open-source fan project. Factual match data with
> emoji flags only — no logos, crests, kits, footage, or player likenesses.

## Install

**Claude Code**
```bash
claude mcp add claudinho -- npx -y @claudinho/mcp
```

**Codex CLI**
```bash
codex mcp add claudinho -- npx -y @claudinho/mcp
```

**Cursor / Claude Desktop / Windsurf / Zed / VS Code** — standard stdio config:
```json
{ "mcpServers": { "claudinho": { "command": "npx", "args": ["-y", "@claudinho/mcp"] } } }
```
Cursor: `.cursor/mcp.json` (or `~/.cursor/mcp.json`). Claude Desktop: Settings →
Developer → Edit Config, then restart. Codex config file: `~/.codex/config.toml`
(`[mcp_servers.claudinho]`, `command = "npx"`, `args = ["-y", "@claudinho/mcp"]`).

## Tools

| Tool | What it does |
|---|---|
| `get_today` | fixtures for a date (default: today), grouped in the caller's `tz`, live scores overlaid |
| `get_live` | matches in play right now |
| `get_match` | a single match by id |
| `get_standings` | live cumulative group table(s) — one group `A`–`L`, or all |
| `get_next_fixture` | a team's next match (3-letter code, e.g. `MEX`) — fully offline |
| `get_market_signal` | read-only prediction-market signal for a match, a team's current-or-next fixture (in-play preferred while live), or a date — informational only |
| `get_share_snippet` | a copy-pasteable plain-text card — for a match, a team's next fixture, a group's standings table (`group`), a date, or live — hand the returned snippet to the user as-is |

All tools are **read-only** (`readOnlyHint`) and accept optional `tz`, `lang`
(`en`/`es`/`pt`/`fr`), and `flavor` (`off`/`subtle`/`full`). Every response carries
human-readable text **and** structured JSON.

Resources: `standings://{group}`, `fixtures://{date}`. Prompts: `tournament_today`,
and `my_team` (give it a 3-letter team code; combines next fixture, standings, and
the prediction-market read).

## Market signals

Market signals are pre-match and in-play reads — finished matches never show one.
`get_today` / `get_match` include a short market line when a reliable market exists
(slugs are auto-derived per fixture; matching fails closed). **Read-only and
informational only — not betting advice:** market-implied percentages with Polymarket
attribution, never links or trade calls. Disable with `CLAUDINHO_MARKETS=off`; set
`CLAUDINHO_MARKETS_SOURCE=fake` in the server `env` for a network-free, clearly
labeled synthetic preview.

## Commentary flair

Match lines in the text end with a short, localized, genre-style exclamation
(`— ¡GOOOOL!`) — generic energy, no real commentator quoted or impersonated, never
in the structured JSON. Control with `CLAUDINHO_FLAVOR` (`off`|`subtle`|`full`,
default `full`) in the server `env`, or per call via the `flavor` argument.

## How it works

All 104 fixtures ship bundled in the package; only live state hits the network —
live scores from **ESPN's** public scoreboard (swappable provider, attributed in
output), market signals from Polymarket. Stdout carries only the MCP protocol;
diagnostics go to stderr.

## License

MIT © 2026 Arturo Garrido · [source & issues](https://github.com/arturogarrido/claudinho)

---

_Built while watching the games._ **#VibingLaVidaLoca** ⚽
