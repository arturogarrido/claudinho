#!/usr/bin/env bash
#
# gate.sh — CI's gating list, run locally, every step printing a verdict, and a
# commit only when every step printed ok.
#
# Why this exists: a gate typed by hand as `a && b && c | tail` stops at the
# first failure (so the later checks say nothing), prints nothing when a step
# fails, and takes its status from the LAST command of a pipe: a failing step
# read through `tail` reports success. Here every step runs whatever the others
# did, prints `<name> ok (Ns)` or `<name> FAIL (Ns)` from the command's OWN exit
# status (saved before any tail of its log is printed), and a FAIL line carries
# the last 20 lines of that step's log under it.
#
# The steps, in CI's order (`--list` prints them; a test reads ci.yml and fails
# on a gating step that is neither one of these nor a named exclusion):
#   build             pnpm -r build
#   typecheck         pnpm -r typecheck
#   test              pnpm -r test
#   lint              pnpm lint
#   stdio-smoke       pnpm -F @claudinho/mcp smoke:stdio
#   pack              node scripts/check-pack.mjs
#   statusline-smoke  node scripts/smoke-statusline.mjs
#   audit             pnpm audit --prod
#   qa-syntax         bash -n scripts/release-qa.sh
#   diff-check        git diff --check <base>
# It does not run `pnpm release:qa` and asks no live feed (its one network
# request is the audit's, to the npm registry), and it does not replace CI's
# Node 20, Windows and macOS jobs: the push watch (scripts/push-and-watch.sh)
# reads those on the pushed SHA.
#
# The audit step asks the registry. When it fails and its log carries a
# registry-unreachable signature (ENOTFOUND, ECONNREFUSED, ETIMEDOUT, EAI_AGAIN,
# "fetch failed", getaddrinfo) and no "N vulnerabilities found" line, its line
# is `audit SKIP (offline) (Ns)`: not a pass. Any other failure is FAIL.
#
# Usage:
#   scripts/gate.sh                          # every step
#   scripts/gate.sh --only build,test        # that subset, in the gate's order; never commits
#   scripts/gate.sh --list                   # <name><TAB><command> per step; runs nothing
#   scripts/gate.sh --base main              # the diff-check base (default origin/main)
#   scripts/gate.sh --commit <message-file> [--allow-offline-audit]
#
# --commit <message-file> commits what is STAGED, with `git commit -F` and no
# `git add`, only when every step printed ok. Before any step it refuses when a
# tracked file differs between the working tree and the index (`git diff
# --quiet`), when an untracked, not ignored file exists (the checks would read
# what no commit carries), and when nothing is staged; it records `git
# write-tree`, and after the steps asks the same questions again: a working
# tree, an untracked list or an index that changed during the gate refuses the
# commit. A FAIL refuses whatever the flags; the audit's SKIP refuses unless
# --allow-offline-audit, which the commit line then names. --only with --commit
# is refused before any step.
#
# Environment:
#   GATE_LOG_DIR  where each step's log is written (default $TMPDIR/claudinho-gate)
#   GATE_ROOT     the repository root to run in (default: this script's parent
#                 directory); a test seam
#
# Exit code: 0 when every step printed ok (and the commit, when asked, was made);
# 1 on any FAIL or SKIP, or a refused or failed commit; 2 on a usage error.

set -u

STEPS="build typecheck test lint stdio-smoke pack statusline-smoke audit qa-syntax diff-check"
BASE="origin/main"
ONLY=""
ONLY_GIVEN=0
LIST=0
COMMIT=0
COMMIT_MSG=""
ALLOW_OFFLINE_AUDIT=0

usage() {
  sed -n '/^# Usage:/,/^# --commit/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'
}
usage_error() {
  echo "gate: $1" >&2
  usage >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --list) LIST=1 ;;
    --only)
      [ $# -ge 2 ] || usage_error "--only needs a comma-separated list of steps"
      ONLY=$2; ONLY_GIVEN=1; shift ;;
    --only=*) ONLY=${1#--only=}; ONLY_GIVEN=1 ;;
    --base)
      [ $# -ge 2 ] || usage_error "--base needs a ref"
      BASE=$2; shift ;;
    --base=*) BASE=${1#--base=} ;;
    --commit)
      [ $# -ge 2 ] || usage_error "--commit needs a message file"
      COMMIT=1; COMMIT_MSG=$2; shift ;;
    --commit=*) COMMIT=1; COMMIT_MSG=${1#--commit=} ;;
    --allow-offline-audit) ALLOW_OFFLINE_AUDIT=1 ;;
    -h|--help) usage; exit 0 ;;
    *) usage_error "unknown argument: $1" ;;
  esac
  shift
done

# The base is spliced into the diff-check command that --list prints and the
# step runs, so it is held to a ref's characters.
case "$BASE" in
  ''|-*|*[!A-Za-z0-9._/@^~-]*) usage_error "--base: not a ref this script accepts: '$BASE'" ;;
esac

# The one table of commands: what --list prints is exactly what a step runs.
step_command() {
  case "$1" in
    build) echo "pnpm -r build" ;;
    typecheck) echo "pnpm -r typecheck" ;;
    test) echo "pnpm -r test" ;;
    lint) echo "pnpm lint" ;;
    stdio-smoke) echo "pnpm -F @claudinho/mcp smoke:stdio" ;;
    pack) echo "node scripts/check-pack.mjs" ;;
    statusline-smoke) echo "node scripts/smoke-statusline.mjs" ;;
    audit) echo "pnpm audit --prod" ;;
    qa-syntax) echo "bash -n scripts/release-qa.sh" ;;
    diff-check) echo "git diff --check $BASE" ;;
  esac
}

if [ "$LIST" -eq 1 ]; then
  for name in $STEPS; do printf '%s\t%s\n' "$name" "$(step_command "$name")"; done
  exit 0
fi

if [ "$ONLY_GIVEN" -eq 1 ]; then
  [ -n "$ONLY" ] || usage_error "--only needs at least one step"
  old_ifs=$IFS; IFS=,
  for name in $ONLY; do
    case " $STEPS " in
      *" $name "*) ;;
      *) IFS=$old_ifs; usage_error "--only: unknown step '$name' (steps: $STEPS)" ;;
    esac
  done
  IFS=$old_ifs
fi

# Refusals before any step: nothing below has run yet.
refuse_early() {
  echo "commit REFUSED ($1)"
  echo "gate: refused before any step; nothing ran"
  exit 1
}

if [ "$COMMIT" -eq 1 ] && [ "$ONLY_GIVEN" -eq 1 ]; then
  refuse_early "--only never commits"
fi

if [ "$COMMIT" -eq 1 ]; then
  # The message file is named relative to where the gate was called from.
  case "$COMMIT_MSG" in
    /*) ;;
    *) COMMIT_MSG="$PWD/$COMMIT_MSG" ;;
  esac
  [ -f "$COMMIT_MSG" ] && [ -s "$COMMIT_MSG" ] || refuse_early "no commit message in $COMMIT_MSG"
fi

ROOT="${GATE_ROOT:-}"
if [ -z "$ROOT" ]; then
  ROOT="$(cd "$(dirname "$0")/.." && pwd)" || { echo "gate: cannot find the repository root" >&2; exit 2; }
fi
cd "$ROOT" || { echo "gate: cannot enter $ROOT" >&2; exit 2; }

tmp_base=${TMPDIR:-/tmp}
LOG_DIR="${GATE_LOG_DIR:-${tmp_base%/}/claudinho-gate}"
mkdir -p "$LOG_DIR" || { echo "gate: cannot create the log directory $LOG_DIR" >&2; exit 2; }

# The working tree's three answers. Each function prints its answer and returns
# nonzero when git itself failed (an answer the gate cannot read is no answer).
unstaged_answer() {
  git diff --quiet
  local rc=$?
  case $rc in
    0) echo "none" ;;
    1) echo "changed" ;;
    *) echo "git diff --quiet failed (exit $rc)"; return 1 ;;
  esac
}
untracked_answer() {
  local out rc line list="" count=0
  out=$(git status --porcelain --untracked-files=normal)
  rc=$?
  if [ $rc -ne 0 ]; then echo "git status --porcelain failed (exit $rc)"; return 1; fi
  while IFS= read -r line; do
    case "$line" in
      '?? '*)
        count=$((count + 1))
        if [ $count -le 5 ]; then list="${list:+$list, }${line:3}"; fi ;;
    esac
  done <<EOF
$out
EOF
  if [ $count -gt 5 ]; then list="$list and $((count - 5)) more"; fi
  echo "$list"
}
tree_answer() {
  local out rc
  out=$(git write-tree)
  rc=$?
  if [ $rc -ne 0 ] || [ -z "$out" ]; then echo "git write-tree failed (exit $rc)"; return 1; fi
  echo "$out"
}

TREE_BEFORE=""
if [ "$COMMIT" -eq 1 ]; then
  answer=$(unstaged_answer) || refuse_early "$answer"
  [ "$answer" = "none" ] || refuse_early "unstaged changes: git diff --quiet reports a tracked file that differs from the index; stage it or stash it"
  answer=$(untracked_answer) || refuse_early "$answer"
  [ -z "$answer" ] || refuse_early "untracked files: $answer"
  git diff --cached --quiet
  rc=$?
  case $rc in
    0) refuse_early "nothing staged: git diff --cached --quiet reports no change to commit" ;;
    1) ;;
    *) refuse_early "git diff --cached --quiet failed (exit $rc)" ;;
  esac
  TREE_BEFORE=$(tree_answer) || refuse_early "$TREE_BEFORE"
fi

# A failed audit is offline only by a named signature, and never when the
# registry answered with findings.
audit_offline() {
  grep -E -q 'ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|getaddrinfo' "$1" &&
    ! grep -E -q '[0-9]+ vulnerabilit(y|ies) found' "$1"
}

N_OK=0
N_FAIL=0
N_SKIP=0
FAILED=""
SKIPPED=""
GATE_START=$SECONDS

for name in $STEPS; do
  if [ "$ONLY_GIVEN" -eq 1 ]; then
    case ",$ONLY," in
      *",$name,"*) ;;
      *) continue ;;
    esac
  fi
  cmd=$(step_command "$name")
  log="$LOG_DIR/$name.log"
  started=$SECONDS
  # The status is the command's own, saved here, before anything prints its log.
  ( eval "$cmd" ) >"$log" 2>&1 </dev/null
  rc=$?
  took=$((SECONDS - started))
  if [ $rc -eq 0 ]; then
    N_OK=$((N_OK + 1))
    printf '%s ok (%ss)\n' "$name" "$took"
    continue
  fi
  if [ "$name" = "audit" ] && audit_offline "$log"; then
    N_SKIP=$((N_SKIP + 1))
    SKIPPED="${SKIPPED:+$SKIPPED, }$name"
    printf '%s SKIP (offline) (%ss)\n' "$name" "$took"
  else
    N_FAIL=$((N_FAIL + 1))
    FAILED="${FAILED:+$FAILED, }$name"
    printf '%s FAIL (%ss)\n' "$name" "$took"
  fi
  echo "    exit $rc: $cmd; the last 20 lines of $log:"
  tail -n 20 "$log" | sed 's/^/    | /'
done

COMMIT_STATE="not asked"
if [ "$COMMIT" -eq 1 ]; then
  reason=""
  if [ $N_FAIL -gt 0 ]; then
    echo "commit REFUSED ($N_FAIL step(s) FAIL: $FAILED)"
    COMMIT_STATE="refused"
  else
    # The same three questions as before the steps: what the steps saw is what
    # would be committed only if none of the answers moved.
    answer=$(unstaged_answer)
    if [ $? -ne 0 ]; then reason="$answer"
    elif [ "$answer" != "none" ]; then reason="git diff --quiet now reports a tracked file that differs from the index"
    fi
    if [ -z "$reason" ]; then
      answer=$(untracked_answer)
      if [ $? -ne 0 ]; then reason="$answer"
      elif [ -n "$answer" ]; then reason="untracked files: $answer"
      fi
    fi
    if [ -z "$reason" ]; then
      answer=$(tree_answer)
      if [ $? -ne 0 ]; then reason="$answer"
      elif [ "$answer" != "$TREE_BEFORE" ]; then reason="git write-tree was $TREE_BEFORE, now $answer"
      fi
    fi
    if [ -n "$reason" ]; then
      echo "commit REFUSED (the tree changed during the gate: $reason)"
      COMMIT_STATE="refused"
    elif [ $N_SKIP -gt 0 ] && [ "$ALLOW_OFFLINE_AUDIT" -ne 1 ]; then
      echo "commit REFUSED (audit skipped offline; --allow-offline-audit to commit anyway)"
      COMMIT_STATE="refused"
    else
      git commit -F "$COMMIT_MSG"
      rc=$?
      if [ $rc -ne 0 ]; then
        echo "commit FAIL (git commit -F exit $rc)"
        COMMIT_STATE="failed"
      elif [ $N_SKIP -gt 0 ]; then
        echo "commit ok (--allow-offline-audit: the audit step was skipped offline, not verified)"
        COMMIT_STATE="made with --allow-offline-audit"
      else
        echo "commit ok"
        COMMIT_STATE="made"
      fi
    fi
  fi
fi

TOTAL=$((SECONDS - GATE_START))
summary="gate: $N_OK ok, $N_FAIL FAIL${FAILED:+ ($FAILED)}, $N_SKIP SKIP${SKIPPED:+ ($SKIPPED)} in ${TOTAL}s; logs in $LOG_DIR"
if [ "$COMMIT" -eq 1 ]; then summary="$summary; commit $COMMIT_STATE"; fi
echo "$summary"

if [ $N_FAIL -gt 0 ] || [ $N_SKIP -gt 0 ]; then exit 1; fi
case "$COMMIT_STATE" in
  refused|failed) exit 1 ;;
esac
exit 0
