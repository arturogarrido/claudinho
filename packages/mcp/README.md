# @claudinho/mcp ⚽

**An MCP server for the 2026 men's football tournament.** Ask your agent about
live scores, fixtures, group standings, and prediction-market odds — in Claude
Code, Cursor, Codex, and any other MCP client.

> ⚠️ **Not affiliated with, endorsed by, or connected to FIFA or Anthropic.**
> Claudinho is an independent, open-source fan project. Factual match data with
> emoji flags only — no logos, crests, kits, footage, or player likenesses.

## Install

**Claude Code**
```bash
claude mcp add claudinho -- npx -y @claudinho/mcp
```

**Cursor** — add to `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):
```json
{ "mcpServers": { "claudinho": { "command": "npx", "args": ["-y", "@claudinho/mcp"] } } }
```

**Codex CLI** — add to `~/.codex/config.toml`:
```toml
[mcp_servers.claudinho]
command = "npx"
args = ["-y", "@claudinho/mcp"]
```
(or `codex mcp add claudinho -- npx -y @claudinho/mcp`)

**Claude Desktop** — edit `claude_desktop_config.json` (Settings → Developer →
Edit Config), then restart Claude Desktop:
```json
{ "mcpServers": { "claudinho": { "command": "npx", "args": ["-y", "@claudinho/mcp"] } } }
```
Config location: macOS `~/Library/Application Support/Claude/claude_desktop_config.json`,
Windows `%APPDATA%\Claude\claude_desktop_config.json`.

Transport is stdio, so the same package works in Windsurf, Zed, VS Code, and
any other MCP client with no changes.

## Tools

| Tool | What it does |
|---|---|
| `get_today` | fixtures for a date (default: today), grouped in the caller's `tz`, live scores overlaid |
| `get_live` | matches in play right now |
| `get_match` | a single match by id |
| `get_standings` | group table(s) — one group `A`–`L`, or all |
| `get_next_fixture` | a team's next match (3-letter code, e.g. `MEX`) |
| `get_market_signal` | read-only prediction-market odds for a match, a team's next fixture, or a date — informational only |

All tools are **read-only** (annotated `readOnlyHint`) and accept optional
`tz` (IANA timezone), `lang` (`en`/`es`/`pt`/`fr`), and `flavor`
(`off`/`subtle`/`full`) arguments. Each response includes both human-readable
text and structured JSON.

`get_today` and `get_match` also include reliable prediction-market context when a
market is available. Match→market event slugs are derived automatically, so no
mapping is needed. Market data is **read-only and informational only — not betting
advice** (market-implied percentages with attribution, never links or trade
calls), sourced from Polymarket public data and shown only when a market maps
cleanly to the result. Disable it with `CLAUDINHO_MARKETS=off`; set
`CLAUDINHO_MARKETS_SOURCE=fake` (in the server `env`) for a network-free synthetic
preview.

## Resources & prompts

- Resources: `standings://{group}` (e.g. `standings://A`), `fixtures://{date}` (UTC date, e.g. `fixtures://2026-06-11`)
- Prompts: `tournament_today`, `my_team`

## Commentary flair

By default the server adds a light, localized football-commentary voice: each
match line in the text ends with a short genre-style exclamation (`— ¡GOOOOL!`),
and the server instructions nudge the model to narrate scores with matching
energy. The phrases are generic — no real commentator is quoted or impersonated —
and they never touch the structured JSON, so the facts stay clean.

Control it with `CLAUDINHO_FLAVOR` (`off` | `subtle` | `full`, default `full`),
or per call via the `flavor` tool argument. In Claude Code, add it to the `env`
block of your server entry:

```json
{ "mcpServers": { "claudinho": {
  "command": "npx", "args": ["-y", "@claudinho/mcp"],
  "env": { "CLAUDINHO_FLAVOR": "subtle" }
} } }
```

## Other competitions

By default the server follows the 2026 World Cup. Set the `CLAUDINHO_COMPETITION`
env var (e.g. `fifa.friendly`) to point the live tools at another
competition — useful for testing before the tournament. In Claude Code, add it
to the `env` block of your MCP server entry.

## How it works

The fixture list ships bundled in the package; only live state hits the network
(via a swappable data provider). The server writes nothing to stdout
except the MCP protocol; diagnostics go to stderr.

## License

MIT © 2026 Arturo Garrido · [source & issues](https://github.com/arturogarrido/claudinho)

---

_Built while watching the games._ **#VibingLaVidaLoca** ⚽
