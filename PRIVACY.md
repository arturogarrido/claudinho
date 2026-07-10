# Privacy Policy

**Effective date:** 2026-07-09

Claudinho is an independent, open-source project — a CLI, a Claude Code / Cursor
statusline, a score-aware hook, and an MCP server (Claude Desktop Extension) that shows
live football scores in your terminal and coding agent. This policy explains what data
Claudinho does and does not handle. It applies to the `@claudinho/cli`, `@claudinho/mcp`,
and `@claudinho/core` packages and the Claude Desktop Extension (`.mcpb`) bundle.

## Short version

Claudinho collects **no personal data**. No accounts, no sign-up, no telemetry, no
analytics, no tracking, no advertising identifiers. **There is no Claudinho server** —
nothing you do is sent to us, because there is nothing on our side to send it to.

## What Claudinho does not collect

- No personal information (name, email, location, device identifiers).
- No usage analytics or telemetry of any kind.
- No API keys, credentials, or account data (Claudinho requires none).
- No prompts, code, or conversation content from Claude Code, Cursor, or any MCP client.

## Data Claudinho does handle

To show live results, Claudinho makes outbound HTTPS requests to public, third-party
sports-data services:

- **ESPN** public scoreboard and standings endpoints — live scores, fixtures, and group tables.
- **Polymarket** public Gamma API — read-only, informational-only prediction-market signals.
  Fetched only when market signals are enabled (`CLAUDINHO_MARKETS` is not `off`), and never
  shown on the statusline or hook.

Claudinho itself adds **no accounts, authentication, profile, or prompt data** to these
requests — they are anonymous reads of public endpoints (a date and competition for scores;
a public event slug for market data). As with any HTTP request, though, the service you
connect to still receives the standard request metadata your device sends, such as your **IP
address and HTTP headers**; Claudinho cannot avoid this and adds nothing beyond it. Your use
of those third-party services is governed by their own privacy policies:

- ESPN (a division of The Walt Disney Company): <https://privacy.thewaltdisneycompany.com/en/current-privacy-policy/>
- Polymarket: <https://polymarket.com/privacy>

## Local storage

To keep the statusline fast (it must render in well under 150 ms and never block on the
network), Claudinho writes a small **cache on your own machine**, in your cache directory
(`$XDG_CACHE_HOME/claudinho`, falling back to `~/.cache/claudinho`). These files hold only
public match data and Claudinho's own local counters — for example `state.json` (cached
scores, fixtures, and standings), `market-signals.json` (cached market reads), and
`runs.json` (a local counter for the star-reminder nudge). They contain no personal data,
stay on your device, are never uploaded, and you can delete them at any time. (Claude Code's
own settings and hook configuration live separately under `~/.claude/`; that is editor
configuration, not a Claudinho data store.)

## Configuration changes (`init`)

The optional setup commands (`claudinho init claude` / `init cursor`, and the granular
`init-…` commands) modify your editor's own configuration on your machine so the statusline
and hook can run: they read your Claude Code (`~/.claude/settings.json`) or Cursor CLI
(`~/.cursor/cli-config.json`) settings file, add Claudinho's entries, and write it back.
Before the first change, Claudinho saves a one-time backup of the original alongside it (e.g.
`settings.json.claudinho.bak`) so you can restore it. This all stays on your machine —
Claudinho does not read these files for personal data, upload them, or transmit their
contents anywhere.

## Data sharing and retention

Claudinho does not sell, rent, share, or transmit your data to anyone, because it collects
none. It retains nothing on any server (there is no server). The only data it retains is
local and on your own device: the cache described above and, if you ran a setup command, the
one-time settings backup — both under your control and deletable at any time.

## Children's privacy

Claudinho is a general-audience developer tool, not directed at children, and collects no
personal data from anyone.

## Changes to this policy

If this policy changes, the updated version is published in this file in the public
repository with a new effective date.

## Contact

Questions or concerns: open an issue at <https://github.com/arturogarrido/claudinho/issues>.

---

Claudinho is an independent, open-source fan project. **Not affiliated with, endorsed by, or
connected to FIFA or Anthropic.** Prediction-market data is read-only and informational only,
not betting or trading advice.
