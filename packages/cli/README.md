# @claudinho/cli ⚽

**The 2026 men's football tournament, right in your terminal.** Live scores, fixtures, and group tables — TZ-aware, localized, scriptable.

> ⚠️ **Not affiliated with, endorsed by, or connected to FIFA or Anthropic.**
> Claudinho is an independent, open-source fan project. It shows factual match
> data (scores, fixtures, standings) with emoji flags only — no logos, crests,
> kits, broadcast footage, or player likenesses.

## Install

```bash
npm i -g @claudinho/cli      # installs the `claudinho` binary
# or run without installing:
npx @claudinho/cli today
```

## Commands

```bash
claudinho today [date]      # a day's fixtures (default: today), live scores inline
claudinho live              # matches in play right now
claudinho next <TEAM>       # a team's next fixture + countdown   (e.g. next MEX)
claudinho table [GROUP]     # group standings (default: all groups)
claudinho match <id>        # a single match's detail
claudinho prompt            # one compact status line (for statusline/tmux/Starship)
claudinho init-statusline   # wire it into the Claude Code statusline
```

### Examples

```bash
claudinho today --tz America/Mexico_City --lang es
claudinho next BRA --tz America/Sao_Paulo --lang pt
claudinho table A
claudinho live --json | jq '.matches[].status'
```

## Global options

| Flag | Description |
|---|---|
| `--lang <code>` | `en`, `es`, `pt`, `fr` (also via `CLAUDINHO_LANG`; falls back to `$LANG`) |
| `--tz <zone>` | IANA timezone, e.g. `America/Mexico_City` (also `CLAUDINHO_TZ`; default: system) |
| `--json` | machine-readable output for scripting |
| `--no-color` | disable ANSI color (also honors `NO_COLOR`; auto-off when piped) |
| `--source <name>` | data source (default: `espn`) |

Team codes are 3-letter (FIFA/IOC-style): `MEX`, `BRA`, `USA`, `ENG`, …

## Statusline (Claude Code)

```bash
claudinho init-statusline          # patches ~/.claude/settings.json (backs up first)
claudinho init-statusline --print  # just print the snippet
```

The statusline reads from a local micro-cache and **never blocks on the
network** (<150ms). Customize via env:

- `CLAUDINHO_TEAM=MEX` — prioritize your team's match
- `CLAUDINHO_COMPACT=0` — show 3-letter codes alongside flags

Use the same `claudinho prompt` in **tmux** (`set -g status-right '#(claudinho prompt)'`)
or a **Starship** custom command — it works in any shell.

## How it works

The full fixture list (104 matches, groups, venues, kickoffs) ships **bundled**
in the package, so the common path is offline and instant. Only live match
state hits the network. Scores come from a swappable data adapter (ESPN by
default); attribution and rate limits are respected.

## License

MIT © 2026 Arturo Garrido · [source & issues](https://github.com/arturogarrido/claudinho)
