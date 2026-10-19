#!/usr/bin/env bash
# The Claude Code plugin's kit tests, run against the plugin as it ships.
#
# packages/plugin holds only what installs: Claude Code copies a plugin's whole folder when it installs it, and
# documents no file that leaves part of the folder out, so a test kept there would ship. The kit lives in
# packages/plugin-tests, laid out as the plugin is (its files under hooks/). `claude plugin test <dir>` runs every
# *.test.ts and *.test.tsx under <dir> against the plugin <dir> holds, so this script copies the plugin and the kit into
# one temporary folder, refusing a kit file that would replace a plugin file, and runs the kit there with `claude` on
# PATH. Its exit status is the kit's.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
plugin="$root/packages/plugin"
kit="$root/packages/plugin-tests"

[ -f "$plugin/.claude-plugin/plugin.json" ] || { echo "plugin-test: no plugin at $plugin" >&2; exit 1; }
tests=$(cd "$kit" && find . -type f \( -name '*.test.ts' -o -name '*.test.tsx' \) | wc -l | tr -d ' ')
[ "$tests" -gt 0 ] || { echo "plugin-test: no test file under $kit" >&2; exit 1; }
clash=$(cd "$kit" && find . -type f | while read -r f; do [ ! -e "$plugin/$f" ] || echo "$f"; done)
[ -z "$clash" ] || { echo "plugin-test: kit files that would replace plugin files: $clash" >&2; exit 1; }

dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
cp -R "$plugin/." "$dir/"
cp -R "$kit/." "$dir/"
echo "plugin-test: $tests test files from packages/plugin-tests against packages/plugin" >&2
claude plugin test "$dir"
