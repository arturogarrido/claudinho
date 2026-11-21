#!/usr/bin/env bash
# The plugin demo's kit tests, run against the demo as scripts/plugin-demo.sh assembles it from this checkout.
#
# packages/plugin-demo holds the demo's own files and no copy of a plugin file: scripts/plugin-demo.sh assembles it,
# the demo's module beside the plugin's drawing modules from this checkout. The kit lives in
# packages/plugin-demo-tests, laid out as the demo is (its files under hooks/). `claude plugin test <dir>` runs every
# *.test.ts and *.test.tsx under <dir> against the plugin <dir> holds, so this script has scripts/plugin-demo.sh
# assemble the demo into a new folder inside a temporary one (it keeps no list of its own of what the demo holds) and
# validate it strictly (the demo's type-check, under the `claude` on PATH), checks the kit, copies the kit in, validates
# that folder strictly once more, and runs the kit there with `claude` on PATH.
#
# The second validation is the kit's type-check: `claude plugin validate <folder> --strict`, on a folder that holds the
# demo and its kit, reports a type error in a test file of the kit as a warning, and --strict fails on a warning.
# scripts/plugin-strict-control.sh is its control: it fails unless the validator refuses a type error written into a
# test file of a copy of the plugin's kit.
#
# It refuses a kit that holds a symbolic link anywhere (to a file, to a folder, or to nothing): `claude plugin test`
# runs regular files only, so a linked test file would be copied and never run, and a link elsewhere would be copied
# as it is (`cp -R` copies a link, not what it names). The test files counted are the regular files named *.test.ts or
# *.test.tsx, one per entry (NUL-terminated, so a name that holds a newline counts once). It refuses, too, a kit entry
# that would replace an assembled one: a kit entry that is not a folder (a file or a link, a dangling link included) is
# refused where the assembled demo holds anything at its path; a kit folder is refused where the demo holds a file or
# a link there, and merges into a folder of the demo. The links are refused beside that check, once the demo is
# assembled, so a link that would also replace an entry is named on both lines. A refusal exits 1 before the kit runs:
# no `claude` on PATH, no kit, no test file, a demo that does not assemble or validate, a link or an entry that would
# replace one, before the kit is copied; and, once it is copied, a demo with its kit that does not validate strictly,
# whatever the validator's status (its report is printed on stderr). The temporary folder is removed on exit.
# Otherwise its exit status is the kit's.
set -euo pipefail
# A shell that exports CDPATH makes `cd` look there first and print where it went: every `cd` below means the name given.
unset CDPATH
# scripts/plugin-demo.sh skips its validation when this variable is set to a value that is not empty: a shell that
# exports it must not skip the demo's type-check here.
unset PLUGIN_DEMO_NO_VALIDATE

root=$(cd "$(dirname "$0")/.." && pwd)
kit="$root/packages/plugin-demo-tests"

refuse() { echo "plugin-demo-test: $1" >&2; exit 1; }

command -v claude >/dev/null 2>&1 || refuse "claude is not on PATH: the kit runs under \`claude plugin test\`, so nothing was run"
[ -d "$kit" ] || refuse "no kit at $kit"
# One NUL per entry, and the NULs counted: a name that holds a newline is one file, not two.
tests=$(cd "$kit" && find . -type f \( -name '*.test.ts' -o -name '*.test.tsx' \) -print0 | LC_ALL=C tr -dc '\0' | wc -c | tr -d ' ')
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
[ -z "$links" ] || echo "plugin-demo-test: kit entries that are symbolic links (claude plugin test runs regular files only, so a linked test file would be copied and never run): $links" >&2
[ -z "$clash" ] || echo "plugin-demo-test: kit entries that would replace entries of the assembled demo: $clash" >&2
[ -z "$links$clash" ] || exit 1
cp -R "$kit/." "$demo/"

# The demo with its kit, validated strictly before the kit runs: that is the kit's type-check. $demo is the absolute
# folder scripts/plugin-demo.sh printed, so claude never reads it as an option. The validator writes its report on
# stdout; both streams are kept, and shown only when the validation fails, whatever its status.
if ! report=$(claude plugin validate "$demo" --strict 2>&1); then
  printf '%s\n' "$report" >&2
  refuse "the demo with its kit does not validate strictly (claude plugin validate --strict on the folder that holds both, the report above), so no test was run"
fi
echo "plugin-demo-test: the demo with its kit validated (strictly: the kit's type-check)" >&2

echo "plugin-demo-test: $tests test files from packages/plugin-demo-tests against the demo assembled by scripts/plugin-demo.sh" >&2
claude plugin test "$demo"
