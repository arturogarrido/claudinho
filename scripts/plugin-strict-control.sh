#!/usr/bin/env bash
# The control for CI's strict validation of the Claude Code plugin: a type error the validator must refuse.
#
# CI's plugin job validates packages/plugin with `claude plugin validate --strict`, and that line is the plugin's
# type-check only while the validator reports a type error in a hooks module (or in what it imports) and strict mode
# fails on it. A validator that stopped type-checking would leave the strict lines green and saying nothing, so this
# script is their negative control. Under one temporary folder (removed on exit; nothing is written into the
# checkout) it makes two copies of packages/plugin: one as it is, and one with the line
#
#   export const strictControl: number = null
#
# appended to hooks/celebration.tsx, an error only strict null checks catch. It validates both strictly under the
# `claude` on PATH. The copy as it is must pass: a refusal of the other copy proves nothing about the error while the
# plugin itself is refused. The copy with the error must be refused, and for the error it planted: the validator's
# report must hold one line with `error TS2322`, `'null'` and `'number'` in it (the planted line gives "error TS2322:
# Type 'null' is not assignable to type 'number'."); a refusal for any other reason, another type error included,
# proves nothing about strict null checks. Anything else exits 1, the validator's report on stderr where there is one:
# no `claude` on PATH, the copy as it is refused, the copy with the error passed, or refused with no such line in its
# report (another type error, or none). On success it prints one line quoting the line it found, and exits 0.
set -euo pipefail
# A shell that exports CDPATH makes `cd` look there first and print where it went: every `cd` below means the name given.
unset CDPATH

root=$(cd "$(dirname "$0")/.." && pwd)
plugin="$root/packages/plugin"
control='export const strictControl: number = null'

refuse() { echo "plugin-strict-control: $1" >&2; exit 1; }

command -v claude >/dev/null 2>&1 || refuse "claude is not on PATH: the control runs \`claude plugin validate --strict\`, so nothing was validated"
[ -f "$plugin/.claude-plugin/plugin.json" ] || refuse "no plugin at $plugin"
[ -f "$plugin/hooks/celebration.tsx" ] || refuse "the plugin has no hooks/celebration.tsx to write the type error into"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
# The folders as absolute paths: a name that starts with a dash is never read by claude as an option.
tmp=$(cd -- "$tmp" && pwd)
as_is="$tmp/as-is"
with_error="$tmp/with-error"
mkdir -- "$as_is" "$with_error"
cp -R "$plugin/." "$as_is/"
cp -R "$plugin/." "$with_error/"
# On a line of its own, whether or not the module ends with a newline.
printf '\n%s\n' "$control" >> "$with_error/hooks/celebration.tsx"

# The validator writes its report on stdout; both streams are kept, and shown only when the control fails.
if ! report=$(claude plugin validate "$as_is" --strict 2>&1); then
  printf '%s\n' "$report" >&2
  refuse "the plugin as it is does not validate strictly (the report above), so a refusal of the copy with the type error would prove nothing"
fi

if report=$(claude plugin validate "$with_error" --strict 2>&1); then
  refuse "the validator did not refuse the copy with \`$control\` in hooks/celebration.tsx: strict validation is not the plugin's type-check under this claude"
fi
# The planted error's own line: its code, and the two types it names. Words matched as they are written (-F).
found=$(grep -F 'error TS2322' <<<"$report" | grep -F "'null'" | grep -F -m 1 "'number'" || true)
if [ -z "$found" ]; then
  printf '%s\n' "$report" >&2
  refuse "the validator refused the copy with the type error, but its report (above) holds no error TS2322 line naming 'null' and 'number': the planted error was not reported, so the refusal proves nothing about strict null checks"
fi
# The line it found, without its indentation.
found=${found#"${found%%[![:space:]]*}"}
echo "plugin-strict-control: the validator refused the type error in a copy of the plugin, strictly: $found"
