/**
 * `scripts/push-and-watch.sh`: the push rule as code (PR A, the process made executable). Run OFFLINE under
 * stub `git` and `gh` on a hermetic PATH; every stub records its calls, so "no `git push` ran" and "no
 * `gh run` call after a failed push" are read from the record.
 *
 * The contract pinned here (the draft's "Tracked", revision 3):
 *   - the repository is the one `origin` names (`gh repo view` must equal the owner/name of the origin URL), else
 *     refuse before anything; the local SHA is `refs/heads/<branch>`, never HEAD;
 *   - a `gh` failure is a refusal before the push; a run queued/in progress for ANOTHER SHA refuses the push;
 *   - the remote already equal to the local SHA: no push, only the watch; else push, read `ls-remote` back,
 *     refuse on a mismatch; a failed push is nonzero at once, nothing watched;
 *   - the CI workflow's NEWEST run for the full local SHA is the one judged; a completed run is read at once; a
 *     run for another SHA never counts; every probe is bounded by the deadline; in_progress at the deadline is
 *     nonzero naming the run, distinct from "no run";
 *   - the per-job table from `gh run view` (name, conclusion, started, completed, duration); an empty job list
 *     or a job without a conclusion is nonzero; any non-`(non-gating)` job not `success` is nonzero;
 *   - strict by default: no run is nonzero naming the SHA and the PR lookup; `--allow-no-run` with no PR exits
 *     0 with `pushed; CI not verified (no pull request)`.
 * Test seams, documented in the script: PUSH_WATCH_POLL_SECONDS and PUSH_WATCH_TIMEOUT_SECONDS.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMON_HOST_TOOLS, makeSandbox, parses, runScript, type Sandbox } from './hermetic-shell';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const SCRIPT = join(ROOT, 'scripts/push-and-watch.sh');
const HOST = [...COMMON_HOST_TOOLS, 'kill'] as const;
const LOCAL = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

/**
 * The stubs answer from `$STATE`:
 *   local-sha (default LOCAL) · remote-sha (default OTHER: the branch is behind) · push-fails · repo (gh's
 *   nameWithOwner, default arturogarrido/claudinho) · gh-fails · hang (gh run list sleeps) · pr-count (default 0)
 *   runs.<n>.tsv: the run list the n-th `gh run list` call prints (id, headSha, event, status, conclusion);
 *   the highest n available answers every later call · jobs-<id>.tsv: the jobs `gh run view <id>` prints
 *   (name, conclusion, startedAt, completedAt). Every answer is TSV: the script asks `gh --jq` for TSV.
 */
const STUBS = {
  git: `
case "$1" in
  rev-parse) [ -e "$STATE/local-sha" ] && cat "$STATE/local-sha" || echo ${LOCAL}; exit 0 ;;
  remote) echo "https://github.com/arturogarrido/claudinho.git"; exit 0 ;;
  ls-remote) sha=$([ -e "$STATE/remote-sha" ] && cat "$STATE/remote-sha" || echo ${OTHER}); printf '%s\\trefs/heads/%s\\n' "$sha" "$3"; exit 0 ;;
  push) [ -e "$STATE/push-fails" ] && { echo "error: failed to push some refs" >&2; exit 1; }; [ -e "$STATE/remote-sha" ] || echo ${LOCAL} > "$STATE/remote-sha"; exit 0 ;;
esac
exit 0
`,
  gh: `
[ -e "$STATE/gh-fails" ] && { echo "gh: HTTP 502" >&2; exit 1; }
case "$1 $2" in
  "repo view") [ -e "$STATE/repo" ] && cat "$STATE/repo" || echo "arturogarrido/claudinho"; exit 0 ;;
  "run list")
    [ -e "$STATE/hang" ] && sleep 30
    n=$(( $(cat "$STATE/runs-calls" 2>/dev/null || echo 0) + 1 )); echo $n > "$STATE/runs-calls"
    while [ $n -gt 0 ] && [ ! -e "$STATE/runs.$n.tsv" ]; do n=$((n-1)); done
    [ $n -gt 0 ] && cat "$STATE/runs.$n.tsv"; exit 0 ;;
  "run view") id=$3; [ -e "$STATE/jobs-$id.tsv" ] && cat "$STATE/jobs-$id.tsv"; exit 0 ;;
  "pr list") [ -e "$STATE/pr-count" ] && cat "$STATE/pr-count" || echo 0; exit 0 ;;
esac
exit 0
`,
};
const RUN = (id: string, sha: string, status: string, conclusion: string, event = 'pull_request') => `${id}\t${sha}\t${event}\t${status}\t${conclusion}\n`;
const JOBS_OK = ['build · typecheck · test (Node 22)', 'audit (shipped deps)', 'coverage (non-gating)']
  .map((n) => `${n}\tsuccess\t2026-10-07T04:00:00Z\t2026-10-07T04:01:20Z\n`).join('');

function sandbox(): Sandbox {
  return makeSandbox(STUBS, HOST, 'watch-');
}
function seed(sb: Sandbox, files: Record<string, string>) {
  for (const [k, v] of Object.entries(files)) writeFileSync(join(sb.state, k), v);
}
function run(sb: Sandbox, args: string[], env: Record<string, string> = {}) {
  return runScript(SCRIPT, ['feature/x', ...args], sb, { PUSH_WATCH_POLL_SECONDS: '0', PUSH_WATCH_TIMEOUT_SECONDS: '3', ...env }, { cwd: ROOT, timeout: 30000 });
}
const pushed = (sb: Sandbox) => sb.calls().some((c) => /^git push /.test(c));
const ghCalls = (sb: Sandbox) => sb.calls().filter((c) => c.startsWith('gh '));

describe.skipIf(process.platform === 'win32')('scripts/push-and-watch.sh, run offline under stub git and gh', () => {
  it('exists and parses whole (bash -n), bash 3.2 and BSD tools only, no jq, no node', () => {
    expect(existsSync(SCRIPT), 'scripts/push-and-watch.sh').toBe(true);
    expect(parses(SCRIPT)).toBe(0);
    const text = readFileSync(SCRIPT, 'utf8');
    for (const forbidden of ['mapfile', 'declare -A', 'date -d', 'readarray', '\\bjq ', 'node ']) expect(text).not.toMatch(new RegExp(forbidden));
    expect(text).toContain('--jq');
  });

  it('a repository mismatch (gh repo view is not origin) refuses before anything', () => {
    const sb = sandbox();
    seed(sb, { repo: 'someone/else\n' });
    const r = run(sb, []);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/repository/i);
    expect(pushed(sb)).toBe(false);
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
    expect(ghCalls(sb).some((c) => /^gh run view 40\b/.test(c))).toBe(false);
    expect(ghCalls(sb).some((c) => /^gh run view 41\b/.test(c))).toBe(true);
  });

  it('a canary-like run on the same SHA is never the one read: the list is asked for the CI workflow only', () => {
    const sb = sandbox();
    seed(sb, { 'runs.1.tsv': RUN('51', LOCAL, 'completed', 'success'), 'jobs-51.tsv': JOBS_OK });
    run(sb, []);
    const lists = ghCalls(sb).filter((c) => /^gh run list/.test(c));
    expect(lists.length, 'the run list was asked at least once').toBeGreaterThan(0);
    expect(lists.every((c) => /--workflow ci\.yml/.test(c))).toBe(true);
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
    expect(r.out).toMatch(/conclusion/i); // the refusal names what was missing
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

  it('a probe that hangs is killed at the deadline: nonzero within the bound', { timeout: 20000 }, () => {
    const sb = sandbox();
    seed(sb, { 'remote-sha': LOCAL, hang: '' });
    const started = Date.now();
    const r = run(sb, [], { PUSH_WATCH_TIMEOUT_SECONDS: '2' });
    expect(r.status).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(20000); // the stub would sleep 30 s: a bound was applied
    expect(r.out).toMatch(/deadline|timed out|killed/i);
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
