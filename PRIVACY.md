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

These requests carry **no personal data and no authentication** — they are anonymous reads
of public endpoints (a date and competition for scores; a public event slug for market data).
Claudinho sends these services nothing about you. Your use of those third-party services is
governed by their own privacy policies:

- ESPN (a division of The Walt Disney Company): <https://privacy.thewaltdisneycompany.com/en/current-privacy-policy/>
- Polymarket: <https://polymarket.com/>

## Local storage

To keep the statusline fast (it must render in well under 150 ms and never block on the
network), Claudinho writes a small **cache file on your own machine**, under your home
directory (e.g. `~/.claude/`). It contains only public match data (scores, fixtures,
standings) and Claudinho's own settings — never personal data. It stays on your device, is
never uploaded, and you can delete it at any time.

## Data sharing and retention

Claudinho does not sell, rent, share, or transmit your data to anyone, because it collects
none. It retains nothing on any server (there is no server). The only retained data is the
local cache described above, which lives on your device under your control.

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
