/**
 * `scripts/push-and-watch.sh`: the push rule as code (PR A, the process made executable). Run OFFLINE under
 * stub `git` and `gh` on a hermetic PATH; every stub records its calls, so "no `git push` ran" and "no
 * `gh run` call after a failed push" are read from the record.
 *
 * The contract pinned here (the draft's "Tracked", revision 3, and the round-1 fix list of PR #157):
 *   - the repository is HOST/OWNER/NAME read from `origin`'s URL (https, ssh://, scp-like; anything else refused);
 *     `gh api --hostname <host> repos/<owner>/<name>` (REST: the GraphQL-backed `gh repo view` is refused in some
 *     environments) must answer the same owner/name, else refuse before anything; every later gh call is bound to
 *     that repository (`-R host/owner/name`, or `gh api --hostname`); the pull-request count is a REST read too;
 *   - the branch argument is a branch NAME (`git check-ref-format --branch`, measured with the host's git) and an
 *     existing local branch (`git show-ref --verify`); the local SHA is `refs/heads/<branch>`, never HEAD; the push
 *     names both ends (`refs/heads/<b>:refs/heads/<b>`), so an argument that is a revision expression never pushes;
 *   - a `gh` failure is a refusal before the push; a run queued/in progress for ANOTHER SHA refuses the push;
 *   - the remote already equal to the local SHA: no push, only the watch; else push, read `ls-remote` back,
 *     refuse on a mismatch; a failed push is nonzero at once, nothing watched;
 *   - the CI workflow's NEWEST run for the full local SHA is the one judged (two runs for the SHA: the first listed);
 *     a completed run is read at once; a run for another SHA never counts; every probe is bounded by the deadline;
 *     in_progress at the deadline is nonzero naming the run, distinct from "no run";
 *   - the per-job table from `gh run view` (name, conclusion, started, completed, duration); an empty job list
 *     or a job without a conclusion is nonzero; any non-`(non-gating)` job not `success` is nonzero;
 *   - strict by default: no run is nonzero naming the SHA and the PR lookup; `--allow-no-run` with no PR exits
 *     0 with `pushed; CI not verified (no pull request)`;
 *   - every process the script starts is reaped with its descendants, by pids RECORDED to the leaves before the
 *     first signal (a child, or a grandchild, that ignores TERM under a parent that dies of it is killed by its own pid): at the deadline and on a TERM
 *     to the script's own pid (the probe, its child and the work directory are gone after);
 *   - the remote ref is matched by its exact name (`git ls-remote` matches a tail); every push URL of origin must be
 *     the fetch URL's repository.
 * Test seams, documented in the script: PUSH_WATCH_POLL_SECONDS and PUSH_WATCH_TIMEOUT_SECONDS.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMON_HOST_TOOLS, hostTool, makeSandbox, parses, pidAlive, runScript, type Sandbox, startScript, until } from './hermetic-shell';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const SCRIPT = join(ROOT, 'scripts/push-and-watch.sh');
const HOST = [...COMMON_HOST_TOOLS, 'kill', 'pkill', 'pgrep'] as const;
const HOST_GIT = hostTool('git');
const LOCAL = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

/**
 * The stubs answer from `$STATE`:
 *   local-sha (default LOCAL) · remote-sha (default OTHER: the branch is behind) · push-fails · origin-url (default
 *   the https github.com URL) · no-branch (show-ref fails) · repo (the REST answer's full_name, default
 *   arturogarrido/claudinho) · gh-fails · hang (gh run list starts a child `sleep 30`, writes its pid to gh-child,
 *   and writes hang-finished only if that sleep COMPLETED) · pr-count (default 0)
 *   runs.<n>.tsv: the run list the n-th `gh run list` call prints (id, headSha, event, status, conclusion);
 *   the highest n available answers every later call · jobs-<id>.tsv: the jobs `gh run view … <id>` prints
 *   (name, conclusion, startedAt, completedAt). Every answer is TSV: the script asks `gh --jq` for TSV.
 * `git check-ref-format` is delegated to the host's git: the branch-name grammar is measured, not re-implemented.
 */
const STUBS = {
  git: `
case "$1" in
  rev-parse) [ -e "$STATE/local-sha" ] && cat "$STATE/local-sha" || echo ${LOCAL}; exit 0 ;;
  remote)
    # get-url origin: the fetch URL; get-url --push --all origin: the push URL(s), the fetch URL unless $STATE/push-url
    fetch=$([ -e "$STATE/origin-url" ] && cat "$STATE/origin-url" || echo "https://github.com/arturogarrido/claudinho.git")
    case "$*" in
      *--push*) [ -e "$STATE/push-url" ] && cat "$STATE/push-url" || echo "$fetch"; exit 0 ;;
      *) echo "$fetch"; exit 0 ;;
    esac ;;
  check-ref-format) shift; exec "${HOST_GIT}" check-ref-format "$@" ;;
  show-ref) [ -e "$STATE/no-branch" ] && exit 1; exit 0 ;;
  ls-remote)
    # a decoy line FIRST when $STATE/ls-remote-decoy exists: a deeper ref whose name ends in the asked pattern (git
    # matches the tail); with $STATE/ls-remote-absent-first the FIRST call prints the decoy alone (the branch absent)
    n=$(( $(cat "$STATE/ls-remote-calls" 2>/dev/null || echo 0) + 1 )); echo $n > "$STATE/ls-remote-calls"
    [ -e "$STATE/ls-remote-decoy" ] && printf '%s\\trefs/heads/archive/%s\\n' "${LOCAL}" "$3"
    if [ -e "$STATE/ls-remote-absent-first" ] && [ "$n" -le 1 ]; then printf '%s\\trefs/tags/%s\\n' "${LOCAL}" "$3"; exit 0; fi
    sha=$([ -e "$STATE/remote-sha" ] && cat "$STATE/remote-sha" || echo ${OTHER}); printf '%s\\t%s\\n' "$sha" "$3"; exit 0 ;;
  push) [ -e "$STATE/push-fails" ] && { echo "error: failed to push some refs" >&2; exit 1; }; [ -e "$STATE/remote-sha" ] || echo ${LOCAL} > "$STATE/remote-sha"; exit 0 ;;
esac
exit 0
`,
  gh: `
[ -e "$STATE/gh-fails" ] && { echo "gh: HTTP 502" >&2; exit 1; }
case "$1 $2" in
  "api "*)
    path=""; for a in "$@"; do case "$a" in repos/*) path=$a ;; esac; done
    case "$path" in
      *"/pulls?"*) [ -e "$STATE/pr-count" ] && cat "$STATE/pr-count" || echo 0; exit 0 ;;
      repos/*) [ -e "$STATE/repo" ] && cat "$STATE/repo" || echo "arturogarrido/claudinho"; exit 0 ;;
    esac
    echo "gh: unknown api path '$path'" >&2; exit 1 ;;
  "run list")
    if [ -e "$STATE/hang" ]; then sleep 30 & echo $! > "$STATE/gh-child"; wait $! && : > "$STATE/hang-finished"; fi
    # hang-ignore-term: the child IGNORES TERM (inherited across exec) while this parent dies of it
    if [ -e "$STATE/hang-ignore-term" ]; then ( trap '' TERM; exec sleep 30 ) & echo $! > "$STATE/gh-child"; wait $! && : > "$STATE/hang-finished"; fi
    # hang-grandchild: a helper (dies of TERM) whose own child ignores TERM; the grandchild's pid in gh-grandchild
    if [ -e "$STATE/hang-grandchild" ]; then ( ( trap '' TERM; exec sleep 30 ) & echo $! > "$STATE/gh-grandchild"; wait ) & echo $! > "$STATE/gh-child"; wait $! && : > "$STATE/hang-finished"; fi
    # hang-grandchild-ignore: the same tree, and this gh ignores TERM too, AFTER forking the helper (the helper still
    # dies of TERM; gh then becomes a sleep that keeps ignoring it): the watchdog's wait on gh lasts its full tries,
    # the window a TERM to the script can land in
    if [ -e "$STATE/hang-grandchild-ignore" ]; then ( ( trap '' TERM; exec sleep 30 ) & echo $! > "$STATE/gh-grandchild"; wait ) & echo $! > "$STATE/gh-child"; trap '' TERM; wait $!; exec sleep 30; fi
    n=$(( $(cat "$STATE/runs-calls" 2>/dev/null || echo 0) + 1 )); echo $n > "$STATE/runs-calls"
    while [ $n -gt 0 ] && [ ! -e "$STATE/runs.$n.tsv" ]; do n=$((n-1)); done
    [ $n -gt 0 ] && cat "$STATE/runs.$n.tsv"; exit 0 ;;
  "run view")
    id=""; for a in "$@"; do case "$a" in ''|*[!0-9]*) ;; *) id=$a ;; esac; done
    [ -e "$STATE/jobs-$id.tsv" ] && cat "$STATE/jobs-$id.tsv"; exit 0 ;;
esac
exit 0
`,
};
const RUN = (id: string, sha: string, status: string, conclusion: string, event = 'pull_request') => `${id}\t${sha}\t${event}\t${status}\t${conclusion}\n`;
const JOBS_OK = ['build · typecheck · test (Node 22)', 'audit (shipped deps)', 'coverage (non-gating)']
  .map((n) => `${n}\tsuccess\t2026-10-07T04:00:00Z\t2026-10-07T04:01:20Z\n`).join('');
const BOUND = 'github.com/arturogarrido/claudinho';

function sandbox(): Sandbox {
  return makeSandbox(STUBS, HOST, 'watch-');
}
function seed(sb: Sandbox, files: Record<string, string>) {
  for (const [k, v] of Object.entries(files)) writeFileSync(join(sb.state, k), v);
}
function runBranch(sb: Sandbox, branch: string, args: string[], env: Record<string, string> = {}) {
  return runScript(SCRIPT, [branch, ...args], sb, { PUSH_WATCH_POLL_SECONDS: '0', PUSH_WATCH_TIMEOUT_SECONDS: '3', ...env }, { cwd: ROOT, timeout: 30000 });
}
function run(sb: Sandbox, args: string[], env: Record<string, string> = {}) {
  return runBranch(sb, 'feature/x', args, env);
}
const pushed = (sb: Sandbox) => sb.calls().some((c) => /^git push /.test(c));
const ghCalls = (sb: Sandbox) => sb.calls().filter((c) => c.startsWith('gh '));
// A pid file is READY when it holds a positive integer: the stub writes `echo $! > file` after starting the
// process, and a helper's own child writes its file beside it, so one file can exist before the other, or exist
// empty, when the test looks (CI on the 0.11.2 release commit: ENOENT on `gh-child` while `gh-grandchild` was
// already there). A read that is not a positive integer throws: `process.kill(0)` would signal this group.
const pidReady = (sb: Sandbox, file: string): boolean => {
  try {
    const n = Number(readFileSync(join(sb.state, file), 'utf8').trim());
    return Number.isInteger(n) && n > 0;
  } catch {
    return false;
  }
};
const pidIn = (sb: Sandbox, file: string) => {
  const n = Number(readFileSync(join(sb.state, file), 'utf8').trim());
  if (!(Number.isInteger(n) && n > 0)) throw new Error(`${file}: not a pid: ${JSON.stringify(readFileSync(join(sb.state, file), 'utf8'))}`);
  return n;
};
const workDirs = (sb: Sandbox) => readdirSync(sb.dir).filter((n) => n.startsWith('push-watch.'));

describe.skipIf(process.platform === 'win32')('scripts/push-and-watch.sh, run offline under stub git and gh', () => {
  it('exists and parses whole (bash -n), bash 3.2 and BSD tools only, no jq, no node', () => {
    expect(existsSync(SCRIPT), 'scripts/push-and-watch.sh').toBe(true);
    expect(parses(SCRIPT)).toBe(0);
    const text = readFileSync(SCRIPT, 'utf8');
    for (const forbidden of ['mapfile', 'declare -A', 'date -d', 'readarray', '\\bjq ', 'node ']) expect(text).not.toMatch(new RegExp(forbidden));
    expect(text).toContain('--jq');
  });

  it('a repository mismatch (gh answers another owner/name for origin) refuses before anything', () => {
    const sb = sandbox();
    seed(sb, { repo: 'someone/else\n' });
    const r = run(sb, []);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/repository/i);
    expect(pushed(sb)).toBe(false);
  });

  it('the repository is host + owner + name: a GHE origin binds every gh call to that host', () => {
    const sb = sandbox();
    seed(sb, { 'origin-url': 'https://ghe.example/arturogarrido/claudinho.git\n', 'remote-sha': LOCAL, 'runs.1.tsv': RUN('5', LOCAL, 'completed', 'success'), 'jobs-5.tsv': JOBS_OK });
    const r = run(sb, []);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('ghe.example/arturogarrido/claudinho');
    const gh = ghCalls(sb);
    expect(gh.length).toBeGreaterThan(0);
    for (const c of gh) expect(c, 'every gh call names the host').toMatch(/--hostname ghe\.example\b|-R ghe\.example\/arturogarrido\/claudinho\b/);
    expect(gh.some((c) => /^gh api --hostname ghe\.example repos\/arturogarrido\/claudinho\b/.test(c)), 'the identity read through REST').toBe(true);
  });

  it('an scp-like ssh origin (git@host:owner/name.git) is read the same', () => {
    const sb = sandbox();
    seed(sb, { 'origin-url': 'git@github.com:arturogarrido/claudinho.git\n', 'remote-sha': LOCAL, 'runs.1.tsv': RUN('6', LOCAL, 'completed', 'success'), 'jobs-6.tsv': JOBS_OK });
    const r = run(sb, []);
    expect(r.status, r.out).toBe(0);
    expect(ghCalls(sb).every((c) => /--hostname github\.com\b|-R github\.com\/arturogarrido\/claudinho\b/.test(c))).toBe(true);
  });

  it('an origin that names no host/owner/name (a local path) refuses before any gh call', () => {
    const sb = sandbox();
    seed(sb, { 'origin-url': '/srv/git/claudinho.git\n' });
    const r = run(sb, []);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/repository/i);
    expect(ghCalls(sb)).toEqual([]);
    expect(pushed(sb)).toBe(false);
  });

  it('no GraphQL-backed gh command is used: the identity and the pull-request count are REST reads (gh api)', () => {
    const sb = sandbox();
    seed(sb, { 'runs.1.tsv': '' });
    run(sb, [], { PUSH_WATCH_TIMEOUT_SECONDS: '1' });
    const gh = ghCalls(sb);
    expect(gh.some((c) => /^gh repo view/.test(c))).toBe(false);
    expect(gh.some((c) => /^gh pr list/.test(c))).toBe(false);
    expect(gh.some((c) => /^gh api .*repos\/arturogarrido\/claudinho\/pulls\?/.test(c)), 'the PR count through gh api').toBe(true);
  });

  it('a gh failure before the push is a refusal: nothing pushed', () => {
    const sb = sandbox();
    seed(sb, { 'gh-fails': '' });
    const r = run(sb, []);
    expect(r.status).not.toBe(0);
    expect(r.status, 'the script ran (not 127)').not.toBe(127);
    expect(pushed(sb)).toBe(false);
    expect(r.out).toMatch(/gh/); // the refusal names the tool that failed
    expect(r.out).not.toMatch(/no run/);
  });

  it('a branch argument that is a revision expression (branch:path) is refused before any push: git itself refuses the name', () => {
    // the measurement: the host's git refuses this as a branch name
    expect(spawnSync(HOST_GIT, ['check-ref-format', '--branch', 'feature/x:AGENTS.md'], { encoding: 'utf8' }).status).not.toBe(0);
    const sb = sandbox();
    const r = runBranch(sb, 'feature/x:AGENTS.md', []);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/branch/i);
    expect(pushed(sb)).toBe(false);
    expect(ghCalls(sb).some((c) => /^gh run /.test(c))).toBe(false);
  });

  it('a name that is no local branch (show-ref fails) is refused before any push', () => {
    const sb = sandbox();
    seed(sb, { 'no-branch': '' });
    const r = run(sb, []);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/no local branch/i);
    expect(pushed(sb)).toBe(false);
  });

  it('the push names both ends: refs/heads/<branch>:refs/heads/<branch>', () => {
    const sb = sandbox();
    seed(sb, { 'runs.1.tsv': RUN('7', LOCAL, 'completed', 'success'), 'jobs-7.tsv': JOBS_OK });
    const r = run(sb, []);
    expect(r.status, r.out).toBe(0);
    expect(sb.calls().filter((c) => /^git push /.test(c))).toEqual(['git push origin refs/heads/feature/x:refs/heads/feature/x']);
  });

  it('a push URL that is not the fetch URL\'s repository (origin.pushurl) refuses before anything: the push and the reads must name one repository', () => {
    const sb = sandbox();
    seed(sb, { 'push-url': 'https://ghe.example/arturogarrido/claudinho.git\n' });
    const r = run(sb, []);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/push URL/i);
    expect(pushed(sb)).toBe(false);
    expect(ghCalls(sb)).toEqual([]);
    expect(sb.calls().some((c) => /^git remote get-url --push/.test(c)), 'the push URL was asked').toBe(true);
  });

  it('the remote ref is matched by its exact name: a deeper ref ending in refs/heads/<b> listed first never stands for the branch', () => {
    // before the push: the decoy carries the LOCAL SHA, the branch itself is behind (OTHER): a push is required
    const sb = sandbox();
    seed(sb, { 'ls-remote-decoy': '', 'runs.1.tsv': RUN('8', LOCAL, 'completed', 'success'), 'jobs-8.tsv': JOBS_OK });
    const r = run(sb, []);
    expect(r.status, r.out).toBe(0);
    expect(pushed(sb), 'the decoy did not pass for "already at"').toBe(true);
    expect(r.out).not.toMatch(/already at/);
    // the branch absent remotely on the first read (a decoy alone): pushed, then read back by its exact name
    const sb2 = sandbox();
    seed(sb2, { 'ls-remote-absent-first': '', 'runs.1.tsv': RUN('9', LOCAL, 'completed', 'success'), 'jobs-9.tsv': JOBS_OK });
    const r2 = run(sb2, []);
    expect(r2.status, r2.out).toBe(0);
    expect(pushed(sb2)).toBe(true);
  });

  it('a run queued or in progress for ANOTHER SHA refuses the push, naming it', () => {
    const sb = sandbox();
    seed(sb, { 'runs.1.tsv': RUN('11', OTHER, 'in_progress', '') });
    const r = run(sb, []);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('11');
    expect(pushed(sb)).toBe(false);
  });

  it('a failed git push is nonzero at once: no gh run call after it', () => {
    const sb = sandbox();
    seed(sb, { 'push-fails': '' });
    const r = run(sb, []);
    expect(r.status).not.toBe(0);
    const calls = sb.calls();
    const pushAt = calls.findIndex((c) => /^git push /.test(c));
    expect(pushAt).toBeGreaterThanOrEqual(0);
    expect(calls.slice(pushAt + 1).filter((c) => /^gh run /.test(c))).toEqual([]);
  });

  it('ls-remote disagreeing with the local SHA after the push is nonzero, no wait', () => {
    const sb = sandbox();
    seed(sb, { 'remote-sha': OTHER });
    // the push stub leaves remote-sha as seeded (OTHER), so the read-back disagrees
    const r = run(sb, []);
    expect(r.status).not.toBe(0);
    expect(pushed(sb)).toBe(true);
    expect(r.out).toMatch(/mismatch|differs/i);
    expect(ghCalls(sb).filter((c) => /^gh run view/.test(c))).toEqual([]);
  });

  it('the remote already equal to the local SHA: no push, only the watch', () => {
    const sb = sandbox();
    seed(sb, { 'remote-sha': LOCAL, 'runs.1.tsv': RUN('21', LOCAL, 'completed', 'success'), 'jobs-21.tsv': JOBS_OK });
    const r = run(sb, []);
    expect(r.status, r.out).toBe(0);
    expect(pushed(sb)).toBe(false);
    expect(r.out).toContain('audit (shipped deps)');
  });

  it('the run turning completed/success on the third poll: the table has every job with its times, exit 0', () => {
    const sb = sandbox();
    seed(sb, {
      'runs.1.tsv': '', 'runs.2.tsv': RUN('31', LOCAL, 'in_progress', ''), 'runs.3.tsv': RUN('31', LOCAL, 'completed', 'success'),
      'jobs-31.tsv': JOBS_OK,
    });
    const r = run(sb, []);
    expect(r.status, r.out).toBe(0);
    expect(pushed(sb)).toBe(true);
    for (const name of ['build · typecheck · test (Node 22)', 'audit (shipped deps)', 'coverage (non-gating)']) expect(r.out).toContain(name);
    expect(r.out).toMatch(/2026-10-07T04:00:00Z/);
    expect(r.out).toMatch(/2026-10-07T04:01:20Z/);
    expect(r.out).toContain(LOCAL); // the SHA read back is printed
  });

  it('a completed success for ANOTHER SHA listed first never counts: the wait goes on to this SHA', () => {
    const sb = sandbox();
    seed(sb, {
      'runs.1.tsv': RUN('40', OTHER, 'completed', 'success') + RUN('41', LOCAL, 'in_progress', ''),
      'runs.2.tsv': RUN('40', OTHER, 'completed', 'success') + RUN('41', LOCAL, 'completed', 'success'),
      'jobs-40.tsv': JOBS_OK, 'jobs-41.tsv': JOBS_OK,
    });
    const r = run(sb, []);
    expect(r.status, r.out).toBe(0);
    expect(ghCalls(sb).some((c) => /^gh run view .*\b40\b/.test(c))).toBe(false);
    expect(ghCalls(sb).some((c) => /^gh run view .*\b41\b/.test(c))).toBe(true);
  });

  it('two runs for the same SHA: the NEWEST (listed first) is the one read, the older never', () => {
    const sb = sandbox();
    seed(sb, {
      'runs.1.tsv': RUN('102', LOCAL, 'completed', 'success') + RUN('101', LOCAL, 'completed', 'failure'),
      'jobs-102.tsv': JOBS_OK,
    });
    const r = run(sb, []);
    expect(r.status, r.out).toBe(0);
    expect(ghCalls(sb).some((c) => /^gh run view .*\b102\b/.test(c))).toBe(true);
    expect(ghCalls(sb).some((c) => /^gh run view .*\b101\b/.test(c))).toBe(false);
  });

  it('a canary-like run on the same SHA is never the one read: the list is asked for the CI workflow only, bound to the repository', () => {
    const sb = sandbox();
    seed(sb, { 'runs.1.tsv': RUN('51', LOCAL, 'completed', 'success'), 'jobs-51.tsv': JOBS_OK });
    run(sb, []);
    const lists = ghCalls(sb).filter((c) => /^gh run list/.test(c));
    expect(lists.length, 'the run list was asked at least once').toBeGreaterThan(0);
    expect(lists.every((c) => /--workflow ci\.yml/.test(c))).toBe(true);
    expect(lists.every((c) => c.includes(`-R ${BOUND}`))).toBe(true);
    expect(ghCalls(sb).filter((c) => /^gh run view/.test(c)).every((c) => c.includes(`-R ${BOUND}`))).toBe(true);
  });

  it('one gating job failing is nonzero; a (non-gating) failure alone is not', () => {
    const sb = sandbox();
    seed(sb, { 'runs.1.tsv': RUN('61', LOCAL, 'completed', 'failure'), 'jobs-61.tsv': JOBS_OK.replace('audit (shipped deps)\tsuccess', 'audit (shipped deps)\tfailure') });
    expect(run(sb, []).status).not.toBe(0);
    const sb2 = sandbox();
    seed(sb2, { 'runs.1.tsv': RUN('62', LOCAL, 'completed', 'success'), 'jobs-62.tsv': JOBS_OK.replace('coverage (non-gating)\tsuccess', 'coverage (non-gating)\tfailure') });
    const r2 = run(sb2, []);
    expect(r2.status, r2.out).toBe(0);
    expect(r2.out).toMatch(/coverage \(non-gating\)\s+failure/);
  });

  it('cancelled is not success', () => {
    const sb = sandbox();
    seed(sb, { 'runs.1.tsv': RUN('71', LOCAL, 'completed', 'cancelled'), 'jobs-71.tsv': JOBS_OK.replace('build · typecheck · test (Node 22)\tsuccess', 'build · typecheck · test (Node 22)\tcancelled') });
    const r = run(sb, []);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/cancelled/); // the table shows the conclusion that failed the run
  });

  it('an empty job list on a completed run is nonzero (jobs: [] is not a green run)', () => {
    const sb = sandbox();
    seed(sb, { 'runs.1.tsv': RUN('81', LOCAL, 'completed', 'success'), 'jobs-81.tsv': '' });
    const r = run(sb, []);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/no jobs|empty/i);
  });

  it('a job without a conclusion is nonzero, never "no run"', () => {
    const sb = sandbox();
    seed(sb, { 'runs.1.tsv': RUN('82', LOCAL, 'completed', 'success'), 'jobs-82.tsv': 'build · typecheck · test (Node 22)\t\t2026-10-07T04:00:00Z\t\n' });
    const r = run(sb, []);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/no conclusion/i); // the refusal names what was missing (the table's header alone must not satisfy this)
    expect(r.out).not.toMatch(/no run for/);
  });

  it('a run still in progress at the deadline is nonzero naming that run, distinct from "no run"', { timeout: 10000 }, () => {
    const sb = sandbox();
    seed(sb, { 'runs.1.tsv': RUN('91', LOCAL, 'in_progress', '') });
    const r = run(sb, [], { PUSH_WATCH_TIMEOUT_SECONDS: '1' });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('91');
    expect(r.out).not.toMatch(/no run for/);
  });

  it('a probe that hangs is killed at the deadline WITH its child: the stub\'s sleep never completes, nonzero, "deadline" said', { timeout: 20000 }, async () => {
    const sb = sandbox();
    seed(sb, { 'remote-sha': LOCAL, hang: '' });
    const r = run(sb, [], { PUSH_WATCH_TIMEOUT_SECONDS: '2' });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/deadline|timed out|killed/i);
    expect(existsSync(join(sb.state, 'hang-finished')), 'the sleep was cut, never completed').toBe(false);
    const child = pidIn(sb, 'gh-child');
    expect(await until(() => !pidAlive(child), 3000), `the probe's child ${child} is dead after the deadline`).toBe(true);
    expect(workDirs(sb)).toEqual([]);
  });

  it('a TERM to the script\'s own pid while a probe runs: exit 143, the probe and its child reaped, the work directory removed', { timeout: 20000 }, async () => {
    const sb = sandbox();
    seed(sb, { 'remote-sha': LOCAL, hang: '' });
    const { child, done } = startScript(SCRIPT, ['feature/x'], sb, { PUSH_WATCH_POLL_SECONDS: '0', PUSH_WATCH_TIMEOUT_SECONDS: '30' }, { cwd: ROOT });
    expect(await until(() => pidReady(sb, 'gh-child'), 8000), 'the probe started').toBe(true);
    const ghChild = pidIn(sb, 'gh-child');
    expect(pidAlive(ghChild)).toBe(true);
    child.kill('SIGTERM');
    const r = await done;
    expect(r.status, r.out).toBe(143);
    expect(await until(() => !pidAlive(ghChild), 3000), `the probe's child ${ghChild} is dead after TERM`).toBe(true);
    expect(existsSync(join(sb.state, 'hang-finished'))).toBe(false);
    expect(workDirs(sb), 'the work directory is removed').toEqual([]);
  });

  it('a child that ignores TERM under a parent that dies of it is still gone after the deadline: the pids are recorded before the first signal', { timeout: 20000 }, async () => {
    const sb = sandbox();
    seed(sb, { 'remote-sha': LOCAL, 'hang-ignore-term': '' });
    const r = run(sb, [], { PUSH_WATCH_TIMEOUT_SECONDS: '2' });
    expect(r.status).not.toBe(0);
    const child = pidIn(sb, 'gh-child');
    const dead = await until(() => !pidAlive(child), 3000);
    if (!dead) try { process.kill(child, 'SIGKILL'); } catch {}
    expect(dead, `the TERM-ignoring child ${child} was killed by its recorded pid`).toBe(true);
    expect(existsSync(join(sb.state, 'hang-finished'))).toBe(false);
  });

  it('a TERM to the script while a probe\'s child ignores TERM: the child is still gone, by its recorded pid', { timeout: 20000 }, async () => {
    const sb = sandbox();
    seed(sb, { 'remote-sha': LOCAL, 'hang-ignore-term': '' });
    const { child, done } = startScript(SCRIPT, ['feature/x'], sb, { PUSH_WATCH_POLL_SECONDS: '0', PUSH_WATCH_TIMEOUT_SECONDS: '30' }, { cwd: ROOT });
    expect(await until(() => pidReady(sb, 'gh-child'), 8000), 'the probe started').toBe(true);
    const ghChild = pidIn(sb, 'gh-child');
    child.kill('SIGTERM');
    const r = await done;
    expect(r.status, r.out).toBe(143);
    const dead = await until(() => !pidAlive(ghChild), 3000);
    if (!dead) try { process.kill(ghChild, 'SIGKILL'); } catch {}
    expect(dead, `the TERM-ignoring child ${ghChild} is dead after TERM`).toBe(true);
    expect(workDirs(sb)).toEqual([]);
  });

  it('a GRANDCHILD that ignores TERM (under a helper that dies of it) is gone after the deadline: the descendants are recorded to the leaves', { timeout: 20000 }, async () => {
    const sb = sandbox();
    seed(sb, { 'remote-sha': LOCAL, 'hang-grandchild': '' });
    const r = run(sb, [], { PUSH_WATCH_TIMEOUT_SECONDS: '2' });
    expect(r.status).not.toBe(0);
    const grandchild = pidIn(sb, 'gh-grandchild');
    const dead = await until(() => !pidAlive(grandchild), 3000);
    if (!dead) try { process.kill(grandchild, 'SIGKILL'); } catch {}
    expect(dead, `the TERM-ignoring grandchild ${grandchild} was killed by its recorded pid`).toBe(true);
  });

  it('a TERM to the script while a probe has a TERM-ignoring grandchild: the grandchild is gone too', { timeout: 20000 }, async () => {
    const sb = sandbox();
    seed(sb, { 'remote-sha': LOCAL, 'hang-grandchild': '' });
    const { child, done } = startScript(SCRIPT, ['feature/x'], sb, { PUSH_WATCH_POLL_SECONDS: '0', PUSH_WATCH_TIMEOUT_SECONDS: '30' }, { cwd: ROOT });
    expect(await until(() => pidReady(sb, 'gh-grandchild'), 8000), 'the probe and its helper started').toBe(true);
    const grandchild = pidIn(sb, 'gh-grandchild');
    child.kill('SIGTERM');
    const r = await done;
    expect(r.status, r.out).toBe(143);
    const dead = await until(() => !pidAlive(grandchild), 3000);
    if (!dead) try { process.kill(grandchild, 'SIGKILL'); } catch {}
    expect(dead, `the TERM-ignoring grandchild ${grandchild} is dead after TERM`).toBe(true);
    expect(workDirs(sb)).toEqual([]);
  });

  it('a TERM to the script WHILE the watchdog is escalating (a probe that ignores TERM, a helper dead of it, a grandchild that ignores it): the recorded grandchild is still gone', { timeout: 25000 }, async () => {
    const sb = sandbox();
    seed(sb, { 'remote-sha': LOCAL, 'hang-grandchild-ignore': '' });
    const { child, done } = startScript(SCRIPT, ['feature/x'], sb, { PUSH_WATCH_POLL_SECONDS: '0', PUSH_WATCH_TIMEOUT_SECONDS: '2' }, { cwd: ROOT });
    expect(await until(() => pidReady(sb, 'gh-grandchild') && pidReady(sb, 'gh-child'), 8000), 'the probe and its helper started').toBe(true);
    const grandchild = pidIn(sb, 'gh-grandchild');
    const gh = pidIn(sb, 'gh-child');
    // the deadline passes at 2 s; the watchdog then TERMs the tree (the helper dies, gh and the grandchild ignore it)
    // and waits its tries on gh before its KILL: the TERM to the script lands inside that wait
    await new Promise((r) => setTimeout(r, 2600));
    child.kill('SIGTERM');
    const r = await done;
    expect(r.status, `status ${r.status} signal ${r.signal}: ${r.out}`).toBe(143);
    const dead = await until(() => !pidAlive(grandchild), 3000);
    if (!dead) try { process.kill(grandchild, 'SIGKILL'); } catch {}
    try { process.kill(gh, 'SIGKILL'); } catch {}
    expect(dead, `the grandchild ${grandchild}, recorded by the watchdog before its first signal, is dead after the TERM to the script`).toBe(true);
    expect(workDirs(sb)).toEqual([]);
  });

  it('no run within the timeout is nonzero by default, naming the SHA and the PR lookup; --allow-no-run with no PR exits 0 with its line', { timeout: 20000 }, () => {
    const sb = sandbox();
    seed(sb, { 'runs.1.tsv': '' });
    const r = run(sb, [], { PUSH_WATCH_TIMEOUT_SECONDS: '1' });
    expect(r.status).not.toBe(0);
    expect(r.out).toContain(LOCAL);
    expect(r.out).toMatch(/pull request/);
    const sb2 = sandbox();
    seed(sb2, { 'runs.1.tsv': '' });
    const r2 = run(sb2, ['--allow-no-run'], { PUSH_WATCH_TIMEOUT_SECONDS: '1' });
    expect(r2.status, r2.out).toBe(0);
    expect(r2.out).toContain('pushed; CI not verified (no pull request)');
    // and with a PR open, the allowance does not apply: still nonzero
    const sb3 = sandbox();
    seed(sb3, { 'runs.1.tsv': '', 'pr-count': '1' });
    expect(run(sb3, ['--allow-no-run'], { PUSH_WATCH_TIMEOUT_SECONDS: '1' }).status).not.toBe(0);
  });

  it('the local SHA is refs/heads/<branch>: rev-parse is asked for the ref, never HEAD', () => {
    const sb = sandbox();
    seed(sb, { 'remote-sha': LOCAL, 'runs.1.tsv': RUN('99', LOCAL, 'completed', 'success'), 'jobs-99.tsv': JOBS_OK });
    run(sb, []);
    expect(sb.calls().some((c) => /^git rev-parse --verify refs\/heads\/feature\/x$/.test(c))).toBe(true);
    expect(sb.calls().some((c) => /^git rev-parse (--verify )?HEAD$/.test(c))).toBe(false);
  });
});
