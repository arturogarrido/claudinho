#!/usr/bin/env bash
# The Claude Code plugin's demo: see what the plugin on this checkout DRAWS, in the Claude desktop app, with no match.
#
# packages/plugin-demo is a development mod (never installed with the plugin): one hooks module with a `/demo`
# command that sets the plugin's own pitch and stadium drawings as the session's look. It holds no copy of a plugin
# file. This script assembles the mod: the demo's files, with the plugin's drawing modules from THIS checkout copied
# beside its module, so the demo shows exactly what packages/plugin draws now.
#
#   bash scripts/plugin-demo.sh            assembles into a new temporary folder and prints it
#   bash scripts/plugin-demo.sh <folder>   assembles into <folder> (created if missing; refused, before anything is
#                                          written, if it is a link or holds a link or any entry that is not this
#                                          demo's; the types the app lays beside a loaded mod are left alone)
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

refuse() { echo "plugin-demo: $1" >&2; exit 1; }
# Whether <folder>/<entry> is one this script writes, or one the app writes beside a loaded mod.
ours() {
  case "$1" in
    ./.claude-plugin | ./.claude-plugin/plugin.json | ./hooks | ./hooks/hooks.json | ./hooks/register.tsx | ./tsconfig.json) return 0 ;;
  esac
  for f in "${copies[@]}"; do [ "$1" = "./hooks/$f" ] && return 0; done
  return 1
}

if [ $# -ge 1 ]; then
  dest=$1
  # The name as its last entry: a trailing slash or /. would make the checks below follow a link instead of seeing it.
  while :; do
    case "$dest" in
      */.) dest=${dest%/.} ;;
      */) dest=${dest%/} ;;
      *) break ;;
    esac
  done
  [ -n "$dest" ] || refuse "the folder's name is empty"
  if [ -e "$dest" ] || [ -L "$dest" ]; then
    # A link is never written through: a folder linked into the checkout would have its files replaced.
    [ ! -L "$dest" ] || refuse "$dest is a link; choose a folder"
    [ -d "$dest" ] || refuse "$dest is not a folder"
    [ ! -L "$dest/.claude-plugin/types" ] || refuse "$dest/.claude-plugin/types is a link; choose an empty folder"
    # Every entry is this demo's (the types the app lays under .claude-plugin/types are its own and are not read),
    # and none is a link. One that is not stops the run before anything is written.
    strange=$(cd -- "$dest" && find . -mindepth 1 -path ./.claude-plugin/types -prune -o -print0 | while IFS= read -r -d '' e; do
      if [ -L "$e" ]; then
        printf '%s (a link)\n' "$e"
      elif ! ours "$e"; then
        printf '%s\n' "$e"
      elif [ "$e" = ./.claude-plugin ] || [ "$e" = ./hooks ]; then
        [ -d "$e" ] || printf '%s (not a folder)\n' "$e"
      elif [ ! -f "$e" ]; then
        printf '%s (not a plain file)\n' "$e"
      elif [ -n "$(find "$e" -maxdepth 0 -links +1)" ]; then
        # A second name for the same file somewhere else: writing here would write there.
        printf '%s (a hard link)\n' "$e"
      fi
    done)
    # The first one is named (the whole list is read first: a reader that stops early would end the pipe with an error).
    [ -z "$strange" ] || refuse "$dest holds something that is not this demo: ${strange%%$'\n'*}; choose an empty folder"
    if [ -n "$(ls -A -- "$dest")" ]; then
      grep -q -e '"name": "claudinho-demo"' -- "$dest/.claude-plugin/plugin.json" 2>/dev/null ||
        refuse "$dest holds something that is not this demo; choose an empty folder"
    fi
  fi
else
  dest="$(mktemp -d)/claudinho-demo"
fi

mkdir -p -- "$dest/.claude-plugin" "$dest/hooks"
cp -- "$demo/.claude-plugin/plugin.json" "$dest/.claude-plugin/plugin.json"
cp -- "$demo/hooks/hooks.json" "$demo/hooks/register.tsx" "$dest/hooks/"
for f in "${copies[@]}"; do cp -- "$hooks/$f" "$dest/hooks/$f"; done

version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$root/packages/plugin/.claude-plugin/plugin.json" | head -1)
if [ -n "${PLUGIN_DEMO_NO_VALIDATE:-}" ]; then
  echo "plugin-demo: not validated (PLUGIN_DEMO_NO_VALIDATE is set)" >&2
elif command -v claude >/dev/null 2>&1; then
  claude plugin validate "$dest" >/dev/null || { echo "plugin-demo: the assembled demo does not validate (claude plugin validate $dest)" >&2; exit 1; }
  echo "plugin-demo: validated" >&2
else
  echo "plugin-demo: claude is not on PATH, so the demo was not validated" >&2
fi
echo "plugin-demo: the drawings of plugin $version, from $(cd "$root" && git rev-parse --short HEAD 2>/dev/null || echo 'this checkout'), assembled in:" >&2
# The folder as an absolute path: the line a person hands to --plugin-dir from any directory.
(cd -- "$dest" && pwd)
