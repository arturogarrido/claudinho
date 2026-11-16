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
| `/demo pitch` | the pitch scene |
| `/demo idle` | the stadium, empty |
| `/demo live` | the stadium with its fans |
| `/demo goal` | the team's goal: six seconds, then live again |
| `/demo other` | the other team's goal |
| `/demo off` | clears the look |

If the real plugin's team look is on in that session, type `/claudinho theme off` first: a session holds one look.
After you change the plugin's drawing, run the script again into the same folder
(`bash scripts/plugin-demo.sh <folder>`) and reload the plugins.

## What it does not show

The plugin's own path from a real goal: its readings of the CLI, its memory of the match, the words of its toast.
The demo sets each drawing directly. Its toast says "Demo:" and carries this mod's name.

Not affiliated with FIFA, any confederation, league or club, or Anthropic.
