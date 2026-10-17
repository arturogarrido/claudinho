# Claudinho for Claude Code ⚽

Live football in Claude Code for the competition you follow: the score or the countdown above the prompt,
`/claudinho` for the same line on demand, a toast that says what happened (a goal and its scorer, a goal against, a
correction, full time and the result), a short celebration in the band when your team scores or wins, the live score
beside your prompt for the model, and `/claudinho match`, a pane with the match you follow and its goals and cards. The plugin reads everything from the installed `claudinho` CLI (`claudinho ambient --json`, the CLI's
local cache; for the pane, `claudinho match <id> --json`, which the CLI reads from the provider) and never fetches
anything itself.

## Install

The plugin runs the `claudinho` command, so install the CLI and choose a competition first. It needs
`@claudinho/cli` 0.11.2 or later, the first whose `claudinho ambient --json` says what its line is (`idle`,
`empty`), carries the hook's own line on each live record, and marks its fallback object `empty`; with an older CLI
the band shows nothing, nothing toasts and nothing celebrates. The goal moments (the toasts that say what happened,
the celebration with the mascot, full time, the bold score, the styled pane) need the first CLI release after 0.11.2,
whose views carry each record's names, the pinned side, the last goal it can prove and the matches just finished.
With CLI 0.11.2 the toasts and the celebration are the ones described under "With CLI 0.11.2" below, the band's line
is plain, the pane needs the newer CLI (see "The match pane") and no full time is said.

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

Answer `y` to add the marketplace, then choose a scope (the user scope first, with Enter), and set the `toasts`,
`celebrate` and `context` options if you want other values than the defaults. The plugin is active in that session
from then on.

Install from a terminal: the desktop app's Code tab refuses the `/plugin install` line. An install at the user scope
made in a terminal then loads in the Code tab too.

## Where it runs

- **In a terminal and in the desktop app's Code tab.** The band is drawn there, and the plugin runs the CLI for the
  band while a terminal or a desktop window is attached to the session.
- **The match pane** (`/claudinho match`) opens in a terminal at any width (beside the transcript in the fullscreen
  layout from 110 columns, above the prompt otherwise) and in the desktop app's Code tab (a side panel).
- **Nowhere else, for the band.** While no terminal or desktop window is attached (`claude -p`, the SDK, a phone or an
  editor alone), the band runs nothing: it starts no process there. `/claudinho` is the exception: typed on any
  surface where the plugin loads, headless included, it runs the CLI once (and `/claudinho match` its match read too;
  with no window nothing draws the pane).
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
  Each score the CLI marks in the line is drawn bold (the `0–1` of `⚽ LAS 0–1 LIV 23'`); the band draws the CLI's
  marked parts only when they spell its line exactly, and the plain line otherwise.
  What the band shows and how often it reads come from what the CLI says the line is, never from its text. With no terminal or desktop window attached
  (`claude -p`, the SDK, a phone or an editor alone) the band runs nothing; `/claudinho` still runs the CLI once when
  typed.
- **The toasts** say what changed between two current views of a match, one toast per match per change: a goal, a
  goal against, more than one goal, a correction, penalties, or full time (below). Best effort, never every goal. A
  change is never said as it happens from a view the CLI could not vouch for (stale, degraded, or a read that was not
  whole), and a goal across such a gap, or across a failed run, is said at the first current view after it: late,
  never lost while the match stays in the list (a match gone from the next current view and back is observed afresh).
  The first view of a match says nothing, and neither does a change of competition.
- **The goal celebration**: on your team's goal, and at full time on its win or draw, the band plays a short
  celebration above its line (see "The goal celebration" below).
- **The context**: while a match is live, each prompt you submit carries the hook's live-score block beside it, for
  the model, from the plugin's last run (never a run on submit), and only while that run is recent and its scores are
  inside their display window. The `context` option turns it off.

## The toasts

Each toast is one line, the news, ` · `, then the score, written from the names and fields the CLI gives (an example
where you pinned Liverpool, away at LASK Linz):

- **A goal**: one side's score up by exactly one.
  `⚽ GOAL! Liverpool · Ronald Araújo 22' · LASK Linz 0–1 Liverpool`. The scorer and the goal's minute (`90+3'` in
  added time) are named only when the CLI proves them: its last goal for the match is a new one since the previous
  view, on the side that scored. Otherwise the team and the match clock's minute:
  `⚽ GOAL! Liverpool 60' · LASK Linz 0–1 Liverpool`. A proven own goal reads
  `⚽ Own goal · Liverpool 63' · LASK Linz 1–2 Liverpool`, the team it counted for, no player.
- **A goal against**: the same for the side opposite your pinned team,
  `Goal for LASK Linz · Robert Ljubicic 63' · LASK Linz 1–1 Liverpool` (no ball, and nothing plays). With no pinned
  side (`toasts: all`, a match that is not your team's) every goal reads `GOAL!`.
- **More than one goal** between two views (both sides scored, or one by two or more):
  `Goals · LASK Linz 1–2 Liverpool`, no player.
- **A correction** (a score that went down): `Score updated · LASK Linz 0–0 Liverpool`.
- **Penalties**: a shootout tally that went up, `Penalties · LASK Linz 1(3)–1(4) Liverpool`.
- **Full time**: a match that left the live list for the CLI's list of finished matches between two current views,
  `Full time · LASK Linz 3–6 Liverpool · Liverpool win` (or `· Draw`); the result is the CLI's marked winner first,
  else the shootout, else the score. A result that cannot be established (no score) is left out:
  `Full time · LASK Linz vs Liverpool`. A goal seen in the same read is said first, with the clock's minute, then
  full time.

When one change could be read two ways, the first that holds is said: `Score updated`, then `Penalties`, then the
goal, then `Goals`. Every toast follows the `toasts` option (below).

**Full time is said only by a current view.** The CLI lists a finished match for ten minutes after the read that saw
it end, and stops polling once the last match of the day has ended, so a session that has no current view in the
minutes after the whistle (closed, idle, or offline then) hears nothing about it.

## The goal celebration

When a run's toasts include a goal for your pinned team (or any goal under `all` of a match with no pinned side), the band
plays about three seconds above its line: Anthropic's Claude mascot drawn as three rows of text art at the left, in
your theme's Claude colour, its legs stepping; a ball `⚽` crossing the top row; `GOAL!` (bold, in your theme's
success colour) and the team on the middle row; the scorer and the minute (`Ronald Araújo 22'`, `own goal 63'`, or
the minute alone when the scorer is not proven) on the bottom row. Then the band is its one line again. At full time,
on your team's win or a draw, the mascot plays once for five seconds beside `Full time · Liverpool win` (or
`Full time · Draw`), after the goal's celebration when both came in one read. A goal against, `Goals`, `Penalties`,
a correction and a loss play nothing. Where a toast is not raised (a view that is not current, the first view of a
match, a change of competition, `toasts: off`, a match not pinned under `toasts: pinned`) nothing plays. Two goals
seen in one run play once, for the last match listed; a goal during a celebration starts it again.

"GOAL!" and the mascot are the plugin's own (English, like every ambient string); every other word is the CLI's.

- **While Claude is working** the band stays its one line and the celebration waits. It plays when the turn ends, if
  that is within 60 seconds of when the plugin saw the goal, and is dropped otherwise (the toast already said it). A
  turn that starts mid-celebration stops it at its frame; the rest plays when the turn ends, within the 60 seconds. A
  celebration already playing when the 60 seconds pass finishes (the goal and the full time queued behind it); a
  paused one does not resume after them.
- **Room.** The celebration takes at most three rows above our line, and leaves one row for a band another plugin
  draws beneath ours: min(3, rows the band may take - 2). With three rows it draws the mascot; with two, `GOAL!
  Liverpool` and the scorer's row (full time: its one row); with one, `GOAL! Liverpool 22'`; with none our line shows
  alone and the celebration waits for room, within its 60 seconds. Each row is cut at the band's width, never
  wrapped. A survey holding the band pauses it too.
- **What drops it.** A waiting or playing celebration (the goal and the full time behind it alike) is dropped by its
  match's score changing in any later current view, live or finished (a correction, or a later goal the plugin did
  not see as one; the score or the shootout tally, whatever the `toasts` option and whatever views came between, so
  the band never celebrates a score it no longer shows), by a change of the competition you follow (any answer naming
  another competition, or none, current or not), by the last terminal or desktop window closing, by a reload of the
  plugin (which changing an option makes), and by the 60 seconds above: the toast already said it. A full-time
  celebration lasts only while each later current view lists its match as finished with the same result: a view that
  gives another result at the same score (a corrected winner, a shootout appearing), lists the match as live again,
  or no longer lists it drops it, and only it (a goal celebration queued before it keeps the rules above). A change of your pinned team does
  not drop a celebration, and neither does another match's correction or a goal's match leaving the list.
- **Redraws.** While it plays the plugin asks for a redraw twice a second, and for none while it waits or once it is
  played.

## With CLI 0.11.2

The CLI 0.11.2 view carries no names, pinned side or last goal, so the plugin keeps the toasts and the celebration it
had before: a toast is `⚽` and the hook's own line for the match, the one `claudinho hook` prints
(`⚽ Arsenal 2–1 Chelsea (67')`; on a nations competition with its flags and the roster's names,
`⚽ 🇲🇽 Mexico 1–0 South Africa 🇿🇦 (67')`), for any score change, a correction included; no full time is said. On a
goal (a regulation score or a shootout tally that rose, with none that fell) the band plays six frames over about
three seconds: a ball crossing the band's width, a banner growing `G`, `GO`, `GOA`, `GOAL`, `GOAL!`, then the goal's
toast line; with two rows the ball and the banner (the toast line in the banner's row at the end), with one the
banner (the toast line in its place at the end). The hold while Claude works, the room, what drops it and the
redraws are as above.

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
so it answers with the band collapsed or not drawn at all. It reads one word typed after it: `match` (spaces around
it aside) opens the match pane (below), and answers in one line only when the pane opened on a terminal or a desktop
window with the CLI's rows and holds both the attribution and the non-affiliation sentence
(`⚽ ARS 2–1 CHE 50' · match pane open`: the pane carries the two); otherwise (no window to draw it, nothing to bind,
a first read that failed, an answer missing either sentence) it answers the bare reply, as `/claudinho` gives it
(its footer as described above: the attribution and the non-affiliation sentence when the view carries them). Any other text is ignored, though the transcript keeps it, as for any command. The model reads its reply, as it reads any command's output.
It was not tried over Remote Control (a phone), and a `/claudinho` typed while Claude is working runs when the turn
ends.

## The match pane

`/claudinho match` opens a pane titled "claudinho" that shows the match you follow now as `claudinho match <id>`
prints it: the score, the competition, the stage and venue, the kickoff and status, and the goals and cards the
provider lists, each row as the CLI wrote it (never cut sideways), then a blank row, the provider's attribution and
the CLI's non-affiliation sentence, dimmed. In a pane too narrow for a goal or card row with its player, every such row
puts the player on the next line, under the event (`Goal`, `Yellow card`); any other row too wide for the pane
continues under its own first character, never at the left edge. Widths are measured as the CLI measures them. The rows keep the CLI's styles: the score
and each scorer bold, your pinned team and a rally cry in your theme's success colour, the competition, stage and
venue dimmed, the commentary dimmed and in italics. The plugin draws the styles only when the CLI's styled rows spell
its plain rows exactly; with a CLI that prints no styled rows, the plain rows as before. Claude Code scrolls it (the arrows with the
pane focused; the wheel in the desktop app). It has no button. Close it with its close mark (or ctrl+x x).

It opens at once, showing the band's line (with the same attribution and sentence under it) until the CLI's rows
land, which can take a few seconds on a slow network; a first read that fails then says `The CLI gave no answer.`
(Claude Code places a pane the person asked for only within about 15 seconds of the command, so the pane does not
wait for the read to open.)

- **Which match.** The command's own `claudinho ambient --json` run decides: the first match of its live list (the CLI
  lists your pinned team's match first), else its next fixture, in the competition that answer names. The pane stays on
  that match and that competition. Its reads name no competition, so the CLI resolves your own choice and the pane's
  competition row says where that choice came from (your saved choice: the name alone). If you follow another
  competition (or none) while it is open, the answer of that other competition is never shown: the read is made once
  more with `--competition <the pane's competition>` (its row then says "from the command line", which is true of that
  read), and every later read of that pane names it the same way. With nothing to show (no competition followed, the
  edition over, nothing live and no next fixture, no answer) no pane opens. The command's reply is the line and
  ` · match pane open` only when the pane opened on a terminal or desktop window with the CLI's rows and holds both
  the attribution and the non-affiliation sentence, and otherwise the bare `/claudinho` reply as `/claudinho` gives it
  (with the attribution and the non-affiliation sentence when the view carries them). Typed again while the pane is open, it binds the same pane afresh.
- **When it reads again.** While open, the pane runs `claudinho match <id> --json` again when a band run sees that
  match's score (or its shootout tally) change, when the match enters the band's live list (kickoff) or leaves it (full
  time), and on a clock: while the last answer is not in play and its kickoff is ahead, once at the kickoff and not
  before (a degraded answer too); otherwise every two minutes: in play (live or half-time), after a read that failed,
  with no match, or once the kickoff has passed (a match still marked scheduled after its kickoff is read every two
  minutes until it starts, or until you close the pane, as a match stuck in play is). Never two reads at once,
  `/claudinho match` included: typed while a read is running, the pane shows the band's line at once and its own read
  waits for that one (up to its five seconds, so the reply can take that much longer), whose answer is then not shown,
  and a reason to read during either is kept and read after. After a final answer (full time, postponed, cancelled) it
  reads no more, and none once closed: a read still running when you close it changes nothing.
- **Three fixed sentences.** A read that fails (the CLI not found, a non-zero exit, past five seconds, a cut or
  unreadable answer) on opening shows `The CLI gave no answer.`; a later read that fails keeps the last rows under
  `Could not refresh: showing the last reading.` until a read answers; a CLI that answers without the rows shows
  `Nothing to show: the CLI's answer is not one this plugin reads.`
- **Bounds.** At most 150 rows, each cut at 600 characters (a styled row at 64 parts); the attribution and the
  sentence each at 1,000.
- **What it costs.** Opening it is one `claudinho ambient --json` (the local cache) and one `claudinho match` read,
  which asks the provider five times on the path measured (six across the end of a month). In play that is about 2.5
  requests a minute, plus five per goal the band sees; before kickoff and after a final answer, none. A read that has
  to be made again for its competition (above) costs twice, once. The CLI keeps its
  own backoff: when the provider throttles it, the pane's reads ask nothing either. Market odds are read only for the
  World Cup.
- **The CLI it needs.** The first CLI release after 0.11.2, whose `claudinho match <id> --json` carries its rows
  (`lines`, and its styled `rows`), its `attribution` and its `disclaimer`. With an older CLI the pane says
  `Nothing to show: the CLI's answer is not one this plugin reads.`
- **Not covered.** A pane opened without the command, hotkeys, a timeline on the band, the toasts or `/claudinho`'s
  reply. After the plugin reloads (changing an option reloads it), an open pane stays as it was drawn and reads again
  from the next `/claudinho match`.

## The `toasts` option

`pinned` (the default) toasts your pinned team's match (`claudinho follow <alias> --team <name>`); with no pin saved
it toasts nothing. `all` toasts every live match of the competition you follow; `off` none. It governs every toast:
the goals, the corrections, penalties and full time. Change it in `/config`.

## The `celebrate` option

`on` (the default) plays the goal and full-time celebrations; `off` plays nothing and drops a waiting celebration. The toasts are the
same either way. Change it in `/config`.

## The `context` option

`on` (the default) puts the live score beside each prompt you send while a match is live, for Claude to read; `off`
sends nothing with your prompts. The band, the toasts and the celebration are the same either way. Change it in
`/config`.

## Data and disclaimer

Live data: ESPN, read by the CLI, which keeps it in a local cache; the plugin reads the CLI's answer and nothing else.

Independent fan project. Not affiliated with FIFA, any confederation, league or club, or Anthropic.
