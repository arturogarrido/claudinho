# @claudinho/cli ⚽

**Live football scores, fixtures and standings in your terminal, for the competition you follow: the World Cup, the Premier League, LALIGA, the Champions League and 12 more.**
The `claudinho` command also puts the live score in your Claude Code or Cursor CLI statusline. It
speaks English, Spanish, Portuguese and French, follows your timezone, and prints JSON for scripts.
No API key, no signup, no account.

## Install

```bash
npm i -g @claudinho/cli
claudinho follow champions-league    # choose your competition once (every alias is in the table below)
claudinho today
```

Or run it without installing:

```bash
npx @claudinho/cli follow champions-league
npx @claudinho/cli today --lang es --tz America/Mexico_City
```

<!-- DEMO: verbatim `claudinho --tz UTC today` with the Champions League followed, on Oct 14, 2026
     after the day's games, colour off. Never hand-edit. -->
```text
Today's matches · 2026-10-14
  Champions League

  Feyenoord Rotterdam    3–2  Como                  FT   the scoreboard has spoken!
  LASK Linz              3–6  Liverpool             FT   You'll never walk alone!
  AS Roma                3–4  Real Madrid           FT   Daje Roma!
  Aston Villa            6–0  Fenerbahce            FT   UTV!
  Bodo/Glimt             1–0  Borussia Dortmund     FT   Echte Liebe!
  Manchester City        2–4  Paris Saint-Germain   FT   Blue Moon!
  Real Betis             3–2  FC Porto              FT   ¡Viva er Betis manque pierda!
  Shakhtar Donetsk       3–1  AEK Athens            FT   off to the tunnel!
  Slovan Bratislava      0–3  VfB Stuttgart         FT   the referee calls time!

Live data: ESPN
Not affiliated with FIFA, any confederation, league or club, or Anthropic.
```

## Competitions

The 16 competitions Claudinho follows, by the alias `follow` and `--competition` take:

<!-- competitions:start -->
| Alias | Competition | Teams | Scores | Next | Standings | Bracket | Markets |
|---|---|---|---|---|---|---|---|
| `world-cup` | World Cup | nations | yes | yes | yes | yes | yes |
| `euro` | EURO | nations | yes | yes | yes | not yet | not yet |
| `copa-america` | Copa América | nations | yes | yes | yes | not yet | not yet |
| `nations-league` | UEFA Nations League | nations | yes | yes | yes | not yet | not yet |
| `concacaf-nations-league` | Concacaf Nations League | nations | yes | yes | yes | not yet | not yet |
| `gold-cup` | Gold Cup | nations | yes | yes | yes | not yet | not yet |
| `premier-league` | Premier League | clubs | yes | yes | yes | n/a | not yet |
| `laliga` | LALIGA | clubs | yes | yes | yes | n/a | not yet |
| `serie-a` | Serie A | clubs | yes | yes | yes | not yet | not yet |
| `bundesliga` | Bundesliga | clubs | yes | yes | yes | not yet | not yet |
| `liga-mx` | Liga MX | clubs | yes | yes | yes | not yet | not yet |
| `liga-auf` | Liga AUF Uruguaya | clubs | yes | yes | yes | not yet | not yet |
| `champions-league` | Champions League | clubs | yes | yes | yes | not yet | not yet |
| `libertadores` | Libertadores | clubs | yes | yes | yes | not yet | not yet |
| `concacaf-champions-cup` | Concacaf Champions Cup | clubs | yes | yes | n/a | not yet | not yet |
| `club-world-cup` | Club World Cup | clubs | yes | yes | yes | not yet | not yet |

`yes` offered · `not yet` not offered yet · `n/a` the competition has no such thing (a league season with no knockout tie has no bracket; a knockout-only cup has no table).
<!-- competitions:end -->

## Commands

```bash
claudinho follow [ALIAS]    # choose the competition every surface follows (saved); --team <name> pins your team; --list; off
claudinho today [date]      # a day's fixtures in your timezone (default: today), live scores inline
claudinho live              # matches in play right now
claudinho next [TEAM]       # a team's next match and a countdown; TEAM is a name or a code (Arsenal, ARS, Mexico, MEX); default: your pinned team
claudinho table [KEY]       # standings (default: every table); KEY is a group letter, or A1, A-B, LEAGUE
claudinho match <id>        # one match, with its goals and cards
claudinho bracket [STAGE]   # the World Cup's knockout bracket (R32, R16, QF, SF, 3P, F); --tree for an ASCII tree
claudinho share [target]    # a plain-text card to paste: today | live | <date> | <id> | next <TEAM> | table <KEY> | bracket
claudinho markets [target]  # World Cup prediction-market odds: today | <date> | <id> | next <TEAM>
claudinho team <query>      # a World Cup nation's name or code to its FIFA code, flag and group (team "DR Congo")
claudinho prompt            # one compact status line (for a statusline, tmux or Starship)
claudinho init claude       # Claude Code: statusline + score-aware hook, then the MCP line to run
claudinho init cursor       # Cursor CLI: statusline, then the MCP config to paste (--print for the snippets)
claudinho init plugin       # remove the statusline and hook `init claude` wrote (for the Claude Code plugin)
claudinho init-statusline   # just the Claude Code statusline
claudinho init-hook         # just the Claude Code score-aware hook
claudinho init-cursor-statusline  # just the Cursor CLI statusline
claudinho hook              # the live-score block for a Claude Code hook (silent off-match)
claudinho ambient --json    # the statusline and the hook as one JSON object, for a program
claudinho vibe              # a matchday-coder one-liner
claudinho star              # how to support the project
```

### Examples

```bash
claudinho follow premier-league --team Arsenal   # follow a league and pin a team
claudinho next                                   # Arsenal's next match, with a countdown
claudinho today --tz America/Mexico_City --lang es
claudinho --competition liga-mx table            # another competition, for one command
claudinho live --json | jq '.matches[].status'
claudinho share next --copy                      # a card for the group chat, on your clipboard
```

### In a club competition

`next` finds a club by its name or code in the competition's own table and answers its next match
within 14 days. When several clubs match a name it lists them and does not guess. `match <id>`
looks from yesterday to 14 days ahead and says which days it searched. Between two seasons,
`today`, `live`, `next` and `match` say "between editions". A club shows by its name (by its code
on the statusline: `ARS 2–1 CHE 50'`), with no flag, and `next` and `match` say the stage:
"League", "Play-offs", or the provider's own words for a round Claudinho does not know.

### One match

`match <id>` lists the goals and cards the provider sent for a match in play or finished, one row
each: the minute (`90+3'` with added time), the kind (goal, own goal, penalty, yellow or red card),
the side and the player when named, a marker before the kind (`⚽` for a goal, an own goal or a penalty, `🟨` for a
yellow card, `🟥` for a red card): `22'  ⚽ Goal  LIV  Ronald Araújo`. An own goal sits under the side it counted for.
The list is what could be read, not a promise that it holds every goal. The answer opens with the score in bold, your
pinned team's name in colour, and a status row (`FT · Kickoff Wed 16:45`). With `--json` it adds `lines` (the rows
the text prints), `rows` (the same rows as styled parts with their roles, for a program that draws them),
`attribution` and `disclaimer`.

## Choosing a competition

Nothing is followed until you choose. Three sources can choose, and the first one present wins:

1. `--competition <alias>` (or `-c`), for one command;
2. `CLAUDINHO_COMPETITION`, while it is set (the statusline, the hook and `ambient --json` follow it too);
3. the choice `claudinho follow <alias>` saved.

Each takes an alias from the table, or an ESPN slug such as `eng.1`. Any other lower-case dotted
ESPN slug works too, labelled experimental. An unknown value is refused with the list. With none of
the three, a command says so and exits 1 (`--json` prints `{ "competition": null, "noCompetition": true }`),
the statusline reads `⚽ claudinho follow`, and the hook stays silent.

Every answer names its competition on the line under its header (`Premier League · from the command
line`), and in `--json` as `competition`. A share card names it in its title.

**Your team.** `claudinho follow <alias> --team <name>` pins a team in that competition. It becomes
the team `next`, `share next` and `markets next` answer for, and its match comes first on the
statusline and in the hook. A pin belongs to its competition and never applies to another, whatever
chose the competition. Pin a team while its competition has matches ahead: between seasons there is
nothing to pin. `CLAUDINHO_TEAM` (a code or a name) takes precedence over the pin while it is set.

**Where it is saved.** `config.json` in `~/.config/claudinho/` (or `$XDG_CONFIG_HOME/claudinho/`;
`%APPDATA%\claudinho\` on Windows). `claudinho follow` shows the choice and where it came from;
`claudinho follow off` forgets it. `follow --json` prints the same facts as its text.

## Options

| Flag | Description |
|---|---|
| `--lang <code>` | `en`, `es`, `pt`, `fr` (also `CLAUDINHO_LANG`; falls back to `$LANG`) |
| `--tz <zone>` | an IANA timezone, such as `America/Mexico_City` (also `CLAUDINHO_TZ`; default: your system's). Kickoff times **and** the day a match falls on use this zone. |
| `--json` | machine-readable output for scripts |
| `--no-color` | no ANSI color (also `NO_COLOR`; off automatically when piped) |
| `-c, --competition <alias\|slug>` | the competition for this command (see [Choosing a competition](#choosing-a-competition)) |
| `--flavor <level>` | commentary: `full` (default), `subtle` or `off` (also `CLAUDINHO_FLAVOR`) |
| `--no-markets` | hide World Cup market odds in `today` and `match` (also `CLAUDINHO_MARKETS=off`) |
| `--source <name>` | the live data provider (advanced) |

Team codes: a nation's is FIFA's 3 letters (`MEX`, `BRA`, `ENG`); a club's is the provider's
abbreviation (`ARS`, `LEE`). A club is also found by its name (`next Arsenal`).

### Commentary

By default each match line ends with a short line of commentary in your language: `¡GOOOOL!` on a
goal, `¡a cancha llena!` before kickoff, something for the break and the last ten minutes. The bank
holds a few hundred lines in four languages, and a day's list does not repeat one while the bank has
another. When a side has a rally cry of its own, the cry takes the slot (Mexico's `¿Y si sí?`, Pumas'
`¡Goya!`, Arsenal's `COYG!`; your pinned team's when both sides have one). None of it reaches `--json`.

- `--flavor full` *(default)*: before kickoff, in play, goals, the break, the closing minutes and full time
- `--flavor subtle`: goals, full time, draws and the rally cries only
- `--flavor off`: just the facts

## Shareable cards

`claudinho share` prints a plain-text card you can paste into a chat, a post or an issue:

```bash
claudinho share                   # today's matches
claudinho share live              # the matches in play
claudinho share next              # your pinned team's next match (or next <TEAM>)
claudinho share table             # the standings (or table <KEY> for one table)
claudinho share 401915407         # one match by id
claudinho share next --copy       # also copy it to the clipboard
```

<!-- DEMO CARD: verbatim `claudinho --tz UTC share 401915407` (a Champions League match from Oct 14,
     2026), with the Champions League followed. Never hand-edit. -->
```text
Match pulse · Champions League

Manchester City 2–4 Paris Saint-Germain · FT
Etihad Stadium, Manchester, England
League phase

Live data: ESPN
#VibingLaVidaLoca · Independent fan project · Not affiliated with FIFA, any confederation, league or club, or Anthropic.
Try it: npx @claudinho/cli --competition champions-league match 401915407
```

A card has no color codes, so it pastes cleanly anywhere, and always carries the non-affiliation
sentence. `--copy` uses the first clipboard tool it finds (`pbcopy`, `clip`, `wl-copy`, `xclip` or
`xsel`). On a system with none of them, the card is still printed: copy it from the terminal.

| Flag | Description |
|---|---|
| `--style <social\|compact>` | `social` (default) is the full card; `compact` is one line per match |
| `--copy` | also copy the card to the clipboard |
| `--no-hashtag` | leave out the `#VibingLaVidaLoca` tag |
| `--no-install-line` | leave out the `Try it: …` line |

Want an image? A screenshot of the card works, or a tool such as
`freeze --execute "claudinho share next" -o card.png` (charmbracelet/freeze).

## Prediction-market odds (World Cup)

For World Cup matches, `claudinho markets` shows a "who's favored" line: the percentages Polymarket's
public market data implies, for a date, a match or a team's next match. A short version appears
under `today` and `match` when a reliable market exists. **Informational only, not betting
advice:** no trading, no links. A match with no clean market, and a finished match, shows nothing.
Turn it off with `--no-markets` or `CLAUDINHO_MARKETS=off`. The statusline and the hook never show
market data.

## Statusline: Claude Code

```bash
claudinho init-statusline          # edits ~/.claude/settings.json (backed up first)
claudinho init-statusline --print  # just print the snippet
```

The statusline reads a local cache and never waits on the network. A background process refreshes
the cache. When several matches are live it shows them all: `⚽ ARS 2–1 CHE 67' · LIV 0–0 MNC 12'`.

- `CLAUDINHO_TEAM=ARS`: that team's match first, the others counted (`+N`). A pinned team does the same when this is not set.
- `CLAUDINHO_MAX=2`: show at most this many live matches (default and maximum: 8); the rest are counted.
- `CLAUDINHO_COMPACT=0`: show 3-letter codes beside the flags.
- `CLAUDINHO_FLAGS=off`: 3-letter codes instead of flag emoji (automatic in Warp, which cannot draw them).

The same `claudinho prompt` works in tmux (`set -g status-right '#(claudinho prompt)'`) and as a
Starship custom command.

### Score-aware Claude: the hook

```bash
claudinho init-hook                # edits ~/.claude/settings.json (backed up first)
```

The hook runs on every prompt you send in Claude Code. During a match it adds the live score to
what Claude reads, so Claude can mention it. Off-match it adds nothing. Restart Claude Code to
activate it.

**Moving to the Claude Code plugin?** The plugin draws the score above the prompt and adds the
score to your prompts itself. Run `claudinho init plugin` first: it removes the statusline and the
hook `init claude` wrote, and keeps every other setting. A command you edited (a wrapper, an `npx`
form) stays, and `init plugin` names it. Then see the
[plugin's README](https://github.com/arturogarrido/claudinho/tree/main/packages/plugin#readme).

## Statusline: Cursor CLI

Cursor CLI is Cursor's agent in the terminal.

```bash
claudinho init-cursor-statusline          # edits ~/.cursor/cli-config.json (backed up first)
claudinho init-cursor-statusline --print  # just print the snippet
```

It runs the same `claudinho prompt`, so the settings above apply. `export CLAUDINHO_CURSOR_META=auto`
adds a second line with the model, the context in use, the worktree and the vim mode. Cursor's
prompt hook cannot pass the score to the model yet, so the score-aware hook is Claude Code only.

## For a program: `claudinho ambient --json`

`claudinho ambient --json [--columns N]` prints the statusline and the hook as one JSON object on
one line, for a program that draws them itself (the Claude Code plugin does). It reads only the
local cache, never the network, and exits 0 whatever the cache holds.

| Field | What it holds |
|---|---|
| `line` | what `claudinho prompt` prints, fitted to `--columns N` with its `+N` count kept |
| `lineParts` | the same line in parts, each shown score marked `strong`; their texts joined equal `line` |
| `idle` | `true` on the end-of-edition line, however narrow the fit |
| `empty` | `true` when nothing is known |
| `context` | the hook's block, or `null` |
| `live` | the live matches, each with `picked`, `pinned`, `pinnedSide` (`home`, `away` or `null`: your saved team's side, never `CLAUDINHO_TEAM`'s), `names` (the two names the hook's line uses), `lastGoal` (the last goal, only when the provider's goals add up to the score, none listed twice, the credited side having scored; else `null`) and `line` (the hook's own line for it) |
| `finished` | the matches the refresher saw in play and then read at full time, each for 10 minutes from that read, while the snapshot's last live read was whole; each with `pinnedSide`, `names` and a `line` ending `(FT)` |
| `current` | whether `live` is a current, whole read: an empty list means nothing is on only when this is `true` |
| `next` | the fixture the countdown names |
| `pick`, `competition` | the team preferred and the competition followed |
| `degraded`, `source`, `updatedAt`, `staleAfter` | where the data came from, when, and when its live scores stop being shown |
| `disclaimer`, `attribution` | the non-affiliation sentence, and the provider's (`Live data: ESPN`; `null` with no snapshot, on the end-of-edition line and when nothing is known) |

Read `idle` and `empty`, never the text of `line`, to decide what the line is. With nothing chosen
it prints `{ "competition": null, "noCompetition": true }` and the first-run line.

## How it works

The World Cup's schedule (104 matches, with venues and kickoffs) ships with the package, so it works
offline. Every other competition's schedule, and every live score, comes from ESPN's public
scoreboard (attributed in every answer as `Live data: ESPN`). World Cup market odds come from
Polymarket's public data. Rate limits are respected, and the CLI backs off when a provider asks it
to.

## Privacy

No accounts, no telemetry, no analytics, no tracking, and no Claudinho server. The CLI asks ESPN
(and Polymarket, for World Cup odds) for public data with nothing about you attached; those services
still see standard request metadata, such as your IP address, like any web request. It keeps your
choice in `~/.config/claudinho/` and a cache of public match data in `~/.cache/claudinho/` (or
`$XDG_CACHE_HOME/claudinho`). The `init` commands edit only the settings file they name, after a
one-time `.claudinho.bak` backup. Nothing is uploaded. Full policy:
[PRIVACY.md](https://github.com/arturogarrido/claudinho/blob/main/PRIVACY.md).

## License

MIT © 2026 Arturo Garrido · [source and issues](https://github.com/arturogarrido/claudinho) ·
like it? [star it on GitHub](https://github.com/arturogarrido/claudinho) (`claudinho star` shows how).

Independent fan project. Not affiliated with FIFA, any confederation, league or club, or Anthropic.

_Built while watching the games._ **#VibingLaVidaLoca** ⚽
