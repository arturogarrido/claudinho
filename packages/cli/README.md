# @claudinho/cli ⚽

**The 2026 men's football tournament, right in your terminal.** Live scores, fixtures, group tables, and market signals — TZ-aware, localized, scriptable.

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
claudinho markets [target]  # prediction-market signals: today | <date> | <id> | next <TEAM>
claudinho share [target]    # copy-pasteable match snippet: today | live | <date> | <id> | next <TEAM>
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
claudinho share next MEX --copy            # a shareable card, copied to your clipboard
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

`claudinho markets` shows **read-only** prediction-market signals — "who's favored" as
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

> **How matches are matched:** event slugs are derived automatically from each
> fixture (`fifwc-{home}-{away}-{date}`), so real odds appear for any match with a
> live Polymarket market — no mapping needed (`mapping.2026.json` is for slug
> *overrides* only). Matching fails closed, so an unmatched fixture simply shows
> nothing. For an offline preview, set `CLAUDINHO_MARKETS_SOURCE=fake` to render
> clearly-labeled synthetic **"demo data"** odds.

## Shareable snippets

`claudinho share` prints a polished, **copy-pasteable** match card for chats,
social posts, READMEs, and issue comments — your terminal football, ready to post:

```bash
claudinho share                   # today's matches
claudinho share live              # matches in play
claudinho share next MEX          # a team's next fixture (+ market read, when reliable)
claudinho share 760415            # one match by id
claudinho share next MEX --copy   # …and copy it straight to the clipboard
```

<!-- DEMO CARD: verbatim output of `claudinho share next MEX --tz America/Mexico_City`.
     REGENERATE immediately before merging — the market block is gate-conditional
     and the numbers drift. Never hand-edit. -->
```text
Next up for Mexico

🇲🇽 Mexico vs South Africa 🇿🇦
Jun 11 · 13:00 America/Mexico_City
Estadio Banorte, Mexico City, Mexico

Prediction markets favor Mexico.
Mexico 69% · Draw 20% · South Africa 10%
Source: Polymarket · updated 08:15 UTC · informational only

#VibingLaVidaLoca · Independent fan project · not affiliated with FIFA or Anthropic.
Try it: npx @claudinho/cli next MEX
```

Snippets are **plain text** (no color codes — they paste cleanly everywhere) and
carry the non-affiliation disclaimer on every paste. The market line uses the
same reliable gate as `today`/`match` (**informational only — never betting
advice**) and disappears when no reliable market exists. Per-command options:

| Flag | Description |
|---|---|
| `--style <social\|compact>` | `social` (default) is the full card; `compact` is one terse line per match |
| `--copy` | also copy the snippet to the clipboard (best-effort: `pbcopy`/`clip`/`wl-copy`/`xclip`/`xsel`) |
| `--no-hashtag` | omit the `#VibingLaVidaLoca` tag |
| `--no-install-line` | omit the `Try it: …` run cue |

`--json` returns the structured snippet (`{ kind, snippet, matches, marketSignals, … }`)
for scripts and future reuse. No clipboard tool? `claudinho share … | pbcopy` works too.

### Want an image?

The snippet is plain text, so a screenshot *is* your share card — or render one with an
existing tool, e.g. `freeze --execute "claudinho share next MEX" -o card.png`
(charmbracelet/freeze), `silicon`, or carbon.now.sh. Claudinho stays text-first:
no bundled image renderer, no fonts or licensing to worry about.

## Statusline (Claude Code)

```bash
claudinho init-statusline          # patches ~/.claude/settings.json (backs up first)
claudinho init-statusline --print  # just print the snippet
```

The statusline reads from a local micro-cache and **never blocks on the
network** (<150ms). When several matches are live it shows them all inline:
`⚽ 🇳🇴 1–1 🇫🇷 87' · 🇸🇳 1–2 🇮🇶 86'`. Customize via env:

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

## How it works

The full fixture list (104 matches, groups, venues, host cities, kickoffs) ships **bundled**
in the package, so the common path is offline and instant. Only live match
state hits the network. Live scores come from **ESPN's** public scoreboard (a
swappable provider, attributed in output as `Live data: ESPN`) and market signals
from Polymarket; provider attribution and rate limits are respected.

## License

MIT © 2026 Arturo Garrido · [source & issues](https://github.com/arturogarrido/claudinho)

---

_Built while watching the games._ **#VibingLaVidaLoca** ⚽
