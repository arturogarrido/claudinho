<p align="center">
  <img src="https://raw.githubusercontent.com/arturogarrido/claudinho/main/.github/assets/logo.png" alt="The Claudinho logo: a yellow C around a football, above the word claudinho" width="120">
</p>

# @claudinho/cli ⚽

**Live football scores, fixtures and standings in your terminal, for the competition you follow: the World Cup, the Premier League, LALIGA, the Champions League and 12 more.**
The `claudinho` command also puts the live score in your Claude Code or Cursor CLI statusline. It
speaks English, Spanish, Portuguese and French, follows your timezone, and prints JSON for scripts.
No API key, no signup, no account.

## Install

It needs Node.js 22 or later.

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

This is a capture from Oct 14, 2026. `claudinho --tz UTC today 2026-10-14` shows that day's results
again.

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
claudinho follow [ALIAS]    # choose the competition you follow (saved); --team <name> pins your team; --list; off
claudinho today [date]      # a day's fixtures in your timezone (default: today), live scores inline
claudinho live              # matches in play right now
claudinho next [TEAM]       # a team's next match and a countdown; TEAM is a name or a code (Arsenal, ARS, Mexico, MEX); default: CLAUDINHO_TEAM, else your pin
claudinho table [KEY]       # standings (default: every table); KEY is a group letter, or A1, A-B, LEAGUE
claudinho match <id>        # one match, with its goals and cards
claudinho bracket [STAGE]   # the knockout bracket, World Cup only (R32, R16, QF, SF, 3P, F); --tree for an ASCII tree
claudinho share [target]    # a plain-text card to paste: today | live | <date> | <id> | next [TEAM] | table [KEY] | bracket [STAGE]
claudinho markets [target]  # World Cup prediction-market odds: today | <date> | <id> | next [TEAM]
claudinho team <query>      # a World Cup nation's name or code to its FIFA code, flag and group (team "DR Congo")
claudinho prompt            # one compact status line (for a statusline, tmux or Starship)
claudinho init claude       # Claude Code: statusline + score-aware hook, then the MCP line to run
claudinho init cursor       # Cursor CLI: statusline, then the MCP config to paste (--print for the snippets)
claudinho init plugin       # remove the Claudinho statusline and hook from Claude Code (for the Claude Code plugin)
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

`next` finds a club by its name or code among the competition's clubs (its table, and its fixtures
from yesterday to 14 days ahead) and answers its next match within 14 days. When several clubs match a name it
lists them and does not guess. `match <id>` looks from yesterday to 14 days ahead. When the match is not there it names the days it
searched, or, when the provider's answer was not whole, says no match with that id was read; when
the provider cannot be reached, it says so. Between two seasons, `today`, `live`, `next` and
`match` say "Between editions". `bracket` says "This competition has no bracket." on the Premier
League and LALIGA, and "Not available for this competition yet." on every other competition but the
World Cup. A club shows by its name (by its code
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

### When the data is not whole

When the provider sends a record Claudinho cannot read, `today`, `live`, `next`, `match`, `bracket`,
`markets` and their share cards say their data may be incomplete. `today` and `live` say it after
their list; the others, and every share card, before what they show. With
`--json` they carry `partial` (with `omitted`, the count of records left out, when it is known). An
empty answer then means nothing was read, not that nothing exists: no next match does not mean a
team is out.

## Choosing a competition

Nothing is followed until you choose. Three sources can choose, and the first one present wins:

1. `--competition <alias>` (or `-c`), for one command;
2. `CLAUDINHO_COMPETITION`, while it is set (the statusline, the hook and `ambient --json` follow it too);
3. the choice `claudinho follow <alias>` saved.

Each takes an alias from the table, or an ESPN slug such as `eng.1`. Any other lower-case dotted
ESPN slug works too, labelled experimental. An unknown value is refused with the list. With none of
the three, a command that answers for a competition says so and exits 1 (`--json` prints
`{ "competition": null, "noCompetition": true }`), the statusline reads `⚽ claudinho follow`, and
the hook stays silent.

`today`, `live`, `next`, `match`, `table`, `bracket` and `markets` name their competition near the
top (`Premier League · from the command line`), and in `--json` as `competition`. A share card names
it in its title, and `share --json` carries `competition` too. `team` reads the World Cup's nations
and carries no `competition`; it is refused when `--competition` or `CLAUDINHO_COMPETITION` chooses
another competition.

**Your team.** `claudinho follow <alias> --team <name>` pins a team in that competition. When you
name no team and `CLAUDINHO_TEAM` is not set, it is the team `next`, `share next` and `markets next`
answer for, and its match comes first on the statusline and in the hook. A pin belongs to its
competition and never applies to another, whatever chose the competition. Between two seasons
("between editions") `follow --team` saves nothing: pin your team once the next season has started.
A club with no match in the next 14 days can still be pinned.

**`CLAUDINHO_TEAM`** replaces the pin while it is set. `next`, `share next` and `markets next` take it
as a name or a code. The statusline and the hook take a code (`ARS`); on the World Cup a nation's
name works too (`mexico`). Off the World Cup a club's name there puts no team first, and the pin is
not used either.

**`claudinho follow`** shows the choice and where it came from; `claudinho follow off` forgets it
(it deletes `config.json`). `follow --json` prints the same facts as its text:

- `competition`: with `follow` alone, what this command follows (`--competition`, else
  `CLAUDINHO_COMPETITION`, else the saved choice). After a write or `off`, what the next command
  follows: while `CLAUDINHO_COMPETITION` is set, that is the environment's choice, not the one just
  saved. With nothing chosen it is `null`, beside `noCompetition: true`; when the value that decides
  it is refused, it is `null`, beside `refused` (a refused value that does not decide it is only in
  `refused`).
- `override`: `flag` or `env` when that competition does not come from the saved choice.
- `sources`: the `--competition`, `CLAUDINHO_COMPETITION` and `CLAUDINHO_TEAM` values this command
  ran under, each competition as its resolved slug (`laliga` is `esp.1`).
- `refused`: each refused value under `flag`, `env` or `team` (a `CLAUDINHO_TEAM` with nothing
  readable is `"team": ""`).
- `saved`: the file as read, or as written; `null` when there is none, with `reason` saying why.
- `path`: the file's path; after `off`, `removed` says whether there was a file.

### Where it is saved

Your choice is `config.json` in `$XDG_CONFIG_HOME/claudinho/` when `XDG_CONFIG_HOME` is an absolute
path, else in `%APPDATA%\claudinho\` on Windows, else in `~/.config/claudinho/`. The cache follows the
same rule: `$XDG_CACHE_HOME/claudinho/`, else `%LOCALAPPDATA%\claudinho\` on Windows, else
`~/.cache/claudinho/`. A relative `XDG_*` value is ignored. `claudinho follow off` deletes the
choice; delete the cache folder yourself after `npm rm -g @claudinho/cli`.

### Other settings

`CLAUDINHO_NO_STAR=1` turns off the occasional "star the repo" line under the interactive commands. `CLAUDINHO_DEBUG=1` prints the data provider's failures to stderr.

## Options

| Flag | Description |
|---|---|
| `--lang <code>` | `en`, `es`, `pt`, `fr` (also `CLAUDINHO_LANG`; falls back to `$LANG`) |
| `--tz <zone>` | an IANA timezone, such as `America/Mexico_City` (also `CLAUDINHO_TZ`; default: your system's). Kickoff times **and** the day a match falls on use this zone. |
| `--json` | machine-readable output for scripts |
| `--no-color` | no ANSI color (also `NO_COLOR`; off automatically when piped) |
| `-c, --competition <alias\|slug>` | the competition for this command (see [Choosing a competition](#choosing-a-competition)) |
| `--flavor <level>` | commentary: `full` (default), `subtle` or `off` (also `CLAUDINHO_FLAVOR`) |
| `--no-markets` | hide World Cup market odds in `today`, `match` and share cards (also `CLAUDINHO_MARKETS=off`) |
| `--source <name>` | the live data provider (advanced) |

Team codes: a nation's is FIFA's 3 letters (`MEX`, `BRA`, `ENG`); a club's is the provider's
abbreviation (`ARS`, `LEE`). A club is also found by its name (`next Arsenal`).

### Commentary

By default a match line ends with a short line of commentary in your language: `¡GOOOOL!` on a
goal, `¡a cancha llena!` before kickoff, something for the break and the last ten minutes. The bank
holds a few hundred lines in four languages, and a day's list does not repeat one while the bank has
another. When a side has a rally cry of its own, the cry takes the slot (Mexico's `¿Y si sí?`, Pumas'
`¡Goya!`, Arsenal's `COYG!`; your pinned team's when both sides have one). A postponed or cancelled
match gets neither. The commentary reaches `--json` only in `match --json`'s `lines` and `rows`,
which are the text's own rows.

- `--flavor full` *(default)*: before kickoff, in play, goals, the break, the closing minutes and full time
- `--flavor subtle`: goals, full time, draws and the rally cries only
- `--flavor off`: just the facts

## Shareable cards

`claudinho share` prints a plain-text card you can paste into a chat, a post or an issue:

```bash
claudinho share                   # today's matches
claudinho share live              # the matches in play
claudinho share next              # your team's next match (or next <TEAM>)
claudinho share table             # the standings (or table <KEY> for one table)
claudinho share 401915407         # one match by id
claudinho share bracket R16       # the World Cup bracket, or one round (R32, R16, QF, SF, 3P, F)
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

This card is a capture from Oct 14, 2026. Off the World Cup, `share <id>` finds a match from
yesterday to 14 days ahead, so run it with a current id (`claudinho today --json` lists each
match's `id`).

A card has no color codes, so it pastes cleanly anywhere, and always carries the non-affiliation
sentence. `--copy` uses `pbcopy` on macOS, `clip` on Windows, and elsewhere the first of `wl-copy`,
`xclip` and `xsel` that works. When none works, the card is still printed: copy it from the terminal.

| Flag | Description |
|---|---|
| `--style <social\|compact>` | `social` (default) is the full card; `compact` is one line per match |
| `--copy` | also copy the card to the clipboard |
| `--no-hashtag` | leave out the `#VibingLaVidaLoca` tag |
| `--no-install-line` | leave out the `Try it: …` line |

`share … --json` prints the card (`kind`, `snippet`) with its facts. A card for a day, live
matches, a match or a team's next match adds `matches`, `marketSignals` and `marketComplete`; a
table card adds `tables`, and a bracket card the bracket's `view`. When the market read did not
finish, the card says so and `--json` carries `marketComplete: false`: that is not "no market".

Want an image? A screenshot of the card works, or a tool such as
`freeze --execute "claudinho share next" -o card.png` (charmbracelet/freeze).

## Prediction-market odds (World Cup)

For World Cup matches, `claudinho markets` shows a "who's favored" line: the percentages Polymarket's
public market data implies, for a date, a match, or a team's current match (one whose kickoff time
passed less than about three and a half hours ago and that the feed has not marked finished) or,
with none, its next. A short version appears under `today`,
`match` and on the share cards for a date, a match or a team's next match, when a reliable market
exists. **Informational only, not betting
advice:** no trading, no links. A match with no clean market, and a finished match, shows nothing.
With `--json`, `markets` carries `complete`, and `today` and `match` carry `marketComplete`. `false`
means the optional market read did not finish, and the text says so: it is not "no market".
Turn the short version off with `--no-markets` or `CLAUDINHO_MARKETS=off`; `claudinho markets`
still answers. The statusline and the hook never show market data.

## Statusline: Claude Code

```bash
claudinho init-statusline          # edits ~/.claude/settings.json (backed up first)
claudinho init-statusline --print  # just print the snippet
```

The statusline reads a local cache and never waits on the network. A background process refreshes
the cache. When several matches are live it shows up to eight side by side, and counts the rest
(`+N`): `⚽ ARS 2–1 CHE 67' · LIV 0–0 MNC 12'`. When your team is in play it shows that match
alone and counts the others.
With nothing in play it counts down to the next match: `⚽ ARS vs LEE in 2d4h`. From kickoff until the data provider
marks the match live, for up to 30 minutes, it reads `⚽ BET vs BAR now` instead of moving on to the next fixture.
The statusline is English in every language.

- `CLAUDINHO_TEAM=ARS`: that team's match first, the others counted (`+N`). Give a code; on the World Cup a nation's name works too. A pinned team does the same when this is not set.
- `CLAUDINHO_MAX=2`: show at most this many live matches when your team is not in play (default and maximum: 8); the rest are counted.
- `CLAUDINHO_COMPACT=0`: show 3-letter codes beside the flags.
- `CLAUDINHO_FLAGS=off`: no flag emoji: 3-letter codes on the statusline and in `bracket`, plain names in `today`, `live`, `next`, `match`, `table`, `team` and the hook (automatic in Warp, which cannot draw them). Share cards keep their flags. `CLAUDINHO_FLAGS=on` keeps the flags.

The same `claudinho prompt` works in tmux (`set -g status-right '#(claudinho prompt)'`) and as a
Starship custom command.

Running a local build (a checkout, no global `claudinho`)? `init-statusline`, `init-hook` and
`init-cursor-statusline` take `--command`. From the checkout's root, after a build:
`node packages/cli/dist/index.js init-cursor-statusline --command "node \"$PWD/packages/cli/dist/index.js\" prompt"`.

### Score-aware Claude: the hook

```bash
claudinho init-hook                # edits ~/.claude/settings.json (backed up first)
```

The hook runs on every prompt you send in Claude Code. During a match it adds the live score to
what Claude reads, so Claude can mention it. Off-match it adds nothing. Restart Claude Code to
activate it.

**Moving to the Claude Code plugin?** The plugin draws the score above the prompt and adds the
score to your prompts itself. Run `claudinho init plugin` first: it removes the statusline whose
command is `claudinho prompt` and the hook whose command is `claudinho hook` (the commands
`init claude`, `init-statusline` and `init-hook` write by default), and keeps every other setting.
Any other command stays (a wrapper, an `npx` form, a `--command` one); `init plugin` names it when
it mentions `claudinho`. Then see the
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
one line, for a program that draws them itself (the Claude Code plugin does). It reads the local
cache, never the network (it may start the background refresh, as the statusline does), and exits 0
whatever the cache holds.

| Field | What it holds |
|---|---|
| `line` | the line `claudinho prompt` prints, but in the CLI's language (`--lang`; `prompt` itself stays English), fitted to `--columns N` with its `+N` count kept. Its `+more`, the World Cup's sign-off and `⚽ —` stay English, and the countdown's units (`2d4h`, `17m`) are the same in every language |
| `lineParts` | the same line in parts, each shown score marked `strong`; their texts joined equal `line` |
| `idle` | `true` on the end-of-edition line, however narrow the fit |
| `empty` | `true` when nothing is known |
| `context` | the hook's block, or `null` |
| `live` | the live matches, each with `picked`, `pinned`, `pinnedSide` (`home`, `away` or `null`: your saved team's side, never `CLAUDINHO_TEAM`'s), `names` (the two names the hook's line uses), `lastGoal` (the last goal, only when the provider's goals add up to the score, none listed twice, the credited side having scored; else `null`) and `line` (the hook's own line for it) |
| `finished` | the matches the refresher saw in play and then read at full time, each for 10 minutes from that read, while the snapshot's last live read was whole; each with `pinnedSide`, `names` and a `line` ending `(FT)` |
| `current` | whether `live` is a current, whole read: an empty list means nothing is on only when this is `true` |
| `next` | the fixture the countdown names (a kickoff that passed less than 30 minutes ago, still listed as scheduled, included) |
| `pick`, `competition` | the team preferred and the competition followed |
| `lang`, `words` | the CLI's resolved language, and the words of the plugin's goal and full-time moments in it |
| `degraded`, `source`, `updatedAt`, `staleAfter` | where the data came from, when, and when its live scores stop being shown |
| `disclaimer`, `attribution` | the non-affiliation sentence, and the provider's (`Live data: ESPN`; `null` with no snapshot, on the end-of-edition line and when nothing is known) |

Read `idle` and `empty`, never the text of `line`, to decide what the line is. With nothing chosen
it prints `{ "competition": null, "noCompetition": true }` and the first-run line.

## How it works

The World Cup's schedule (104 matches, with venues and kickoffs) ships with the package, so it works
offline. Every other competition's schedule, and every live score, comes from ESPN's public
scoreboard (an answer from it says `Live data: ESPN`). World Cup market odds come from
Polymarket's public data. Rate limits are respected, and the CLI backs off when a provider asks it
to.

## Privacy

No accounts, no telemetry, no analytics, no tracking, and no Claudinho server. The CLI asks ESPN
(and Polymarket, for World Cup odds) for public data with nothing about you attached; those services
still see standard request metadata, such as your IP address, like any web request. It keeps your
choice and a cache of public match data on your machine (see [Where it is saved](#where-it-is-saved)).
The `init` commands edit only the settings file they name, after a
one-time `.claudinho.bak` backup. Nothing is uploaded. Full policy:
[PRIVACY.md](https://github.com/arturogarrido/claudinho/blob/main/PRIVACY.md).

## License

MIT © 2026 Arturo Garrido · [source and issues](https://github.com/arturogarrido/claudinho) ·
like it? [star it on GitHub](https://github.com/arturogarrido/claudinho) (`claudinho star` shows how).

Independent fan project. Not affiliated with FIFA, any confederation, league or club, or Anthropic.

_Built while watching the games._ **#VibingLaVidaLoca** ⚽
