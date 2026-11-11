/**
 * CI's `audit (shipped deps)` job. It is a required check, so it reports on every run under the same name, but
 * the audit itself (the install and both `pnpm audit` steps) runs only where its answer can change because of
 * the change being tested: a pull request that edits what decides the dependency tree (`pnpm-lock.yaml`,
 * `pnpm-workspace.yaml`, any `package.json`) or this workflow, and every event that is not a pull request (a push
 * to main always audits). A third-party advisory published against an unchanged tree no longer turns an
 * unrelated pull request red; Dependabot's alerts report it.
 *
 * The decision is one step (`id: changed`) whose script is run here, offline, in a temporary repository built
 * the way a pull request's checkout is: GitHub's merge commit, its first parent the base branch's tip, fetched
 * two deep. Any failure to read the difference audits.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const yml = readFileSync(fileURLToPath(new URL('../../../.github/workflows/ci.yml', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

/** One job's text: its two-space key line up to the next key at that indent (or the end of the `jobs:` block). */
function jobText(text: string, id: string): string {
  const lines = text.slice(text.search(/^jobs:\s*$/m)).split('\n').slice(1);
  const start = lines.indexOf(`  ${id}:`);
  if (start < 0) return '';
  const end = lines.findIndex((l, i) => i > start && (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(l) || /^\S/.test(l)));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}
/** A job's steps, each its own text from its `      - ` line to the next. */
function stepsOf(job: string): string[] {
  const out: string[] = [];
  for (const l of job.split('\n')) {
    if (/^ {6}- /.test(l)) out.push(l);
    else if (out.length && (/^ {8}/.test(l) || !l.trim())) out[out.length - 1] += `\n${l}`;
  }
  return out;
}
/** A step's `run: |` block, de-indented. */
function runBlock(step: string): string {
  const lines = step.slice(step.indexOf('run: |') + 'run: |'.length).split('\n').slice(1);
  const indent = /^(\s*)\S/.exec(lines.find((l) => l.trim()) ?? '')?.[1] ?? '';
  const block: string[] = [];
  for (const l of lines) {
    if (l.trim() && !l.startsWith(indent)) break;
    block.push(l.slice(indent.length));
  }
  return block.join('\n');
}

const audit = jobText(yml, 'audit');
const steps = stepsOf(audit);
const decide = steps.find((s) => /^ {8}id: changed\s*$/m.test(s)) ?? '';
const GATED = /^ {8}if: steps\.changed\.outputs\.audit == 'true'\s*$/m;

describe('ci.yml, the audit job', () => {
  it('keeps its name and has no job-level condition, so the required check reports on every run', () => {
    expect(audit, 'the audit job').not.toBe('');
    expect(audit).toMatch(/^ {4}name: audit \(shipped deps\)\s*$/m);
    expect(audit).not.toMatch(/^ {4}if:/m);
  });

  it('checks out two deep, so the merge commit and its first parent are both there', () => {
    const checkout = steps.find((s) => /uses: actions\/checkout@/.test(s)) ?? '';
    expect(checkout).toMatch(/^ {10}fetch-depth: 2\s*$/m);
    expect(steps.indexOf(checkout)).toBeLessThan(steps.indexOf(decide));
  });

  it('decides in one step, from the event name, before anything is installed', () => {
    expect(decide, 'the step with id: changed').not.toBe('');
    expect(decide).toMatch(/^ {10}EVENT_NAME: \$\{\{ github\.event_name \}\}\s*$/m);
    const install = steps.findIndex((s) => /pnpm install --frozen-lockfile/.test(s));
    expect(steps.indexOf(decide)).toBeLessThan(install);
    expect(decide).not.toMatch(GATED);
  });

  it('gates the install and both audits on that decision, and nothing that runs them is left ungated', () => {
    const runsIt = steps.filter((s) => /pnpm (install|audit)\b/.test(s));
    expect(runsIt.length).toBe(3);
    for (const s of runsIt) expect(s, s.split('\n')[0]).toMatch(GATED);
    expect(runsIt.some((s) => /pnpm audit --prod\s*$/m.test(s))).toBe(true);
  });
});

describe.skipIf(process.platform === 'win32')('ci.yml, the audit decision, run', () => {
  const script = decide ? runBlock(decide) : 'exit 99';
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
      cwd,
      encoding: 'utf8',
    });
  const write = (root: string, rel: string, body: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  const BASE = ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', 'packages/cli/package.json', '.github/workflows/ci.yml', '.github/workflows/publish.yml', 'README.md', 'packages/cli/src/a.ts'];

  /**
   * A pull request's checkout: a base commit, the branch's commit changing `changed`, and GitHub's merge commit
   * checked out (first parent the base tip). `mainMoves` changes files on the base after the branch was cut.
   */
  function prRepo(changed: string[], mainMoves: string[] = []): string {
    const root = mkdtempSync(join(tmpdir(), 'ci-audit-'));
    git(root, 'init', '-q', '-b', 'main');
    for (const f of BASE) write(root, f, `${f}\n`);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'base');
    git(root, 'checkout', '-q', '-b', 'pr');
    for (const f of changed) write(root, f, `${f} changed\n`);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '--allow-empty', '-m', 'pr');
    git(root, 'checkout', '-q', 'main');
    if (mainMoves.length) {
      for (const f of mainMoves) write(root, f, `${f} moved on main\n`);
      git(root, 'add', '-A');
      git(root, 'commit', '-q', '-m', 'main moves');
    }
    git(root, 'merge', '-q', '--no-ff', '--no-edit', 'pr');
    return root;
  }
  function decideIn(cwd: string, event: string): { audit: string | undefined; status: number | null; out: string } {
    const output = join(mkdtempSync(join(tmpdir(), 'ci-audit-out-')), 'out');
    writeFileSync(output, '');
    const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
      cwd,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME, EVENT_NAME: event, GITHUB_OUTPUT: output },
    });
    const lines = readFileSync(output, 'utf8').split('\n').filter((l) => l.startsWith('audit='));
    expect(lines.length, `one audit= line: ${r.stdout}${r.stderr}`).toBeLessThanOrEqual(1);
    return { audit: lines[0]?.slice('audit='.length), status: r.status, out: r.stdout + r.stderr };
  }

  for (const file of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', 'packages/cli/package.json', 'packages/new/package.json', '.github/workflows/ci.yml'])
    it(`a pull request that changes ${file} audits`, () => {
      const r = decideIn(prRepo([file, 'README.md']), 'pull_request');
      expect(r.status, r.out).toBe(0);
      expect(r.audit, r.out).toBe('true');
    });

  it('a pull request that changes none of them skips the audit, and says why', () => {
    const r = decideIn(prRepo(['README.md', 'packages/cli/src/a.ts', '.github/workflows/publish.yml', 'packages/cli/package.json.bak']), 'pull_request');
    expect(r.status, r.out).toBe(0);
    expect(r.audit, r.out).toBe('false');
    expect(r.out.trim(), 'a skipped audit prints a line saying so').not.toBe('');
  });

  it("a lockfile change on the base branch alone does not audit the pull request (the difference is the merge's, against its first parent)", () => {
    const r = decideIn(prRepo(['README.md'], ['pnpm-lock.yaml']), 'pull_request');
    expect(r.audit, r.out).toBe('false');
  });

  for (const event of ['push', 'workflow_dispatch', 'schedule', 'merge_group', ''])
    it(`${event || 'an empty event name'} audits, whatever changed`, () => {
      const r = decideIn(prRepo(['README.md']), event);
      expect(r.status, r.out).toBe(0);
      expect(r.audit, r.out).toBe('true');
    });

  it('a pull request whose base cannot be read (a one-deep checkout) audits', () => {
    const shallow = mkdtempSync(join(tmpdir(), 'ci-audit-shallow-'));
    git(shallow, 'clone', '-q', '--depth', '1', `file://${prRepo(['README.md'])}`, 'c');
    const r = decideIn(join(shallow, 'c'), 'pull_request');
    expect(r.status, r.out).toBe(0);
    expect(r.audit, r.out).toBe('true');
  });

  it('a pull request outside any repository audits', () => {
    const r = decideIn(mkdtempSync(join(tmpdir(), 'ci-audit-none-')), 'pull_request');
    expect(r.status, r.out).toBe(0);
    expect(r.audit, r.out).toBe('true');
  });
});
