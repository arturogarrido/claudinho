# Claudinho — Cursor Marketplace plugin

**MCP-only.** This folder is the Cursor Marketplace manifest for the
[`claudinho`](https://github.com/arturogarrido/claudinho) monorepo. The npm
package is [`@claudinho/mcp`](https://www.npmjs.com/package/@claudinho/mcp).

## What installs

| Shipped in plugin | Not shipped (by design) |
|-------------------|-------------------------|
| MCP server via `../mcp.json` → `npx -y @claudinho/mcp` | Cursor CLI **statusline** (separate: `@claudinho/cli`) |
| 9 read-only tools (see below) | **Hook** / score-aware prompt injection (Cursor `beforeSubmitPrompt` unreliable) |
| Resources + prompts | Betting links or trade calls |

## MCP tools (9)

- `get_today` — fixtures for a date (default today), live overlay
- `get_live` — matches in play now
- `get_match` — one match by id
- `get_standings` — group table(s) A–L or all
- `get_bracket` — knockout tree (optional stage filter)
- `get_next_fixture` — team's next match (offline schedule)
- `get_market_signal` — read-only market-implied % (informational only)
- `get_share_snippet` — copy-paste plain-text card (match, standings, bracket, …)
- `get_team` — resolve a name/code to its FIFA code, flag, group (fuzzy; offline)

All tools are `readOnlyHint`; the match tools take optional `tz` / `lang` / `flavor`, while `get_team` is offline and takes just a `query`. No API keys.

## Verify locally

```bash
git clone https://github.com/arturogarrido/claudinho.git
cp -R claudinho ~/.cursor/plugins/local/claudinho
# Cursor → Developer: Reload Window
# Settings → MCP → confirm `claudinho` lists 9 tools
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

- Independent fan project — **not affiliated with FIFA or Anthropic**
- MIT license, full source in this repo
- Factual match data + emoji flags only (no crests, kits, footage, player likenesses)
- Live scores: ESPN public scoreboard (attributed as `Live data: ESPN`)
- Market line: optional, read-only Polymarket signal — **not betting advice**; off via `CLAUDINHO_MARKETS=off`
