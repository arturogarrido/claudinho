---
name: Claudinho Live Scores
description: |
  Live 2026 World Cup scores, fixtures, standings, knockout bracket, and
  shareable match cards — streamed from ESPN into your terminal, statusline,
  or MCP client. No API key required.
---

# Claudinho Live Scores

> Provenance: shaped from [arturogarrido/claudinho](https://github.com/arturogarrido/claudinho)
> (TypeScript, MIT, 17 stars). Discovery: <https://x.com/JordanLyall/status/2023770839934459914>.
> The original repo ships a CLI (`@claudinho/cli`), an MCP server (`@claudinho/mcp`),
> and a shared core library — but no SKILL.md. This skill wraps the public workflow
> into a single conversational interface.

## What This Skill Does

Claudinho gives you live and scheduled World Cup 2026 match data in a
conversational interface. It covers:

- **Today's matches** — scores, minute markers, and status for every fixture
  on a given date (defaults to today).
- **Live matches** — only the games currently in play, with real-time score
  updates from ESPN.
- **Single match lookup** — fetch any fixture by its match ID, with live
  overlay when the game is on.
- **Group standings** — cumulative tables for any group (A–L) or all groups
  at once, sourced from the provider's standings feed.
- **Knockout bracket** — the full elimination tree (R32 through Final) with
  hybrid slot resolution: confirmed ties from the live feed, projected
  placeholders from group standings elsewhere.
- **Next fixture for a team** — the upcoming (or currently live) match for a
  given national team code (e.g. MEX, BRA, FRA).
- **Prediction-market signals** — read-only Polymarket odds for upcoming or
  in-play matches (informational only, no advice, no links).
- **Shareable snippets** — copy-pasteable plain-text cards for matches,
  standings tables, or the bracket — the same artifact as `claudinho share`
  in the CLI.

All 104 group-stage and knockout fixtures ship bundled, so the schedule works
offline; live scores overlay from ESPN when available.

## Required Inputs

None. The skill works with zero configuration. Optionally the user may specify:

- `team` — a three-letter FIFA country code (e.g. `MEX`, `BRA`, `GER`)
- `date` — an ISO date string (e.g. `2026-07-19`) to query a specific matchday
- `group` — a group letter (A–L) for standings
- `matchId` — a specific fixture ID for direct lookup
- `tz` — IANA timezone (e.g. `America/Mexico_City`) for localized kickoff times
- `lang` — language/locale code for i18n output

## Output Contract

The skill returns structured match data with:

- Human-readable text summaries with emoji flags and minute markers
- Structured JSON data payloads for programmatic consumption
- Live-data attribution (e.g. "Live data: ESPN") when the live feed served results
- Non-affiliation disclaimer (independent fan project, not FIFA/Anthropic)
- Optional market-signal blocks with source attribution and informational-only caveat

## How To Use

Ask in natural language. Examples:

- "What matches are on today?"
- "Show me the live scores"
- "What's the next match for Mexico?"
- "Show Group A standings"
- "Show the knockout bracket"
- "Give me a shareable card for today's matches"
- "What are the market odds for the Brazil vs France match?"

## Installation (CLI / MCP)

```bash
# Try it instantly
npx @claudinho/cli today

# Install globally
npm i -g @claudinho/cli

# Set up Claude Code / Cursor statusline
claudinho init cursor
```

MCP server config (for any MCP client):
```json
{ "mcpServers": { "claudinho": { "command": "npx", "args": ["-y", "@claudinho/mcp"] } } }
```

## Source References

- Repository: https://github.com/arturogarrido/claudinho
- npm CLI: https://www.npmjs.com/package/@claudinho/cli
- npm MCP: https://www.npmjs.com/package/@claudinho/mcp
- Core library: https://github.com/arturogarrido/claudinho/tree/main/packages/core
- MCP tools: https://github.com/arturogarrido/claudinho/tree/main/packages/mcp/src/tools.ts
- CLI commands: https://github.com/arturogarrido/claudinho/tree/main/packages/cli/src/commands.ts
