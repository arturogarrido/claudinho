#!/usr/bin/env bash
# Type-checks the Claude Code plugin's modules, and the demo's as scripts/plugin-demo.sh assembles it, against the
# ENGINE's TypeScript declarations (the `claude-code` module the modules import), which the caller supplies.
#
#   bash scripts/plugin-typecheck.sh <file>     the engine's `claude-code` declarations file (a .d.ts)
#   bash scripts/plugin-typecheck.sh <folder>   a folder that holds claude-code/index.d.ts (a mod's .claude-plugin/types,
#                                               copied whole: it may hold claude-code-tools/ and claude-code-mcp/ too)
#
# No command of the `claude` CLI writes the declarations: the engine lays them in a mod's .claude-plugin/types when it
# loads the mod, and the plugin-authoring skill writes a copy when it loads. So this script cannot find them itself,
# and CI, which loads no mod, cannot run it: it is run by hand, on a machine where the engine has written them. It
# prints the declarations' first line ("// Written by Claude Code <version>."), so the result says which build it was
# checked against.
#
# `tsc` comes from PATH (the script installs nothing), for example the workspace's own:
#   PATH="$PWD/packages/core/node_modules/.bin:$PATH" bash scripts/plugin-typecheck.sh <declarations>
#
# Two targets, both always checked, each in its own folder under one temporary folder (removed on exit; nothing is
# written into the checkout): the plugin (packages/plugin's hooks/ and types/ copied in) and the demo (assembled by
# scripts/plugin-demo.sh, not validated). Each gets the declarations in .claude-plugin/types/ and a tsconfig.json
# written here, and `tsc -p` runs in it, so its errors name files relative to the target (hooks/register.tsx(3,5): ...).
# Then one line per target: `plugin-typecheck: <target>: ok`, or `plugin-typecheck: <target>: failed (...)`. A refusal
# (no declarations, no tsc on PATH) exits 1 before any check; otherwise the status is 1 when either target failed, else 0.
set -euo pipefail
# A shell that exports CDPATH makes `cd` look there first and print where it went: every `cd` below means the name given.
unset CDPATH

root=$(cd "$(dirname "$0")/.." && pwd)
plugin="$root/packages/plugin"

refuse() { echo "plugin-typecheck: $1" >&2; exit 1; }

usage="give the engine's claude-code .d.ts, or a folder that holds claude-code/index.d.ts (a mod's .claude-plugin/types)"
[ $# -ge 1 ] || refuse "no declarations named: $usage"
[ $# -eq 1 ] || refuse "one argument, the declarations, and $# were given: $usage"
given=$1
decl_file=
decl_dir=
if [ -d "$given" ]; then
  [ -f "$given/claude-code/index.d.ts" ] || refuse "$given holds no claude-code/index.d.ts, so it holds no declarations: $usage"
  decl_dir=$given
  first="$given/claude-code/index.d.ts"
elif [ -f "$given" ]; then
  decl_file=$given
  first=$given
else
  refuse "no declarations at $given: $usage"
fi
command -v tsc >/dev/null 2>&1 || refuse "tsc is not on PATH: the check runs \`tsc -p\`, so nothing was checked"

echo "plugin-typecheck: the declarations at $given, whose first line reads: $(head -n 1 < "$first")" >&2

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# A target folder gets the declarations in .claude-plugin/types/ and the tsconfig. Each step is chained: a function
# called as a condition runs with errexit off.
equip() {
  mkdir -p -- "$1/.claude-plugin/types" &&
    if [ -n "$decl_dir" ]; then
      cp -R -- "$decl_dir/." "$1/.claude-plugin/types/"
    else
      mkdir -p -- "$1/.claude-plugin/types/claude-code" && cp -- "$decl_file" "$1/.claude-plugin/types/claude-code/index.d.ts"
    fi &&
    cat > "$1/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["es2023"],
    "types": [],
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "jsx": "react",
    "jsxFactory": "h",
    "jsxFragmentFactory": "Fragment"
  },
  "include": [".claude-plugin/types", "hooks", "types"]
}
JSON
}

failed=0
# One line per target; a failed one never reads "ok".
verdict() {
  if [ "$2" = ok ]; then
    echo "plugin-typecheck: $1: ok" >&2
  else
    echo "plugin-typecheck: $1: failed ($2)" >&2
    failed=1
  fi
}
# Runs tsc in a target folder, whose errors then name files relative to it; --pretty false keeps one form in a terminal
# and in a pipe.
check() {
  if (cd -- "$2" && tsc -p . --pretty false); then verdict "$1" ok; else verdict "$1" "tsc exited $?; its errors are above"; fi
}

# The plugin: its modules and its contract.
p="$tmp/plugin"
if mkdir -- "$p" && cp -R -- "$plugin/hooks" "$p/hooks" && cp -R -- "$plugin/types" "$p/types" && equip "$p"; then
  check plugin "$p"
else
  verdict plugin "its hooks/ and types/ could not be copied from packages/plugin, or the declarations put beside them"
fi

# The demo, assembled by its own script (which keeps the list of the plugin modules it copies) and not validated.
if demo=$(PLUGIN_DEMO_NO_VALIDATE=1 bash "$root/scripts/plugin-demo.sh" "$tmp/demo") && [ -f "$demo/.claude-plugin/plugin.json" ] && equip "$demo"; then
  check demo "$demo"
else
  verdict demo "scripts/plugin-demo.sh did not assemble it, or the declarations could not be put in it"
fi

exit "$failed"
