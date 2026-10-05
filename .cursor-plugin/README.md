# Claudinho: Cursor Marketplace plugin

**A read-only MCP server with live football scores, fixtures and standings for the competition
you follow: the World Cup, the Premier League, LALIGA, the Champions League and 11 more.** No API
key. Pairs with the Claudinho Cursor CLI statusline.

**MCP-only.** This folder is the Cursor Marketplace manifest for the
[`claudinho`](https://github.com/arturogarrido/claudinho) monorepo. The npm
package is [`@claudinho/mcp`](https://www.npmjs.com/package/@claudinho/mcp).

## What installs

| Shipped in plugin | Not shipped (by design) |
|-------------------|-------------------------|
| MCP server via `../mcp.json` → `npx -y @claudinho/mcp` | Cursor CLI **statusline** (separate: `@claudinho/cli`) |
| 10 read-only tools (see below) | **Hook** / score-aware prompt injection (Cursor `beforeSubmitPrompt` unreliable) |
| Resources + prompts | Betting links or trade calls |

## MCP tools (10)

- `get_today`: fixtures for a date (default today), live overlay
- `get_live`: matches in play now
- `get_match`: one match by id
- `get_standings`: standings (every table, or one by its key: a group letter, or `A1`, `A-B`, `LEAGUE`)
- `get_bracket`: knockout tree (optional stage filter)
- `get_next_fixture`: a team's next match, by name or code (a nation, or a club in a club competition)
- `get_market_signal`: read-only market-implied % (informational only)
- `get_share_snippet`: copy-paste plain-text card (match, standings, bracket, …)
- `get_team`: the World Cup roster; resolves a nation's name/code to its FIFA code, flag, group (fuzzy; offline)
- `list_competitions`: the supported competitions: aliases, names, what each offers, and the current one (offline)

All tools are `readOnlyHint`; the match tools take optional `tz` / `lang` / `flavor` and `competition` (an alias such as `premier-league`, or an ESPN slug such as `eng.1`; without it, the server's `CLAUDINHO_COMPETITION`, else the user's saved choice from `claudinho follow`; with none, a tool answers `noCompetition`), while `get_team` is offline and takes just a `query`. No API keys.

## Verify locally

```bash
git clone https://github.com/arturogarrido/claudinho.git
cp -R claudinho ~/.cursor/plugins/local/claudinho
# Cursor → Developer: Reload Window
# Settings → MCP → confirm `claudinho` lists 10 tools
```

Or run the server directly:

```bash
npx -y @claudinho/mcp
```

Tests: `packages/mcp/test/cursor-plugin.test.ts`, `packages/mcp/test/manifest.test.ts`.

## Statusline (optional companion)

Not a plugin primitive. Users who want live scores in the Cursor CLI statusline:

```bash
npm i -g @claudinho/cli
claudinho init cursor
```

## Data & compliance

- Independent fan project. **Not affiliated with FIFA, any confederation, league or club, or Anthropic. Nor endorsed by or connected to any of them.**
- MIT license, full source in this repo
- Factual match data + emoji flags only (no crests, kits, footage, player likenesses)
- Live scores: ESPN public scoreboard (attributed as `Live data: ESPN`)
- Market line: optional, read-only Polymarket signal, **not betting advice**; off via `CLAUDINHO_MARKETS=off`
