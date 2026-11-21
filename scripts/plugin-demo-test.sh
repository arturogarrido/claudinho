#!/usr/bin/env bash
# The plugin demo's kit tests, run against the demo as scripts/plugin-demo.sh assembles it from this checkout.
#
# packages/plugin-demo holds the demo's own files and no copy of a plugin file: scripts/plugin-demo.sh assembles it,
# the demo's module beside the plugin's drawing modules from this checkout. The kit lives in
# packages/plugin-demo-tests, laid out as the demo is (its files under hooks/). `claude plugin test <dir>` runs every
# *.test.ts and *.test.tsx under <dir> against the plugin <dir> holds, so this script has scripts/plugin-demo.sh
# assemble the demo into a new folder inside a temporary one (it keeps no list of its own of what the demo holds),
# refuses a kit entry that would replace an assembled one, copies the kit in, and runs it there with `claude` on PATH.
# A kit entry that is not a folder (a file or a link, a dangling link included) is refused where the assembled demo
# holds anything at its path; a kit folder is refused where the demo holds a file or a link there, and merges into a
# folder of the demo. The test files counted are every non-folder entry named *.test.ts or *.test.tsx, links included.
# The temporary folder is removed on exit. Its exit status is the kit's.
set -euo pipefail
# A shell that exports CDPATH makes `cd` look there first and print where it went: every `cd` below means the name given.
unset CDPATH

root=$(cd "$(dirname "$0")/.." && pwd)
kit="$root/packages/plugin-demo-tests"

refuse() { echo "plugin-demo-test: $1" >&2; exit 1; }

command -v claude >/dev/null 2>&1 || refuse "claude is not on PATH: the kit runs under \`claude plugin test\`, so nothing was run"
[ -d "$kit" ] || refuse "no kit at $kit"
tests=$(cd "$kit" && find . ! -type d \( -name '*.test.ts' -o -name '*.test.tsx' \) | wc -l | tr -d ' ')
[ "$tests" -gt 0 ] || refuse "no test file under $kit"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
# The demo first, assembled and validated alone by its own script, which prints the folder it made on stdout.
demo=$(bash "$root/scripts/plugin-demo.sh" "$tmp/claudinho-demo")
[ -f "$demo/.claude-plugin/plugin.json" ] || refuse "scripts/plugin-demo.sh printed no assembled demo (it printed: $demo)"

# `find` follows no link, so a link in the kit is listed as a non-folder entry, whatever it points at. The names are
# read whole (NUL-separated, no field splitting), and every loop body ends in an `if`, so a pass leaves status 0.
clash=$(cd "$kit" && {
  find . ! -type d -print0 | while IFS= read -r -d '' f; do
    if [ -e "$demo/$f" ] || [ -L "$demo/$f" ]; then echo "$f"; fi
  done
  find . -mindepth 1 -type d -print0 | while IFS= read -r -d '' f; do
    if [ -L "$demo/$f" ] || { [ -e "$demo/$f" ] && [ ! -d "$demo/$f" ]; }; then echo "$f/"; fi
  done
})
[ -z "$clash" ] || refuse "kit entries that would replace entries of the assembled demo: $clash"
cp -R "$kit/." "$demo/"

echo "plugin-demo-test: $tests test files from packages/plugin-demo-tests against the demo assembled by scripts/plugin-demo.sh" >&2
claude plugin test "$demo"
