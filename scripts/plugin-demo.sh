#!/usr/bin/env bash
# The Claude Code plugin's demo: see what the plugin on this checkout DRAWS, in the Claude desktop app, with no match.
#
# packages/plugin-demo is a development mod (never installed with the plugin): one hooks module with a `/demo`
# command that sets the plugin's own pitch and stadium drawings as the session's look, and plays the plugin's goal and
# full-time celebration in the band above the prompt. It holds no copy of a plugin
# file. This script assembles the mod: the demo's files, with the plugin's drawing modules from THIS checkout copied
# beside its module, so the demo shows exactly what packages/plugin draws now.
#
#   bash scripts/plugin-demo.sh            assembles into a new temporary folder and prints it
#   bash scripts/plugin-demo.sh <folder>   makes <folder> and assembles into it; <folder> must not exist yet
#
# The script only ever writes into a folder it has just made. A name that is taken (a folder, a file, a link, an
# earlier copy of this demo) is refused, whatever it holds: nothing of yours is ever replaced, and there is nothing
# to check about what a folder holds. Its parent must exist.
#
# Then load the folder in a session of the desktop app (the scenes show in the desktop and mobile apps only; the
# celebration also plays in a terminal's band, as text art):
# start Claude Code with `--plugin-dir <folder>`, or name the folder in CLAUDE_CODE_PLUGIN_DIRS, and type `/demo`.
# After a change to the plugin's drawing, run this again (a new folder each time) and load that folder.
set -euo pipefail
# A shell that exports CDPATH makes `cd` look there first and print where it went: every `cd` below means the name given.
unset CDPATH

root=$(cd "$(dirname "$0")/.." && pwd)
demo="$root/packages/plugin-demo"
hooks="$root/packages/plugin/hooks"
# The plugin modules the demo's module imports, and what those import.
copies=(team-scenes.ts team-look.ts team-colors.ts make-colors.js make-colors.d.ts celebration.tsx)

[ -f "$demo/.claude-plugin/plugin.json" ] || { echo "plugin-demo: no demo at $demo" >&2; exit 1; }
for f in "${copies[@]}"; do
  [ -f "$hooks/$f" ] || { echo "plugin-demo: the plugin has no hooks/$f" >&2; exit 1; }
done

refuse() { echo "plugin-demo: $1" >&2; exit 1; }

if [ $# -ge 1 ]; then
  dest=$1
  # The name as its last entry: with a trailing slash or /. a mkdir follows a link that leads nowhere and makes its target.
  while :; do
    case "$dest" in
      */.) dest=${dest%/.} ;;
      */) dest=${dest%/} ;;
      *) break ;;
    esac
  done
  [ -n "$dest" ] || refuse "the folder's name is empty"
  # No .. in the name: through a linked folder, the folder a mkdir makes for a/../b is not the one `cd a/../b` reaches.
  case "/$dest/" in
    */../*) refuse "$1 holds a ..: name the folder directly" ;;
  esac
  # A relative name is made ./name: no command below reads it as an option, or as `-` (the previous directory, to cd).
  case "$dest" in
    /*) ;;
    *) dest=./$dest ;;
  esac
  # The folder is made here, by a mkdir that makes one folder and no parent: it fails on any name that is taken (a
  # link to a folder too) and on a path through a folder that does not exist.
  mkdir -- "$dest" 2>/dev/null || refuse "$1 is taken or cannot be made: name a folder that does not exist yet, in a folder that does"
else
  dest="$(mktemp -d)/claudinho-demo"
  mkdir -- "$dest"
fi

mkdir -- "$dest/.claude-plugin" "$dest/hooks"
cp -- "$demo/.claude-plugin/plugin.json" "$dest/.claude-plugin/plugin.json"
cp -- "$demo/hooks/hooks.json" "$demo/hooks/register.tsx" "$dest/hooks/"
for f in "${copies[@]}"; do cp -- "$hooks/$f" "$dest/hooks/$f"; done

version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$root/packages/plugin/.claude-plugin/plugin.json" | head -1)
if [ -n "${PLUGIN_DEMO_NO_VALIDATE:-}" ]; then
  echo "plugin-demo: not validated (PLUGIN_DEMO_NO_VALIDATE is set)" >&2
elif command -v claude >/dev/null 2>&1; then
  # The folder as an absolute path: a name that starts with a dash is never read by claude as an option.
  claude plugin validate "$(cd -- "$dest" && pwd)" >/dev/null || { echo "plugin-demo: the assembled demo does not validate (claude plugin validate $dest)" >&2; exit 1; }
  echo "plugin-demo: validated" >&2
else
  echo "plugin-demo: claude is not on PATH, so the demo was not validated" >&2
fi
echo "plugin-demo: the drawings of plugin $version, from $(cd "$root" && git rev-parse --short HEAD 2>/dev/null || echo 'this checkout'), assembled in:" >&2
# The folder as an absolute path: the line a person hands to --plugin-dir from any directory.
(cd -- "$dest" && pwd)
