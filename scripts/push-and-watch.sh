#!/usr/bin/env bash
#
# push-and-watch.sh — push a branch, then read CI's per-job result on THAT SHA.
#
# Why this exists: a watch command that returns "success" proves nothing about
# the commit just pushed. `gh run watch` on a queued run returns at once; a run
# listed first may be another SHA's, or another workflow's on the same SHA; and
# a second push cancels the run in flight for the first (ci.yml cancels a
# superseded run on the same ref), which once hid a Windows-only failure. This
# script judges the CI workflow's NEWEST run for the FULL local SHA and prints
# every job's conclusion and times.
#
# Usage:
#   scripts/push-and-watch.sh <branch> [--timeout <min>] [--allow-no-run]
#
# In order, each refusal exiting nonzero before the next step:
#   1. the repository: HOST/OWNER/NAME read from `git remote get-url origin`
#      (`https://HOST/OWNER/NAME[.git][/]`, `http://...`,
#      `ssh://[user@]HOST[:port]/OWNER/NAME[.git]` or
#      `[user@]HOST:OWNER/NAME[.git]`; anything else refuses); every push URL
#      (`git remote get-url --push --all origin`, one per line: the fetch URL
#      when no pushurl is set) must read as the same HOST/OWNER/NAME (compared
#      without case, as GitHub names them), so the push and the reads name one
#      repository; `gh api --hostname HOST repos/OWNER/NAME` (REST: the
#      GraphQL-backed `gh repo view` is refused in some environments) must
#      answer the same OWNER/NAME, so gh reads the repository pushed to; every
#      later gh call is bound to it (`gh run ... -R HOST/OWNER/NAME`, `gh api
#      --hostname HOST`);
#   2. the branch: the argument must be a branch name (`git check-ref-format
#      --branch` prints it back unchanged) and a local branch (`git show-ref
#      --verify refs/heads/<branch>`); the local SHA is `git rev-parse --verify
#      refs/heads/<branch>`, never HEAD;
#   3. before the push: the CI workflow's runs for the branch (`gh run list -R
#      HOST/OWNER/NAME --workflow ci.yml`); a gh failure refuses, and so does a
#      run not yet completed for ANOTHER SHA (the push would cancel it: wait for
#      it, or cancel it yourself);
#   4. the push: the remote SHA is the first field of the one line of `git
#      ls-remote origin refs/heads/<branch>` whose ref is exactly
#      `refs/heads/<branch>` (ls-remote matches a pattern by its tail, so a tag or
#      a deeper branch ending in that name is listed too, and ignored; no such
#      line: the branch is absent remotely); when it already equals the local
#      SHA nothing is pushed and the run is only watched (re-running the script
#      after a timeout does this); else `git push origin
#      refs/heads/<branch>:refs/heads/<branch>` (both ends named; a failed push
#      exits at once) and `git ls-remote` read back the same way, which must
#      equal the local SHA;
#   5. the watch: the run list asked every PUSH_WATCH_POLL_SECONDS until the
#      deadline; the first (newest) line for the full local SHA is the run; a
#      completed run is read at once; a run still pending at the deadline exits
#      nonzero naming it; no run for the SHA exits nonzero naming the SHA and the
#      open pull requests found for the branch (`gh api --hostname HOST
#      repos/OWNER/NAME/pulls?state=open&head=OWNER:<branch>`), except with
#      --allow-no-run when there is none (CI runs on pull requests and on main):
#      then it prints `pushed; CI not verified (no pull request)` and exits 0;
#   6. the jobs (`gh run view -R HOST/OWNER/NAME <id>`): a table of the SHA read
#      back and every job with its conclusion, start, completion and duration.
#      An empty job list, a job with no conclusion, or any job not named
#      `(non-gating)` whose conclusion is not `success` exits nonzero.
#
# Every gh call is bounded (macOS has no `timeout`): it runs in the background,
# a watchdog kills it and its descendants when the deadline passes, and a killed
# call is reported with the word "deadline". The deadline is a background
# `sleep` started first, so it is as exact as `sleep` (bash 3.2's $SECONDS counts
# whole seconds). The reads after the watch (a completed run's jobs, the pull
# request lookup after no run) get the time left or 30 seconds, whichever is
# longer. A run list cut at the deadline ends the watch on what the earlier
# answers showed. Every process the script starts (the deadline timer, a gh call
# and its watchdog) is reaped with its descendants on every exit, an interrupt
# or a TERM included. A process is stopped by pids RECORDED to the leaves before
# the first signal (`pgrep -P` on the process, then on each pid found, at most
# 32 levels deep): TERM to each recorded descendant and to the process, a
# bounded wait, then KILL to each one still alive, so a child or a grandchild
# that ignores TERM under a parent that dies of it is still killed by its own
# pid. The recorded pids are written, before that first signal, to
# `tree.<pid>` in the temporary directory, one line, and the file is removed
# after the last KILL; a later stop of the same process takes in the pids of a
# file left there, and replaces it. A stop that does not finish leaves its file:
# when the script is TERMed while the watchdog waits on a call that ignores
# TERM, cleanup KILLs the watchdog (its file stays, naming the call's whole
# tree), then stops the call with those pids too (its own walk no longer finds a
# grandchild whose parent died of TERM). Cleanup then sends KILL to each pid
# still alive (`kill -0`) in any file left, and removes the temporary
# directory. It never tags, merges or comments.
#
# Options:
#   --timeout <min>   how long to wait for the run (default 30 minutes)
#   --allow-no-run    a branch with no pull request and no run is not a failure
#
# Environment (test seams):
#   PUSH_WATCH_POLL_SECONDS     seconds between run list polls (default 15)
#   PUSH_WATCH_TIMEOUT_SECONDS  the deadline in seconds; when set, overrides --timeout
#
# Exit code: 0 when every gating job concluded success (or no run was allowed);
# 1 on a refusal, a failed push, a run not verified or a job not success; 2 on a
# usage error.

set -u

WORKFLOW="ci.yml"
LATE_BOUND=30
BRANCH=""
TIMEOUT_MIN=30
ALLOW_NO_RUN=0

usage() {
  sed -n '/^# Usage:/,/^# In order/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'
}
usage_error() {
  echo "push-and-watch: $1" >&2
  usage >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --timeout)
      [ $# -ge 2 ] || usage_error "--timeout needs a number of minutes"
      TIMEOUT_MIN=$2; shift ;;
    --timeout=*) TIMEOUT_MIN=${1#--timeout=} ;;
    --allow-no-run) ALLOW_NO_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    -*) usage_error "unknown option: $1" ;;
    *)
      [ -z "$BRANCH" ] || usage_error "one branch only (got '$BRANCH' and '$1')"
      BRANCH=$1 ;;
  esac
  shift
done

[ -n "$BRANCH" ] || usage_error "a branch is required"
is_count() { case "$1" in ''|*[!0-9]*) return 1 ;; esac; return 0; }
# is_pid <text>: a pid as a record holds one (digits, no leading zero, above 1),
# so a token read back is never sent a signal as 0 or a negative number (kill
# reads those as a process group, -1 as every process) or as 1 (launchd).
is_pid() { case "$1" in ''|0*|1|*[!0-9]*) return 1 ;; esac; return 0; }
is_count "$TIMEOUT_MIN" || usage_error "--timeout: not a number of minutes: '$TIMEOUT_MIN'"
POLL=${PUSH_WATCH_POLL_SECONDS:-15}
is_count "$POLL" || usage_error "PUSH_WATCH_POLL_SECONDS: not a number of seconds: '$POLL'"
if [ -n "${PUSH_WATCH_TIMEOUT_SECONDS:-}" ]; then
  TIMEOUT=$PUSH_WATCH_TIMEOUT_SECONDS
  is_count "$TIMEOUT" || usage_error "PUSH_WATCH_TIMEOUT_SECONDS: not a number of seconds: '$TIMEOUT'"
else
  TIMEOUT=$((TIMEOUT_MIN * 60))
fi

# Every process this script starts is one of three, each held in a global
# while it runs: the deadline timer, a gh call (PROBE_PID) and its watchdog
# (WATCHDOG_PID). Cleanup on every exit reaps the watchdog, then the gh call,
# then the timer (each with its descendants, by recorded pids), sends KILL to
# each pid still alive in a record a stop left in place (stop_tree), and removes
# the temporary directory. An interrupt or a TERM ends the script through it (a
# script's background job ignores SIGINT, and a TERM to the script's pid reaches
# nothing else, so they would otherwise outlive the script).
TIMER=""
WORK=""
PROBE_PID=""
WATCHDOG_PID=""

# descendants_of <pid>: the pids of every descendant of the process, to the
# leaves: `pgrep -P` on the process, then on each pid found, level by level, at
# most MAX_DEPTH levels (a bound against a cycle that cannot exist, which costs
# nothing). Printed on one line, separated by spaces; nothing when none is.
MAX_DEPTH=32
descendants_of() {
  local level=$1 depth=0 next p found all=""
  while [ -n "$level" ] && [ $depth -lt $MAX_DEPTH ]; do
    next=""
    for p in $level; do
      found=$(pgrep -P "$p")
      [ -n "$found" ] && next="$next $found"
    done
    all="$all$next"
    level=$next
    depth=$((depth + 1))
  done
  echo $all
} 2>/dev/null

# stop_tree <pid> <tries>: stops a process this script started, with its
# descendants, by pids RECORDED to the leaves before the first signal
# (descendants_of: once a process is gone its children are re-parented and its
# pid no longer finds them, so a child, or a grandchild under a child, that
# ignores TERM would outlive it). Before the first signal the pids are written
# to $WORK/tree.<pid> ($pid, then each descendant, one line), replacing an
# earlier record for the same pid after taking in its pids: that record is a
# stop of this process that did not finish (a watchdog killed while it waited),
# and it names descendants this walk can no longer find. TERM to each recorded
# descendant and to the process; up to <tries> waits of 0.02s for the process to
# go; then KILL to each recorded descendant still alive (`kill -0`) and to the
# process if it is; then the record is removed (once a process is gone its pid
# may be given to another). A stop killed before its end leaves the record for
# the next stop of the same pid, and for cleanup. Quiet: bash otherwise reports
# a killed job.
stop_tree() {
  local pid=$1 tries=$2 i=0 desc k rec="" earlier=""
  [ -n "$pid" ] || return 0
  desc=$(descendants_of "$pid")
  if [ -n "$WORK" ] && [ -d "$WORK" ]; then
    rec="$WORK/tree.$pid"
    if [ -f "$rec" ]; then read -r earlier <"$rec"; fi
    for k in $earlier; do
      is_pid "$k" && [ "$k" != "$pid" ] || continue
      case " $desc " in *" $k "*) ;; *) desc="$desc $k" ;; esac
    done
    echo $pid $desc >"$rec"
  fi
  for k in $desc; do kill "$k"; done
  kill "$pid"
  while kill -0 "$pid" && [ $i -lt "$tries" ]; do sleep 0.02; i=$((i + 1)); done
  for k in $desc; do kill -0 "$k" && kill -9 "$k"; done
  kill -0 "$pid" && kill -9 "$pid"
  if [ -n "$rec" ]; then rm -f "$rec"; fi
  return 0
} 2>/dev/null

# reap <pid>: stop_tree, then the process waited for (it is this shell's child).
reap() {
  [ -n "$1" ] || return 0
  stop_tree "$1" 50
  wait "$1"
  return 0
} 2>/dev/null

cleanup() {
  local rec line k
  reap "$WATCHDOG_PID"; WATCHDOG_PID=""
  reap "$PROBE_PID"; PROBE_PID=""
  reap "$TIMER"; TIMER=""
  if [ -n "$WORK" ]; then
    # A record still here is a stop that did not finish and that no later stop
    # of its pid took in: KILL each pid it names that is still alive.
    for rec in "$WORK"/tree.*; do
      [ -f "$rec" ] || continue
      line=""
      read -r line <"$rec"
      for k in $line; do is_pid "$k" && kill -0 "$k" && kill -9 "$k"; done
    done 2>/dev/null
    rm -rf "$WORK"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# The deadline: a timer that exits when the time is up.
sleep "$TIMEOUT" </dev/null >/dev/null 2>&1 &
TIMER=$!
PASSED=0

cd "$(dirname "$0")/.." || { echo "push-and-watch: cannot enter the repository root" >&2; exit 2; }

tmp_base=${TMPDIR:-/tmp}
WORK=$(mktemp -d "${tmp_base%/}/push-watch.XXXXXX") || { WORK=""; echo "push-and-watch: cannot create a temporary directory" >&2; exit 2; }

refuse() {
  echo "REFUSED ($1)"
  exit 1
}

# True once the deadline has passed (latched: a finished timer's pid is never asked twice).
deadline_passed() {
  [ "$PASSED" -eq 1 ] && return 0
  kill -0 "$TIMER" 2>/dev/null && return 1
  PASSED=1
  return 0
}

# probe <deadline|late> <command...>: runs the command with no stdin, its stdout
# in $WORK/out and its stderr in $WORK/err (so nothing it leaves running holds
# this script's output). A watchdog stops it and its descendants (stop_tree)
# when its bound passes: `deadline`, the deadline; `late`, the deadline or
# LATE_BOUND seconds from the call's start, whichever is later ($SECONDS is
# whole seconds: one more, so never shorter). PROBE_PID and WATCHDOG_PID name
# the two while the call runs (cleanup reaps them on an exit in between) and are
# cleared when it returns.
# Returns the command's own status, or 124 when the watchdog killed it.
probe() {
  local mode=$1 pid rc late_end=0
  shift
  if [ "$mode" = "late" ]; then late_end=$((SECONDS + LATE_BOUND + 1)); fi
  "$@" </dev/null >"$WORK/out" 2>"$WORK/err" &
  PROBE_PID=$!
  pid=$PROBE_PID
  (
    trap - EXIT INT TERM
    while kill -0 "$pid" 2>/dev/null; do
      if ! kill -0 "$TIMER" 2>/dev/null && [ "$SECONDS" -ge "$late_end" ]; then
        : >"$WORK/killed.$pid"
        # From here the watchdog finishes what it started: the caller reaps it
        # (TERM) as soon as the call is gone, which must not land between the
        # TERM sent to a recorded descendant and the KILL it may still need.
        trap '' TERM
        stop_tree "$pid" 100
        exit 0
      fi
      sleep 0.02
    done
  ) </dev/null >/dev/null 2>&1 &
  WATCHDOG_PID=$!
  wait "$pid" 2>/dev/null
  rc=$?
  reap "$WATCHDOG_PID"
  WATCHDOG_PID=""
  PROBE_PID=""
  if [ -e "$WORK/killed.$pid" ]; then return 124; fi
  return $rc
}
# The first line of a probe's stderr, for a refusal.
probe_error() { head -n 1 "$WORK/err" 2>/dev/null; }
# Reports a probe's failure (the call named $1, its status $2, a note $3) and exits.
probe_failed() {
  if [ "$2" -eq 124 ]; then
    refuse "$1: killed at the deadline (${TIMEOUT}s)${3:+; $3}"
  fi
  refuse "$1 failed (exit $2): $(probe_error)${3:+; $3}"
}

# parse_origin <url>: sets REPO_HOST, REPO_OWNER and REPO_NAME from one of the
# four forms the header names; returns nonzero for anything else (a local path,
# file://, a host with credentials or a port in an https URL, a deeper path).
parse_origin() {
  local u=$1 rest authority path
  case "$u" in
    https://*/*|http://*/*)
      rest=${u#*://}
      authority=${rest%%/*}
      path=${rest#*/} ;;
    ssh://*/*)
      rest=${u#ssh://}
      authority=${rest%%/*}
      path=${rest#*/}
      authority=${authority#*@}
      authority=${authority%%:*} ;;
    *://*) return 1 ;;
    *:*)
      authority=${u%%:*}
      path=${u#*:}
      case "$authority" in */*) return 1 ;; esac
      authority=${authority#*@} ;;
    *) return 1 ;;
  esac
  path=${path%/}
  path=${path%.git}
  REPO_HOST=$authority
  REPO_OWNER=${path%%/*}
  REPO_NAME=${path#*/}
  [ "$REPO_NAME" != "$path" ] || return 1
  case "$REPO_HOST" in ''|*[!A-Za-z0-9.-]*) return 1 ;; esac
  case "$REPO_OWNER" in ''|*[!A-Za-z0-9._-]*) return 1 ;; esac
  case "$REPO_NAME" in ''|*[!A-Za-z0-9._-]*) return 1 ;; esac
  return 0
}

# repo_of <url>: HOST/OWNER/NAME of a URL (parse_origin in a subshell, so the
# globals stay the fetch URL's); nonzero when it is not one of the four forms.
repo_of() {
  parse_origin "$1" || return 1
  printf '%s/%s/%s' "$REPO_HOST" "$REPO_OWNER" "$REPO_NAME"
}
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
# shown_url <url>: the URL for a message, its userinfo (a token can ride there)
# replaced by `***` in a scheme://user[:password]@host form.
shown_url() {
  local u=$1 scheme rest auth
  case "$u" in
    *://*)
      scheme=${u%%://*}; rest=${u#*://}; auth=${rest%%/*}
      case "$auth" in
        *@*) printf '%s://***@%s%s' "$scheme" "${auth##*@}" "${rest#"$auth"}"; return 0 ;;
      esac ;;
  esac
  printf '%s' "$u"
}

# 1. The repository: HOST/OWNER/NAME, and every gh call below bound to it.
REPO_HOST=""
REPO_OWNER=""
REPO_NAME=""
origin_url=$(git remote get-url origin) || refuse "repository: git remote get-url origin failed"
parse_origin "$origin_url" ||
  refuse "repository: cannot read host/owner/name from origin's URL (https://, http://, ssh:// or [user@]host:owner/name); nothing pushed"
REPO="$REPO_HOST/$REPO_OWNER/$REPO_NAME"
# Every push URL names the same repository: `git push origin` uses them, the reads use the fetch URL's.
push_urls=$(git remote get-url --push --all origin) ||
  refuse "repository: git remote get-url --push --all origin failed; nothing pushed"
n_push=0
while IFS= read -r push_url; do
  [ -n "$push_url" ] || continue
  n_push=$((n_push + 1))
  push_repo=$(repo_of "$push_url") || push_repo=""
  if [ -z "$push_repo" ] || [ "$(lower "$push_repo")" != "$(lower "$REPO")" ]; then
    refuse "repository: origin's push URL $(shown_url "$push_url") is not $REPO; nothing pushed"
  fi
done <<EOF
$push_urls
EOF
[ "$n_push" -gt 0 ] || refuse "repository: origin has no push URL (git remote get-url --push --all origin printed nothing); nothing pushed"
probe deadline gh api --hostname "$REPO_HOST" "repos/$REPO_OWNER/$REPO_NAME" --jq=.full_name
rc=$?
[ $rc -eq 0 ] || probe_failed "gh api --hostname $REPO_HOST repos/$REPO_OWNER/$REPO_NAME" $rc "nothing pushed"
gh_repo=""
read -r gh_repo <"$WORK/out" || true
if [ -z "$gh_repo" ] || [ "$(lower "$gh_repo")" != "$(lower "$REPO_OWNER/$REPO_NAME")" ]; then
  refuse "repository mismatch: origin is $REPO, gh answers '$gh_repo' on $REPO_HOST; nothing pushed"
fi
echo "repository  $REPO (origin and gh agree)"

# 2. The branch: a branch name, an existing local branch, and its SHA from its own ref.
checked=$(git check-ref-format --branch "$BRANCH" 2>/dev/null) && [ "$checked" = "$BRANCH" ] ||
  refuse "branch: '$BRANCH' is not a branch name (git check-ref-format --branch); nothing pushed"
git show-ref --verify --quiet "refs/heads/$BRANCH" || refuse "no local branch refs/heads/$BRANCH; nothing pushed"
local_sha=$(git rev-parse --verify "refs/heads/$BRANCH") || refuse "no local branch refs/heads/$BRANCH; nothing pushed"
case "$local_sha" in
  *[!0-9a-f]*|'') refuse "git rev-parse returned '$local_sha' for refs/heads/$BRANCH" ;;
esac
if [ ${#local_sha} -ne 40 ] && [ ${#local_sha} -ne 64 ]; then
  refuse "git rev-parse returned '$local_sha' for refs/heads/$BRANCH"
fi
echo "branch      $BRANCH at $local_sha"

# urlencode <text>: the text percent-encoded byte by byte for a query value
# (letters, digits, `._~-` and `/` kept), so a branch name's `#`, `&`, `+` or `%`
# cannot end or change the pull-request query.
urlencode() {
  local LC_ALL=C
  local s=$1 out="" c v i
  for ((i = 0; i < ${#s}; i++)); do
    c=${s:i:1}
    case "$c" in
      [A-Za-z0-9._~/-]) out="$out$c" ;;
      *) v=$(printf '%d' "'$c"); out="$out$(printf '%%%02X' $((v & 255)))" ;;
    esac
  done
  printf '%s' "$out"
}

# The CI workflow's runs for the branch, newest first, one TSV line each: id,
# headSha, event, status, conclusion. Tabs become \037 so an empty field stays a
# field when read (a tab is whitespace to `read`, and runs of it collapse).
US=$(printf '\037')
list_runs() {
  probe deadline gh run list -R "$REPO" --workflow "$WORKFLOW" --branch "$BRANCH" --limit 20 \
    --json databaseId,headSha,event,status,conclusion \
    --jq='.[] | [.databaseId,.headSha,.event,.status,.conclusion] | @tsv'
  local rc=$?
  if [ $rc -eq 0 ]; then tr '\t' '\037' <"$WORK/out" >"$WORK/runs"; fi
  return $rc
}

# 3. Before the push: a run not yet completed for another SHA would be cancelled by it.
list_runs
rc=$?
[ $rc -eq 0 ] || probe_failed "gh run list" $rc "nothing pushed"
while IFS="$US" read -r id sha event status conclusion; do
  [ -n "$id" ] || continue
  if [ "$status" != "completed" ] && [ "$sha" != "$local_sha" ]; then
    refuse "run $id for $sha is $status: a push now would cancel it; wait for it or cancel it yourself; nothing pushed"
  fi
done <"$WORK/runs"

# remote_sha_of <ls-remote output>: the first field of the line whose second
# field is exactly refs/heads/<branch>; nothing when no line is (the branch is
# absent remotely). `git ls-remote` matches its pattern by the ref's tail, so a
# tag or a deeper branch whose name ends in refs/heads/<branch> is listed too,
# possibly first: it never stands for the branch.
TAB=$(printf '\t')
remote_sha_of() {
  local line
  while IFS= read -r line; do
    case "$line" in
      *"$TAB"*)
        if [ "${line#*$TAB}" = "refs/heads/$BRANCH" ]; then printf '%s' "${line%%$TAB*}"; return 0; fi ;;
    esac
  done <<EOF
$1
EOF
  return 0
}

# 4. The push, read back.
remote_line=$(git ls-remote origin "refs/heads/$BRANCH") || refuse "git ls-remote origin refs/heads/$BRANCH failed; nothing pushed"
remote_sha=$(remote_sha_of "$remote_line")
if [ -n "$remote_sha" ] && [ "$remote_sha" = "$local_sha" ]; then
  echo "remote      origin/$BRANCH already at $local_sha: no push, watching only"
else
  git push origin "refs/heads/$BRANCH:refs/heads/$BRANCH"
  rc=$?
  if [ $rc -ne 0 ]; then
    echo "push FAIL (git push origin refs/heads/$BRANCH:refs/heads/$BRANCH exit $rc): nothing watched"
    exit 1
  fi
  remote_line=$(git ls-remote origin "refs/heads/$BRANCH") || refuse "git ls-remote origin refs/heads/$BRANCH failed after the push"
  remote_sha=$(remote_sha_of "$remote_line")
  if [ "$remote_sha" != "$local_sha" ]; then
    refuse "ls-remote mismatch after the push: origin/$BRANCH is ${remote_sha:-absent (no line for refs/heads/$BRANCH)}, local is $local_sha"
  fi
  echo "pushed      origin/$BRANCH = $local_sha (read back with git ls-remote)"
fi

# 5. The watch. The run is the last ANSWERED poll's: a poll cut at the deadline changes nothing.
echo "watching    $WORKFLOW for $local_sha, up to ${TIMEOUT}s, every ${POLL}s"
run_id=""
run_status=""
run_event=""
run_conclusion=""
run_sha=""
seen=""
answered=0
while :; do
  list_runs
  rc=$?
  if [ $rc -eq 124 ]; then
    [ $answered -gt 0 ] || refuse "gh run list: killed at the deadline (${TIMEOUT}s) before any answer; CI not verified"
    echo "gh run list: the last poll was cut at the deadline (${TIMEOUT}s)"
    break
  fi
  [ $rc -eq 0 ] || probe_failed "gh run list" $rc "re-run this script to watch again (nothing is pushed twice)"
  answered=$((answered + 1))
  run_id=""
  while IFS="$US" read -r id sha event status conclusion; do
    if [ -n "$id" ] && [ "$sha" = "$local_sha" ]; then
      run_id=$id; run_sha=$sha; run_event=$event; run_status=$status; run_conclusion=$conclusion
      break
    fi
  done <"$WORK/runs"
  if [ -n "$run_id" ]; then
    if [ "$seen" != "$run_id $run_status" ]; then
      echo "run         $run_id ($run_event): $run_status"
      seen="$run_id $run_status"
    fi
    [ "$run_status" = "completed" ] && break
  fi
  deadline_passed && break
  # Wait the poll interval, in tenths, ending early at the deadline.
  i=0
  while [ $i -lt $((POLL * 10)) ] && ! deadline_passed; do sleep 0.1; i=$((i + 1)); done
  deadline_passed && break
done

if [ -z "$run_id" ] || [ "$run_status" != "completed" ]; then
  if [ -n "$run_id" ]; then
    echo "run $run_id for $local_sha still $run_status at the deadline (${TIMEOUT}s): CI not verified; re-run this script to watch again"
    exit 1
  fi
  echo "no run for $local_sha within ${TIMEOUT}s ($WORKFLOW on $BRANCH)"
  probe late gh api --hostname "$REPO_HOST" \
    "repos/$REPO_OWNER/$REPO_NAME/pulls?state=open&head=$REPO_OWNER:$(urlencode "$BRANCH")" --jq=length
  rc=$?
  [ $rc -eq 0 ] || probe_failed "gh api (the open pull requests for $BRANCH)" $rc "CI not verified"
  prs=""
  read -r prs <"$WORK/out" || true
  is_count "$prs" || refuse "gh api printed '$prs' for the open pull requests, not a count; CI not verified"
  echo "$prs open pull request(s) found for $BRANCH"
  if [ "$ALLOW_NO_RUN" -eq 1 ] && [ "$prs" -eq 0 ]; then
    echo "pushed; CI not verified (no pull request)"
    exit 0
  fi
  exit 1
fi

# 6. The jobs.
probe late gh run view -R "$REPO" "$run_id" --json jobs \
  --jq='.jobs[] | [.name,.conclusion,.startedAt,.completedAt] | @tsv'
rc=$?
[ $rc -eq 0 ] || probe_failed "gh run view $run_id" $rc "CI not verified"
echo "run $run_id ($run_event) on $run_sha: completed, ${run_conclusion:-no conclusion}"
if ! grep -q . "$WORK/out"; then
  echo "run $run_id: no jobs listed (an empty job list is not a green run)"
  exit 1
fi
# awk splits on each tab (a single-character FS other than space keeps empty
# fields); the durations are computed from the timestamps in awk (no GNU date).
awk '
BEGIN { FS = "\t" }
function epoch(ts,   y, m, d, era, yoe, doy, doe) {
  if (length(ts) < 19 || substr(ts, 5, 1) != "-" || substr(ts, 11, 1) != "T") return -1
  y = substr(ts, 1, 4) + 0; m = substr(ts, 6, 2) + 0; d = substr(ts, 9, 2) + 0
  y -= (m <= 2)
  era = int((y >= 0 ? y : y - 399) / 400)
  yoe = y - era * 400
  doy = int((153 * (m > 2 ? m - 3 : m + 9) + 2) / 5) + d - 1
  doe = yoe * 365 + int(yoe / 4) - int(yoe / 100) + doy
  return (era * 146097 + doe - 719468) * 86400 + substr(ts, 12, 2) * 3600 + substr(ts, 15, 2) * 60 + substr(ts, 18, 2)
}
$0 != "" {
  n++
  name[n] = $1; concl[n] = $2; start[n] = $3; done_at[n] = $4
  if (length($1) > w) w = length($1)
}
END {
  if (w < 3) w = 3
  fmt = "%-" w "s  %-11s  %-20s  %-20s  %s\n"
  printf fmt, "job", "conclusion", "started", "completed", "seconds"
  bad = 0; missing = 0
  for (i = 1; i <= n; i++) {
    s = epoch(start[i]); e = epoch(done_at[i])
    secs = (s >= 0 && e >= 0) ? e - s : "-"
    printf fmt, name[i], (concl[i] == "" ? "(none)" : concl[i]), (start[i] == "" ? "-" : start[i]), (done_at[i] == "" ? "-" : done_at[i]), secs
    if (concl[i] == "") { missing++; nolist = nolist (nolist == "" ? "" : ", ") name[i] }
    else if (index(name[i], "(non-gating)") == 0 && concl[i] != "success") { bad++; badlist = badlist (badlist == "" ? "" : ", ") name[i] " " concl[i] }
  }
  if (missing > 0) print missing " job(s) with no conclusion: " nolist
  if (bad > 0) print bad " gating job(s) not success: " badlist
  if (missing > 0) exit 3
  if (bad > 0) exit 1
  exit 0
}' "$WORK/out"
rc=$?
case $rc in
  0) echo "CI green on $local_sha (every gating job success)"; exit 0 ;;
  3) echo "CI not verified on $local_sha: a job has no conclusion"; exit 1 ;;
  *) echo "CI not green on $local_sha"; exit 1 ;;
esac
