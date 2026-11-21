#!/usr/bin/env bash
# The control for the strict validations of the Claude Code plugin: a type error the validator must refuse, in a module
# of the plugin and in a test file of its kit.
#
# CI's plugin job validates packages/plugin with `claude plugin validate --strict`, and that line is the plugin's
# type-check only while the validator reports a type error in a hooks module (or in what it imports) and strict mode
# fails on it. scripts/plugin-test.sh and scripts/plugin-demo-test.sh validate a folder that holds a plugin with its kit
# the same way before the kit runs, and that validation is the kit's type-check only while the validator also reads the
# kit's test files. A validator that stopped type-checking, or stopped reading test files, would leave those lines green
# and saying nothing, so this script is their negative control. Under one temporary folder (removed on exit; nothing is
# written into the checkout) it makes four copies: packages/plugin as it is; packages/plugin with the line
#
#   export const strictControl: number = null
#
# appended to hooks/celebration.tsx, an error only strict null checks catch; the plugin with its kit
# (packages/plugin-tests copied over it, as scripts/plugin-test.sh does) as it is; and the plugin with its kit with the
# same line appended to the kit's hooks/band.test.tsx. It validates them strictly, in that order, under the `claude` on PATH, and stops at the
# first that fails. Each copy as it is must pass: a refusal of the copy with the error proves nothing while the copy
# without it is refused too. Each copy with the error must be refused, and for the error it planted: the validator's
# report must hold one line with `error TS2322`, `'null'` and `'number'` in it (the planted line gives "error TS2322:
# Type 'null' is not assignable to type 'number'."); a refusal for any other reason, another type error included,
# proves nothing about strict null checks, or about the test file being read. The fourth copy is what proves that the
# validator reads a kit's test files, which is what makes the two kit scripts' validation a type-check. Anything else
# exits 1, the validator's report on stderr where there is one: no `claude` on PATH, no plugin, no kit, a module or a
# test file missing to write the error into, a copy as it is refused, a copy with the error passed, or refused with no
# such line in its report (another type error, or none). On success it prints two lines, each quoting the line it
# found (the module's, then the test file's), and exits 0.
set -euo pipefail
# A shell that exports CDPATH makes `cd` look there first and print where it went: every `cd` below means the name given.
unset CDPATH

root=$(cd "$(dirname "$0")/.." && pwd)
plugin="$root/packages/plugin"
kit="$root/packages/plugin-tests"
control='export const strictControl: number = null'

refuse() { echo "plugin-strict-control: $1" >&2; exit 1; }
# The planted error's own line in a report: its code, and the two types it names, without its indentation; empty when
# the report holds none. Words matched as they are written (-F).
planted_line() {
  local line
  line=$(grep -F 'error TS2322' <<<"$1" | grep -F "'null'" | grep -F -m 1 "'number'" || true)
  printf '%s' "${line#"${line%%[![:space:]]*}"}"
}

command -v claude >/dev/null 2>&1 || refuse "claude is not on PATH: the control runs \`claude plugin validate --strict\`, so nothing was validated"
[ -f "$plugin/.claude-plugin/plugin.json" ] || refuse "no plugin at $plugin"
[ -f "$plugin/hooks/celebration.tsx" ] || refuse "the plugin has no hooks/celebration.tsx to write the type error into"
[ -d "$kit" ] || refuse "no kit at $kit: the control writes the type error into a test file of the plugin's kit too"
# A regular file in a regular folder: the line is appended to the copy, and through a link it would reach whatever the
# link names, a file of the checkout included.
if [ -L "$kit/hooks" ] || [ -L "$kit/hooks/band.test.tsx" ] || [ ! -f "$kit/hooks/band.test.tsx" ]; then
  refuse "the kit at $kit has no hooks/band.test.tsx (a regular file, in a folder that is no link) to write the type error into"
fi

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
found=$(planted_line "$report")
if [ -z "$found" ]; then
  printf '%s\n' "$report" >&2
  refuse "the validator refused the copy with the type error, but its report (above) holds no error TS2322 line naming 'null' and 'number': the planted error was not reported, so the refusal proves nothing about strict null checks"
fi

# The plugin with its kit, copied as scripts/plugin-test.sh copies them: the plugin, then the kit over it.
kit_as_is="$tmp/kit-as-is"
kit_with_error="$tmp/kit-with-error"
mkdir -- "$kit_as_is" "$kit_with_error"
cp -R "$plugin/." "$kit_as_is/"
cp -R "$kit/." "$kit_as_is/"
cp -R "$plugin/." "$kit_with_error/"
cp -R "$kit/." "$kit_with_error/"
# The test file kept whole, the line after its own text, whether or not it ends with a newline.
printf '\n%s\n' "$control" >> "$kit_with_error/hooks/band.test.tsx"

if ! report=$(claude plugin validate "$kit_as_is" --strict 2>&1); then
  printf '%s\n' "$report" >&2
  refuse "the plugin with its kit as it is does not validate strictly (the report above), so a refusal of the copy with the type error in a test file would prove nothing"
fi

if report=$(claude plugin validate "$kit_with_error" --strict 2>&1); then
  refuse "the validator did not refuse the copy of the plugin with its kit with \`$control\` in the test file hooks/band.test.tsx: it reads no test file under this claude, so the kit scripts' strict validation is not the kit's type-check"
fi
kit_found=$(planted_line "$report")
if [ -z "$kit_found" ]; then
  printf '%s\n' "$report" >&2
  refuse "the validator refused the copy of the plugin with its kit with the type error in a test file, but its report (above) holds no error TS2322 line naming 'null' and 'number': the planted error was not reported, so the refusal proves nothing about the validator reading test files"
fi

echo "plugin-strict-control: the validator refused the type error in a copy of the plugin, strictly: $found"
echo "plugin-strict-control: the validator refused the type error in a test file of the plugin's kit, strictly: $kit_found"
