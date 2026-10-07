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
#   1. the repository: the owner/name of `git remote get-url origin` (https or
#      ssh) must equal `gh repo view`'s, so gh reads the repository pushed to;
#   2. the local SHA: `git rev-parse --verify refs/heads/<branch>`, never HEAD;
#   3. before the push: the CI workflow's runs for the branch (`gh run list
#      --workflow ci.yml`); a gh failure refuses, and so does a run not yet
#      completed for ANOTHER SHA (the push would cancel it: wait for it, or
#      cancel it yourself);
#   4. the push: when `git ls-remote origin refs/heads/<branch>` already equals
#      the local SHA nothing is pushed and the run is only watched (re-running
#      the script after a timeout does this); else `git push origin <branch>`
#      (a failed push exits at once) and `git ls-remote` read back, which must
#      equal the local SHA;
#   5. the watch: the run list asked every PUSH_WATCH_POLL_SECONDS until the
#      deadline; the first (newest) line for the full local SHA is the run; a
#      completed run is read at once; a run still pending at the deadline exits
#      nonzero naming it; no run for the SHA exits nonzero naming the SHA and the
#      pull requests found for the branch, except with --allow-no-run when there
#      is none (CI runs on pull requests and on main): then it prints
#      `pushed; CI not verified (no pull request)` and exits 0;
#   6. the jobs (`gh run view <id>`): a table of the SHA read back and every job
#      with its conclusion, start, completion and duration. An empty job list, a
#      job with no conclusion, or any job not named `(non-gating)` whose
#      conclusion is not `success` exits nonzero.
#
# Every gh call is bounded (macOS has no `timeout`): it runs in the background,
# a watchdog kills it when the deadline passes, and a killed call is reported
# with the word "deadline". The deadline is a background `sleep` started first,
# so it is as exact as `sleep` (bash 3.2's $SECONDS counts whole seconds). The
# reads after the watch (a completed run's jobs, the pull request lookup after no
# run) get the time left or 30 seconds, whichever is longer. A run list cut at
# the deadline ends the watch on what the earlier answers showed. It never tags,
# merges or comments.
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
is_count "$TIMEOUT_MIN" || usage_error "--timeout: not a number of minutes: '$TIMEOUT_MIN'"
POLL=${PUSH_WATCH_POLL_SECONDS:-15}
is_count "$POLL" || usage_error "PUSH_WATCH_POLL_SECONDS: not a number of seconds: '$POLL'"
if [ -n "${PUSH_WATCH_TIMEOUT_SECONDS:-}" ]; then
  TIMEOUT=$PUSH_WATCH_TIMEOUT_SECONDS
  is_count "$TIMEOUT" || usage_error "PUSH_WATCH_TIMEOUT_SECONDS: not a number of seconds: '$TIMEOUT'"
else
  TIMEOUT=$((TIMEOUT_MIN * 60))
fi

# Cleanup on every exit: the deadline timer stopped and reaped (quietly: a
# reaped job is otherwise reported), the temporary directory removed. An
# interrupt ends the script through it (a script's background job ignores
# SIGINT, so the timer would otherwise outlive the script).
TIMER=""
WORK=""
cleanup() {
  if [ -n "$TIMER" ]; then kill "$TIMER" 2>/dev/null; wait "$TIMER" 2>/dev/null; fi
  if [ -n "$WORK" ]; then rm -rf "$WORK"; fi
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
# this script's output). A watchdog kills it when its bound passes: `deadline`,
# the deadline; `late`, the deadline or LATE_BOUND seconds from the call's start,
# whichever is later ($SECONDS is whole seconds: one more, so never shorter).
# Returns the command's own status, or 124 when the watchdog killed it.
probe() {
  local mode=$1 pid watchdog rc late_end=0
  shift
  if [ "$mode" = "late" ]; then late_end=$((SECONDS + LATE_BOUND + 1)); fi
  "$@" </dev/null >"$WORK/out" 2>"$WORK/err" &
  pid=$!
  (
    trap - EXIT INT TERM
    while kill -0 "$pid" 2>/dev/null; do
      if ! kill -0 "$TIMER" 2>/dev/null && [ "$SECONDS" -ge "$late_end" ]; then
        : >"$WORK/killed.$pid"
        kill "$pid" 2>/dev/null
        i=0
        while kill -0 "$pid" 2>/dev/null && [ $i -lt 100 ]; do sleep 0.02; i=$((i + 1)); done
        kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
        exit 0
      fi
      sleep 0.02
    done
  ) </dev/null >/dev/null 2>&1 &
  watchdog=$!
  wait "$pid" 2>/dev/null
  rc=$?
  kill "$watchdog" 2>/dev/null
  wait "$watchdog" 2>/dev/null
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

# 1. The repository.
origin_url=$(git remote get-url origin) || refuse "repository: git remote get-url origin failed"
repo=${origin_url%/}
repo=${repo%.git}
origin_name=${repo##*/}
repo=${repo%/*}
origin_owner=${repo##*[/:]}
if [ -z "$origin_owner" ] || [ -z "$origin_name" ] || [ "$origin_owner" = "$repo" ]; then
  refuse "repository: cannot read owner/name from origin's URL: $origin_url"
fi
origin_repo="$origin_owner/$origin_name"
probe deadline gh repo view --json nameWithOwner --jq=.nameWithOwner
rc=$?
[ $rc -eq 0 ] || probe_failed "gh repo view" $rc "nothing pushed"
gh_repo=""
read -r gh_repo <"$WORK/out" || true
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
if [ -z "$gh_repo" ] || [ "$(lower "$gh_repo")" != "$(lower "$origin_repo")" ]; then
  refuse "repository mismatch: origin is $origin_repo, gh resolves '$gh_repo'; nothing pushed"
fi
echo "repository  $origin_repo (origin and gh agree)"

# 2. The local SHA, from the branch's own ref.
local_sha=$(git rev-parse --verify "refs/heads/$BRANCH") || refuse "no local branch refs/heads/$BRANCH"
case "$local_sha" in
  *[!0-9a-f]*|'') refuse "git rev-parse returned '$local_sha' for refs/heads/$BRANCH" ;;
esac
if [ ${#local_sha} -ne 40 ] && [ ${#local_sha} -ne 64 ]; then
  refuse "git rev-parse returned '$local_sha' for refs/heads/$BRANCH"
fi
echo "branch      $BRANCH at $local_sha"

# The CI workflow's runs for the branch, newest first, one TSV line each: id,
# headSha, event, status, conclusion. Tabs become \037 so an empty field stays a
# field when read (a tab is whitespace to `read`, and runs of it collapse).
US=$(printf '\037')
list_runs() {
  probe deadline gh run list --workflow "$WORKFLOW" --branch "$BRANCH" --limit 20 \
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

# 4. The push, read back.
remote_line=$(git ls-remote origin "refs/heads/$BRANCH") || refuse "git ls-remote origin refs/heads/$BRANCH failed; nothing pushed"
remote_sha=$(printf '%s\n' "$remote_line" | head -n 1 | cut -f 1)
if [ "$remote_sha" = "$local_sha" ]; then
  echo "remote      origin/$BRANCH already at $local_sha: no push, watching only"
else
  git push origin "$BRANCH"
  rc=$?
  if [ $rc -ne 0 ]; then
    echo "push FAIL (git push origin $BRANCH exit $rc): nothing watched"
    exit 1
  fi
  remote_line=$(git ls-remote origin "refs/heads/$BRANCH") || refuse "git ls-remote origin refs/heads/$BRANCH failed after the push"
  remote_sha=$(printf '%s\n' "$remote_line" | head -n 1 | cut -f 1)
  if [ "$remote_sha" != "$local_sha" ]; then
    refuse "ls-remote mismatch after the push: origin/$BRANCH is '$remote_sha', local is $local_sha"
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
  probe late gh pr list --head "$BRANCH" --json number --jq=length
  rc=$?
  [ $rc -eq 0 ] || probe_failed "gh pr list" $rc "CI not verified"
  prs=""
  read -r prs <"$WORK/out" || true
  is_count "$prs" || refuse "gh pr list printed '$prs', not a count; CI not verified"
  echo "$prs pull request(s) found for $BRANCH"
  if [ "$ALLOW_NO_RUN" -eq 1 ] && [ "$prs" -eq 0 ]; then
    echo "pushed; CI not verified (no pull request)"
    exit 0
  fi
  exit 1
fi

# 6. The jobs.
probe late gh run view "$run_id" --json jobs \
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
