/**
 * `scripts/gate.sh`: CI's gating list run locally, every step printing a verdict, a commit only on all green
 * (PR A, the process made executable). Run OFFLINE under stub `pnpm`, `node`, `git` on a PATH that holds
 * the stubs and a named set of host tools, and nothing else of the host's (the shape of the publish
 * workflow's test). Every stub records the calls it receives, so "no `git commit` ran" is read from the
 * record, never inferred from the script's output.
 *
 * The contract pinned here (the draft's "Tracked", revision 3, and the round-1 fix list of PR #157):
 *   - the steps, in CI's order, each printing `<name> ok (Ns)` or `<name> FAIL (Ns)` (and `audit SKIP (offline)`
 *     for the one offline case); the chain never stops on a FAIL; the exit is nonzero on any FAIL or SKIP;
 *   - `--commit <file>` refuses before any step when `--only` is given, when `git diff --quiet` is nonzero (a
 *     tracked file differs between the working tree and the index), when an untracked, not ignored file is
 *     listed, or when nothing is staged; records `git write-tree` and HEAD before the steps and asks the same
 *     questions again after them; the commit CONSUMES the recorded tree (`git commit-tree <tree> -p <HEAD0>`, then
 *     `git update-ref HEAD <new> <HEAD0>`: a compare-and-swap on the HEAD recorded before the steps), never
 *     `git commit`, never `git add`, never a third `git write-tree`; a failed commit-tree or update-ref is
 *     `commit FAIL` and exit 1; `SKIP` refuses unless `--allow-offline-audit`, and the exit stays 1 then;
 *   - the logs go to a fresh private directory per run under GATE_LOG_DIR, named in the summary, so a
 *     concurrent or stale `audit.log` can never be read as this run's;
 *   - `--only a,b` runs that subset in order and nothing else, and never commits;
 *   - `--list` prints `<name>\t<command>` per step and runs nothing (the tripwire's source);
 *   - a step's status is the command's own, saved before any `tail` of its log prints.
 * Durations are asserted as "a parenthesized duration is present", never a particular N.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMON_HOST_TOOLS, hostTool, makeSandbox, parses, runScript, type Sandbox } from './hermetic-shell';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const GATE = join(ROOT, 'scripts/gate.sh');
const HOST = [...COMMON_HOST_TOOLS, 'kill'] as const;

/** The stubs. Each reads `$STATE/<flag>` files the test seeds and records every call (the sandbox's prelude). */
const STUBS = {
  // pnpm: `-r typecheck` fails when $STATE/fail-typecheck exists; `audit --prod` fails offline, with a finding,
  // with BOTH (a registry that answered findings over a flaky line), or with neither.
  pnpm: `
case "$*" in
  "-r typecheck") [ -e "$STATE/fail-typecheck" ] && { echo "src/x.ts(1,1): error TS2322" >&2; exit 2; } ;;
  "-r test") [ -e "$STATE/fail-test" ] && { echo "FAIL test/x.test.ts"; exit 1; } ;;
  "audit --prod")
    [ -e "$STATE/audit-offline" ] && { echo "ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS  request to https://registry.npmjs.org/-/npm/v1/security/audits failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org" >&2; exit 1; }
    [ -e "$STATE/audit-vuln" ] && { echo "2 vulnerabilities found"; echo "Severity: 1 high | 1 moderate" >&2; exit 1; }
    [ -e "$STATE/audit-both" ] && { echo "1 vulnerability found"; echo "WARN  request to https://registry.npmjs.org/-/npm/v1/security/advisories failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org" >&2; exit 1; }
    [ -e "$STATE/audit-other" ] && { echo "ERR_PNPM_AUDIT_BAD_RESPONSE  The audit endpoint returned HTML" >&2; exit 1; } ;;
esac
exit 0
`,
  node: 'exit 0\n',
  // git: diff --quiet answers from $STATE/unstaged (first call) and $STATE/unstaged-after (second call); status
  // lists an untracked file when $STATE/untracked (first call) or $STATE/untracked-after (second call) exists;
  // diff --cached reports nothing staged when $STATE/nothing-staged; write-tree answers T1, then T2 on the second
  // call when $STATE/tree-changes, then T3 on a THIRD call when $STATE/tree-changes-late (an index staged after
  // the comparison); rev-parse --verify HEAD answers H0; commit-tree answers C1 unless $STATE/commit-tree-fails;
  // update-ref succeeds unless $STATE/update-ref-fails (HEAD moved: the ref could not be locked).
  git: `
calls="$STATE/git-calls"; echo "$*" >> "$calls"
case "$1 $2" in
  "diff --quiet")
    n=$(grep -c '^diff --quiet' "$calls")
    if [ "$n" -le 1 ]; then [ -e "$STATE/unstaged" ] && exit 1; else [ -e "$STATE/unstaged-after" ] && exit 1; fi
    exit 0 ;;
  "diff --cached") [ -e "$STATE/nothing-staged" ] && exit 0; exit 1 ;;
  "diff --check") exit 0 ;;
  "status --porcelain")
    n=$(grep -c '^status --porcelain' "$calls")
    if [ "$n" -le 1 ]; then [ -e "$STATE/untracked" ] && echo "?? scratch.txt"; else [ -e "$STATE/untracked-after" ] && echo "?? late.txt"; fi
    exit 0 ;;
  "write-tree "*|"write-tree")
    n=$(grep -c '^write-tree' "$calls")
    if [ "$n" -ge 2 ] && [ -e "$STATE/tree-changes" ]; then echo T2; elif [ "$n" -ge 3 ] && [ -e "$STATE/tree-changes-late" ]; then echo T3; else echo T1; fi; exit 0 ;;
  "rev-parse --verify") echo H0; exit 0 ;;
  "rev-parse --show-toplevel") echo "$GATE_ROOT"; exit 0 ;;
  "commit-tree "*) [ -e "$STATE/commit-tree-fails" ] && { echo "fatal: not a valid object name" >&2; exit 128; }; echo C1; exit 0 ;;
  "update-ref "*) [ -e "$STATE/update-ref-fails" ] && { echo "error: cannot lock ref 'HEAD': is at H1 but expected H0" >&2; exit 1; }; exit 0 ;;
  "commit -F") exit 0 ;;
esac
exit 0
`,
};

function sandbox(): Sandbox {
  return makeSandbox(STUBS, HOST, 'gate-');
}
function run(sb: Sandbox, args: string[]) {
  return runScript(GATE, args, sb, { GATE_LOG_DIR: join(sb.dir, 'logs'), GATE_ROOT: ROOT }, { cwd: ROOT, timeout: 60000 });
}
function withMessage(sb: Sandbox): string {
  const msg = join(sb.dir, 'msg.txt');
  writeFileSync(msg, 'a message\n');
  return msg;
}
const lines = (out: string) => out.split('\n');
const STEP = /^(\S+) (ok|FAIL|SKIP(?: \([^)]*\))?) \(\d+s\)$/;
const verdictOf = (out: string, name: string) => lines(out).find((l) => l.startsWith(`${name} `) && STEP.test(l));
const gitCalls = (sb: Sandbox) => sb.calls().filter((c) => c.startsWith('git '));
/** The commit happened: HEAD was moved to the new commit by a compare-and-swap on the recorded HEAD. */
const committed = (sb: Sandbox) => gitCalls(sb).some((c) => /^git update-ref .*\bHEAD C1 H0$/.test(c));
const usedGitCommit = (sb: Sandbox) => gitCalls(sb).some((c) => /^git commit /.test(c));
const added = (sb: Sandbox) => gitCalls(sb).some((c) => /^git add /.test(c));
const pnpmCalls = (sb: Sandbox) => sb.calls().filter((c) => c.startsWith('pnpm '));

const EXPECTED_STEPS = ['build', 'typecheck', 'test', 'lint', 'stdio-smoke', 'pack', 'statusline-smoke', 'audit', 'qa-syntax', 'diff-check'];

describe.skipIf(process.platform === 'win32')('scripts/gate.sh, run offline under stub pnpm, node and git', () => {
  it('exists and parses whole (bash -n), bash 3.2 and BSD tools only', () => {
    expect(existsSync(GATE), 'scripts/gate.sh').toBe(true);
    expect(parses(GATE)).toBe(0);
    const text = readFileSync(GATE, 'utf8');
    for (const forbidden of ['mapfile', 'declare -A', 'date -d', 'readarray']) expect(text, forbidden).not.toContain(forbidden);
  });

  it('--list prints every step as <name>\\t<command> in CI order and runs nothing', () => {
    const sb = sandbox();
    const r = run(sb, ['--list']);
    expect(r.status).toBe(0);
    const names = lines(r.stdout).filter(Boolean).map((l) => l.split('\t')[0]);
    expect(names).toEqual(EXPECTED_STEPS);
    expect(sb.calls().filter((c) => c.startsWith('pnpm ') || c.startsWith('node '))).toEqual([]);
  });

  it('all ok: every line ok with a duration, exit 0; --commit commits the RECORDED tree on the RECORDED HEAD, never git commit or git add', () => {
    const sb = sandbox();
    const msg = withMessage(sb);
    const r = run(sb, ['--commit', msg]);
    expect(r.status, r.out).toBe(0);
    for (const name of EXPECTED_STEPS) expect(verdictOf(r.out, name), `${name}: ${r.out}`).toMatch(new RegExp(`^${name} ok \\(\\d+s\\)$`));
    // the commit: the tree written before the steps, the parent HEAD read before the steps, the message file verbatim
    expect(gitCalls(sb).filter((c) => c === `git commit-tree T1 -p H0 -F ${msg}`), r.out).toHaveLength(1);
    expect(gitCalls(sb).filter((c) => /^git update-ref .*\bHEAD C1 H0$/.test(c))).toHaveLength(1);
    expect(usedGitCommit(sb)).toBe(false);
    expect(added(sb)).toBe(false);
    expect(r.out).toMatch(/^commit ok$/m);
    // the write-tree question was asked before AND after the steps, and the HEAD question before them
    expect(gitCalls(sb).filter((c) => c.startsWith('git write-tree')).length).toBeGreaterThanOrEqual(2);
    expect(gitCalls(sb).some((c) => /^git rev-parse --verify (-q |--quiet )?HEAD$/.test(c))).toBe(true);
  });

  it('an index staged AFTER the comparison cannot reach the commit: the commit takes the recorded tree, and asks write-tree no third time', () => {
    const sb = sandbox();
    writeFileSync(join(sb.state, 'tree-changes-late'), ''); // a third write-tree would answer T3
    const msg = withMessage(sb);
    const r = run(sb, ['--commit', msg]);
    expect(r.status, r.out).toBe(0);
    expect(gitCalls(sb).filter((c) => c.startsWith('git write-tree'))).toHaveLength(2);
    expect(gitCalls(sb).some((c) => c.startsWith('git commit-tree T1 '))).toBe(true);
    expect(gitCalls(sb).some((c) => c.startsWith('git commit-tree T3 '))).toBe(false);
  });

  it('a HEAD that moved during the gate fails the commit (update-ref refuses the compare-and-swap): commit FAIL, exit 1', () => {
    const sb = sandbox();
    writeFileSync(join(sb.state, 'update-ref-fails'), '');
    const msg = withMessage(sb);
    const r = run(sb, ['--commit', msg]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/^commit FAIL \(/m);
    expect(r.out).not.toMatch(/^commit ok/m);
    expect(usedGitCommit(sb)).toBe(false);
  });

  it('a failed commit-tree is commit FAIL and exit 1, and HEAD is never moved', () => {
    const sb = sandbox();
    writeFileSync(join(sb.state, 'commit-tree-fails'), '');
    const msg = withMessage(sb);
    const r = run(sb, ['--commit', msg]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/^commit FAIL \(/m);
    expect(gitCalls(sb).some((c) => c.startsWith('git update-ref'))).toBe(false);
  });

  it('one step failing: that line FAIL with its log tail, EVERY later step still runs, exit nonzero, no commit', () => {
    const sb = sandbox();
    writeFileSync(join(sb.state, 'fail-typecheck'), '');
    const msg = withMessage(sb);
    const r = run(sb, ['--commit', msg]);
    expect(r.status).not.toBe(0);
    expect(verdictOf(r.out, 'typecheck')).toMatch(/^typecheck FAIL \(\d+s\)$/);
    expect(r.out).toContain('error TS2322'); // the log tail, under the FAIL line
    for (const later of EXPECTED_STEPS.slice(EXPECTED_STEPS.indexOf('typecheck') + 1)) expect(verdictOf(r.out, later), later).toMatch(/ ok \(\d+s\)$/);
    expect(r.out).toMatch(/^commit REFUSED \(/m);
    expect(committed(sb)).toBe(false);
    expect(usedGitCommit(sb)).toBe(false);
  });

  it("a step's status is the command's own, not a pipe's: a failing test step is FAIL though its log is tailed", () => {
    const sb = sandbox();
    writeFileSync(join(sb.state, 'fail-test'), '');
    const r = run(sb, []);
    expect(r.status).not.toBe(0);
    expect(verdictOf(r.out, 'test')).toMatch(/^test FAIL \(\d+s\)$/);
  });

  it('--only runs the named subset in order and nothing else', () => {
    const sb = sandbox();
    const r = run(sb, ['--only', 'build,test']);
    expect(r.status).toBe(0);
    const ran = sb.calls().filter((c) => c.startsWith('pnpm ') || c.startsWith('node '));
    expect(ran).toEqual(['pnpm -r build', 'pnpm -r test']);
    expect(verdictOf(r.out, 'typecheck')).toBeUndefined();
  });

  it('--only with --commit is refused before any step runs', () => {
    const sb = sandbox();
    const msg = withMessage(sb);
    const r = run(sb, ['--only', 'build', '--commit', msg]);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/^commit REFUSED \(.*--only/m);
    expect(pnpmCalls(sb)).toEqual([]);
    expect(committed(sb)).toBe(false);
  });

  it('an unstaged edit (git diff --quiet nonzero) refuses --commit before any step', () => {
    const sb = sandbox();
    writeFileSync(join(sb.state, 'unstaged'), '');
    const msg = withMessage(sb);
    const r = run(sb, ['--commit', msg]);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/^commit REFUSED \(unstaged/m);
    expect(pnpmCalls(sb)).toEqual([]);
    expect(committed(sb)).toBe(false);
  });

  it('an untracked, not ignored file refuses --commit before any step (the checks could read what no commit carries)', () => {
    const sb = sandbox();
    writeFileSync(join(sb.state, 'untracked'), '');
    const msg = withMessage(sb);
    const r = run(sb, ['--commit', msg]);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/^commit REFUSED \(untracked/m);
    expect(pnpmCalls(sb)).toEqual([]);
    expect(committed(sb)).toBe(false);
  });

  it('nothing staged (git diff --cached --quiet exit 0) refuses --commit before any step', () => {
    const sb = sandbox();
    writeFileSync(join(sb.state, 'nothing-staged'), '');
    const msg = withMessage(sb);
    const r = run(sb, ['--commit', msg]);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/^commit REFUSED \(nothing staged/m);
    expect(pnpmCalls(sb)).toEqual([]);
    expect(committed(sb)).toBe(false);
  });

  it('the working tree changing during the steps refuses the commit (the second git diff --quiet)', () => {
    const sb = sandbox();
    writeFileSync(join(sb.state, 'unstaged-after'), '');
    const msg = withMessage(sb);
    const r = run(sb, ['--commit', msg]);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/^commit REFUSED \(.*changed during the gate/m);
    expect(committed(sb)).toBe(false);
  });

  it('an untracked file first appearing during the steps refuses the commit (the second git status)', () => {
    const sb = sandbox();
    writeFileSync(join(sb.state, 'untracked-after'), '');
    const msg = withMessage(sb);
    const r = run(sb, ['--commit', msg]);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/^commit REFUSED \(.*changed during the gate.*late\.txt/m);
    expect(committed(sb)).toBe(false);
  });

  it('the index changing during the steps (write-tree differs) refuses the commit', () => {
    const sb = sandbox();
    writeFileSync(join(sb.state, 'tree-changes'), '');
    const msg = withMessage(sb);
    const r = run(sb, ['--commit', msg]);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/^commit REFUSED \(.*changed during the gate/m);
    expect(committed(sb)).toBe(false);
  });

  it('audit offline (a registry-unreachable signature): SKIP (offline), exit 1, --commit refused unless allowed; allowed, the commit is made and the exit is still 1', () => {
    const sb = sandbox();
    writeFileSync(join(sb.state, 'audit-offline'), '');
    const msg = withMessage(sb);
    const r = run(sb, ['--commit', msg]);
    expect(r.status).toBe(1);
    expect(verdictOf(r.out, 'audit')).toMatch(/^audit SKIP \(offline\) \(\d+s\)$/);
    expect(committed(sb)).toBe(false);
    const sb2 = sandbox();
    writeFileSync(join(sb2.state, 'audit-offline'), '');
    const msg2 = withMessage(sb2);
    const r2 = run(sb2, ['--commit', msg2, '--allow-offline-audit']);
    expect(committed(sb2)).toBe(true);
    expect(r2.out).toMatch(/^commit ok \(--allow-offline-audit/m); // the allowance is printed on the commit line
    expect(r2.status, 'a SKIP is never exit 0, commit or not').toBe(1);
  });

  it('audit with a finding (no offline signature): FAIL, --commit refused whatever the flags', () => {
    const sb = sandbox();
    writeFileSync(join(sb.state, 'audit-vuln'), '');
    const msg = withMessage(sb);
    const r = run(sb, ['--commit', msg, '--allow-offline-audit']);
    expect(r.status).not.toBe(0);
    expect(verdictOf(r.out, 'audit')).toMatch(/^audit FAIL \(\d+s\)$/);
    expect(committed(sb)).toBe(false);
  });

  it('audit with BOTH a signature and a findings line is FAIL, never SKIP: the registry answered findings', () => {
    const sb = sandbox();
    writeFileSync(join(sb.state, 'audit-both'), '');
    const msg = withMessage(sb);
    const r = run(sb, ['--commit', msg, '--allow-offline-audit']);
    expect(r.status).not.toBe(0);
    expect(verdictOf(r.out, 'audit')).toMatch(/^audit FAIL \(\d+s\)$/);
    expect(committed(sb)).toBe(false);
  });

  it('audit failing with neither a signature nor a findings line is FAIL, never SKIP (the signature is required)', () => {
    const sb = sandbox();
    writeFileSync(join(sb.state, 'audit-other'), '');
    const r = run(sb, []);
    expect(r.status).not.toBe(0);
    expect(verdictOf(r.out, 'audit')).toMatch(/^audit FAIL \(\d+s\)$/);
  });

  it('the logs go to a fresh directory of this run under GATE_LOG_DIR: a stale offline audit.log beside it is never this run\'s evidence', () => {
    const sb = sandbox();
    const logs = join(sb.dir, 'logs');
    mkdirSync(logs);
    const stale = 'getaddrinfo ENOTFOUND registry.npmjs.org\n';
    writeFileSync(join(logs, 'audit.log'), stale);
    writeFileSync(join(sb.state, 'audit-vuln'), '');
    const msg = withMessage(sb);
    const r = run(sb, ['--commit', msg, '--allow-offline-audit']);
    expect(verdictOf(r.out, 'audit')).toMatch(/^audit FAIL \(\d+s\)$/);
    expect(committed(sb)).toBe(false);
    expect(readFileSync(join(logs, 'audit.log'), 'utf8'), 'the stale file is not this run\'s log').toBe(stale);
    const named = /logs in ([^;\s]+)/.exec(r.out)?.[1] ?? '';
    expect(named.startsWith(`${logs}/`), `the summary names a run directory under GATE_LOG_DIR: ${named}`).toBe(true);
    expect(named).not.toBe(logs);
    expect(existsSync(join(named, 'audit.log'))).toBe(true);
  });

  it('the PATH the tests give the script is exactly the stubs plus the named host tools', () => {
    const sb = sandbox();
    const dirs = (sb.env.PATH ?? '').split(':');
    expect(dirs).toHaveLength(2);
    const names = new Set([...Object.keys(STUBS), ...HOST, 'bash']);
    for (const d of dirs) for (const f of readdirSync(d)) expect(names.has(f), f).toBe(true);
  });
});

/**
 * The tripwire: "the workflow file is the list". Every `run:` command of CI's gating jobs (one-line and `run: |`
 * block forms, trailing comments stripped) and every `uses:` step is classified: RUN BY THE GATE (its text is
 * a line of `gate.sh --list`), or EXCLUDED with a reason here. Anything else fails, naming the job, the step and
 * the command. A copy of the workflow with a synthetic gating job must fail the classification. The reader
 * REFUSES every step shape it does not read (a flow mapping, a plain multi-line scalar, a folded block, a step
 * with neither key): a silent drop would let a new gating step through (PR #157 round 1).
 */
type Step = { job: string; index: number; kind: 'run' | 'uses'; text: string; continueOnError: boolean };

/** The keys a step may carry; any other key, or any other shape where a key belongs, is refused. */
const STEP_KEYS = new Set(['name', 'id', 'if', 'with', 'env', 'shell', 'working-directory', 'continue-on-error', 'timeout-minutes', 'run', 'uses']);

/**
 * A small YAML-free reader of the workflow's jobs: enough for this file's shape, refusing what it does not read.
 * Jobs are the keys at 2 spaces under `jobs:`, a job's own keys are at 4, its steps are items at `      - ` (6
 * spaces, a dash) and a step's keys are at 8 (the item's first key on the dash line). A `run: |` block is read
 * from the indent of its first non-blank line, which must be deeper than 8, to the first non-blank line indented
 * less; a one-line `run:` or `uses:` value is the command. Every other shape throws, naming the job: a flow
 * mapping, a sequence or a bare scalar where a key belongs, a key no step has, `|-`, `|+`, `>`, an empty `run:`
 * (a plain multi-line scalar), a one-line value continued on a deeper line, a step with neither `run:` nor `uses:`
 * (or both), a dash at another column, an inline `steps:` and a job-level `uses:` (a reusable workflow).
 */
export function workflowSteps(yaml: string): Step[] {
  const lines = yaml.split('\n');
  const steps: Step[] = [];
  const continueJobs = new Set<string>();
  const indentOf = (s: string) => s.length - s.replace(/^ +/, '').length;
  const skippable = (s: string) => s.trim() === '' || s.trim().startsWith('#');
  const scalarOf = (raw: string) => raw.replace(/(^|\s+)#.*$/, '').trim();
  let inJobs = false;
  let job = '';
  let inSteps = false;
  let index = 0;
  function refuse(what: string, at: number): never {
    throw new Error(`${what} in ${job}: ${(lines[at] ?? '').trim()}`);
  }
  let i = 0;
  while (i < lines.length) {
    const l = lines[i] ?? '';
    if (skippable(l)) { i++; continue; }
    const n = indentOf(l);
    if (n === 0) {
      if (/^jobs:/.test(l) && !/^jobs:\s*(#.*)?$/.test(l)) throw new Error(`unreadable jobs: ${l}`);
      inJobs = /^jobs:/.test(l); job = ''; inSteps = false;
      i++; continue;
    }
    if (!inJobs) { i++; continue; }
    if (n === 2) {
      const key = /^ {2}([A-Za-z_][A-Za-z0-9_-]*):\s*(#.*)?$/.exec(l);
      if (!key) throw new Error(`unreadable job key: ${l}`);
      job = key[1] ?? ''; inSteps = false; index = 0;
      i++; continue;
    }
    if (n < 4) refuse('unreadable line', i);
    if (n === 4) {
      const afterSteps = inSteps;
      inSteps = false;
      if (afterSteps && /^ {4}-/.test(l)) refuse('unreadable step (a sequence at 4 spaces)', i);
      if (/^ {4}steps:\s*(#.*)?$/.test(l)) inSteps = true;
      else if (/^ {4}steps:/.test(l)) refuse('unreadable steps (an inline value)', i);
      else if (/^ {4}uses:/.test(l)) refuse('unread job shape (a job-level uses:, a reusable workflow)', i);
      else if (/^ {4}continue-on-error:\s*true\s*(#.*)?$/.test(l)) continueJobs.add(job);
      i++; continue;
    }
    if (!inSteps) { i++; continue; }
    if (!/^ {6}- /.test(l)) refuse('unreadable step', i);
    // One step: its first key on the dash line, then its keys at 8, to the next item or a line indented less.
    const fields = new Map<string, string>();
    let j = i;
    let text = l.slice(8);
    for (;;) {
      const kv = /^([A-Za-z][A-Za-z0-9_-]*):(?: +(.*))?$/.exec(text);
      const key = kv?.[1] ?? '';
      if (!kv || !STEP_KEYS.has(key)) refuse('unreadable step', j);
      if (fields.has(key)) refuse(`a second ${key}: in one step`, j);
      const value = scalarOf(kv[2] ?? '');
      const keyAt = j;
      j++;
      if (key === 'run' && value === '|') {
        let first = j;
        while (first < lines.length && (lines[first] ?? '').trim() === '') first++;
        const blockIndent = indentOf(lines[first] ?? '');
        if (first >= lines.length || blockIndent <= 8) refuse('an empty run: | block', keyAt);
        const block: string[] = [];
        while (j < lines.length) {
          const b = lines[j] ?? '';
          if (b.trim() !== '' && indentOf(b) < blockIndent) break;
          block.push(b.slice(blockIndent));
          j++;
        }
        const end = lines[j] ?? '';
        if (j < lines.length && indentOf(end) > 8 && !skippable(end)) refuse('unreadable step (a line inside the run: | block\'s indent)', j);
        fields.set(key, block.join('\n').trim());
      } else if (key === 'run' || key === 'uses') {
        if (value === '') refuse(`an empty ${key}: (a plain multi-line scalar, or nothing)`, keyAt);
        if (/^[|>]/.test(value)) refuse(`a ${key}: block this reader does not read`, keyAt);
        fields.set(key, value);
        while (j < lines.length && skippable(lines[j] ?? '')) j++;
        if (j < lines.length && indentOf(lines[j] ?? '') > 8) refuse(`a one-line ${key}: continued on a deeper line`, j);
      } else {
        if (key === 'shell' && !/bash/.test(value)) throw new Error(`a shell other than bash in ${job}`);
        fields.set(key, value);
        // the key's own deeper lines: a mapping under with: or env:, a continued name
        while (j < lines.length && (skippable(lines[j] ?? '') || indentOf(lines[j] ?? '') > 8)) j++;
      }
      while (j < lines.length && skippable(lines[j] ?? '')) j++;
      const next = lines[j] ?? '';
      if (j >= lines.length || indentOf(next) < 8) break;
      if (indentOf(next) > 8) refuse('unreadable step', j);
      text = next.slice(8);
    }
    const run = fields.get('run');
    const uses = fields.get('uses');
    if (run === undefined && uses === undefined) refuse('a step with neither run: nor uses:', i);
    if (run !== undefined && uses !== undefined) refuse('a step with both run: and uses:', i);
    if (run !== undefined) {
      if (/\$\{\{/.test(run)) throw new Error(`unreadable run shape in ${job}: ${run}`);
      steps.push({ job, index: index++, kind: 'run', text: run, continueOnError: false });
    } else {
      steps.push({ job, index: index++, kind: 'uses', text: uses ?? '', continueOnError: false });
    }
    i = j;
  }
  return steps.map((s) => ({ ...s, continueOnError: continueJobs.has(s.job) }));
}

/** The excluded commands, each by its WHOLE text: a command added inside one of these blocks matches none. */
const INSTALL = 'pnpm install --frozen-lockfile';
const NODE20_CLI_BLOCK = [
  'node --version',
  'node packages/cli/dist/index.js --competition world-cup next MEX',
  'node packages/cli/dist/index.js --competition world-cup table A',
  'node packages/cli/dist/index.js vibe',
  'echo "Node 20 runtime OK"',
].join('\n');
const OS_MATRIX_CLI_BLOCK = [
  'node packages/cli/dist/index.js --competition world-cup next MEX',
  'node packages/cli/dist/index.js --competition world-cup table A',
].join('\n');
const STDIO_SMOKE_FILE = 'node packages/mcp/scripts/stdio-smoke.mjs';
const AUDIT_ALL = 'pnpm audit || true';

/** The exclusions, each with its reason; every other gating command must be a gate step. */
const EXCLUDED: Array<{ match: (s: Step) => boolean; reason: string }> = [
  { match: (s) => s.kind === 'run' && s.text === INSTALL, reason: 'the install: already installed locally' },
  { match: (s) => s.kind === 'run' && s.job === 'runtime-node20' && s.text === NODE20_CLI_BLOCK, reason: 'the Node-20 job runs the BUILT local CLI on the engines floor: a Node-version check the gate cannot make' },
  { match: (s) => s.kind === 'run' && s.job === 'runtime-node20' && s.text === STDIO_SMOKE_FILE, reason: 'the same stdio smoke file under Node 20; the gate runs it through the package script under the developer Node' },
  { match: (s) => s.kind === 'run' && s.job === 'os-matrix' && s.text === OS_MATRIX_CLI_BLOCK, reason: 'the offline CLI smoke on the Windows and macOS runners' },
  { match: (s) => s.kind === 'run' && s.job === 'os-matrix' && s.text === STDIO_SMOKE_FILE, reason: 'the same stdio smoke file on the Windows and macOS runners' },
  { match: (s) => s.kind === 'run' && s.text === AUDIT_ALL, reason: 'non-blocking by its own `|| true`' },
  { match: (s) => s.kind === 'uses' && /^(actions\/checkout|pnpm\/action-setup|actions\/setup-node|actions\/upload-artifact)@/.test(s.text), reason: 'a setup or upload action, not a check' },
];
/** A command the gate runs through another spelling of the same file. */
const EQUIVALENT: Record<string, string> = { [STDIO_SMOKE_FILE]: 'pnpm -F @claudinho/mcp smoke:stdio' };

export function classify(steps: Step[], gateCommands: string[]): { run: Step[]; excluded: Array<[Step, string]>; unclassified: Step[] } {
  const run: Step[] = []; const excluded: Array<[Step, string]> = []; const unclassified: Step[] = [];
  for (const s of steps) {
    if (s.continueOnError) { excluded.push([s, 'a job with continue-on-error is not gating']); continue; }
    const ex = EXCLUDED.find((e) => e.match(s));
    if (ex) { excluded.push([s, ex.reason]); continue; }
    const text = EQUIVALENT[s.text] ?? s.text;
    if (s.kind === 'run' && gateCommands.includes(text)) { run.push(s); continue; }
    unclassified.push(s);
  }
  return { run, excluded, unclassified };
}

describe.skipIf(process.platform === 'win32')('the tripwire: every gating step of ci.yml is a gate step or a named exclusion', () => {
  const yaml = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  const gateList = () => {
    const r = spawnSync(hostTool('bash'), [GATE, '--list'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    return r.stdout.split('\n').filter(Boolean).map((l) => l.split('\t')[1] ?? '');
  };
  /** The workflow with one more job appended, its steps as given. */
  const withJob = (name: string, stepsYaml: string) => `${yaml.trimEnd()}\n  ${name}:\n    runs-on: ubuntu-latest\n    steps:\n${stepsYaml}`;

  it('reads every job, both run forms and the uses steps', () => {
    const steps = workflowSteps(yaml);
    expect(new Set(steps.map((s) => s.job))).toEqual(new Set(['build-test', 'runtime-node20', 'os-matrix', 'coverage', 'audit']));
    expect(steps.some((s) => s.text.includes('\n')), 'a run: | block was read whole').toBe(true);
    expect(steps.find((s) => s.text.startsWith('pnpm lint'))?.text, 'the trailing comment is stripped').toBe('pnpm lint');
    expect(steps.some((s) => s.kind === 'uses')).toBe(true);
  });

  it('classifies every gating command against gate.sh --list: nothing unclassified', () => {
    const { run, unclassified } = classify(workflowSteps(yaml), gateList());
    expect(unclassified.map((s) => `${s.job}#${s.index} ${s.kind}: ${s.text}`)).toEqual([]);
    for (const cmd of ['pnpm -r build', 'pnpm -r typecheck', 'pnpm -r test', 'pnpm lint', 'node scripts/check-pack.mjs', 'node scripts/smoke-statusline.mjs', 'pnpm audit --prod']) {
      expect(run.some((s) => (EQUIVALENT[s.text] ?? s.text) === cmd), cmd).toBe(true);
    }
  });

  it('a synthetic gating job added to the workflow is named by the tripwire', () => {
    const { unclassified } = classify(workflowSteps(withJob('extra-check', '      - run: pnpm run extra-check\n')), gateList());
    expect(unclassified.map((s) => `${s.job}: ${s.text}`)).toEqual(['extra-check: pnpm run extra-check']);
  });

  it('a gating job with an unknown action is named too', () => {
    const { unclassified } = classify(workflowSteps(withJob('extra-action', '      - uses: someone/some-check@abc\n')), gateList());
    expect(unclassified.map((s) => `${s.job}: ${s.text}`)).toEqual(['extra-action: someone/some-check@abc']);
  });

  it('a flow-mapping step (- {run: …}) is refused by the reader, naming the job: never dropped', () => {
    expect(() => workflowSteps(withJob('extra-flow', '      - {run: pnpm run extra-check}\n'))).toThrow(/extra-flow/);
  });

  it('a run: with a plain multi-line scalar (no block indicator) is refused, naming the job', () => {
    expect(() => workflowSteps(withJob('extra-plain', '      - run:\n          pnpm run extra-check\n'))).toThrow(/extra-plain/);
  });

  it('a folded block (run: >) is refused, naming the job', () => {
    expect(() => workflowSteps(withJob('extra-folded', '      - run: >\n          pnpm run\n          extra-check\n'))).toThrow(/extra-folded/);
  });

  it('a step with neither run: nor uses: is refused, naming the job', () => {
    expect(() => workflowSteps(withJob('extra-empty', '      - name: nothing here\n'))).toThrow(/extra-empty/);
  });

  it('an expression inside a run: | block is refused, naming the job', () => {
    expect(() => workflowSteps(withJob('extra-expr', '      - run: |\n          echo ${{ github.sha }}\n'))).toThrow(/extra-expr/);
  });

  it('an unnamed - run: | block (its content two columns in from the dash) is read whole, and is unclassified', () => {
    const steps = workflowSteps(withJob('extra-unnamed', '      - run: |\n        node --version\n        pnpm run extra-check\n'));
    const step = steps.find((s) => s.job === 'extra-unnamed');
    expect(step?.text).toBe('node --version\npnpm run extra-check');
    const { unclassified } = classify(steps, gateList());
    expect(unclassified.map((s) => `${s.job}: ${s.text}`)).toEqual(['extra-unnamed: node --version\npnpm run extra-check']);
  });

  it('a command added inside the Node-20 CLI block is unclassified: an exclusion matches the whole block, never a substring', () => {
    const marker = '          echo "Node 20 runtime OK"\n';
    expect(yaml).toContain(marker);
    const edited = yaml.replace(marker, `${marker}          pnpm run extra-check\n`);
    const { unclassified } = classify(workflowSteps(edited), gateList());
    expect(unclassified.map((s) => `${s.job}: ${s.text.split('\n').pop()}`)).toEqual(['runtime-node20: pnpm run extra-check']);
  });

  it('a command added inside the os-matrix CLI block is unclassified too', () => {
    const marker = '          node packages/cli/dist/index.js --competition world-cup table A\n      - name: Statusline smoke (seeded cache)\n';
    expect(yaml).toContain(marker);
    const edited = yaml.replace(marker, marker.replace('      - name: Statusline', '          pnpm run extra-check\n      - name: Statusline'));
    const { unclassified } = classify(workflowSteps(edited), gateList());
    expect(unclassified.map((s) => `${s.job}: ${s.text.split('\n').pop()}`)).toEqual(['os-matrix: pnpm run extra-check']);
  });

  it('the os-matrix exclusions name the runners the matrix has (Windows and macOS), not three', () => {
    for (const e of EXCLUDED) expect(e.reason).not.toMatch(/three operating systems/);
  });
});
