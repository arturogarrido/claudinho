# @claudinho/cli ⚽

**The 2026 men's football tournament, right in your terminal.** Live scores, fixtures, group tables, and market signals — TZ-aware, localized, scriptable. No API key, no signup.

> ⭐ Installing via `npx` or globally? **[Star the repo](https://github.com/arturogarrido/claudinho)** — a fan project runs on stars. (`claudinho star` shows you how anytime.)

## Install

```bash
npm i -g @claudinho/cli      # installs the `claudinho` binary
# or run without installing:
npx @claudinho/cli today
```

`claudinho today` on a knockout night — penalty shootouts and all:

<!-- DEMO: verbatim `claudinho today <date>` from a knockout matchday. Shootouts render
     as 1(3)–1(4). REGENERATE per matchday (capture after the day's games finish, so the
     scores are live and current). Never hand-edit. -->
```text
Matches · 2026-06-29

  🇧🇷 Brazil            2–1  Japan 🇯🇵   FT   into the history books!
  🇩🇪 Germany           1(3)–1(4)  Paraguay 🇵🇾   FT   it's all over!
  🇳🇱 Netherlands       1(2)–1(3)  Morocco 🇲🇦   FT   the final whistle blows!

Live data: ESPN
Not affiliated with FIFA or Anthropic.
```

All 104 fixtures ship bundled, so the schedule works offline; only live scores hit the network.

## Commands

```bash
claudinho today [date]      # a day's fixtures in your timezone (default: today), live scores inline
claudinho live              # matches in play right now
claudinho next [TEAM]       # a team's next fixture + countdown — TEAM is a name OR code (Mexico | MEX | "DR Congo"); default $CLAUDINHO_TEAM
claudinho table [GROUP]     # live cumulative group standings (default: all groups)
claudinho bracket [STAGE]   # knockout bracket (R32, R16, QF, SF, 3P, F); --tree for ASCII tree
claudinho match <id>        # a single match's detail
claudinho team <query>      # resolve a name/code to its FIFA code, flag, and group (e.g. team "DR Congo")
claudinho markets [target]  # prediction-market signals: today | <date> | <id> | next <TEAM>
                            #   (next prefers the team's IN-PLAY match while one is live)
claudinho share [target]    # copy-pasteable snippet: today | live | <date> | <id> | next <TEAM> | table <GROUP> | bracket [STAGE]
claudinho prompt            # one compact status line (for statusline/tmux/Starship)
claudinho init cursor       # one-step Cursor setup: statusline + MCP paste (--print for snippets)
claudinho init claude       # one-step Claude Code setup: statusline + hook + MCP one-liner
claudinho init-statusline   # (granular) wire just the Claude Code statusline
claudinho init-cursor-statusline  # (granular) wire just the Cursor CLI statusline
claudinho hook              # live-score context for a Claude Code hook (silent off-match)
claudinho init-hook         # (granular) make Claude itself score-aware (UserPromptSubmit)
claudinho vibe              # a matchday-coder one-liner (#VibingLaVidaLoca)
claudinho star              # how to support the project (star the repo ⭐)
```

### Examples

```bash
claudinho today --tz America/Mexico_City --lang es
claudinho next BRA --tz America/Sao_Paulo --lang pt
claudinho table A
claudinho bracket R32 --tree
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
claudinho markets next MEX        # a team's current-or-next fixture (in-play preferred)
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
> fixture (`fifwc-{home}-{away}-{date}`), so real signals appear for any match with a
> live Polymarket market — no mapping needed (`mapping.2026.json` is for slug
> *overrides* only). Matching fails closed, so an unmatched fixture simply shows
> nothing — and finished matches never show one (market signals are pre-match
> and in-play reads). For an offline preview, set `CLAUDINHO_MARKETS_SOURCE=fake`
> to render clearly-labeled synthetic **"demo data"** signals.

## Shareable snippets

`claudinho share` prints a polished, **copy-pasteable** match card for chats,
social posts, READMEs, and issue comments — your terminal football, ready to post:

```bash
claudinho share                   # today's matches
claudinho share live              # matches in play
claudinho share next MEX          # a team's next fixture (+ market read, when reliable)
claudinho share table A           # a group's standings card (facts only, no market line)
claudinho share bracket           # knockout bracket card (facts only, no market line)
claudinho share bracket R16       # one round only
claudinho share 760415            # one match by id
claudinho share next MEX --copy   # …and copy it straight to the clipboard
```

<!-- DEMO CARD: verbatim output of `claudinho share next MEX --tz America/Los_Angeles`.
     REGENERATE before release — the matchup advances each round and any market block
     drifts. Never hand-edit. -->
```text
Next up for Mexico

🇲🇽 Mexico vs Ecuador 🇪🇨
Jun 30 · 18:00 America/Los_Angeles
Estadio Banorte, Mexico City, Mexico
Round of 32

Live data: ESPN
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

- `CLAUDINHO_TEAM=MEX` — show only your team's match (a nation name works too, e.g. `CLAUDINHO_TEAM=mexico`); also the default team for `next`, `markets next`, and `share next` when the argument is omitted
- `CLAUDINHO_MAX=2` — cap how many live matches show inline (rest collapse to `+N`; default: all)
- `CLAUDINHO_COMPACT=0` — show 3-letter codes alongside flags
- `CLAUDINHO_FLAGS=off` — drop emoji flags for 3-letter codes (statusline) / plain names (`today`, `live`, `table`, `next`, hook); already automatic on terminals that can't render flag emoji, e.g. Warp

Use the same `claudinho prompt` in **tmux** (`set -g status-right '#(claudinho prompt)'`)
or a **Starship** custom command — it works in any shell.

### Score-aware Claude (hook)

```bash
claudinho init-hook                # patches ~/.claude/settings.json (backs up first)
```

Wires `claudinho hook` into Claude Code's `UserPromptSubmit`. During a match,
the live score is injected into Claude's context so it can mention it naturally;
off-match it's silent (zero added tokens). Restart Claude Code to activate.

## Statusline (Cursor CLI)

```bash
claudinho init-cursor-statusline          # patches ~/.cursor/cli-config.json (backs up first)
claudinho init-cursor-statusline --print  # just print the snippet
```

Uses the same `claudinho prompt` hot path as Claude Code — so the same
`CLAUDINHO_TEAM` / `CLAUDINHO_MAX` / `CLAUDINHO_COMPACT` customizations above apply
here too. Cursor-specific tuning is applied automatically (`updateIntervalMs: 1000`,
`timeoutMs: 1500`).

Optional second line with session meta (model, context %, worktree, vim mode) **below** the score:

```bash
export CLAUDINHO_CURSOR_META=auto   # recommended for Cursor CLI
```

Custom command (local dev or monorepo checkout):

```bash
claudinho init-cursor-statusline --command "node ./packages/cli/dist/index.js prompt"
```

> Cursor's `beforeSubmitPrompt` hook does not yet reliably inject live-score
> context into the model. Use `init-hook` for Claude Code; Cursor CLI is
> statusline-only until hook injection lands.

## How it works

The full fixture list (104 matches, groups, venues, host cities, kickoffs) ships **bundled**
in the package, so the common path is offline and instant. Only live match
state hits the network. Live scores come from **ESPN's** public scoreboard (a
swappable provider, attributed in output as `Live data: ESPN`) and market signals
from Polymarket; provider attribution and rate limits are respected.

## Privacy Policy

No personal data collected — no accounts, no telemetry, no analytics, no tracking, and no
Claudinho server. To show live results, the CLI makes read-only requests to public services
(ESPN; Polymarket for informational-only market signals) with no account or personal data
attached, though those services still receive standard request metadata (such as your IP
address) like any HTTP call. It keeps a small cache of public match data in your local cache
directory (`~/.cache/claudinho`, or `$XDG_CACHE_HOME/claudinho`), and the optional `init`
commands update your Claude Code / Cursor settings file after saving a one-time
`.claudinho.bak` backup — all on your machine, never uploaded. Full policy:
[PRIVACY.md](https://github.com/arturogarrido/claudinho/blob/main/PRIVACY.md).

## License

MIT © 2026 Arturo Garrido · [source & issues](https://github.com/arturogarrido/claudinho)

> **Not affiliated with, endorsed by, or connected to FIFA or Anthropic.** An independent,
> open-source fan project showing factual match data (scores, fixtures, standings) with emoji
> flags only — no logos, crests, kits, broadcast footage, or player likenesses.

---

_Built while watching the games._ **#VibingLaVidaLoca** ⚽
