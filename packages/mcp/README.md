# @claudinho/mcp ⚽

**An MCP server for the 2026 men's football tournament.** Ask your agent about
live scores, fixtures, and group standings — in Claude Code, Cursor, Codex, and
any other MCP client.

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
| `get_today` | fixtures for a date (default: today), live scores overlaid |
| `get_live` | matches in play right now |
| `get_match` | a single match by id |
| `get_standings` | group table(s) — one group `A`–`L`, or all |
| `get_next_fixture` | a team's next match (3-letter code, e.g. `MEX`) |

All tools are **read-only** (annotated `readOnlyHint`) and accept optional
`tz` (IANA timezone) and `lang` (`en`/`es`/`pt`/`fr`) arguments. Each response
includes both human-readable text and structured JSON.

## Resources & prompts

- Resources: `standings://{group}` (e.g. `standings://A`), `fixtures://{date}` (e.g. `fixtures://2026-06-11`)
- Prompts: `tournament_today`, `my_team`

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
