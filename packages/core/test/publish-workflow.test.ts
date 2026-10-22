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
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
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
 * trigger is gone; a failed run is re-run on its own tag). The publish job
 * publishes only a commit `main` contains: its first step after the checkout
 * fetches `main` and fails unless
 * `git merge-base --is-ancestor "$GITHUB_SHA" refs/remotes/origin/main` holds,
 * so a tag on the release branch's own commit stops before anything is
 * installed with the credential in the job. The rule is ancestry, not a ref's
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
const publishJob = yml.slice(yml.indexOf('\n  publish:\n'), yml.indexOf('\n  mcp-registry:'));
const ON_MAIN = '- name: Verify the commit is on main';
const TAG_STEP = '- name: Verify tag matches all package versions';
/** A step's own text in the publish job: its `- name:` line up to the next step's (or the job's end). */
function publishStep(name: string): string {
  const at = publishJob.indexOf(name);
  if (at < 0) return '';
  const next = publishJob.indexOf('\n      - ', at + name.length);
  return next < 0 ? publishJob.slice(at) : publishJob.slice(at, next);
}
const tagStep = publishStep(TAG_STEP);
const onMain = (() => {
  const at = publishJob.indexOf(ON_MAIN);
  if (at < 0) return '';
  const next = publishJob.indexOf('\n      - ', at + ON_MAIN.length);
  return next < 0 ? publishJob.slice(at) : publishJob.slice(at, next);
})();

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
    expect(publishJob.indexOf(TAG_STEP)).toBeLessThan(publishJob.indexOf('pnpm -r publish'));
  });
});

describe('publish.yml, the publish job', () => {
  it('checks the commit is on main first after the checkout, on every trigger, before the install and the publish', () => {
    expect(onMain, 'the ancestry step').not.toBe('');
    // Not skipped (an `if:` on the step), and its failure not let through: a `continue-on-error`, or a later step
    // run on failure (`always()`, `failure()`, `cancelled()` in an `if:`), would publish an off-main commit. A
    // tripwire on those spellings, not every way to write one.
    expect(onMain).not.toMatch(/^\s*if:/m);
    expect(publishJob).not.toMatch(/^\s*continue-on-error:/m);
    for (const l of publishJob.split('\n').filter((l) => /^\s*if:/.test(l))) {
      expect(l).not.toMatch(/\b(always|failure|cancelled)\(\)/);
    }
    expect(onMain).toMatch(/git fetch [^\n]*\+refs\/heads\/main:refs\/remotes\/origin\/main/);
    // The ref in full: the shorthand `origin/main` resolves to a local branch of that name first.
    expect(onMain).toMatch(/git merge-base --is-ancestor "\$GITHUB_SHA" refs\/remotes\/origin\/main;/);
    expect(onMain).not.toMatch(/[\s"]origin\/main\b/);
    const steps = publishJob.split('\n').filter((l) => /^ {6}- (uses|name|run):/.test(l));
    expect(steps[0]).toMatch(/actions\/checkout@/);
    expect(steps[1]).toContain(ON_MAIN);
    const at = publishJob.indexOf(ON_MAIN);
    for (const later of ['pnpm install', 'Verify tag matches all package versions', 'pnpm -r publish']) {
      expect(publishJob.indexOf(later), later).toBeGreaterThan(at);
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
