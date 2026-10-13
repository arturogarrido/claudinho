# Claudinho for Claude Code ⚽

Live football in Claude Code for the competition you follow: the score or the countdown above the prompt,
`/claudinho` for the same line on demand, a toast when a score changes, a short celebration in the band on a goal, and
the live score beside your prompt for the model. The plugin reads everything from the installed `claudinho` CLI (`claudinho ambient --json`, the CLI's local
cache) and never fetches anything itself.

## Install

The plugin runs the `claudinho` command, so install the CLI and choose a competition first. It needs
`@claudinho/cli` 0.11.2 or later, the first whose `claudinho ambient --json` says what its line is (`idle`,
`empty`), carries the hook's own line on each live record, and marks its fallback object `empty`; with an older CLI
the band shows nothing, nothing toasts and nothing celebrates.

```bash
npm i -g @claudinho/cli              # 0.11.2 or later
claudinho follow premier-league      # or any alias from `claudinho follow --list`
claudinho init plugin                # removes the statusline and hook `init claude` wrote, if you ran it
```

`claudinho init plugin` removes exactly the `claudinho prompt` statusline and the `claudinho hook` prompt hook that
`claudinho init claude` wrote to `~/.claude/settings.json` (an edited command or a wrapper stays, and it names it), so
the plugin's band and context do not show twice. Then, at the prompt of a Claude Code session in a terminal:

```
/plugin install claudinho --marketplace arturogarrido/claudinho
```

Answer `y` to add the marketplace, then choose a scope (the user scope first, with Enter), and set the `toasts`
and `celebrate` options if you want other values than the defaults. The plugin is active in that session from then on.

Install from a terminal: the desktop app's Code tab refuses the `/plugin install` line. An install at the user scope
made in a terminal then loads in the Code tab too.

## Where it runs

- **In a terminal and in the desktop app's Code tab.** The band is drawn there, and the plugin runs the CLI for the
  band while a terminal or a desktop window is attached to the session.
- **Nowhere else, for the band.** While no terminal or desktop window is attached (`claude -p`, the SDK, a phone or an
  editor alone), the band runs nothing: it starts no process there. `/claudinho` is the exception: typed on any
  surface where the plugin loads, headless included, it runs the CLI once.
- **Finding the CLI.** The plugin runs `claudinho` from the `PATH` Claude Code was started with. When that `PATH` does
  not hold the CLI's folder (an app can start Claude Code with a bare one), the plugin also looks in the folders the
  usual installers put global commands in, in this order: nvm's (`~/.nvm/versions/node/<version>/bin`, the eight
  newest versions), `~/.volta/bin`, `~/.local/share/pnpm`, `~/Library/pnpm`, `~/.bun/bin`, `~/.npm-global/bin`,
  `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin` and `/bin`. Among nvm's folders, those that hold
  the CLI come first, then the others, each group newest first. Until nvm's folders have been read, each run waits at
  most a second for them and otherwise runs without them. The folders under `~` are used only when `HOME` is an
  absolute path with no `:` in it. `/claudinho` finds the CLI the same way. A CLI installed anywhere else leaves the
  band empty, and `/claudinho` answers `The CLI gave no answer.` On Windows the plugin uses Claude Code's own `PATH`
  alone.
- **Beside other plugins.** A band drawn beneath ours in the hook chain (a plugin registered after ours, or Claude
  Code's own) stays, under our line: the plugin never drops it.

## What it does, and what it does not promise

- **The band** above the prompt shows the line `claudinho prompt` prints: the live score, or the countdown to the
  next fixture. It shows nothing when nothing is chosen or nothing is known. At the end of an edition: the World
  Cup's sign-off line (`⚽ World Cup 2026 is complete · claudinho follow --list`) is the one end-of-edition line the
  statusline prints, and the band shows it; after another competition's season the statusline says nothing is known,
  and the band shows nothing. It runs the CLI every 15 seconds (every five minutes on the sign-off line and while
  nothing is chosen), which is also what keeps the CLI's cache fresh. The CLI fits the line to the band's width and
  keeps its `+N` count of other matches (`+more` after a read that was not whole); the engine cuts anything wider.
  What the band shows and how often it reads come from what the CLI says the line is, never from its text. With no terminal or desktop window attached
  (`claude -p`, the SDK, a phone or an editor alone) the band runs nothing; `/claudinho` still runs the CLI once when
  typed.
- **The toasts** say a score change the plugin observed between two current views, as `⚽` and the hook's own line
  for the match, the one `claudinho hook` prints (`⚽ Arsenal 2–1 Chelsea (67')`; on a nations competition with its
  flags and the roster's names, `⚽ 🇲🇽 Mexico 1–0 South Africa 🇿🇦 (67')`): one toast per match per change. Best
  effort, never every goal. A change is never said as it happens from a view the CLI could not vouch for (stale,
  degraded, or a read that was not whole), and a goal across such a gap, or across a failed run, is said at the first
  current view after it: late, never lost while the match stays in the list (a match gone from the next current
  view and back is observed afresh). The first view of a match says nothing, and neither does a change of
  competition.
- **The goal celebration**: on a goal the toasts announce, the band plays a short celebration above its line, about
  three seconds (see "The goal celebration" below).
- **The context**: while a match is live, each prompt you submit carries the hook's live-score block beside it, for
  the model, from the plugin's last run (never a run on submit), and only while that run is recent and its scores are
  inside their display window.

## The goal celebration

When a run's toasts include a goal (a regulation score or a shootout tally that rose, with none that fell, between two
current views, under the `toasts` option), the band plays six frames over about three seconds above its line: a ball
`⚽` stepping across the band's width, a banner growing `G`, `GO`, `GOA`, `GOAL`, `GOAL!`, then the goal's toast line
(`⚽ Arsenal 2–1 Chelsea (67')`), and then the band is its one line again. "GOAL!" is the plugin's one word of its own
(English, like every ambient string); every other word is the CLI's. Where a toast is not raised (a view that is not
current, the first view of a match, a change of competition, `toasts: off`, a match not pinned under `toasts: pinned`)
nothing plays. A correction (2–1 back to 1–1) still toasts and plays nothing. Two goals seen in one run play once, with
the line of the last; a goal during a celebration starts it again with the new line.

- **While Claude is working** the band stays its one line and the celebration waits. It plays when the turn ends, if
  that is within 60 seconds of when the plugin saw the goal, and is dropped otherwise (the toast already said it). A
  turn that starts mid-celebration stops it at its frame; the rest plays when the turn ends, within the 60 seconds. A
  celebration already playing when the 60 seconds pass finishes its three seconds; a paused one does not resume after
  them.
- **Room.** The celebration takes at most three rows above our line, and leaves one row for a band another plugin
  draws beneath ours: min(3, rows the band may take - 2). With two rows it shows the ball and the banner (the toast
  line in the banner's row at the end), with one the banner alone; with none our line shows alone and the celebration
  waits for room, within its 60 seconds. Each row is cut at the band's width, never wrapped. A survey holding the band
  pauses it too.
- **What drops it.** A waiting or playing celebration is dropped by a correction of that goal (its match's score or
  shootout tally falling in a later current view, whatever the `toasts` option, so the band never celebrates a goal
  the score no longer holds), by a change of the competition you follow, by the last terminal or desktop window
  closing, by a reload of the plugin (which changing an option makes), and by the 60 seconds above: the toast already
  said it. A change of your pinned team does not drop it, and neither does another match's correction or the match
  leaving the list.
- **Redraws.** While it plays the plugin asks for a redraw twice a second, and for none while it waits or once it is
  played.

## The `/claudinho` command

`/claudinho` answers the band's line now, as the command's output after the plugin's name
(`claudinho: ⚽ ARS 2–1 CHE 50'`, `claudinho: ARS vs LEE in 7h13m`). The command asks the CLI for no width, so the
CLI fits the line to its own ceiling, 200 display columns, never to the window: past it the CLI keeps its `+N` count
of the other matches (`+more` after a read that was not whole), or ends an over-wide segment with `…`. The transcript row wraps what it draws. Where the band
would show nothing, it answers one fixed sentence instead, chosen by what the CLI's answer says, never by a guess at
the cause:

- `The CLI gave no answer.` The run gave nothing the plugin can read as an answer: it could not be started, it ran
  past two seconds, it exited with a non-zero status, its output was cut, or its first line is not a JSON object with a
  line.
- `No competition followed yet.` The CLI answered that no competition is chosen.
- `Nothing to show: the CLI's answer is not one this plugin reads.` The CLI answered an object that lacks its live list,
  `idle` or `empty` (the two fields that say what its line is), such as its fallback object.
- `Nothing to show right now: no live match and no next fixture known.` The CLI's view says it is empty, or its line
  is blank.
- `The edition you follow is over.` The CLI's view says it is idle: the edition you follow ended.
  Its line (the band's sign-off line) carries a command, so the reply says this instead.

A reply made from the CLI's view (its line, the empty sentence or the edition sentence) ends with the two sentences
the view carries, each after a blank line: the provider's attribution (`Live data: ESPN`; none when the line is the
sign-off or nothing is known, or the cache holds no read, so the edition and empty sentences carry none), then the
CLI's non-affiliation sentence. The sentences said when there is no
view (no answer, no competition followed, an answer that is no view) carry neither. With CLI 0.11.2, older than the
release that adds the attribution to `claudinho ambient --json`, the reply carries the non-affiliation sentence
alone.

It runs the CLI once each time it is typed (`claudinho ambient --json`), on any surface where the plugin loads,
headless included (`claude -p "/claudinho"`), and finds the CLI as the band does (see "Finding the CLI" above). Its
run is its own: it reads nothing the band drew and changes none of it (no band line, pace, toast or prompt context),
so it answers with the band collapsed or not drawn at all. It takes no arguments: text typed after it is ignored,
though the transcript keeps it, as for any command. The model reads its reply, as it reads any command's output.
It was not tried over Remote Control (a phone), and a `/claudinho` typed while Claude is working runs when the turn
ends.

## The `toasts` option

`pinned` (the default) toasts your pinned team's match (`claudinho follow <alias> --team <name>`); with no pin saved
it toasts nothing. `all` toasts every live match of the competition you follow; `off` none. Change it in `/config`.

## The `celebrate` option

`on` (the default) plays the goal celebration; `off` plays nothing and drops a waiting celebration. The toasts are the
same either way. Change it in `/config`.

## Data and disclaimer

Live data: ESPN, read by the CLI, which keeps it in a local cache; the plugin reads the CLI's answer and nothing else.

Independent fan project. Not affiliated with FIFA, any confederation, league or club, or Anthropic.
