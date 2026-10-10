# @claudinho/cli ⚽

**Live football scores, fixtures and standings in your terminal and your Claude Code and Cursor CLI statusline (and, for a program, `claudinho ambient --json`: the statusline and the hook as one JSON object), for the competition you follow: the World Cup, the Premier League, LALIGA, the Champions League and 12 more.** The `claudinho` command: TZ-aware, localized, scriptable, with read-only market signals for the World Cup. No API key, no signup. It ran the 2026 World Cup from the opener to the final.

> ⭐ Installing via `npx` or globally? **[Star the repo](https://github.com/arturogarrido/claudinho)**: a fan project runs on stars. (`claudinho star` shows you how anytime.)

## Install

```bash
npm i -g @claudinho/cli      # installs the `claudinho` binary
claudinho follow world-cup   # choose a competition once (claudinho follow --list shows them all)
# or run without installing, choosing per command (or once: npx @claudinho/cli follow world-cup):
npx @claudinho/cli --competition world-cup today
```

`claudinho today` on a World Cup knockout night, penalty shootouts and all:

<!-- DEMO: verbatim `claudinho --tz America/Los_Angeles today 2026-06-29` with the World Cup
     followed (`claudinho follow world-cup`), from a knockout matchday. Shootouts render as 1(3)–1(4). REGENERATE per matchday
     (capture after the day's games finish, so the scores are live and current). Never
     hand-edit. Re-rendered on 2026-10-05 (0.11) through the CLI's own `today` command,
     offline: a provider double served the capture's three results on the bundled
     fixtures' ids, at a frozen clock of 2026-06-30T12:00Z. A US zone, because the capture's
     was west of UTC: in UTC the third tie (01:00Z on Jun 30) leaves this date. -->
```text
Matches · 2026-06-29
  World Cup

  🇧🇷 Brazil              2–1  Japan 🇯🇵   FT   into the history books!
  🇩🇪 Germany             1(3)–1(4)  Paraguay 🇵🇾   FT   it's all over!
  🇳🇱 Netherlands         1(2)–1(3)  Morocco 🇲🇦   FT   the final whistle blows!

Live data: ESPN
Not affiliated with FIFA, any confederation, league or club, or Anthropic.
```

The World Cup's schedule ships bundled (104 fixtures), so it works offline and only its live scores hit the network; the other competitions' schedules are read from the feed, so `today` and `next` need the network there.

## Commands

```bash
claudinho follow [ALIAS]    # choose the competition every surface follows (saved); --team <name> pins your team; --list; off
claudinho today [date]      # a day's fixtures in your timezone (default: today), live scores inline
claudinho live              # matches in play right now
claudinho next [TEAM]       # a team's next fixture + countdown — TEAM is a name OR code (Mexico | MEX | "DR Congo", or a club: Arsenal | ARS); default $CLAUDINHO_TEAM, else your pinned team
claudinho table [KEY]       # live cumulative standings (default: every table); KEY is a group letter, or A1, A-B, LEAGUE
claudinho bracket [STAGE]   # knockout bracket (R32, R16, QF, SF, 3P, F); --tree for ASCII tree
claudinho match <id>        # a single match's detail
claudinho team <query>      # resolve a World Cup nation's name/code to its FIFA code, flag, and group (e.g. team "DR Congo")
claudinho markets [target]  # prediction-market signals: today | <date> | <id> | next <TEAM>
                            #   (next prefers the team's IN-PLAY match while one is live)
claudinho share [target]    # copy-pasteable snippet: today | live | <date> | <id> | next <TEAM> | table <KEY> | bracket [STAGE]
claudinho prompt            # one compact status line (for statusline/tmux/Starship)
claudinho init cursor       # one-step Cursor setup: statusline + MCP paste (--print for snippets)
claudinho init claude       # one-step Claude Code setup: statusline + hook + MCP one-liner
claudinho init plugin       # remove the statusline and hook init claude wrote, for the Claude Code plugin
claudinho init-statusline   # (granular) wire just the Claude Code statusline
claudinho init-cursor-statusline  # (granular) wire just the Cursor CLI statusline
claudinho hook              # live-score context for a Claude Code hook (silent off-match)
claudinho ambient --json    # the statusline and the hook as one JSON object, for a program (--columns N)
claudinho init-hook         # (granular) make Claude itself score-aware (UserPromptSubmit)
claudinho vibe              # a matchday-coder one-liner (#VibingLaVidaLoca)
claudinho star              # how to support the project (star the repo ⭐)
```

In a club competition, `next` resolves a club's name or code against the
competition's own table and answers its next match within 14 days (several teams
matching a name are listed, never guessed); `match <id>` looks from yesterday to
14 days ahead and names the days it searched when the match is not there;
`bracket` says when a league season has no bracket; and `today`, `live`, `next`
and `match` say "between editions" once a competition's edition has ended and
the next has not started. A club shows by its name (or its code on the
statusline: `ARS 2–1 CHE 50'`), with nothing where a nation's flag would be, and
`next`/`match` say the stage it is in ("League", "Play-offs", or the provider's
words for a phase Claudinho does not know).

`claudinho follow <alias>` saves the competition every surface follows;
`--team <name>` pins a team in it, resolved as `next <name>` resolves it. Pin a
team while its competition has fixtures ahead: between editions `next` answers
the verdict before it resolves a club, so there is nothing to pin (a `follow
<alias>` without `--team` still works there). A pin is scoped to its
competition, whatever chose it (`--competition`, `CLAUDINHO_COMPETITION`, or the
saved choice), and never applies to another. `follow --json` says the same facts as
its text: `competition` (`follow` alone: this command's; after a write or `off`: what
the next command follows), `override` (its source when it is not the saved choice),
`sources` (the flag, the environment and `CLAUDINHO_TEAM` this command ran under),
`refused` (each refused value under its source's name, `flag`, `env` or `team`; a
`CLAUDINHO_TEAM` with nothing readable is `"team": ""`, which the team-taking
commands refuse), `saved` (the file as read) and `path`.

### Examples

```bash
claudinho today --tz America/Mexico_City --lang es
claudinho next BRA --tz America/Sao_Paulo --lang pt
claudinho table A
claudinho bracket R32 --tree
claudinho live --json | jq '.matches[].status'
claudinho today --flavor off               # just the facts, no commentary
claudinho share next MEX --copy            # a shareable card, copied to your clipboard
claudinho follow premier-league --team Arsenal       # follow a competition, pin a team: `claudinho next` answers for it
claudinho --competition laliga today                  # another competition for one command, by its alias
CLAUDINHO_COMPETITION=laliga claudinho table          # the environment works too (the statusline and hook follow it)
```

## Global options

| Flag | Description |
|---|---|
| `--lang <code>` | `en`, `es`, `pt`, `fr` (also via `CLAUDINHO_LANG`; falls back to `$LANG`) |
| `--tz <zone>` | IANA timezone, e.g. `America/Mexico_City` (also `CLAUDINHO_TZ`; default: system). Kickoff times **and** which day a fixture falls on are computed in this zone: a late-night-UTC match shows on the day you actually watch it. |
| `--json` | machine-readable output for scripting |
| `--no-color` | disable ANSI color (also honors `NO_COLOR`; auto-off when piped) |
| `-c, --competition <alias\|slug>` | the competition: an alias such as `premier-league` (the sixteen competitions are listed in the [root README](https://github.com/arturogarrido/claudinho#competitions)), or an ESPN slug such as `eng.1` (any other lower-case dotted ESPN slug works too, labelled experimental). Also `CLAUDINHO_COMPETITION` (an alias or a slug), which the statusline, the hook and `ambient --json` follow, and the choice `claudinho follow <alias>` saves: the flag, then the environment, then the saved choice; with none, a command says so (exit 1; `--json` prints `{ "competition": null, "noCompetition": true }`), the statusline reads `⚽ claudinho follow` (`ambient --json` prints it as `line` beside `competition: null`), and the hook stays silent. Every answer names its competition on a line after its header (`Premier League · from the command line`; first where an answer has none; `table` once, before its tables) and in `--json` as `competition`; `share` prints no such line: its card's title names the competition and its run cue selects it; `team` names the World Cup roster it reads. An unknown value is refused with the list. |
| `--source <name>` | live data provider (advanced; sensible default) |
| `--flavor <level>` | commentary flair: `off`, `subtle`, `full` (default: `full`; also `CLAUDINHO_FLAVOR`) |
| `--no-markets` | hide prediction-market signals in `today`/`match` (also `CLAUDINHO_MARKETS=off`) |

Team codes: a nation's is FIFA-style, 3 letters (`MEX`, `BRA`, `USA`, `ENG`); a club's is the provider's abbreviation (`ARS`, `LEE`), and a club is also taken by name (`next Arsenal`).

### Commentary flair

By default Claudinho narrates with a bit of localized football-broadcast energy:
`¡GOOOOL!` on a goal, `¡a cancha llena!` before kickoff, something for the break,
the last ten minutes and a draw. The bank holds a few hundred lines in four
languages (genre exclamations and the catchphrases fans know; no real person is
named or impersonated), localized per `--lang`; a day's list never prints the
same line twice while the bank has another, and none of it reaches `--json`.

When one side has a rally cry of its own, the cry takes the slot instead, in
every language: Mexico's `¿Y si sí?`, Pumas' `¡Goya!`, Arsenal's `COYG!` (when
both sides have one, the team you pinned with `follow --team`, else the home
side's; `CLAUDINHO_TEAM` picks the team `next` asks about, not the cry). A row
with a cry takes no line from the bank, so the others in the list stay
different; a postponed or cancelled match prints neither.

- `--flavor full` *(default)*: flair on fixtures, live play, goals, the break, the closing minutes, and full time
- `--flavor subtle`: only goals, full time and draws, and the rally cries
- `--flavor off`: just the facts

## Prediction-market signals

`claudinho markets` shows **read-only** prediction-market signals ("who's favored" as
market-implied percentages) for a date, a match, or a team's next fixture:

```bash
claudinho markets                 # today's signals
claudinho markets 2026-06-11      # a specific date
claudinho markets 760415          # one match by id
claudinho markets next MEX        # a team's current-or-next fixture (in-play preferred)
claudinho markets today --json    # structured sidecar output
```

A short market line is also added under `claudinho today` and `claudinho match`
when a reliable market is available. It's **informational only, not betting
advice:** market-implied percentages with attribution, no trading, no links. Data
comes from Polymarket public market data and is shown
only when the market maps cleanly to the result and is fresh.
Structured output uses `complete` on `markets` and `marketComplete` on the
default-on `today`/`match` enrichment. `false` means the optional read did not
finish and is paired with an explicit warning, not a confident empty result.

Opt out with `--no-markets` (per command) or `CLAUDINHO_MARKETS=off` (global). The
statusline and hook **never** show market data: it stays off the hot path.

> **How matches are matched:** event slugs are derived automatically from each
> fixture (`fifwc-{home}-{away}-{date}`), so real signals appear for any match with a
> live Polymarket market, with no mapping needed (`mapping.2026.json` is for slug
> *overrides* only). Matching fails closed, so an unmatched fixture simply shows
> nothing, and finished matches never show one (market signals are pre-match
> and in-play reads). For an offline preview, set `CLAUDINHO_MARKETS_SOURCE=fake`
> to render clearly-labeled synthetic **"demo data"** signals.

## Shareable snippets

`claudinho share` prints a polished, **copy-pasteable** match card for chats,
social posts, READMEs, and issue comments: your terminal football, ready to post:

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

<!-- DEMO CARD: verbatim output of `claudinho --competition world-cup --tz UTC share next MEX`.
     REGENERATE before release: the matchup advances each round and any market block
     drifts. Never hand-edit. Re-rendered on 2026-10-05 (0.11) through the CLI's own
     `share next MEX` command, offline: a provider double served the Round of 32 tie the
     capture showed (Mexico vs Ecuador, on the bundled fixture's id, kickoff and venue),
     at a frozen clock of 2026-06-28T12:00Z. -->
```text
Next up for Mexico · World Cup

🇲🇽 Mexico vs Ecuador 🇪🇨
Jul 1 · 01:00 UTC
Estadio Banorte, Mexico City, Mexico
Round of 32

Live data: ESPN
#VibingLaVidaLoca · Independent fan project · Not affiliated with FIFA, any confederation, league or club, or Anthropic.
Try it: npx @claudinho/cli --competition world-cup next MEX
```

Snippets are **plain text** (no color codes: they paste cleanly everywhere) and
carry the non-affiliation disclaimer on every paste. The market line uses the
same reliable gate as `today`/`match` (**informational only, never betting
advice**) and disappears when no reliable market exists. Per-command options:

| Flag | Description |
|---|---|
| `--style <social\|compact>` | `social` (default) is the full card; `compact` is one terse line per match |
| `--copy` | also copy the snippet to the clipboard (best-effort: `pbcopy`/`clip`/`wl-copy`/`xclip`/`xsel`) |
| `--no-hashtag` | omit the `#VibingLaVidaLoca` tag |
| `--no-install-line` | omit the `Try it: …` run cue |

`--json` returns the structured snippet
(`{ kind, snippet, matches, marketSignals, marketComplete, … }`) for scripts and
future reuse. An incomplete optional market read is stated in the snippet and reported
as `marketComplete: false`; it is never presented as a confident empty market result.
When the provider's knockout answer was not whole (a record it sent could not be read,
was a second copy of a fixture, or lay beyond the bound Claudinho reads), `next`,
`bracket` and their share cards say so before what was read, and `--json` carries
`partial` (`{ omitted }`, the count of provider records left out, when known): no fixture
is then not "eliminated". `today`, `live`, `match`, `markets` and their share cards do the
same for their own reads: an empty answer then says nothing was *read*, never that nothing
exists, and a World Cup day names the fixtures shown from the bundled schedule without
their live state (with no "Live data" line when none shown was served). Off the World Cup a day
the provider could not be asked for says so, never "no matches scheduled".
No clipboard tool? `claudinho share … | pbcopy` works too.

### Want an image?

The snippet is plain text, so a screenshot *is* your share card, or render one with an
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

- `CLAUDINHO_TEAM=MEX`: your team's match first, the others counted (`+N`) (a nation name works too, e.g. `CLAUDINHO_TEAM=mexico`); also the default team for `next`, `markets next`, and `share next` when the argument is omitted. A team pinned with `claudinho follow <alias> --team <name>` does the same when this is not set, under its own competition (a pin is scoped to its competition, whatever chose it): a preference, never a filter
- `CLAUDINHO_MAX=2`: cap how many live matches show inline (rest collapse to exact `+N`
  after a complete cache scan, or `+more` when the bounded scan cannot know the count; default: 8,
  and values above 8 are capped at 8)
- `CLAUDINHO_COMPACT=0`: show 3-letter codes alongside flags
- `CLAUDINHO_FLAGS=off`: drop emoji flags for 3-letter codes (statusline) / plain names (`today`, `live`, `table`, `next`, hook); already automatic on terminals that can't render flag emoji, e.g. Warp

A background refresher writes that cache. Whenever no cache could be read (none, unreadable, or rejected), its attempts are paced by a small attempt record beside the throttle note, both named by scope like the cache itself (`attempt*.json`, `backoff*.json`: bare for the World Cup, `attempt.json`; with the source and competition for another, `attempt.espn.eng.1.json` for the Premier League): after each attempt the next waits one minute, the wait doubling to at most thirty, and only an attempt whose own cache then reads back resets it (a cache repaired by hand does not, so if it disappears again the retained wait applies). A rewrite repairs most of what can be at the cache path (a corrupted cache, a link, a file or a pipe whose own mode lets its owner read it, a file refused by an access-control list or owned by another user included; not a file marked immutable or append-only, a flag the refresher cannot see, which it treats exactly as it would without the flag: one that cannot be read as a cache and is not among the entries named next as beyond a rewrite has its attempts paced while the attempt record works, and repeated as before the record existed when it does not; one that reads as a cache never involves the record, so the refresher fetches whenever an update is due and never replaces it, as before); it cannot repair a directory, or anything but a link whose own mode denies its owner a read (a file or a pipe at mode 000, say: a rewrite keeps those mode bits), unless the directory's own inherited permissions let a new file at those bits be read, which is measured, not assumed. There, if the attempt record cannot be written or read either, the refresher asks nothing while the statusline keeps starting one on every update, until a rewrite could repair the cache path (the entry removed, its owner-read bit set, or the directory's inherited permissions letting a new file at those bits be read) or the attempt record works again; a cache file that merely opens is not enough (a mode-000 file with its own allow-read access-control entry opens, and a rewrite keeps its bits, not its entry). The same holds in a cache directory whose new files nobody can read (an inherited deny-read access-control list): no attempt asks or publishes anything (the refresher cannot read back its own lock), and the statusline keeps starting one on every update, until files in that directory can be read again.

Use the same `claudinho prompt` in **tmux** (`set -g status-right '#(claudinho prompt)'`)
or a **Starship** custom command: it works in any shell.

### Score-aware Claude (hook)

```bash
claudinho init-hook                # patches ~/.claude/settings.json (backs up first)
```

Wires `claudinho hook` into Claude Code's `UserPromptSubmit`. During a match,
the live score is injected into Claude's context so it can mention it naturally;
off-match it's silent (zero added tokens). Restart Claude Code to activate.

**Moving to the Claude Code plugin?** `claudinho init plugin` removes the statusline
(`claudinho prompt`) and the live-score hook (`claudinho hook`) that `init claude` wrote to
`~/.claude/settings.json`, keeps every other setting, then prints the plugin's install line and the
MCP one-liner; an edited command (a wrapper, `npx -y @claudinho/cli hook`) stays, and it names it.

### For a program: `claudinho ambient --json`

`claudinho ambient --json [--columns N]` prints the statusline and the hook as one JSON object on
one line, for a program that draws them itself: `line` (what `claudinho prompt` prints, fitted to N
columns with the `+N` count kept; N a positive integer), `context` (the hook's block, or `null`),
`live` (the live matches, each marked `picked` and `pinned`), `current` (an empty list means nothing
is on only when this is true), `next`, `pick`, `competition`, `degraded`, `source`, `updatedAt`,
`staleAfter` and `disclaimer` (the non-affiliation sentence). It reads only the local cache, never
the network; the command itself exits 0 whatever the cache holds, and any other `--columns` value is
refused by the option parser, as a wrong option is for every command.

## Statusline (Cursor CLI)

```bash
claudinho init-cursor-statusline          # patches ~/.cursor/cli-config.json (backs up first)
claudinho init-cursor-statusline --print  # just print the snippet
```

Uses the same `claudinho prompt` hot path as Claude Code, so the same
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

The World Cup's full fixture list (104 matches, groups, venues, host cities, kickoffs) ships
**bundled** in the package, so its schedule is offline and instant; the other competitions'
schedules are read from the feed, so `today` and `next` need the network there. Live match
state always hits the network. Live scores come from **ESPN's** public scoreboard (a
swappable provider, attributed in output as `Live data: ESPN`) and market signals
from Polymarket; provider attribution and rate limits are respected.

## Privacy Policy

No personal data collected: no accounts, no telemetry, no analytics, no tracking, and no
Claudinho server. To show live results, the CLI makes read-only requests to public services
(ESPN; Polymarket for informational-only market signals) with no account or personal data
attached, though those services still receive standard request metadata (such as your IP
address) like any HTTP call. It keeps a small cache of public match data in your local cache
directory (`~/.cache/claudinho`, or `$XDG_CACHE_HOME/claudinho`), and the optional `init`
commands update your Claude Code / Cursor settings file after saving a one-time
`.claudinho.bak` backup, all on your machine, never uploaded. Full policy:
[PRIVACY.md](https://github.com/arturogarrido/claudinho/blob/main/PRIVACY.md).

## License

MIT © 2026 Arturo Garrido · [source & issues](https://github.com/arturogarrido/claudinho)

> **Not affiliated with FIFA, any confederation, league or club, or Anthropic. Nor endorsed by or connected to any of them.** An independent,
> open-source fan project showing factual match data (scores, fixtures, standings) with emoji
> flags only: no logos, crests, kits, broadcast footage, or player likenesses.

---

_Built while watching the games._ **#VibingLaVidaLoca** ⚽
