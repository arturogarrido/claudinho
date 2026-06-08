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
claudinho today [date]      # a day's fixtures in your timezone (default: today), live scores inline
claudinho live              # matches in play right now
claudinho next <TEAM>       # a team's next fixture + countdown   (e.g. next MEX)
claudinho table [GROUP]     # group standings (default: all groups)
claudinho match <id>        # a single match's detail
claudinho markets [target]  # prediction-market odds: today | <date> | <id> | next <TEAM>
claudinho prompt            # one compact status line (for statusline/tmux/Starship)
claudinho init-statusline   # wire it into the Claude Code statusline
claudinho hook              # live-score context for a Claude Code hook (silent off-match)
claudinho init-hook         # make Claude itself score-aware (UserPromptSubmit)
claudinho vibe              # a matchday-coder one-liner (#VibingLaVidaLoca)
```

### Examples

```bash
claudinho today --tz America/Mexico_City --lang es
claudinho next BRA --tz America/Sao_Paulo --lang pt
claudinho table A
claudinho live --json | jq '.matches[].status'
claudinho today --flavor off               # just the facts, no commentary
```

## Global options

| Flag | Description |
|---|---|
| `--lang <code>` | `en`, `es`, `pt`, `fr` (also via `CLAUDINHO_LANG`; falls back to `$LANG`) |
| `--tz <zone>` | IANA timezone, e.g. `America/Mexico_City` (also `CLAUDINHO_TZ`; default: system). Kickoff times **and** which day a fixture falls on are computed in this zone — a late-night-UTC match shows on the day you actually watch it. |
| `--json` | machine-readable output for scripting |
| `--no-color` | disable ANSI color (also honors `NO_COLOR`; auto-off when piped) |
| `--source <name>` | live data provider (advanced; sensible default) |
| `--flavor <level>` | commentary flair: `off`, `subtle`, `full` (default: `full`; also `CLAUDINHO_FLAVOR`) |
| `--no-markets` | hide prediction-market signals in `today`/`match` (also `CLAUDINHO_MARKETS=off`) |

Team codes are 3-letter (FIFA/IOC-style): `MEX`, `BRA`, `USA`, `ENG`, …

### Commentary flair

By default Claudinho narrates with a bit of localized football-broadcast energy —
`¡GOOOOL!` on a goal, `¡a cancha llena!` before kickoff. These are generic,
genre-style exclamations (no real commentator is quoted or impersonated),
localized per `--lang`, and they never affect `--json` output.

- `--flavor full` *(default)* — flair on fixtures, live play, goals, and full-time
- `--flavor subtle` — only goals and full-time
- `--flavor off` — just the facts

## Prediction-market signals

`claudinho markets` shows **read-only** prediction-market odds — "who's favored" as
market-implied percentages — for a date, a match, or a team's next fixture:

```bash
claudinho markets                 # today's signals
claudinho markets 2026-06-11      # a specific date
claudinho markets 760415          # one match by id
claudinho markets next MEX        # a team's next fixture
claudinho markets today --json    # structured sidecar output
```

A short market line is also added under `claudinho today` and `claudinho match`
when a reliable market is available. It's **informational only — not betting
advice:** market-implied percentages with attribution, no trading, no links. Data
comes from Polymarket public market data and is shown
only when the market maps cleanly to the result and is fresh.

Opt out with `--no-markets` (per command) or `CLAUDINHO_MARKETS=off` (global). The
statusline and hook **never** show market data — it stays off the hot path.

> **Preview locally:** no markets are mapped yet, so the default (Polymarket)
> shows none. Set `CLAUDINHO_MARKETS_SOURCE=fake` to render clearly-labeled
> synthetic **"demo data"** odds and try the command + annotations end to end.

## Statusline (Claude Code)

```bash
claudinho init-statusline          # patches ~/.claude/settings.json (backs up first)
claudinho init-statusline --print  # just print the snippet
```

The statusline reads from a local micro-cache and **never blocks on the
network** (<150ms). When several matches are live it shows them all inline:
`⚽ 🇪🇸 1–1 🇮🇶 87' · 🇫🇷 1–2 🇨🇮 86'`. Customize via env:

- `CLAUDINHO_TEAM=MEX` — show only your team's match
- `CLAUDINHO_MAX=2` — cap how many live matches show inline (rest collapse to `+N`; default: all)
- `CLAUDINHO_COMPACT=0` — show 3-letter codes alongside flags

Use the same `claudinho prompt` in **tmux** (`set -g status-right '#(claudinho prompt)'`)
or a **Starship** custom command — it works in any shell.

### Score-aware Claude (hook)

```bash
claudinho init-hook                # patches ~/.claude/settings.json (backs up first)
```

Wires `claudinho hook` into Claude Code's `UserPromptSubmit`. During a match,
the live score is injected into Claude's context so it can mention it naturally;
off-match it's silent (zero added tokens). Restart Claude Code to activate.

## Other competitions

By default Claudinho follows the 2026 World Cup. To follow a different
competition (e.g. international friendlies before the tournament starts):

```bash
export CLAUDINHO_COMPETITION=fifa.friendly
claudinho live      # live friendlies
unset CLAUDINHO_COMPETITION   # back to the World Cup
```

Only the live fetch changes; the bundled schedule is always the World Cup. The
statusline/hook cache is keyed to the active competition, so switching with
`CLAUDINHO_COMPETITION` never surfaces stale scores from the other competition.

## How it works

The full fixture list (104 matches, groups, venues, host cities, kickoffs) ships **bundled**
in the package, so the common path is offline and instant. Only live match
state hits the network. Scores come from a swappable data provider; provider
attribution and rate limits are respected.

## License

MIT © 2026 Arturo Garrido · [source & issues](https://github.com/arturogarrido/claudinho)

---

_Built while watching the games._ **#VibingLaVidaLoca** ⚽
