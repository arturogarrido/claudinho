/**
 * The release workflow's Registry job (0.11 · 2.7c): npm serves a freshly
 * published version minutes after the publish job ends (0.10.0 on the
 * publisher's attempt 6 of 6, 0.10.1 on 8 of 12), so the job WAITS for npm to
 * serve the version before the first `mcp-publisher publish`, and the
 * publisher's own retries are spent on Registry errors only.
 *
 * The wait is pinned on its OWN step's text (from its `- name:` line to the
 * next step's): the publisher's step has its own `::error::` and `exit` lines,
 * which a search of the whole job would match in the wait's place. It waits to
 * a DEADLINE (eight minutes), every probe bounded (`npm view` has no timeout of
 * its own: up to five minutes with two retries, so a count of attempts bounds
 * nothing), exits 0 when npm serves the version, and fails with its own
 * `::error::` past the deadline.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Line endings made LF at the read: a Windows checkout gives the workflow CRLF, and every anchor below is a whole line.
const yml = readFileSync(fileURLToPath(new URL('../../../.github/workflows/publish.yml', import.meta.url)), 'utf8').replace(
  /\r\n/g,
  '\n',
);
const job = yml.slice(yml.indexOf('mcp-registry:'));
const WAIT = '- name: Wait for npm to serve the version';

/** A step's own text in the Registry job: its `- name:` line up to the next step's (or the end). */
function stepText(name: string): string {
  const at = job.indexOf(name);
  if (at < 0) return '';
  const next = job.indexOf('- name:', at + name.length);
  return next < 0 ? job.slice(at) : job.slice(at, next);
}
const wait = stepText(WAIT);

describe('publish.yml, the mcp-registry job', () => {
  it('has a step that polls npm for the version, before the first publish attempt', () => {
    expect(wait, 'the wait step').not.toBe('');
    expect(wait).toMatch(/npm view @claudinho\/mcp@/);
    const publish = job.indexOf('mcp-publisher publish');
    expect(publish).toBeGreaterThan(0);
    expect(job.indexOf(WAIT), 'the wait comes before the publisher').toBeLessThan(publish);
  });

  it('waits to an eight-minute deadline, not a count of attempts, and prints the elapsed seconds on every attempt', () => {
    expect(wait).toMatch(/DEADLINE=\$\(\(SECONDS \+ 480\)\)/);
    expect(wait).toMatch(/while \[ "?\$SECONDS"? -lt "?\$DEADLINE"? \]/);
    expect(wait).not.toMatch(/\bseq\b/);
    expect(wait).toMatch(/sleep \d+/);
    // Every attempt's line (served or not yet) carries the elapsed seconds.
    const attempts = wait.split('\n').filter((l) => /echo "attempt /.test(l));
    expect(attempts.length).toBeGreaterThanOrEqual(2);
    for (const l of attempts) expect(l).toMatch(/\$\{?SECONDS\}?/);
  });

  it('bounds every probe, so a slow npm cannot outrun the deadline and the job timeout', () => {
    // Both halves of the bound, on the probe itself: GNU `timeout` ends the
    // probe whatever npm does, and npm's own options keep its one request
    // inside that (no retries: with npm's default two, one probe can take
    // about 115 s and the step outruns the bound the comment states).
    const probe = wait.split('\n').find((l) => /\bnpm view\b/.test(l)) ?? '';
    expect(probe).toMatch(/\btimeout \d+ npm view\b/);
    expect(probe).toMatch(/--fetch-timeout=\d+/);
    expect(probe).toMatch(/--fetch-retries=0\b/);
    // The job's own timeout leaves room for the wait and the publisher's retries after it.
    const minutes = Number(/timeout-minutes: (\d+)/.exec(job)?.[1]);
    expect(minutes).toBeGreaterThanOrEqual(15);
  });

  it("keeps each probe's stderr and prints the last one with its error, so a 404, a network failure, a timed-out probe and a missing npm are told apart", () => {
    const probe = wait.split('\n').find((l) => /\bnpm view\b/.test(l)) ?? '';
    expect(probe).not.toMatch(/2>\s*\/dev\/null/);
    // The probe's stderr goes to a file, and the step's own error prints that file's tail.
    const err = /2>("[^"\s]+")/.exec(probe)?.[1];
    expect(err, probe).toBeTruthy();
    // The status is the probe's own: captured on the probe line, where `|| true`
    // would make it 0 and a `PIPESTATUS` would read another command's.
    expect(probe).toMatch(/\) && RC=0 \|\| RC=\$\?\s*$/);
    const after = wait.slice(wait.indexOf('::error::'));
    // The SAME quoted token, whole: `"$ERR"`, not a file nothing writes.
    expect(after).toMatch(new RegExp(`\\b(head|tail|cat)\\b[^\\n]*${(err as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|;|$)`));
    // Every "not yet" attempt says why: the probe's exit status (124 is `timeout`'s).
    const notYet = wait.split('\n').filter((l) => /echo "attempt /.test(l) && /yet/.test(l));
    expect(notYet.length).toBeGreaterThanOrEqual(1);
    for (const l of notYet) expect(l).toMatch(/exit \$\{?\w+\}?/);
  });

  it('exits 0 when npm serves the version, and fails with its own ::error:: past the deadline', () => {
    expect(wait).toMatch(/if \[ "\$GOT" = "\$V" \]; then[^\n]*\bexit 0\b/);
    expect(wait).toMatch(/::error::[^\n]*\bexit 1\b/);
  });
});

/**
 * The step's `run:` block, de-indented: the lines under `run: |` up to the
 * first non-blank line indented less than its first (the block's end in YAML;
 * the next step's comment, which the step's own text runs into, is not part of
 * it), the script the runner executes under `bash -e`, with the deadline and
 * the sleep shortened (the two literals are pinned above; the behaviour is the
 * same at any length): the served state ends on its second probe, the four
 * others run to the two-second deadline, about ten seconds for the file.
 */
function stepScript(): string {
  return runBlock(wait, 'the wait step')
    .replace('DEADLINE=$((SECONDS + 480))', 'DEADLINE=$((SECONDS + 2))')
    .replace(/\bsleep 20\b/g, 'sleep 0.2');
}

/** A step's `run: |` block, de-indented: its lines up to the first non-blank one indented less than its first. */
function runBlock(step: string, what: string): string {
  const at = step.indexOf('run: |');
  expect(at, `${what} has a run block`).toBeGreaterThan(0);
  const lines = step.slice(at + 'run: |'.length).split('\n').slice(1);
  const indent = /^(\s*)\S/.exec(lines.find((l) => l.trim()) ?? '')?.[1] ?? '';
  const block: string[] = [];
  for (const l of lines) {
    if (l.trim() && !l.startsWith(indent)) break;
    block.push(l.slice(indent.length));
  }
  return block.join('\n');
}

/** Where the host keeps a tool, so the step's PATH can hold that tool and nothing else. */
function hostTool(name: string): string {
  return execFileSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).trim();
}

/** npm's own refusal of a version it does not serve (npm 11), five lines. */
const E404 = [
  'npm error code E404',
  'npm error 404 No match found for version 0.11.0',
  'npm error 404',
  "npm error 404  '@claudinho/mcp@0.11.0' is not in this registry.",
  'npm error A complete log of this run can be found in: /home/runner/.npm/_logs/debug-0.log',
];
/** A network refusal: the code and the reason first, generic advice after (npm 11 prints 21 lines). */
const ECONNREFUSED = [
  'npm error code ECONNREFUSED',
  'npm error syscall connect',
  'npm error errno ECONNREFUSED',
  'npm error FetchError: request to https://registry.npmjs.org/@claudinho%2fmcp failed, reason: connect ECONNREFUSED',
  'npm error     at ClientRequest.<anonymous>',
  'npm error  If you are behind a proxy, please make sure that the',
  "npm error 'proxy' config is set properly.  See: 'npm help config'",
  'npm error A complete log of this run can be found in: /home/runner/.npm/_logs/debug-0.log',
];

type Stub = { npm?: string; timeout?: string };
/** Runs the step under `bash -e` with stand-in `npm` and `timeout` scripts first on PATH. */
function runStep(stub: Stub): { status: number | null; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'wait-step-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  // The stand-in `timeout` ignores its bound and ends the command after 0.3 s
  // with GNU timeout's status, 124: one hung probe must not take 20 s here.
  const timeout = stub.timeout ?? '#!/bin/bash\nshift\n"$@" & p=$!\nfor i in 1 2 3; do sleep 0.1; kill -0 $p 2>/dev/null || { wait $p; exit $?; }; done\nkill $p 2>/dev/null; wait $p 2>/dev/null; exit 124\n';
  writeFileSync(join(bin, 'timeout'), timeout);
  chmodSync(join(bin, 'timeout'), 0o755);
  if (stub.npm !== undefined) {
    writeFileSync(join(bin, 'npm'), stub.npm);
    chmodSync(join(bin, 'npm'), 0o755);
  }
  // The step's PATH holds the stubs and links to the three host tools the
  // step and the stubs call, and nothing else: a host that keeps a real npm
  // in /usr/bin would otherwise answer the no-npm state with a live request.
  const tools = join(dir, 'tools');
  mkdirSync(tools);
  for (const name of ['sleep', 'head', 'cat']) symlinkSync(hostTool(name), join(tools, name));
  // bash by its host path: the child's PATH (below) is where the SCRIPT looks, and spawn looks there too.
  const r = spawnSync(hostTool('bash'), ['-e', '-c', stepScript()], {
    env: { PATH: `${bin}:${tools}`, HOME: dir, RUNNER_TEMP: dir, GITHUB_REF_NAME: 'v0.11.0', COUNT: join(dir, 'count') },
    encoding: 'utf8',
    timeout: 20000,
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}
const stderrLines = (lines: string[]) => lines.map((l) => `echo ${JSON.stringify(l)} >&2`).join('\n');
const notYet = (out: string) => out.split('\n').filter((l) => /^attempt \d+ \(\d+s\): npm does not serve/.test(l));

describe.skipIf(process.platform === 'win32')('the wait step, run offline under stand-in npm and timeout', () => {
  it('is the run block alone, and parses: the extraction stops where the YAML block does', () => {
    const script = stepScript();
    expect(script).not.toMatch(/- name:|mcp-publisher/);
    expect(spawnSync('bash', ['-n', '-c', script], { encoding: 'utf8' }).status, script).toBe(0);
  });

  it('exits 0 the moment npm serves the version, after saying why the earlier probe failed', () => {
    const npm = `#!/bin/bash\nn=$(cat "$COUNT" 2>/dev/null || echo 0); n=$((n + 1)); echo $n > "$COUNT"\nif [ $n -ge 2 ]; then echo 0.11.0; exit 0; fi\n${stderrLines(E404)}\nexit 1\n`;
    const { status, out } = runStep({ npm });
    expect(status, out).toBe(0);
    expect(out).toMatch(/^attempt 2 \(\d+s\): npm serves @claudinho\/mcp@0\.11\.0$/m);
    expect(notYet(out), out).toEqual([expect.stringMatching(/\(exit 1\); retrying/)]);
    expect(out).not.toMatch(/::error::/);
  });

  it('a version npm never serves: exit 1, every attempt with status 1, and the refusal printed under the error', () => {
    const { status, out } = runStep({ npm: `#!/bin/bash\n${stderrLines(E404)}\nexit 1\n` });
    expect(status, out).toBe(1);
    expect(notYet(out).length).toBeGreaterThanOrEqual(2);
    for (const l of notYet(out)) expect(l).toMatch(/\(exit 1\); retrying/);
    const error = out.indexOf('::error::');
    expect(error, out).toBeGreaterThanOrEqual(0);
    expect(out.slice(error)).toContain('npm error code E404');
  });

  it('a network refusal: the error code and the reason reach the log, not only the advice npm prints last', () => {
    const { status, out } = runStep({ npm: `#!/bin/bash\n${stderrLines(ECONNREFUSED)}\nexit 1\n` });
    expect(status, out).toBe(1);
    const tail = out.slice(out.indexOf('::error::'));
    expect(tail).toContain('npm error code ECONNREFUSED');
    expect(tail).toContain('reason: connect ECONNREFUSED');
  });

  it("a probe that hangs: every attempt says timeout's own status, 124", () => {
    // `exec`: the sleeper IS the probe process, so the stand-in timeout's kill
    // ends the writer of the substitution's pipe (a child left behind would
    // hold it open and the substitution would wait for it).
    const { status, out } = runStep({ npm: '#!/bin/bash\nexec sleep 30\n' });
    expect(status, out).toBe(1);
    expect(notYet(out).length).toBeGreaterThanOrEqual(1);
    for (const l of notYet(out)) expect(l).toMatch(/\(exit 124\); retrying/);
  });

  it('no npm on the runner: every attempt says 127', () => {
    const { status, out } = runStep({});
    expect(status, out).toBe(1);
    expect(notYet(out).length).toBeGreaterThanOrEqual(1);
    for (const l of notYet(out)) expect(l).toMatch(/\(exit 127\); retrying/);
  });
});

/**
 * The publish workflow runs on a `v*` tag push alone (0.13.0: the manual
 * trigger is gone; a failed run is re-run on its own tag). The build job, the
 * first of the run and the one every other job needs, builds only a commit
 * `main` contains: its first step after the checkout fetches `main` and fails
 * unless `git merge-base --is-ancestor "$GITHUB_SHA" refs/remotes/origin/main`
 * holds, so a tag on the release branch's own commit stops before anything is
 * installed and before any job that publishes starts. The rule is ancestry, not a ref's
 * name, and it still refuses a run on a branch ref, which no trigger starts
 * since 0.13.0. Then the tag step refuses any ref that is not `refs/tags/v*`
 * and any tag that is not every package's version, on every run. Both steps
 * are run here offline, the ancestry step against a repository made for the
 * case, in checkouts made as actions/checkout makes them: on a tag push the
 * tag's commit alone, depth 1; on a branch the branch's commit alone, as a
 * local branch of the same name.
 *
 * The trigger and the `if:` checks are source-text guards (a tripwire, not a
 * parser): the `on:` block must read, comments and blank lines aside, exactly
 * `push:` then `tags: ["v*"]`, so any trigger written in any form fails the
 * test rather than passing it; a condition on the ref is looked for as
 * `startsWith(github.ref` and `github.ref ==` anywhere, and as any
 * `github.<...>ref` (`ref_type`, `ref_name`, `event.ref`, `base_ref`,
 * `head_ref`) on an `if:` line, a step's first key (`- if:`) included: the
 * spellings a YAML author reaches for, not every way to write one (a condition
 * on an environment variable, or an `if:` whose expression continues on the
 * next line, is outside it).
 */
/**
 * The workflow's jobs by name: each job's text from its two-space key line up
 * to the next job's key line or the end of the `jobs:` block. A comment line
 * between two jobs belongs to the job above it, so a pin on what a job RUNS
 * reads `code(job)`, the job with its comment lines removed.
 */
function jobsOf(text: string): Map<string, string> {
  const at = text.search(/^jobs:\s*$/m);
  const jobs = new Map<string, string>();
  if (at < 0) return jobs;
  let name = '';
  let lines: string[] = [];
  for (const l of text.slice(at).split('\n').slice(1)) {
    if (/^\S/.test(l)) break;
    const key = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(l);
    if (key) {
      if (name) jobs.set(name, lines.join('\n'));
      name = key[1] as string;
      lines = [l];
    } else if (name) lines.push(l);
  }
  if (name) jobs.set(name, lines.join('\n'));
  return jobs;
}
/** A job's text without its comment lines and without the comment that ends a line. */
function code(text: string): string {
  return text
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .map((l) => l.replace(/\s+#.*$/, ''))
    .join('\n');
}
const jobs = jobsOf(yml);
const buildJob = jobs.get('build') ?? '';
const ON_MAIN = '- name: Verify the commit is on main';
const TAG_STEP = '- name: Verify tag matches all package versions';
/** A step's own text in a job: its `- name:` line up to the next step's (or the job's end). */
function stepIn(jobText: string, name: string): string {
  const at = jobText.indexOf(name);
  if (at < 0) return '';
  const next = jobText.indexOf('\n      - ', at + name.length);
  return next < 0 ? jobText.slice(at) : jobText.slice(at, next);
}
const tagStep = stepIn(buildJob, TAG_STEP);
const onMain = stepIn(buildJob, ON_MAIN);

describe('publish.yml, the trigger', () => {
  it('runs on a `v*` tag push alone: no manual trigger, no other event', () => {
    const at = yml.search(/^on:\s*$/m);
    expect(at, 'an `on:` block').toBeGreaterThanOrEqual(0);
    const rest = yml.slice(at).split('\n').slice(1);
    const end = rest.findIndex((l) => /^\S/.test(l));
    const body = rest
      .slice(0, end < 0 ? rest.length : end)
      .map((l) => l.replace(/\s+#.*$/, '').replace(/\s+$/, ''))
      .filter((l) => l.trim() && !/^\s*#/.test(l));
    expect(body).toEqual(['  push:', '    tags: ["v*"]']);
    expect(yml).not.toMatch(/workflow_dispatch/);
  });

  it('no step or job is conditioned on the ref: the tag step refuses every other ref itself', () => {
    expect(yml).not.toMatch(/startsWith\(\s*github\.ref\b/);
    expect(yml).not.toMatch(/github\.ref\s*==/);
    for (const l of yml.split('\n').filter((l) => /^\s*(-\s*)?if:/.test(l))) expect(l).not.toMatch(/github\.[\w.]*ref/);
    expect(tagStep, 'the tag step').not.toBe('');
    expect(tagStep).not.toMatch(/^\s*if:/m);
    expect(buildJob.indexOf(TAG_STEP)).toBeGreaterThan(0);
    expect(buildJob.indexOf(TAG_STEP), 'the tag step runs before the install').toBeLessThan(buildJob.indexOf('pnpm install'));
  });
});

describe('publish.yml, the build job', () => {
  it('checks the commit is on main first after the checkout, on every trigger, before the install and the pack', () => {
    expect(onMain, 'the ancestry step').not.toBe('');
    // Not skipped (an `if:` on the step), and its failure not let through: a `continue-on-error`, or a later step
    // run on failure (`always()`, `failure()`, `cancelled()` in an `if:`), would publish an off-main commit. A
    // tripwire on those spellings, not every way to write one.
    expect(onMain).not.toMatch(/^\s*if:/m);
    expect(yml, 'no job or step lets a failure through').not.toMatch(/^\s*continue-on-error:/m);
    for (const l of yml.split('\n').filter((l) => /^\s*(-\s*)?if:/.test(l))) {
      expect(l).not.toMatch(/\b(always|failure|cancelled)\(\)/);
    }
    expect(onMain).toMatch(/git fetch [^\n]*\+refs\/heads\/main:refs\/remotes\/origin\/main/);
    // The ref in full: the shorthand `origin/main` resolves to a local branch of that name first.
    expect(onMain).toMatch(/git merge-base --is-ancestor "\$GITHUB_SHA" refs\/remotes\/origin\/main;/);
    expect(onMain).not.toMatch(/[\s"]origin\/main\b/);
    const steps = buildJob.split('\n').filter((l) => /^ {6}- (uses|name|run):/.test(l));
    expect(steps[0]).toMatch(/actions\/checkout@/);
    expect(steps[1]).toContain(ON_MAIN);
    const at = buildJob.indexOf(ON_MAIN);
    for (const later of ['pnpm install', 'Verify tag matches all package versions', ' pack ']) {
      expect(buildJob.indexOf(later), later).toBeGreaterThan(at);
    }
  });
});

describe.skipIf(process.platform === 'win32')('the ancestry step, run offline against a local origin', () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const root = mkdtempSync(join(tmpdir(), 'on-main-'));
  const gitEnv = {
    ...process.env,
    HOME: root,
    GIT_CONFIG_GLOBAL: join(root, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@example.invalid',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@example.invalid',
  };
  writeFileSync(gitEnv.GIT_CONFIG_GLOBAL, '');
  // origin: main is a -> b -> c; the release branch's own commit r sits on b.
  const origin = join(root, 'origin');
  mkdirSync(origin);
  git(origin, 'init', '-q', '-b', 'main');
  const commit = (msg: string) => {
    git(origin, 'commit', '-q', '--allow-empty', '-m', msg);
    return git(origin, 'rev-parse', 'HEAD');
  };
  commit('a');
  const b = commit('b');
  git(origin, 'checkout', '-q', '-b', 'release');
  const r = commit('r');
  git(origin, 'checkout', '-q', 'main');
  const c = commit('c');
  // v1.0.0 is annotated, as this repository's v0.1.0 is: the checkout holds the tag object too.
  git(origin, 'tag', '-a', '-m', 'v1.0.0', 'v1.0.0', c);
  const cTag = git(origin, 'rev-parse', 'v1.0.0');
  git(origin, 'tag', 'v0.9.0', b);
  git(origin, 'tag', 'v1.0.1', r);
  // Branch refs (no trigger starts a run on one since 0.13.0; the step refuses them anyway): one at r, and one at r
  // NAMED like the remote-tracking ref.
  git(origin, 'branch', 'feature', r);
  git(origin, 'branch', 'origin/main', r);
  // The step's PATH holds git alone (the script calls nothing else); bash is spawned by its host path.
  const tools = join(root, 'tools');
  mkdirSync(tools);
  symlinkSync(hostTool('git'), join(tools, 'git'));

  /** A checkout of one tag as actions/checkout makes it (depth 1, no other refs), then the step's script in it. */
  function runOnMain(tag: string, sha: string, url = `file://${origin}`, githubSha = sha) {
    const work = mkdtempSync(join(root, 'work-'));
    git(work, 'init', '-q');
    git(work, 'remote', 'add', 'origin', `file://${origin}`);
    git(work, 'fetch', '-q', '--depth=1', '--no-tags', 'origin', `+refs/tags/${tag}:refs/tags/${tag}`);
    git(work, 'checkout', '-q', '--detach', sha);
    git(work, 'remote', 'set-url', 'origin', url);
    return runIn(work, githubSha, `refs/tags/${tag}`);
  }

  /** A run on a branch ref, as actions/checkout makes it: the branch's commit alone, then a local branch of its name. */
  function runOnBranch(branch: string) {
    const work = mkdtempSync(join(root, 'work-'));
    git(work, 'init', '-q');
    git(work, 'remote', 'add', 'origin', `file://${origin}`);
    git(work, 'fetch', '-q', '--depth=1', '--no-tags', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`);
    git(work, 'checkout', '-q', '-B', branch, `refs/remotes/origin/${branch}`);
    return runIn(work, git(work, 'rev-parse', 'HEAD'), `refs/heads/${branch}`);
  }

  function runIn(work: string, githubSha: string, githubRef: string) {
    const shallow = readFileSync(join(work, '.git', 'shallow'), 'utf8').trim();
    const r = spawnSync(hostTool('bash'), ['-e', '-c', runBlock(onMain, 'the ancestry step')], {
      cwd: work,
      env: { ...gitEnv, PATH: tools, GITHUB_SHA: githubSha, GITHUB_REF: githubRef },
      encoding: 'utf8',
      timeout: 20000,
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}`, shallow };
  }

  it('is the run block alone, and parses', () => {
    const script = runBlock(onMain, 'the ancestry step');
    expect(script).not.toMatch(/- name:|- uses:|pnpm/);
    expect(spawnSync('bash', ['-n', '-c', script], { encoding: 'utf8' }).status, script).toBe(0);
  });

  it("passes on main's tip, an annotated tag, whether GITHUB_SHA names the commit or the tag object", () => {
    expect(cTag, 'v1.0.0 is a tag object').not.toBe(c);
    for (const githubSha of [c, cTag]) {
      const { status, out, shallow } = runOnMain('v1.0.0', c, `file://${origin}`, githubSha);
      expect(shallow, 'the checkout is the commit alone').toBe(c);
      expect(status, out).toBe(0);
      expect(out).toContain(`${githubSha} is on main`);
    }
  });

  it('passes on a commit main contains below its tip (main moved on after the tag), from a depth-1 checkout', () => {
    const { status, out, shallow } = runOnMain('v0.9.0', b);
    expect(shallow).toBe(b);
    expect(status, out).toBe(0);
    expect(out).toContain(`${b} is on main`);
  });

  it("fails on the release branch's own commit, whose parent main contains", () => {
    const { status, out } = runOnMain('v1.0.1', r);
    expect(status, out).toBe(1);
    expect(out).toMatch(new RegExp(`::error::${r} \\(refs/tags/v1\\.0\\.1\\) is not on main`));
    expect(out).not.toContain('is on main\n');
  });

  it("a run on main's branch ref passes on main's tip (the rule is ancestry, not the ref)", () => {
    const { status, out, shallow } = runOnBranch('main');
    expect(shallow).toBe(c);
    expect(status, out).toBe(0);
    expect(out).toContain(`${c} is on main`);
  });

  it('a run on a branch whose commit main does not contain fails', () => {
    const { status, out } = runOnBranch('feature');
    expect(status, out).toBe(1);
    expect(out).toMatch(new RegExp(`::error::${r} \\(refs/heads/feature\\) is not on main`));
  });

  it('a run on a branch NAMED origin/main, at a commit main does not contain, fails', () => {
    const { status, out } = runOnBranch('origin/main');
    expect(status, out).toBe(1);
    expect(out).toMatch(new RegExp(`::error::${r} \\(refs/heads/origin/main\\) is not on main`));
  });

  it('fails when main cannot be fetched: no answer is not a pass', () => {
    const { status, out } = runOnMain('v1.0.0', c, `file://${join(root, 'nowhere')}`);
    expect(status, out).not.toBe(0);
    expect(out).not.toContain(`${c} is on main`);
  });
});

describe.skipIf(process.platform === 'win32')('the tag step, run offline against three package files', () => {
  const VERSION = '1.2.3';
  /** A checkout holding the three published packages at `versions`, and the step's script run in it on `ref`. */
  function runTag(ref: string, versions: Record<'core' | 'cli' | 'mcp', string> = { core: VERSION, cli: VERSION, mcp: VERSION }) {
    const work = mkdtempSync(join(tmpdir(), 'tag-step-'));
    for (const [pkg, version] of Object.entries(versions)) {
      mkdirSync(join(work, 'packages', pkg), { recursive: true });
      writeFileSync(join(work, 'packages', pkg, 'package.json'), JSON.stringify({ name: `@claudinho/${pkg}`, version }));
    }
    // The step's PATH holds node alone (the script calls nothing else); bash is spawned by its host path.
    const tools = join(work, 'tools');
    mkdirSync(tools);
    symlinkSync(hostTool('node'), join(tools, 'node'));
    const name = ref.replace(/^refs\/(tags|heads)\//, '');
    const r = spawnSync(hostTool('bash'), ['-e', '-c', runBlock(tagStep, 'the tag step')], {
      cwd: work,
      env: { PATH: tools, HOME: work, GITHUB_REF: ref, GITHUB_REF_NAME: name },
      encoding: 'utf8',
      timeout: 20000,
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  }

  it('is the run block alone, and parses', () => {
    const script = runBlock(tagStep, 'the tag step');
    expect(script).not.toMatch(/- name:|- uses:|pnpm -r/);
    expect(spawnSync('bash', ['-n', '-c', script], { encoding: 'utf8' }).status, script).toBe(0);
  });

  it('passes on a version tag every package carries', () => {
    const { status, out } = runTag(`refs/tags/v${VERSION}`);
    expect(status, out).toBe(0);
    expect(out).toContain(`all package versions match ${VERSION}`);
  });

  it('fails on a version tag one package does not carry', () => {
    const { status, out } = runTag(`refs/tags/v${VERSION}`, { core: VERSION, cli: '1.2.2', mcp: VERSION });
    expect(status, out).toBe(1);
    expect(out).toMatch(/::error::packages\/cli version 1\.2\.2 != tag v1\.2\.3/);
  });

  it('fails on a branch NAMED like the version tag, whose name the version comparison would pass', () => {
    const { status, out } = runTag(`refs/heads/v${VERSION}`);
    expect(status, out).toBe(1);
    expect(out).toContain(`::error::refs/heads/v${VERSION} is not a version tag`);
    expect(out).not.toContain('all package versions match');
  });

  it('fails on a branch ref and on a tag that is not a version tag', () => {
    for (const ref of ['refs/heads/main', 'refs/tags/release-1.2.3']) {
      const { status, out } = runTag(ref);
      expect(status, `${ref}: ${out}`).toBe(1);
      expect(out).toContain(`::error::${ref} is not a version tag`);
    }
  });
});

/**
 * The split (SEC-1, SEC-2 of the Nov 10, 2026 security review). The npm credential, `id-token: write`, is never in a
 * job that checks out the repository or installs or runs a dependency: the `build` job installs, builds, tests and
 * packs with `contents: read` alone and uploads the three tarballs and `server.json` as one artifact; the `publish`
 * job, in the `release` environment, downloads that artifact and runs `npm publish` on each tarball; the `release`
 * job writes the GitHub Release; the `mcp-registry` job publishes `server.json` from the same artifact. Source-text
 * guards over the shapes this file reads (a tripwire, not a YAML parser: a shape it does not read fails), then the
 * new steps' run blocks executed offline.
 */
type Perms = Map<string, string> | null;
/** A job's `permissions:` as a map, `{}` as an empty map, absent as undefined, any other shape (`write-all`) as null. */
function permsOf(jobText: string): Perms | undefined {
  const lines = code(jobText).split('\n');
  const at = lines.findIndex((l) => /^ {4}permissions:/.test(l));
  if (at < 0) return undefined;
  const rest = (lines[at] as string).replace(/^ {4}permissions:/, '').trim();
  if (rest === '{}') return new Map();
  if (rest !== '') return null;
  const map = new Map<string, string>();
  for (const l of lines.slice(at + 1)) {
    if (!l.trim()) continue;
    const m = /^ {6}([a-z-]+): (read|write|none)\s*$/.exec(l);
    if (!m) {
      if (/^ {6}/.test(l)) return null;
      break;
    }
    map.set(m[1] as string, m[2] as string);
  }
  return map;
}
/** A job's `needs:` as a list: `needs: a` or `needs: [a, b]`; none as []; any other shape as null. */
function needsOf(jobText: string): string[] | null {
  const line = code(jobText)
    .split('\n')
    .find((l) => /^ {4}needs:/.test(l));
  if (line === undefined) return [];
  const rest = line.replace(/^ {4}needs:/, '').trim();
  if (/^[A-Za-z0-9_-]+$/.test(rest)) return [rest];
  const list = /^\[([A-Za-z0-9_, -]+)\]$/.exec(rest);
  return list ? (list[1] as string).split(',').map((s) => s.trim()) : null;
}
/** A job's steps, each from its `      - ` line to the next one's. */
function stepsOf(jobText: string): string[] {
  const at = jobText.indexOf('\n    steps:');
  if (at < 0) return [];
  const parts = jobText.slice(at).split(/\n(?= {6}- )/);
  return parts.slice(1);
}
const publishJob = jobs.get('publish') ?? '';
const releaseJob = jobs.get('release') ?? '';
const registryJob = jobs.get('mcp-registry') ?? '';
/** What runs a dependency or a file of the repository: an install, a package manager, a repository script. */
const RUNS_REPO_CODE = [
  /actions\/checkout@/,
  /pnpm\/action-setup@/,
  /\bpnpm\b/,
  /\bnpm (install|i|ci|exec|run|run-script|rebuild|link|pack|x)\b/,
  /\bnpx\b/,
  /\byarn\b/,
  /\bcorepack\b/,
  /\b(node|bash|sh|tsx) (\.\/)?(scripts|packages)\//,
  /\.\/scripts\//,
  /^\s*(container|services):/m,
];
const ARTIFACT = /name: (release-files)\s*$/m;
/**
 * What a job holding `id-token: write` may not run besides the list above: an interpreter or a shell given a file
 * (the artifact is written by the build job, adversary one), `source`, or a `./` path other than the sha256-verified
 * `./mcp-publisher`. `node` runs only inline (`node -e`, `node -p`).
 */
const RUNS_A_FILE = [
  /(^|[\s;&|(`$])(bash|sh|zsh|dash|python3?|perl|ruby|tsx|ts-node|deno|bun)\s/m,
  /(^|[\s;&|(`$])(source|\.)\s+\S/m,
  /\bnode\b(?!-version|@| -[ep] )/,
  /(^|[\s;&|(`$])\.\/(?!mcp-publisher\b)\S/m,
];

describe('publish.yml, the split: the npm credential never meets the repository or a dependency', () => {
  it('has the four jobs, in the order they run', () => {
    expect([...jobs.keys()]).toEqual(['build', 'publish', 'release', 'mcp-registry']);
    expect(needsOf(buildJob)).toEqual([]);
    expect(needsOf(publishJob)).toEqual(['build']);
    expect(needsOf(releaseJob)).toEqual(['publish']);
    // The Registry job reads build's outputs (needs it directly) and runs after the Release, so after npm.
    expect(new Set(needsOf(registryJob))).toEqual(new Set(['build', 'release']));
  });

  it('grants no permission at the workflow level: every job states the least it needs', () => {
    const top = yml.split('\n').filter((l) => /^permissions:/.test(l));
    expect(top).toEqual(['permissions: {}']);
    expect(yml).not.toMatch(/\b(write-all|read-all)\b/);
    expect(Object.fromEntries(permsOf(buildJob) ?? [])).toEqual({ contents: 'read' });
    expect(Object.fromEntries(permsOf(publishJob) ?? [])).toEqual({ 'id-token': 'write' });
    expect(Object.fromEntries(permsOf(releaseJob) ?? [])).toEqual({ contents: 'write' });
    expect(Object.fromEntries(permsOf(registryJob) ?? [])).toEqual({ 'id-token': 'write' });
  });

  it('no job that holds `id-token: write` checks out the repository, installs, or runs a dependency or a repository script', () => {
    const holders = [...jobs].filter(([, text]) => permsOf(text)?.get('id-token') === 'write').map(([name]) => name);
    expect(holders).toEqual(['publish', 'mcp-registry']);
    for (const name of holders) {
      const text = code(jobs.get(name) as string);
      for (const re of RUNS_REPO_CODE) expect(text, `${name}: ${re}`).not.toMatch(re);
      for (const re of RUNS_A_FILE) expect(text, `${name}: ${re}`).not.toMatch(re);
    }
    // The only `uses:` in those jobs are the artifact download and, in publish, setup-node.
    for (const name of holders) {
      const uses = code(jobs.get(name) as string).match(/uses: [^\s@]+@/g) ?? [];
      for (const u of uses) expect(['uses: actions/download-artifact@', 'uses: actions/setup-node@'], `${name}: ${u}`).toContain(u);
    }
  });

  it('the publish job sets no npm configuration of its own and writes nothing for later steps to inherit', () => {
    // npm reads `npm_config_*` and `NPM_CONFIG_*` from the environment; a step writing GITHUB_ENV or GITHUB_PATH
    // changes what every later step runs with. setup-node writes its own .npmrc and NPM_CONFIG_USERCONFIG, which do
    // not appear in this file.
    expect(code(publishJob)).not.toMatch(/npm_config_/i);
    expect(code(publishJob)).not.toMatch(/\bGITHUB_(ENV|PATH)\b/);
  });

  it('only the publish job names an environment, and it is `release`', () => {
    const lines = yml.split('\n').filter((l) => /^\s*environment:/.test(l));
    expect(lines).toEqual(['    environment: release']);
    expect(code(publishJob)).toMatch(/^ {4}environment: release$/m);
  });

  it('every checkout sets `persist-credentials: false`', () => {
    const checkouts = [...jobs.values()].flatMap(stepsOf).filter((s) => /uses: actions\/checkout@/.test(s));
    expect(checkouts.length).toBe(1);
    for (const s of checkouts) expect(s).toMatch(/^\s+persist-credentials: false\s*$/m);
  });

  it('every action is pinned to a full commit SHA with its version beside it', () => {
    const uses = yml.split('\n').filter((l) => /^\s*(-\s*)?uses:/.test(l));
    expect(uses.length).toBeGreaterThan(0);
    for (const l of uses) expect(l).toMatch(/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d/);
  });
});

describe('publish.yml, the build job packs what the publish job publishes', () => {
  const steps = stepsOf(buildJob);
  const at = (re: RegExp) => steps.findIndex((s) => re.test(s));
  it('gates, then installs, builds, tests, lints, packs, refuses a workspace range, records the sums, and uploads', () => {
    const order = [
      /uses: actions\/checkout@/,
      /- name: Verify the commit is on main/,
      /- name: Verify tag matches all package versions/,
      /run: pnpm install --frozen-lockfile/,
      /run: pnpm -r build/,
      /run: pnpm -r typecheck/,
      /run: pnpm -r test/,
      /run: pnpm lint/,
      /- name: Pack the three packages/,
      /- name: Refuse a workspace range in a packed manifest/,
      /- name: Record the sha256 of the release files/,
      /uses: actions\/upload-artifact@/,
    ].map(at);
    for (const i of order) expect(i).toBeGreaterThanOrEqual(0);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('packs each package with pnpm (which rewrites `workspace:` ranges) and puts server.json beside the tarballs', () => {
    const pack = stepIn(buildJob, '- name: Pack the three packages');
    expect(pack).toMatch(/for p in core cli mcp; do/);
    expect(pack).toMatch(/pnpm --filter "@claudinho\/\$p" pack --pack-destination "\$OUT"/);
    expect(pack).toMatch(/cp packages\/mcp\/server\.json "\$OUT\/server\.json"/);
    expect(pack).toMatch(/^\s+OUT="\$RUNNER_TEMP\/release"$/m);
    for (const name of ['- name: Refuse a workspace range in a packed manifest', '- name: Record the sha256 of the release files']) {
      expect(stepIn(buildJob, name), name).toMatch(/^\s+working-directory: \$\{\{ runner\.temp \}\}\/release$/m);
    }
  });

  it('uploads the release files as one artifact that fails when empty and replaces itself on a re-run, and exposes the sums', () => {
    const upload = steps[at(/uses: actions\/upload-artifact@/)] ?? '';
    expect(upload).toMatch(ARTIFACT);
    expect(upload).toMatch(/if-no-files-found: error/);
    expect(upload).toMatch(/overwrite: true/);
    expect(upload).toMatch(/^\s+path: \$\{\{ runner\.temp \}\}\/release\/$/m);
    // A dotfile written by the build job (a `.npmrc`) never reaches a job that runs npm: upload-artifact's default.
    expect(upload).not.toMatch(/include-hidden-files/);
    expect(code(buildJob)).toMatch(/^ {4}outputs:\n {6}sums: \$\{\{ steps\.sums\.outputs\.sums \}\}$/m);
    expect(stepIn(buildJob, '- name: Record the sha256 of the release files')).toMatch(/^\s+id: sums$/m);
  });
});

describe('publish.yml, the publish job: no checkout, no install, the release environment', () => {
  const steps = stepsOf(publishJob);
  it('downloads the build artifact, sets up Node 24 against the npm registry, requires npm 11.5.1, checks the sums, publishes', () => {
    expect(steps[0]).toMatch(/uses: actions\/download-artifact@/);
    expect(steps[0]).toMatch(ARTIFACT);
    expect(steps[1]).toMatch(/uses: actions\/setup-node@/);
    expect(steps[1]).toMatch(/node-version: 24\s*$/m);
    expect(steps[1]).toMatch(/registry-url: https:\/\/registry\.npmjs\.org/);
    expect(steps[1]).not.toMatch(/cache:/);
    expect(steps[2]).toMatch(/- name: Require npm 11\.5\.1 or later/);
    expect(steps[3]).toMatch(/- name: Verify the release files against the build job's sums/);
    expect(steps[4]).toMatch(/- name: Publish to npm with provenance/);
    expect(steps.length).toBe(5);
  });

  it('publishes core, then cli and mcp, each skipped when npm already serves its version, and stops at the first failure', () => {
    const loop = runBlock(stepIn(publishJob, '- name: Publish to npm with provenance'), 'the publish step');
    expect(loop.split('\n')[0]).toBe('set -euo pipefail');
    expect(loop).toMatch(/for p in core cli mcp; do/);
    expect(loop.indexOf('npm view')).toBeGreaterThan(0);
    expect(loop.indexOf('npm view')).toBeLessThan(loop.indexOf('npm publish'));
    expect(loop).toMatch(/npm publish "\$tgz" --provenance --access public --ignore-scripts --registry "\$REGISTRY"/);
    expect(loop).toMatch(/npm view "\$name@\$V" version --registry "\$REGISTRY" --fetch-timeout=\d+ --fetch-retries=\d/);
    expect(loop).toMatch(/^REGISTRY=https:\/\/registry\.npmjs\.org\/$/m);
    // npm runs in a directory the step made, never in the artifact's: no project .npmrc or package.json of the build's.
    expect(stepIn(publishJob, '- name: Publish to npm with provenance')).not.toMatch(/working-directory:/);
  });
});

describe('publish.yml, the release and Registry jobs', () => {
  it('the release job writes the Release without a checkout, naming the repository itself, and skips one that exists', () => {
    expect(code(releaseJob)).not.toMatch(/actions\/checkout@/);
    const step = stepIn(releaseJob, '- name: Create GitHub Release');
    expect(step).toMatch(/GH_REPO: \$\{\{ github\.repository \}\}/);
    expect(step).toMatch(/if gh release view "\$GITHUB_REF_NAME" >\/dev\/null 2>&1; then/);
    expect(step).toMatch(/gh release create "\$GITHUB_REF_NAME" --verify-tag --latest/);
  });

  it('the Registry job reads server.json from the build artifact, after checking it against the sums, and stays out of the environment', () => {
    const steps = stepsOf(registryJob);
    expect(steps[0]).toMatch(/uses: actions\/download-artifact@/);
    expect(steps[0]).toMatch(ARTIFACT);
    expect(steps[1]).toMatch(/- name: Verify the release files against the build job's sums/);
    expect(code(registryJob)).toMatch(/SERVER_JSON: release\/server\.json/);
    expect(code(registryJob)).not.toMatch(/environment:/);
    // The same check in both jobs, word for word.
    expect(runBlock(steps[1] as string, 'the Registry sums step')).toBe(
      runBlock(stepIn(publishJob, "- name: Verify the release files against the build job's sums"), 'the publish sums step'),
    );
  });

  it('both download steps put the artifact where the steps after them read it', () => {
    for (const j of [publishJob, registryJob]) {
      const dl = stepsOf(j)[0] ?? '';
      expect(dl).toMatch(/path: release\s*$/m);
    }
    for (const j of [publishJob, registryJob]) {
      const sums = stepIn(j, "- name: Verify the release files against the build job's sums");
      expect(sums).toMatch(/working-directory: release\s*$/m);
      expect(sums).toMatch(/^\s+SUMS: \$\{\{ needs\.build\.outputs\.sums \}\}$/m);
    }
    expect(runBlock(stepIn(publishJob, '- name: Publish to npm with provenance'), 'the publish step')).toMatch(
      /FILES="\$GITHUB_WORKSPACE\/release"/,
    );
  });
});

/** Writes `package/package.json` holding `manifest` into `<dir>/<file>` as a gzip tarball, as `pnpm pack` lays one out. */
function tarball(dir: string, file: string, manifest: object): void {
  const src = mkdtempSync(join(tmpdir(), 'pkg-'));
  mkdirSync(join(src, 'package'));
  writeFileSync(join(src, 'package', 'package.json'), JSON.stringify(manifest));
  execFileSync('tar', ['-czf', join(dir, file), '-C', src, 'package']);
}
const V3 = '1.2.3';
const RELEASE_FILES = [`claudinho-core-${V3}.tgz`, `claudinho-cli-${V3}.tgz`, `claudinho-mcp-${V3}.tgz`, 'server.json'];
const manifestOf = (p: string) => ({ name: `@claudinho/${p}`, version: V3, publishConfig: { access: 'public' } });
/** A release directory as a download step leaves it, `<workspace>/release`: the three tarballs at `V3` and server.json. */
function releaseDir(manifests: Partial<Record<'core' | 'cli' | 'mcp', object>> = {}): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'workspace-')), 'release');
  mkdirSync(dir);
  for (const p of ['core', 'cli', 'mcp'] as const) {
    tarball(dir, `claudinho-${p}-${V3}.tgz`, manifests[p] ?? manifestOf(p));
  }
  writeFileSync(join(dir, 'server.json'), JSON.stringify({ version: V3 }));
  return dir;
}
/** Runs a step's run block under `bash -e` in `cwd`, with `bin` (stubs) then the named host tools on PATH. */
function runIn(cwd: string, script: string, env: Record<string, string>, tools: string[], stubs: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'step-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  for (const [name, body] of Object.entries(stubs)) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  const host = join(dir, 'tools');
  mkdirSync(host);
  for (const name of tools) symlinkSync(hostTool(name), join(host, name));
  const r = spawnSync(hostTool('bash'), ['-e', '-c', script], {
    cwd,
    env: { PATH: `${bin}:${host}`, HOME: dir, GITHUB_REF_NAME: `v${V3}`, ...env },
    encoding: 'utf8',
    timeout: 20000,
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, dir };
}

describe.skipIf(process.platform === 'win32')('the release-file steps, run offline', () => {
  // A step this file cannot find is an empty script here, and each test below fails on it rather than the file.
  const block = (step: string) => (step.includes('run: |') ? runBlock(step, 'a step') : '');
  const NPM_STEP = block(stepIn(publishJob, '- name: Require npm 11.5.1 or later'));
  const SUMS_STEP = block(stepIn(publishJob, "- name: Verify the release files against the build job's sums"));
  const RECORD_STEP = block(stepIn(buildJob, '- name: Record the sha256 of the release files'));
  const WS_STEP = block(stepIn(buildJob, '- name: Refuse a workspace range in a packed manifest'));
  const PUBLISH_STEP = block(stepIn(publishJob, '- name: Publish to npm with provenance'));
  const SUM_TOOLS = ['sha256sum', 'sed', 'sort', 'grep', 'cat'];

  it('each run block parses', () => {
    for (const s of [NPM_STEP, SUMS_STEP, RECORD_STEP, WS_STEP, PUBLISH_STEP]) {
      expect(s.trim(), 'a run block').not.toBe('');
      expect(spawnSync('bash', ['-n', '-c', s], { encoding: 'utf8' }).status, s).toBe(0);
    }
  });

  it('npm 11.5.1 or later passes; an older npm, or none, fails with its own error', () => {
    const at = (v: string | null) =>
      runIn(tmpdir(), NPM_STEP, {}, ['node'], v === null ? {} : { npm: `#!/bin/sh\necho ${v}\n` });
    for (const v of ['11.5.1', '11.19.1', '11.10.0', '12.0.0']) expect(at(v).status, v).toBe(0);
    for (const v of ['10.9.9', '11.5.0', '11.4.9', '9.9.9']) {
      const r = at(v);
      expect(r.status, `${v}: ${r.out}`).not.toBe(0);
      expect(r.out).toMatch(/::error::/);
    }
    expect(at(null).status).not.toBe(0);
  });

  it("the build job's sums, recorded and then checked, pass; a changed, missing, unlisted or doubled file fails", () => {
    const dir = releaseDir();
    const temp = mkdtempSync(join(tmpdir(), 'runner-temp-'));
    const out = join(temp, 'out');
    writeFileSync(out, '');
    const rec = runIn(dir, RECORD_STEP, { GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: join(temp, 'summary'), RUNNER_TEMP: temp }, SUM_TOOLS);
    expect(rec.status, rec.out).toBe(0);
    const m = /^sums<<(\w+)\n([\s\S]*?)\n\1$/m.exec(readFileSync(out, 'utf8'));
    expect(m, readFileSync(out, 'utf8')).toBeTruthy();
    const sums = (m as RegExpExecArray)[2] as string;
    expect(sums.split('\n')).toHaveLength(4);
    expect(readFileSync(join(temp, 'summary'), 'utf8')).toContain(sums);
    // The record step writes nothing into the directory it uploads: the artifact is the four files.
    expect(readdirSync(dir).sort()).toEqual([...RELEASE_FILES].sort());
    const check = (s: string, cwd = dir) => runIn(cwd, SUMS_STEP, { SUMS: s }, SUM_TOOLS);
    expect(check(sums).status, check(sums).out).toBe(0);
    // A changed file.
    const other = releaseDir({ cli: { name: '@claudinho/cli', version: V3, evil: true } });
    expect(check(sums, other).status).not.toBe(0);
    // A line removed, a line doubled, a malformed line, an empty list.
    const lines = sums.split('\n');
    for (const bad of [
      lines.slice(1).join('\n'),
      [...lines, lines[0]].join('\n'),
      [...lines.slice(1), `xyz  ${lines[0]?.split('  ')[1]}`].join('\n'),
      '',
      // The four good lines and a malformed fifth: `sha256sum -c` alone ignores the fifth.
      [...lines, 'not-a-sum-line'].join('\n'),
    ]) {
      const r = check(bad);
      expect(r.status, `${bad}\n${r.out}`).not.toBe(0);
    }
    // A file the sums do not list, a dotfile among them, is refused: npm never meets a `.npmrc` of the build's.
    for (const extra of ['.npmrc', 'prepare.sh']) {
      const more = releaseDir();
      writeFileSync(join(more, extra), 'registry=http://attacker.example/\n');
      const r = check(sums, more);
      expect(r.status, `${extra}: ${r.out}`).not.toBe(0);
      expect(r.out).toMatch(/::error::/);
    }
  });

  it('refuses a packed manifest that still carries a `workspace:` range, and a missing tarball', () => {
    expect(runIn(releaseDir(), WS_STEP, {}, ['tar', 'grep', 'gzip']).status).toBe(0);
    for (const range of ['workspace:*', 'workspace:^', 'workspace:~', 'workspace:1.2.3']) {
      const ws = runIn(releaseDir({ mcp: { ...manifestOf('mcp'), devDependencies: { '@claudinho/core': range } } }), WS_STEP, {}, ['tar', 'grep', 'gzip']);
      expect(ws.status, `${range}: ${ws.out}`).not.toBe(0);
      expect(ws.out).toMatch(/::error::claudinho-mcp-1\.2\.3\.tgz/);
    }
    const dir = releaseDir();
    rmSync(join(dir, `claudinho-cli-${V3}.tgz`));
    expect(runIn(dir, WS_STEP, {}, ['tar', 'grep', 'gzip']).status).not.toBe(0);
  });

  /**
   * A stub npm: `view` answers the version for each name in $ON_NPM (and fails otherwise, as npm 11 does with
   * E404), `publish` logs its arguments and fails for the name in $FAIL_ON; every call is logged to $LOG.
   */
  const NPM = `#!/bin/bash
echo "$*" >> "$LOG"
# Where npm runs, and how many entries that directory holds when it does.
echo "$PWD $(ls -A | wc -l | tr -d ' ')" >> "$WHERE"
if [ "$1" = view ]; then
  name=\${2%@*}; v=\${2##*@}
  case " $ON_NPM " in *" $name "*) echo "$v"; exit 0;; esac
  [ -n "$VIEW_SAYS" ] && { echo "$VIEW_SAYS"; exit 0; }
  echo "npm error code E404" >&2; exit 1
fi
if [ "$1" = publish ]; then
  case "$2" in *"$FAIL_ON"*) [ -n "$FAIL_ON" ] && { echo "npm error 403" >&2; exit 1; };; esac
  exit 0
fi
exit 2
`;
  const REG = 'https://registry.npmjs.org/';
  let files = '';
  /** Runs the publish step from the workspace that holds `dir` (`<workspace>/release`), as the job does. */
  function publish(dir: string, env: Record<string, string> = {}) {
    const logs = mkdtempSync(join(tmpdir(), 'npm-log-'));
    const temp = mkdtempSync(join(tmpdir(), 'runner-temp-'));
    const log = join(logs, 'npm.log');
    const where = join(logs, 'where.log');
    writeFileSync(log, '');
    writeFileSync(where, '');
    files = dir;
    const workspace = join(dir, '..');
    const r = runIn(
      workspace,
      PUBLISH_STEP,
      { LOG: log, WHERE: where, ON_NPM: '', FAIL_ON: '', VIEW_SAYS: '', GITHUB_WORKSPACE: workspace, RUNNER_TEMP: temp, ...env },
      ['tar', 'node', 'gzip', 'mktemp', 'ls', 'wc', 'tr'],
      { npm: NPM },
    );
    const lines = (f: string) => readFileSync(f, 'utf8').split('\n').filter(Boolean);
    return { ...r, calls: lines(log), where: lines(where), temp };
  }
  const PUB = (p: string) => `publish ${files}/claudinho-${p}-${V3}.tgz --provenance --access public --ignore-scripts --registry ${REG}`;
  const VIEW = (p: string) => `view @claudinho/${p}@${V3} version --registry ${REG} --fetch-timeout=20000 --fetch-retries=1`;

  it('publishes core, then cli, then mcp when npm has none of them', () => {
    const r = publish(releaseDir());
    expect(r.status, r.out).toBe(0);
    expect(r.calls).toEqual([VIEW('core'), PUB('core'), VIEW('cli'), PUB('cli'), VIEW('mcp'), PUB('mcp')]);
  });

  it('runs npm in an empty directory of its own under RUNNER_TEMP, never in the artifact directory', () => {
    const r = publish(releaseDir());
    expect(r.where).toHaveLength(6);
    for (const w of r.where) {
      const [dir, entries] = w.split(' ');
      expect(dir?.startsWith(r.temp), w).toBe(true);
      expect(entries, w).toBe('0');
    }
  });

  it("refuses a tarball whose publishConfig is anything but {\"access\":\"public\"}, before npm reads it", () => {
    for (const publishConfig of [
      { access: 'public', registry: 'http://registry.npmjs.org/' },
      { access: 'public', proxy: 'http://attacker.example:8080' },
      { access: 'public', provenance: false },
      { access: 'restricted' },
      undefined,
    ]) {
      const r = publish(releaseDir({ cli: { name: '@claudinho/cli', version: V3, publishConfig } }));
      expect(r.status, `${JSON.stringify(publishConfig)}: ${r.out}`).not.toBe(0);
      expect(r.out).toMatch(/::error::claudinho-cli-1\.2\.3\.tgz holds /);
      expect(r.calls).toEqual([VIEW('core'), PUB('core')]);
    }
  });

  it('skips a version npm already serves, so a re-run after a partial publish is safe', () => {
    const r = publish(releaseDir(), { ON_NPM: '@claudinho/core @claudinho/cli' });
    expect(r.status, r.out).toBe(0);
    expect(r.calls).toEqual([VIEW('core'), VIEW('cli'), VIEW('mcp'), PUB('mcp')]);
    expect(r.out).toMatch(/@claudinho\/core@1\.2\.3 is already on npm; skipping/);
  });

  it('a view that fails, or answers another version, is not a skip', () => {
    expect(publish(releaseDir()).calls.filter((c) => c.startsWith('publish'))).toHaveLength(3);
    const r = publish(releaseDir(), { VIEW_SAYS: '1.2.30' });
    expect(r.calls.filter((c) => c.startsWith('publish'))).toHaveLength(3);
  });

  it('stops at the first failed publish: cli and mcp are never published when core failed', () => {
    const r = publish(releaseDir(), { FAIL_ON: 'claudinho-core' });
    expect(r.status, r.out).not.toBe(0);
    expect(r.calls).toEqual([VIEW('core'), PUB('core')]);
  });

  it('refuses a tarball whose manifest is not the package and version the tag names, before asking npm about it', () => {
    for (const manifest of [
      { ...manifestOf('cli'), version: '1.2.4' },
      { ...manifestOf('core') },
      { ...manifestOf('cli'), name: 'claudinho-cli' },
    ]) {
      const r = publish(releaseDir({ cli: manifest }));
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toMatch(/::error::claudinho-cli-1\.2\.3\.tgz holds /);
      expect(r.calls).toEqual([VIEW('core'), PUB('core')]);
    }
    const dir = releaseDir();
    rmSync(join(dir, `claudinho-mcp-${V3}.tgz`));
    const r = publish(dir);
    expect(r.status).not.toBe(0);
    expect(r.calls).not.toContain(PUB('mcp'));
  });
});
