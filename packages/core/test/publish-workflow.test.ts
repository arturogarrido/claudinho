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

const yml = readFileSync(fileURLToPath(new URL('../../../.github/workflows/publish.yml', import.meta.url)), 'utf8');
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
  const at = wait.indexOf('run: |');
  expect(at, 'the wait step has a run block').toBeGreaterThan(0);
  const lines = wait.slice(at + 'run: |'.length).split('\n').slice(1);
  const indent = /^(\s*)\S/.exec(lines.find((l) => l.trim()) ?? '')?.[1] ?? '';
  const block: string[] = [];
  for (const l of lines) {
    if (l.trim() && !l.startsWith(indent)) break;
    block.push(l.slice(indent.length));
  }
  return block
    .join('\n')
    .replace('DEADLINE=$((SECONDS + 480))', 'DEADLINE=$((SECONDS + 2))')
    .replace(/\bsleep 20\b/g, 'sleep 0.2');
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
