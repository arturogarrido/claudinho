#!/usr/bin/env bash
# The plugin demo's kit tests, run against the demo as scripts/plugin-demo.sh assembles it from this checkout.
#
# packages/plugin-demo holds the demo's own files and no copy of a plugin file: scripts/plugin-demo.sh assembles it,
# the demo's module beside the plugin's drawing modules from this checkout. The kit lives in
# packages/plugin-demo-tests, laid out as the demo is (its files under hooks/). `claude plugin test <dir>` runs every
# *.test.ts and *.test.tsx under <dir> against the plugin <dir> holds, so this script has scripts/plugin-demo.sh
# assemble the demo into a new folder inside a temporary one (it keeps no list of its own of what the demo holds) and
# validate it strictly (the demo's type-check, under the `claude` on PATH), checks the kit, copies the kit in, and runs
# it there with `claude` on PATH.
#
# It refuses a kit that holds a symbolic link anywhere (to a file, to a folder, or to nothing): `claude plugin test`
# runs regular files only, so a linked test file would be counted and never run, and a link elsewhere would be copied
# as it is (`cp -R` copies a link, not what it names). With links refused, the test files counted are the regular files
# named *.test.ts or *.test.tsx. It refuses, too, a kit entry that would replace an assembled one: a kit entry that is
# not a folder (a file or a link, a dangling link included) is refused where the assembled demo holds anything at its
# path; a kit folder is refused where the demo holds a file or a link there, and merges into a folder of the demo. The
# links are refused beside that check, once the demo is assembled, so a link that would also replace an entry is named
# on both lines. A refusal (no `claude` on PATH, no kit, no test file, a demo that does not assemble or validate, a
# link, an entry that would replace one) exits 1 before the kit is copied or run. The temporary folder is removed on
# exit. Otherwise its exit status is the kit's.
set -euo pipefail
# A shell that exports CDPATH makes `cd` look there first and print where it went: every `cd` below means the name given.
unset CDPATH
# scripts/plugin-demo.sh skips its validation when this variable is set: a shell that exports it must not skip the
# demo's type-check here.
unset PLUGIN_DEMO_NO_VALIDATE

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

# `find` follows no link: a link is listed as itself (`-type l`, and `! -type d` below), whatever it points at, and a
# linked folder is not entered. Every entry is listed, a name that starts with a dot included. In the clash check the
# names are read whole (NUL-separated, no field splitting), and every loop body ends in an `if`, so a pass leaves
# status 0.
links=$(cd "$kit" && find . -type l)
clash=$(cd "$kit" && {
  find . ! -type d -print0 | while IFS= read -r -d '' f; do
    if [ -e "$demo/$f" ] || [ -L "$demo/$f" ]; then echo "$f"; fi
  done
  find . -mindepth 1 -type d -print0 | while IFS= read -r -d '' f; do
    if [ -L "$demo/$f" ] || { [ -e "$demo/$f" ] && [ ! -d "$demo/$f" ]; }; then echo "$f/"; fi
  done
})
[ -z "$links" ] || echo "plugin-demo-test: kit entries that are symbolic links (claude plugin test runs regular files only, so a linked test would be counted and never run): $links" >&2
[ -z "$clash" ] || echo "plugin-demo-test: kit entries that would replace entries of the assembled demo: $clash" >&2
[ -z "$links$clash" ] || exit 1
cp -R "$kit/." "$demo/"

echo "plugin-demo-test: $tests test files from packages/plugin-demo-tests against the demo assembled by scripts/plugin-demo.sh" >&2
claude plugin test "$demo"
