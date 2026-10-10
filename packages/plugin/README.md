# Claudinho for Claude Code ⚽

Live football in Claude Code for the competition you follow: the score or the countdown above the prompt, a toast
when a score changes, and the live score beside your prompt for the model. The plugin reads everything from the
installed `claudinho` CLI (`claudinho ambient --json`, the CLI's local cache) and never fetches anything itself.

## Install

The plugin runs the `claudinho` command, so install the CLI and choose a competition first:

```bash
npm i -g @claudinho/cli
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
option if you want another value than the default. The plugin is active in that session from then on.

## What it does, and what it does not promise

- **The band** above the prompt shows the line `claudinho prompt` prints: the live score, or the countdown to the
  next fixture. It shows nothing when nothing is chosen or nothing is known yet, and it shows the end of an edition.
  It runs the CLI every 15 seconds (every five minutes on the two idle lines), which is also what keeps the CLI's
  cache fresh. The CLI fits the line to the band's width and keeps its `+N` count of other matches; the engine cuts
  anything wider. A headless session (`claude -p`, the SDK) runs nothing.
- **The toasts** say a score change the plugin observed between two of its runs, as `⚽` and the hook's line for the
  match (`⚽ Arsenal 2–1 Chelsea (67')`). Best effort, never every goal: a change the plugin did not see between two
  current views (the first sight of a match, a stale or failed read, a change of competition) is silent.
- **The context**: while a match is live, each prompt you submit carries the hook's live-score block beside it, for
  the model, from the plugin's last run (never a run on submit), and only while that run is recent and its scores are
  inside their display window.

## The `toasts` option

`pinned` (the default) toasts your pinned team's match (`claudinho follow <alias> --team <name>`); with no pin saved
it toasts nothing. `all` toasts every live match of the competition you follow; `off` none. Change it in `/config`.

## Data and disclaimer

Live data: ESPN, read by the CLI, which keeps it in a local cache; the plugin reads the CLI's answer and nothing else.

Independent fan project. Not affiliated with FIFA, any confederation, league or club, or Anthropic.
