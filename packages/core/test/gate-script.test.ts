/**
 * `scripts/gate.sh`: CI's gating list run locally, every step printing a verdict, a commit only on all green
 * (PR A, the process made executable). Run OFFLINE under stub `pnpm`, `node`, `git` on a PATH that holds
 * the stubs and a named set of host tools, and nothing else of the host's (the shape of the publish
 * workflow's test). Every stub records the calls it receives, so "no `git commit` ran" is read from the
 * record, never inferred from the script's output.
 *
 * The contract pinned here (the draft's "Tracked", revision 3):
 *   - the steps, in CI's order, each printing `<name> ok (Ns)` or `<name> FAIL (Ns)` (and `audit SKIP (offline)`
 *     for the one offline case); the chain never stops on a FAIL; the exit is nonzero on any FAIL or SKIP;
 *   - `--commit <file>` refuses before any step when `--only` is given, when `git diff --quiet` is nonzero (a
 *     tracked file differs between the working tree and the index) or when an untracked, not ignored file is
 *     listed; records `git write-tree` before the steps and asks the same questions again after them; commits
 *     with `git commit -F <file>` and no `git add` only when every step printed `ok`; `SKIP` refuses unless
 *     `--allow-offline-audit`;
 *   - `--only a,b` runs that subset in order and nothing else, and never commits;
 *   - `--list` prints `<name>\t<command>` per step and runs nothing (the tripwire's source);
 *   - a step's status is the command's own, saved before any `tail` of its log prints.
 * Durations are asserted as "a parenthesized duration is present", never a particular N.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMON_HOST_TOOLS, hostTool, makeSandbox, parses, runScript, type Sandbox } from './hermetic-shell';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const GATE = join(ROOT, 'scripts/gate.sh');
const HOST = [...COMMON_HOST_TOOLS, 'kill'] as const;

/** The stubs. Each reads `$STATE/<flag>` files the test seeds and records every call (the sandbox's prelude). */
const STUBS = {
  // pnpm: `-r typecheck` fails when $STATE/fail-typecheck exists; `audit --prod` fails offline or with a finding.
  pnpm: `
case "$*" in
  "-r typecheck") [ -e "$STATE/fail-typecheck" ] && { echo "src/x.ts(1,1): error TS2322" >&2; exit 2; } ;;
  "-r test") [ -e "$STATE/fail-test" ] && { echo "FAIL test/x.test.ts"; exit 1; } ;;
  "audit --prod")
    [ -e "$STATE/audit-offline" ] && { echo "ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS  request to https://registry.npmjs.org/-/npm/v1/security/audits failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org" >&2; exit 1; }
    [ -e "$STATE/audit-vuln" ] && { echo "2 vulnerabilities found"; echo "Severity: 1 high | 1 moderate" >&2; exit 1; }
    [ -e "$STATE/audit-other" ] && { echo "ERR_PNPM_AUDIT_BAD_RESPONSE  The audit endpoint returned HTML" >&2; exit 1; } ;;
esac
exit 0
`,
  node: 'exit 0\n',
  // git: diff --quiet answers from $STATE/unstaged (first call) and $STATE/unstaged-after (second call); status
  // lists an untracked file when $STATE/untracked exists; write-tree answers T1 then T2 when $STATE/tree-changes.
  git: `
calls="$STATE/git-calls"; echo "$*" >> "$calls"
case "$1 $2" in
  "diff --quiet")
    n=$(grep -c '^diff --quiet' "$calls")
    if [ "$n" -le 1 ]; then [ -e "$STATE/unstaged" ] && exit 1; else [ -e "$STATE/unstaged-after" ] && exit 1; fi
    exit 0 ;;
  "diff --cached") [ -e "$STATE/nothing-staged" ] && exit 0; exit 1 ;;
  "diff --check") exit 0 ;;
  "status --porcelain") [ -e "$STATE/untracked" ] && echo "?? scratch.txt"; exit 0 ;;
  "write-tree "*|"write-tree")
    n=$(grep -c '^write-tree' "$calls")
    if [ "$n" -ge 2 ] && [ -e "$STATE/tree-changes" ]; then echo T2; else echo T1; fi; exit 0 ;;
  "commit -F") exit 0 ;;
  "rev-parse --show-toplevel") echo "$GATE_ROOT"; exit 0 ;;
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
const lines = (out: string) => out.split('\n');
const STEP = /^(\S+) (ok|FAIL|SKIP(?: \([^)]*\))?) \(\d+s\)$/;
const verdictOf = (out: string, name: string) => lines(out).find((l) => l.startsWith(`${name} `) && STEP.test(l));
const gitCalls = (sb: Sandbox) => sb.calls().filter((c) => c.startsWith('git '));
const committed = (sb: Sandbox) => gitCalls(sb).some((c) => /^git commit -F /.test(c));
const added = (sb: Sandbox) => gitCalls(sb).some((c) => /^git add /.test(c));

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

  it('all ok: every line ok with a duration, exit 0, --commit commits once with -F and never git add', () => {
    const sb = sandbox();
    const msg = join(sb.dir, 'msg.txt');
    writeFileSync(msg, 'a message\n');
    const r = run(sb, ['--commit', msg]);
    expect(r.status, r.out).toBe(0);
    for (const name of EXPECTED_STEPS) expect(verdictOf(r.out, name), `${name}: ${r.out}`).toMatch(new RegExp(`^${name} ok \\(\\d+s\\)$`));
    expect(gitCalls(sb).filter((c) => c.startsWith('git commit -F'))).toHaveLength(1);
    expect(added(sb)).toBe(false);
    // the write-tree question was asked before AND after the steps
    expect(gitCalls(sb).filter((c) => c.startsWith('git write-tree')).length).toBeGreaterThanOrEqual(2);
  });

  it('one step failing: that line FAIL with its log tail, the later steps still run, exit nonzero, no commit', () => {
    const sb = sandbox();
    writeFileSync(join(sb.state, 'fail-typecheck'), '');
    const msg = join(sb.dir, 'msg.txt');
    writeFileSync(msg, 'm\n');
    const r = run(sb, ['--commit', msg]);
    expect(r.status).not.toBe(0);
    expect(verdictOf(r.out, 'typecheck')).toMatch(/^typecheck FAIL \(\d+s\)$/);
    expect(r.out).toContain('error TS2322'); // the log tail, under the FAIL line
    for (const later of ['test', 'lint', 'pack', 'diff-check']) expect(verdictOf(r.out, later), later).toMatch(/ ok \(\d+s\)$/);
    expect(r.out).toMatch(/^commit REFUSED \(/m);
    expect(committed(sb)).toBe(false);
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
    const msg = join(sb.dir, 'msg.txt');
    writeFileSync(msg, 'm\n');
    const r = run(sb, ['--only', 'build', '--commit', msg]);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/^commit REFUSED \(.*--only/m);
    expect(sb.calls().filter((c) => c.startsWith('pnpm '))).toEqual([]);
    expect(committed(sb)).toBe(false);
  });

  it('an unstaged edit (git diff --quiet nonzero) refuses --commit before any step', () => {
    const sb = sandbox();
    writeFileSync(join(sb.state, 'unstaged'), '');
    const msg = join(sb.dir, 'msg.txt');
    writeFileSync(msg, 'm\n');
    const r = run(sb, ['--commit', msg]);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/^commit REFUSED \(unstaged/m);
    expect(sb.calls().filter((c) => c.startsWith('pnpm '))).toEqual([]);
    expect(committed(sb)).toBe(false);
  });

  it('an untracked, not ignored file refuses --commit (the checks could read what no commit carries)', () => {
    const sb = sandbox();
    writeFileSync(join(sb.state, 'untracked'), '');
    const msg = join(sb.dir, 'msg.txt');
    writeFileSync(msg, 'm\n');
    const r = run(sb, ['--commit', msg]);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/^commit REFUSED \(untracked/m);
    expect(committed(sb)).toBe(false);
  });

  it('the working tree changing during the steps refuses the commit (the second git diff --quiet)', () => {
    const sb = sandbox();
    writeFileSync(join(sb.state, 'unstaged-after'), '');
    const msg = join(sb.dir, 'msg.txt');
    writeFileSync(msg, 'm\n');
    const r = run(sb, ['--commit', msg]);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/^commit REFUSED \(.*changed during the gate/m);
    expect(committed(sb)).toBe(false);
  });

  it('the index changing during the steps (write-tree differs) refuses the commit', () => {
    const sb = sandbox();
    writeFileSync(join(sb.state, 'tree-changes'), '');
    const msg = join(sb.dir, 'msg.txt');
    writeFileSync(msg, 'm\n');
    const r = run(sb, ['--commit', msg]);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/^commit REFUSED \(.*changed during the gate/m);
    expect(committed(sb)).toBe(false);
  });

  it('audit offline (a registry-unreachable signature): SKIP (offline), exit nonzero, --commit refused unless allowed', () => {
    const sb = sandbox();
    writeFileSync(join(sb.state, 'audit-offline'), '');
    const msg = join(sb.dir, 'msg.txt');
    writeFileSync(msg, 'm\n');
    const r = run(sb, ['--commit', msg]);
    expect(r.status).not.toBe(0);
    expect(verdictOf(r.out, 'audit')).toMatch(/^audit SKIP \(offline\) \(\d+s\)$/);
    expect(committed(sb)).toBe(false);
    const sb2 = sandbox();
    writeFileSync(join(sb2.state, 'audit-offline'), '');
    const msg2 = join(sb2.dir, 'msg.txt');
    writeFileSync(msg2, 'm\n');
    const r2 = run(sb2, ['--commit', msg2, '--allow-offline-audit']);
    expect(committed(sb2)).toBe(true);
    expect(r2.out).toMatch(/allow-offline-audit/); // the allowance is printed on the commit line
  });

  it('audit with a finding (no offline signature): FAIL, --commit refused whatever the flags', () => {
    const sb = sandbox();
    writeFileSync(join(sb.state, 'audit-vuln'), '');
    const msg = join(sb.dir, 'msg.txt');
    writeFileSync(msg, 'm\n');
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
 * the command. A copy of the workflow with a synthetic gating job must fail the classification.
 */
type Step = { job: string; index: number; kind: 'run' | 'uses'; text: string; continueOnError: boolean };

/** A small YAML-free reader of the workflow's jobs: enough for this file's shape, refusing what it does not read. */
export function workflowSteps(yaml: string): Step[] {
  const lines = yaml.split('\n');
  const steps: Step[] = [];
  let job = '';
  let jobContinue = false;
  let inSteps = false;
  let index = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? '';
    const jobKey = /^  ([a-z][a-z0-9-]*):\s*$/.exec(l);
    if (jobKey && !inSteps) { job = jobKey[1] ?? ''; jobContinue = false; index = 0; }
    else if (jobKey && inSteps && l.startsWith('  ') && !l.startsWith('    ')) { job = jobKey[1] ?? ''; jobContinue = false; inSteps = false; index = 0; }
    if (/^    continue-on-error:\s*true/.test(l)) jobContinue = true;
    if (/^    steps:\s*$/.test(l)) { inSteps = true; continue; }
    if (!inSteps) continue;
    const run = /^      - run: (.*)$/.exec(l) ?? /^        run: (.*)$/.exec(l);
    const uses = /^      - uses: (.*)$/.exec(l) ?? /^        uses: (.*)$/.exec(l);
    if (run) {
      let text = run[1] ?? '';
      if (text === '|') {
        // the block: to the first less-indented line, as the publish workflow's test reads one
        const block: string[] = [];
        for (let j = i + 1; j < lines.length; j++) {
          const b = lines[j] ?? '';
          if (b.trim() && !b.startsWith('          ')) break;
          block.push(b.slice(10));
        }
        text = block.join('\n').trim();
      }
      text = text.replace(/\s+#.*$/, '').trim();
      if (/\$\{\{/.test(text)) throw new Error(`unreadable run shape in ${job}: ${text}`);
      steps.push({ job, index: index++, kind: 'run', text, continueOnError: jobContinue });
    } else if (uses) {
      steps.push({ job, index: index++, kind: 'uses', text: (uses[1] ?? '').replace(/\s+#.*$/, '').trim(), continueOnError: jobContinue });
    }
    if (/^        shell:/.test(l) && !/bash/.test(l)) throw new Error(`a shell other than bash in ${job}`);
  }
  return steps;
}

/** The exclusions, each with its reason; every other gating command must be a gate step. */
const EXCLUDED: Array<{ match: (s: Step) => boolean; reason: string }> = [
  { match: (s) => s.kind === 'run' && /^pnpm install --frozen-lockfile$/.test(s.text), reason: 'the install: already installed locally' },
  { match: (s) => s.kind === 'run' && s.job === 'runtime-node20' && /node packages\/cli\/dist\/index\.js/.test(s.text), reason: 'the Node-20 job runs the BUILT local CLI on the engines floor: a Node-version check the gate cannot make' },
  { match: (s) => s.kind === 'run' && s.job === 'runtime-node20' && /node packages\/mcp\/scripts\/stdio-smoke\.mjs/.test(s.text), reason: 'the same stdio smoke file under Node 20; the gate runs it through the package script under the developer Node' },
  { match: (s) => s.kind === 'run' && s.job === 'os-matrix' && /node packages\/cli\/dist\/index\.js/.test(s.text), reason: 'the offline CLI smoke on three operating systems' },
  { match: (s) => s.kind === 'run' && s.job === 'os-matrix' && /node packages\/mcp\/scripts\/stdio-smoke\.mjs/.test(s.text), reason: 'the same stdio smoke file on three operating systems' },
  { match: (s) => s.kind === 'run' && /^pnpm audit \|\| true$/.test(s.text), reason: 'non-blocking by its own `|| true`' },
  { match: (s) => s.kind === 'uses' && /^(actions\/checkout|pnpm\/action-setup|actions\/setup-node|actions\/upload-artifact)@/.test(s.text), reason: 'a setup or upload action, not a check' },
];
/** A command the gate runs through another spelling of the same file. */
const EQUIVALENT: Record<string, string> = { 'node packages/mcp/scripts/stdio-smoke.mjs': 'pnpm -F @claudinho/mcp smoke:stdio' };

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
    const extra = `${yaml.trimEnd()}\n  extra-check:\n    name: extra\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm run extra-check\n`;
    const { unclassified } = classify(workflowSteps(extra), gateList());
    expect(unclassified.map((s) => `${s.job}: ${s.text}`)).toEqual(['extra-check: pnpm run extra-check']);
  });

  it('a gating job with an unknown action is named too', () => {
    const extra = `${yaml.trimEnd()}\n  extra-action:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: someone/some-check@abc\n`;
    const { unclassified } = classify(workflowSteps(extra), gateList());
    expect(unclassified.map((s) => `${s.job}: ${s.text}`)).toEqual(['extra-action: someone/some-check@abc']);
  });
});
