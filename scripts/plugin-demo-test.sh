#!/usr/bin/env bash
# The plugin demo's kit tests, run against the demo as scripts/plugin-demo.sh assembles it from this checkout.
#
# packages/plugin-demo holds the demo's own files and no copy of a plugin file: scripts/plugin-demo.sh assembles it,
# the demo's module beside the plugin's drawing modules from this checkout. The kit lives in
# packages/plugin-demo-tests, laid out as the demo is (its files under hooks/). `claude plugin test <dir>` runs every
# *.test.ts and *.test.tsx under <dir> against the plugin <dir> holds, so this script has scripts/plugin-demo.sh
# assemble the demo into a new folder inside a temporary one (it keeps no list of its own of what the demo holds),
# refuses a kit file that would replace an assembled file, copies the kit in, and runs it there with `claude` on PATH.
# The temporary folder is removed on exit. Its exit status is the kit's.
set -euo pipefail
# A shell that exports CDPATH makes `cd` look there first and print where it went: every `cd` below means the name given.
unset CDPATH

root=$(cd "$(dirname "$0")/.." && pwd)
kit="$root/packages/plugin-demo-tests"

refuse() { echo "plugin-demo-test: $1" >&2; exit 1; }

command -v claude >/dev/null 2>&1 || refuse "claude is not on PATH: the kit runs under \`claude plugin test\`, so nothing was run"
[ -d "$kit" ] || refuse "no kit at $kit"
tests=$(cd "$kit" && find . -type f \( -name '*.test.ts' -o -name '*.test.tsx' \) | wc -l | tr -d ' ')
[ "$tests" -gt 0 ] || refuse "no test file under $kit"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
# The demo first, assembled and validated alone by its own script, which prints the folder it made on stdout.
demo=$(bash "$root/scripts/plugin-demo.sh" "$tmp/claudinho-demo")
[ -f "$demo/.claude-plugin/plugin.json" ] || refuse "scripts/plugin-demo.sh printed no assembled demo (it printed: $demo)"

clash=$(cd "$kit" && find . -type f | while read -r f; do [ ! -e "$demo/$f" ] && [ ! -L "$demo/$f" ] || echo "$f"; done)
[ -z "$clash" ] || refuse "kit files that would replace files of the assembled demo: $clash"
cp -R "$kit/." "$demo/"

echo "plugin-demo-test: $tests test files from packages/plugin-demo-tests against the demo assembled by scripts/plugin-demo.sh" >&2
claude plugin test "$demo"
