#!/usr/bin/env bash
# The Claude Code plugin's demo: see what the plugin on this checkout DRAWS, in the Claude desktop app, with no match.
#
# packages/plugin-demo is a development mod (never installed with the plugin): one hooks module with a `/demo`
# command that sets the plugin's own pitch and stadium drawings as the session's look. It holds no copy of a plugin
# file. This script assembles the mod: the demo's files, with the plugin's drawing modules from THIS checkout copied
# beside its module, so the demo shows exactly what packages/plugin draws now.
#
#   bash scripts/plugin-demo.sh            assembles into a new temporary folder and prints it
#   bash scripts/plugin-demo.sh <folder>   assembles into <folder> (created if missing; refused if it holds
#                                          anything that is not an earlier copy of this demo)
#
# Then load the folder in a session of the desktop app (the drawings show in the desktop and mobile apps only):
# start Claude Code with `--plugin-dir <folder>`, or name the folder in CLAUDE_CODE_PLUGIN_DIRS, and type `/demo`.
# After a change to the plugin's drawing, run this again into the same folder and reload the plugins.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
demo="$root/packages/plugin-demo"
hooks="$root/packages/plugin/hooks"
# The plugin modules the demo's module imports, and what those import.
copies=(team-scenes.ts team-look.ts team-colors.ts make-colors.js make-colors.d.ts)

[ -f "$demo/.claude-plugin/plugin.json" ] || { echo "plugin-demo: no demo at $demo" >&2; exit 1; }
for f in "${copies[@]}"; do
  [ -f "$hooks/$f" ] || { echo "plugin-demo: the plugin has no hooks/$f" >&2; exit 1; }
done

if [ $# -ge 1 ]; then
  dest=$1
  if [ -e "$dest" ]; then
    [ -d "$dest" ] || { echo "plugin-demo: $dest is not a folder" >&2; exit 1; }
    if [ -n "$(ls -A "$dest")" ]; then
      grep -q '"name": "claudinho-demo"' "$dest/.claude-plugin/plugin.json" 2>/dev/null ||
        { echo "plugin-demo: $dest holds something that is not this demo; choose an empty folder" >&2; exit 1; }
    fi
  fi
else
  dest="$(mktemp -d)/claudinho-demo"
fi

mkdir -p "$dest/.claude-plugin" "$dest/hooks"
cp "$demo/.claude-plugin/plugin.json" "$dest/.claude-plugin/plugin.json"
cp "$demo/hooks/hooks.json" "$demo/hooks/register.tsx" "$dest/hooks/"
for f in "${copies[@]}"; do cp "$hooks/$f" "$dest/hooks/$f"; done

version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$root/packages/plugin/.claude-plugin/plugin.json" | head -1)
if command -v claude >/dev/null 2>&1; then
  claude plugin validate "$dest" >/dev/null || { echo "plugin-demo: the assembled demo does not validate (claude plugin validate $dest)" >&2; exit 1; }
  echo "plugin-demo: validated" >&2
else
  echo "plugin-demo: claude is not on PATH, so the demo was not validated" >&2
fi
echo "plugin-demo: the drawings of plugin $version, from $(cd "$root" && git rev-parse --short HEAD 2>/dev/null || echo 'this checkout'), assembled in:" >&2
echo "$dest"
