# @claudinho/mcp ⚽

**An MCP server for the 2026 men's football tournament.** Ask your agent about live
scores, fixtures, group standings, and the prediction-market read — in Claude Code,
Cursor, Codex, Claude Desktop, Windsurf, Zed, VS Code, or any MCP client (stdio).
No API key, no signup — all 104 fixtures ship bundled; only live scores (and optional, read-only Polymarket signals) hit the network.

<p align="center">
  <img src="https://raw.githubusercontent.com/arturogarrido/claudinho/main/.github/assets/mcp-aha.gif" alt="An AI coding agent mid-task: asked 'did Germany get through?', it calls the Claudinho MCP server and answers with the result — 🇩🇪 Germany 1(3)–1(4) Paraguay 🇵🇾, FT (Paraguay won the shootout)" width="760">
</p>

> ⭐ Added via `npx` or your MCP config? **[Star the repo](https://github.com/arturogarrido/claudinho)** — a fan project runs on stars.

## Install

**Claude Code**
```bash
claude mcp add claudinho -- npx -y @claudinho/mcp
```

**Cursor** — add to `~/.cursor/mcp.json` (global) or a project `.cursor/mcp.json`:
```json
{ "mcpServers": { "claudinho": { "command": "npx", "args": ["-y", "@claudinho/mcp"] } } }
```
> Bonus: `claudinho init-cursor-statusline` (from `@claudinho/cli`) also puts the live score
> in your Cursor CLI statusline — or run `claudinho init cursor` to do both at once.

**Codex CLI**
```bash
codex mcp add claudinho -- npx -y @claudinho/mcp
```

**Claude Desktop / Windsurf / Zed / VS Code** — standard stdio config (same JSON as Cursor):
Claude Desktop: Settings → Developer → Edit Config, then restart. Codex config file:
`~/.codex/config.toml` (`[mcp_servers.claudinho]`, `command = "npx"`, `args = ["-y", "@claudinho/mcp"]`).

Then just ask your agent naturally — it picks the right tool and answers with live data:

> "What matches are on today?" · "Show me the live scores" · "What's Mexico's next game?"
> "Group A standings" · "Show the knockout bracket" · "Make me a shareable card for today"

## Tools

| Tool | What it does |
|---|---|
| `get_today` | fixtures for a date (default: today), grouped in the caller's `tz`, live scores overlaid |
| `get_live` | matches in play right now |
| `get_match` | a single match by id — in a club competition, looked for from yesterday to 14 days ahead (`window` names the days searched when it is not there) |
| `get_standings` | live cumulative standings — every table, or one by its key (a group letter, or `A1`, `A-B`, `LEAGUE`) |
| `get_bracket` | knockout bracket from the Round of 32 through the final — optional `stage` filter (`R32`, `R16`, `QF`, `SF`, `3P`, `F`); a league season with no knockout answers `inapplicable` |
| `get_next_fixture` | a team's next match, by name or code — a nation (`Mexico`, `MEX`): live-resolves a confirmed knockout tie from the feed, group fixtures offline, fails back to the bundled schedule if the feed is down; a club (`Arsenal`, `ARS`): its next match within 14 days, `candidates` when several teams match, `horizon` when it has none in that span |
| `get_market_signal` | read-only prediction-market signal for a match, a team's current-or-next fixture (in-play preferred while live), or a date — informational only |
| `get_share_snippet` | a copy-pasteable plain-text card — for a match, a team's next fixture, a group's standings table (`group`), the knockout bracket (`bracket: true`, optional `knockoutStage`), a date, or live — hand the returned snippet to the user as-is |
| `get_team` | the World Cup roster: resolve a nation name or code to its FIFA 3-letter code, flag, and group — fuzzy (`Mexico`, `mex`, `DR Congo`, `Türkiye`); handy for the code `get_market_signal` needs. It knows no clubs. Offline (no network) |

Most tools are **read-only** (`readOnlyHint`) and accept optional `tz`, `lang`
(`en`/`es`/`pt`/`fr`), and `flavor` (`off`/`subtle`/`full`); `get_team` is read-only
**and** offline. Every response carries
human-readable text **and** structured content, validated against each tool's
declared `outputSchema`. When the provider's knockout answer was not whole,
`get_next_fixture`, `get_bracket` and the next/bracket share cards say so before
what was read and carry `partial` (`omitted`: the count of provider records left
out, when known); no fixture is then not "eliminated". `get_today`, `get_live`,
`get_match`, `get_market_signal` and their share cards carry `partial` for their own
reads too: an empty answer then means nothing was read, not that nothing exists, and a
World Cup day counts the fixtures shown from the bundled schedule without their live
state. In a club competition whose
edition has ended (and the next has not started), `get_today`, `get_live`,
`get_next_fixture` and `get_match` say so and carry `betweenEditions`. A club has no
`flag` (a nation's is generated from its name), and nothing is printed in its place; a
match's `stage` is the written one (`REGULAR` for a league's season, `LEAGUE` for a cup's
league phase, `PO` for play-offs), or `OTHER` with the provider's own words in `stageLabel`.

Resources: `standings://{group}`, `fixtures://{date}`. Prompts: `tournament_today`,
and `my_team` (give it a 3-letter team code; combines next fixture, standings, and
the prediction-market read).

## Market signals

Market signals are pre-match and in-play reads — finished matches never show one.
`get_today` / `get_match` include a short market line when a reliable market exists
(slugs are auto-derived per fixture; matching fails closed). Their structured output
includes `marketComplete`; the dedicated market tool uses `complete`. A false verdict
means the optional read was unavailable or incomplete and is never described as "no signal."
Share cards carry the same verdict and warning. **Read-only and
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

## Privacy Policy

No personal data collected — no accounts, no telemetry, no analytics, no tracking, and no
Claudinho server. To show live scores, Claudinho makes read-only requests to public services
(ESPN; Polymarket for informational-only market signals) with no account or personal data
attached, though those services still receive standard request metadata (such as your IP
address) like any HTTP call. The MCP server keeps its cache **in memory only** and writes
nothing to disk. Full policy: [PRIVACY.md](https://github.com/arturogarrido/claudinho/blob/main/PRIVACY.md).

## License

MIT © 2026 Arturo Garrido · [source & issues](https://github.com/arturogarrido/claudinho)

> **Not affiliated with, endorsed by, or connected to FIFA or Anthropic.** An independent,
> open-source fan project showing factual match data with emoji flags only — no logos, crests,
> kits, broadcast footage, or player likenesses.

---

_Built while watching the games._ **#VibingLaVidaLoca** ⚽
