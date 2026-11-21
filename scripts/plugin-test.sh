#!/usr/bin/env bash
# The Claude Code plugin's kit tests, run against the plugin as it ships.
#
# packages/plugin holds only what installs: Claude Code copies a plugin's whole folder when it installs it, and
# documents no file that leaves part of the folder out, so a test kept there would ship. The kit lives in
# packages/plugin-tests, laid out as the plugin is (its files under hooks/). `claude plugin test <dir>` runs every
# *.test.ts and *.test.tsx under <dir> against the plugin <dir> holds, so this script copies the plugin and the kit into
# one temporary folder, refusing a kit entry that would replace an entry of the plugin, and runs the kit there with
# `claude` on PATH. A kit entry that is not a folder (a file or a link, a dangling link included) is refused where the
# plugin holds anything at its path; a kit folder is refused where the plugin holds a file or a link there, and merges
# into a folder of the plugin. The test files counted are every non-folder entry named *.test.ts or *.test.tsx, links
# included. A refusal (no `claude` on PATH, no plugin, no kit, no test file, an entry that would replace one) exits 1
# before anything runs. The temporary folder is removed on exit. Otherwise its exit status is the kit's.
set -euo pipefail
# A shell that exports CDPATH makes `cd` look there first and print where it went: every `cd` below means the name given.
unset CDPATH

root=$(cd "$(dirname "$0")/.." && pwd)
plugin="$root/packages/plugin"
kit="$root/packages/plugin-tests"

refuse() { echo "plugin-test: $1" >&2; exit 1; }

command -v claude >/dev/null 2>&1 || refuse "claude is not on PATH: the kit runs under \`claude plugin test\`, so nothing was run"
[ -f "$plugin/.claude-plugin/plugin.json" ] || refuse "no plugin at $plugin"
[ -d "$kit" ] || refuse "no kit at $kit"
tests=$(cd "$kit" && find . ! -type d \( -name '*.test.ts' -o -name '*.test.tsx' \) | wc -l | tr -d ' ')
[ "$tests" -gt 0 ] || refuse "no test file under $kit"

# `find` follows no link, so a link in the kit is listed as a non-folder entry, whatever it points at. The names are
# read whole (NUL-separated, no field splitting), and every loop body ends in an `if`, so a pass leaves status 0.
clash=$(cd "$kit" && {
  find . ! -type d -print0 | while IFS= read -r -d '' f; do
    if [ -e "$plugin/$f" ] || [ -L "$plugin/$f" ]; then echo "$f"; fi
  done
  find . -mindepth 1 -type d -print0 | while IFS= read -r -d '' f; do
    if [ -L "$plugin/$f" ] || { [ -e "$plugin/$f" ] && [ ! -d "$plugin/$f" ]; }; then echo "$f/"; fi
  done
})
[ -z "$clash" ] || refuse "kit entries that would replace entries of the plugin: $clash"

dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
cp -R "$plugin/." "$dir/"
cp -R "$kit/." "$dir/"

echo "plugin-test: $tests test files from packages/plugin-tests against packages/plugin" >&2
claude plugin test "$dir"
