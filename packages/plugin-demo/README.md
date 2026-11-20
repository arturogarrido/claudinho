# The plugin's demo (development only)

A small Claude Code mod that shows the Claudinho plugin's own drawings in the Claude desktop app on a `/demo`
command, with no match needed. It exists so a change to what the plugin draws is seen in the app before it merges.
It is not part of the plugin, is not listed in the marketplace file, and is never installed with it.

## Use it

```bash
bash scripts/plugin-demo.sh
```

The script prints a folder. It holds this mod with the plugin's drawing modules from your checkout copied beside
it, so the demo draws what `packages/plugin` draws now. Load that folder in a session of the desktop app (start
Claude Code with `--plugin-dir <folder>`, or name the folder in `CLAUDE_CODE_PLUGIN_DIRS`), then type:

| Command | What it shows |
|---|---|
| `/demo spain` (or `mexico`, `italy`, `argentina`, `pumas`, `arsenal`) | that team's stadium, live |
| `/demo band` | the band of the team's two colors across the top (the default scene) |
| `/demo pitch` | the pitch scene |
| `/demo idle` | the stadium, empty |
| `/demo live` | the stadium with its fans |
| `/demo goal` | the team's goal: six seconds, then live again |
| `/demo other` | the other team's goal |
| `/demo mascot` | the goal celebration, played in the band above the prompt for 3 seconds: the Claude mascot beside the ball crossing the top row, the goal word and the team, and a demo scorer; in the desktop app the mascot is drawn as shapes, in a terminal as text art; it needs three spare rows in the band |
| `/demo fulltime` | the full-time celebration, played in the band above the prompt for 5 seconds: the mascot beside `Full time · <team> win`, drawn as `/demo mascot` draws it |
| `/demo left` | the stadium at the bottom left, mirrored (the plugin's `teamScenePlace: left`), from then on; shows it live |
| `/demo right` | the stadium at the bottom right again (the default); shows it live |
| `/demo en` (or `es`, `pt`, `fr`) | the goal's word on the scoreboard from then on: `GOAL!` (GOOOAL), `¡GOL!` and `GOL!` (GOOOL), `BUT !` (BUUUT); `/demo goal` shows it |
| `/demo off` | clears the look, and ends a celebration that is playing |

If the real plugin's team look is on in that session, type `/claudinho theme off` first: a session holds one look.
After you change the plugin's drawing, run the script again and load the folder it prints: it makes a new folder each
time, and never writes into one that exists (`bash scripts/plugin-demo.sh <folder>` wants a name that is not taken).

## What it does not show

The plugin's own path from a real goal: its readings of the CLI, its memory of the match, the words of its toast.
The demo sets each drawing directly. Its toast says "Demo:" and carries this mod's name.
Nor when the plugin plays its celebration (the hold while Claude works, the 60-second drop, full time queued behind a
goal), or the plugin's own line under it: the demo plays the celebration at once, in this mod's own row of the band,
over a fixed demo line.

Not affiliated with FIFA, any confederation, league or club, or Anthropic.
