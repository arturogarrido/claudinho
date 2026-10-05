# @claudinho/mcp ⚽

**An MCP server with live football scores, fixtures, standings and paste-ready match cards for
the competition you follow: the World Cup, the Premier League, LALIGA, the Champions League and
11 more.** Ask your agent in Claude Code, Cursor, Codex, Claude Desktop, Windsurf, Zed, VS Code,
or any MCP client (stdio). No API key, no signup. The World Cup's 104 fixtures ship bundled; the
other competitions' schedules are read from the feed, and live scores (and the optional,
read-only Polymarket signals for the World Cup) hit the network. It ran the 2026 World Cup from
the opener to the final.

<p align="center">
  <img src="https://raw.githubusercontent.com/arturogarrido/claudinho/main/.github/assets/mcp-aha.gif" alt="An AI coding agent mid-task: asked 'did Germany get through?', it calls the Claudinho MCP server and answers with the result: 🇩🇪 Germany 1(3)–1(4) Paraguay 🇵🇾, FT (Paraguay won the shootout)" width="760">
</p>

> ⭐ Added via `npx` or your MCP config? **[Star the repo](https://github.com/arturogarrido/claudinho)**: a fan project runs on stars.

## Install

**Claude Code**
```bash
claude mcp add claudinho -- npx -y @claudinho/mcp
```

**Cursor**: add to `~/.cursor/mcp.json` (global) or a project `.cursor/mcp.json`:
```json
{ "mcpServers": { "claudinho": { "command": "npx", "args": ["-y", "@claudinho/mcp"] } } }
```
> Bonus: `claudinho init-cursor-statusline` (from `@claudinho/cli`) also puts the live score
> in your Cursor CLI statusline, or run `claudinho init cursor` to do both at once.

**Codex CLI**
```bash
codex mcp add claudinho -- npx -y @claudinho/mcp
```

**Claude Desktop / Windsurf / Zed / VS Code**: standard stdio config (same JSON as Cursor):
Claude Desktop: Settings → Developer → Edit Config, then restart. Codex config file:
`~/.codex/config.toml` (`[mcp_servers.claudinho]`, `command = "npx"`, `args = ["-y", "@claudinho/mcp"]`).

Then just ask your agent naturally; it picks the right tool and answers with live data:

> "What matches are on today?" · "Show me the live scores" · "What's Arsenal's next game?"
> "Show the Premier League table" · "Show the World Cup bracket" · "Make me a shareable card for today"

## Tools

| Tool | What it does |
|---|---|
| `get_today` | fixtures for a date (default: today), grouped in the caller's `tz`, live scores overlaid |
| `get_live` | matches in play right now |
| `get_match` | a single match by id; in a club competition, looked for from yesterday to 14 days ahead (`window` names the days searched when it is not there) |
| `get_standings` | live cumulative standings: every table, or one by its key (a group letter, or `A1`, `A-B`, `LEAGUE`) |
| `get_bracket` | knockout bracket from the Round of 32 through the final, with an optional `stage` filter (`R32`, `R16`, `QF`, `SF`, `3P`, `F`); the Premier League and LALIGA, league seasons with no knockout tie of their own, answer `inapplicable`; the other competitions off the World Cup answer `unsupported` (not offered yet) |
| `get_next_fixture` | a team's next match, by name or code. A nation (`Mexico`, `MEX`): live-resolves a confirmed knockout tie from the feed, group fixtures offline, fails back to the bundled schedule if the feed is down; a club (`Arsenal`, `ARS`): its next match within 14 days, `candidates` when several teams match, `horizon` when it has none in that span. With no `team`: the server's `CLAUDINHO_TEAM`, else the team the user pinned (`claudinho follow <alias> --team <name>`) when the request is for its competition |
| `get_market_signal` | read-only prediction-market signal for a match, a team's current-or-next fixture (in-play preferred while live), or a date; informational only |
| `get_share_snippet` | a copy-pasteable plain-text card for a match, a team's next fixture, a group's standings table (`group`), the knockout bracket (`bracket: true`, optional `knockoutStage`), a date, or live; hand the returned snippet to the user as-is |
| `get_team` | the World Cup roster: resolve a nation name or code to its FIFA 3-letter code, flag, and group; fuzzy (`Mexico`, `mex`, `DR Congo`, `Türkiye`); handy for the code `get_market_signal` needs. It knows no clubs. Offline (no network) |
| `list_competitions` | the supported competitions: each one's alias (what `competition` takes), name, teams (nations or clubs), kind, and what it offers (scores, next, standings, bracket, markets: `offered`, `not-offered-yet`, `not-applicable`), plus `current`, the competition the request is for. Offline (no network) |

Most tools are **read-only** (`readOnlyHint`) and accept optional `tz`, `lang`
(`en`/`es`/`pt`/`fr`), `flavor` (`off`/`subtle`/`full`), and `competition`: an alias
such as `premier-league` (from `list_competitions`) or an ESPN slug such as `eng.1`
(without it: the server's `CLAUDINHO_COMPETITION`, else the user's saved choice, the one
`claudinho follow <alias>` saves; an unknown value is a tool error listing the aliases).
With none of the three, every competition-answering tool answers, before it reads
anything, `noCompetition: true` and `competition: null` beside its empty shape, and a
sentence saying what to do (pass `competition`, or the user runs `claudinho follow
<alias>`); `list_competitions` answers `current: null`, and `get_team` answers as ever. Every competition-answering tool's text
starts with the competition it is for (`Premier League · from the request`; a share
card says it in its title instead) and its structured content carries it as
`competition`. `get_team` (the World Cup's roster, whatever the competition) and
`list_competitions` are read-only **and** offline. Every response carries
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

Resources: `standings://{group}` (its text starts with the competition it is for, like a tool's), `fixtures://{date}` (the bundled World Cup schedule, named first, whatever the competition). Prompts: `tournament_today`,
and `my_team` (the World Cup's: give it a nation's code or name; it asks the World Cup's
tools, `competition: "world-cup"`, for the next fixture with its date and state, the
standings, and the prediction-market read).

## Market signals

Market signals are pre-match and in-play reads: finished matches never show one.
`get_today` / `get_match` include a short market line when a reliable market exists
(slugs are auto-derived per fixture; matching fails closed). Their structured output
includes `marketComplete`; the dedicated market tool uses `complete`. A false verdict
means the optional read was unavailable or incomplete and is never described as "no signal."
Share cards carry the same verdict and warning. **Read-only and
informational only, not betting advice:** market-implied percentages with Polymarket
attribution, never links or trade calls. Disable with `CLAUDINHO_MARKETS=off`; set
`CLAUDINHO_MARKETS_SOURCE=fake` in the server `env` for a network-free, clearly
labeled synthetic preview.

## Commentary flair

Match lines in the text end with a short, localized exclamation for the match's
moment (`— ¡GOOOOL!`): a few hundred lines in four languages, no real person named
or impersonated, none repeated within one list while the bank lasts, never in the
structured JSON. A team's own rally cry takes its place when one side has one
(Mexico's `¿Y si sí?`, Pumas' `¡Goya!`, Arsenal's `COYG!`; the home side's when
both do). Control with `CLAUDINHO_FLAVOR` (`off`|`subtle`|`full`, default `full`)
in the server `env`, or per call via the `flavor` argument.

## How it works

The World Cup's 104 fixtures ship bundled in the package; the other competitions'
schedules are read from the feed, and live state always hits the network: live scores
from **ESPN's** public scoreboard (swappable provider, attributed in output), market
signals from Polymarket. Stdout carries only the MCP protocol;
diagnostics go to stderr.

## Privacy Policy

No personal data collected: no accounts, no telemetry, no analytics, no tracking, and no
Claudinho server. To show live scores, Claudinho makes read-only requests to public services
(ESPN; Polymarket for informational-only market signals) with no account or personal data
attached, though those services still receive standard request metadata (such as your IP
address) like any HTTP call. The MCP server keeps its cache **in memory only** and writes
nothing to disk. Full policy: [PRIVACY.md](https://github.com/arturogarrido/claudinho/blob/main/PRIVACY.md).

## License

MIT © 2026 Arturo Garrido · [source & issues](https://github.com/arturogarrido/claudinho)

> **Not affiliated with FIFA, any confederation, league or club, or Anthropic. Nor endorsed by or connected to any of them.** An independent,
> open-source fan project showing factual match data with emoji flags only: no logos, crests,
> kits, broadcast footage, or player likenesses.

---

_Built while watching the games._ **#VibingLaVidaLoca** ⚽
