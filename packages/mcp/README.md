# @claudinho/mcp ⚽

**An MCP server that lets your coding agent answer football questions: live scores, fixtures,
standings and paste-ready match cards for the competition you follow: the World Cup, the Premier
League, LALIGA, the Champions League and 12 more.** It works in Claude Code, Cursor, Codex, Claude
Desktop, Windsurf, Zed, VS Code and any MCP client that runs a local (stdio) server. No API key, no
signup, no account.

<p align="center">
  <img src="https://raw.githubusercontent.com/arturogarrido/claudinho/main/.github/assets/mcp-aha.gif" alt="Cursor CLI asked mid-task how Manchester City are doing against Paris Saint-Germain; it calls the Claudinho MCP server and answers with the live score from the 24th minute" width="760">
</p>

## Install

**Claude Code**
```bash
claude mcp add claudinho -- npx -y @claudinho/mcp
```

**Codex CLI**
```bash
codex mcp add claudinho -- npx -y @claudinho/mcp
```

**Cursor, Claude Desktop, Windsurf, Zed, VS Code**: add this to the client's MCP config (for
Cursor, `~/.cursor/mcp.json` or a project's `.cursor/mcp.json`; for Claude Desktop, Settings →
Developer → Edit Config, then restart):
```json
{ "mcpServers": { "claudinho": { "command": "npx", "args": ["-y", "@claudinho/mcp"] } } }
```

Using Cursor CLI too? `claudinho init cursor` (from `@claudinho/cli`) puts the live score in its
statusline and prints this config for you to paste.

## Ask your first question

The server answers for one competition at a time. Either name it in your question:

> "What Champions League matches are on today?" · "Show me the Premier League table" ·
> "When does Arsenal play next in the Champions League?"

or choose it once with the CLI, and then just ask:

```bash
npx @claudinho/cli follow champions-league --team Arsenal
```

> "What matches are on today?" · "Show me the live scores" · "When's our next game?" ·
> "Make me a shareable card for today"

Without a competition, the tools answer with a sentence saying how to choose one.

## Tools

Every tool is read-only, and two of them never touch the network.

| Tool | What it does |
|---|---|
| `get_today` | the fixtures for a date (default: today) in the caller's timezone, with live scores |
| `get_live` | the matches in play right now |
| `get_match` | one match by id, with the goals and cards the provider sent for a match in play or finished |
| `get_next_fixture` | a team's next match, by name or code (`Arsenal`, `ARS`, `Mexico`, `MEX`); with no team, the user's pinned team |
| `get_standings` | the standings: every table, or one by its key (a group letter, or `A1`, `A-B`, `LEAGUE`) |
| `get_bracket` | the World Cup's knockout bracket, from the Round of 32 to the final |
| `get_share_snippet` | a plain-text card for a match, a team's next match, a table, the bracket, a date or live; hand it to the user as it is |
| `get_market_signal` | World Cup prediction-market odds for a match, a team's current or next match, or a date; informational only |
| `get_team` | a World Cup nation's name or code to its FIFA code, flag and group (offline) |
| `list_competitions` | the supported competitions, the alias each takes and what each offers, and the one in effect (offline) |

Every tool but `get_team` takes an optional `competition` (an alias such as `champions-league`), and
most take `tz`, `lang` (`en`, `es`, `pt`, `fr`) and `flavor` (`off`, `subtle`, `full`).

Resources: `standings://{group}`, and `fixtures://{date}` (the bundled World Cup schedule).
Prompts: `my_team` (your team's next match and its standing, in the competition you follow) and
`tournament_today`.

## Prediction-market odds (World Cup)

For World Cup matches, `get_today` and `get_match` add a short "who's favored" line when a reliable
Polymarket market exists, and `get_market_signal` reads one on its own. **Informational only, not
betting advice:** market-implied percentages with Polymarket's attribution, never links or trade
calls. Finished matches never show one. Turn it off with `CLAUDINHO_MARKETS=off` in the server's
`env`.

## Commentary

Each match line in a tool's text ends with a short line of commentary in the reader's language
(`— ¡GOOOOL!`), or a team's own rally cry when it has one (Mexico's `¿Y si sí?`, Pumas' `¡Goya!`,
Arsenal's `COYG!`). It never appears in the structured data. Turn it down with
`CLAUDINHO_FLAVOR=subtle` or `off` in the server's `env`, or per call with `flavor`.

## Details for agent builders

**Choosing the competition.** A request's competition is its `competition` argument, else the
server's `CLAUDINHO_COMPETITION`, else the choice `claudinho follow <alias>` saved. An unknown value
is a tool error that lists the aliases. With none of the three, every competition-answering tool
answers `noCompetition: true` and `competition: null` beside its empty shape, with a sentence saying
what to do; `list_competitions` answers `current: null`.

**What every answer carries.** Human-readable text and structured content, validated against each
tool's declared `outputSchema`. The text starts with the competition it is for (a share card says it
in its title), and the structured content carries it as `competition`.

**Answers that are not whole.** When the provider sent records that could not be read,
`get_today`, `get_live`, `get_match`, `get_next_fixture`, `get_bracket`, `get_market_signal` and
`get_share_snippet` say so before what they show and carry `partial` (with `omitted`, the count of
records left out, when it is known). An empty answer then means nothing was read, not that nothing
exists. In particular, a missing next match does not mean a team is out.

**Club competitions.** `get_next_fixture` and `get_match` search from yesterday to 14 days ahead:
an empty answer carrying `horizon` or `window` is about that span. Several teams matching one name
come back as `candidates`. Between two seasons, `get_today`, `get_live`, `get_next_fixture` and
`get_match` carry `betweenEditions`. `get_bracket` answers `inapplicable` for a league season with no
knockout tie, and `unsupported` for a competition it does not cover yet. A club has no `flag`. A
match's `stage` is `REGULAR` for a league's season, `LEAGUE` for a cup's league phase, `PO` for
play-offs, or `OTHER` with the provider's own words in `stageLabel`.

**Markets.** `get_today` and `get_match` carry `marketComplete`, and `get_market_signal` carries
`complete`. `false` means the optional market read did not finish, which is not the same as "no
signal". `CLAUDINHO_MARKETS_SOURCE=fake` gives a clearly labelled, network-free preview.

**The process.** Stdout carries only the MCP protocol; diagnostics go to stderr.

## How it works

The World Cup's 104 fixtures ship with the package. Every other competition's schedule, and every
live score, comes from ESPN's public scoreboard (attributed in every answer). World Cup market odds
come from Polymarket's public data. The server keeps its cache in memory only.

## Privacy

No accounts, no telemetry, no analytics, no tracking, and no Claudinho server. The server asks ESPN
(and Polymarket, for World Cup odds) for public data with nothing about you attached; those services
still see standard request metadata, such as your IP address, like any web request. It writes
nothing to disk. Full policy:
[PRIVACY.md](https://github.com/arturogarrido/claudinho/blob/main/PRIVACY.md).

## License

MIT © 2026 Arturo Garrido · [source and issues](https://github.com/arturogarrido/claudinho)

Independent fan project. Not affiliated with FIFA, any confederation, league or club, or Anthropic.

_Built while watching the games._ **#VibingLaVidaLoca** ⚽
