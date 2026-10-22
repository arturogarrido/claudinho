/**
 * The engines floor is tested AT the floor (PR #206). The published packages state one floor, `>=N`; CI's floor job
 * (`runtime-node<N>`, named `runtime smoke (Node <N> engines floor)`) builds on Node `<N>` (the floor's major, the
 * newest release of it) and then runs the built output on `<N>.0.0`, the lowest version that floor promises. Both
 * numbers are derived from the packages' `engines.node`, never spelled here, so the next floor bump fails this test
 * until the job follows it.
 *
 * Limit, stated as a tripwire: this is a second reader of ci.yml, narrower than gate-script.test.ts's, and a source-
 * text guard. It catches the shapes this repository's workflows use today: a step's `uses: actions/setup-node@...`
 * on its dash line or as one of its keys, with a block-style `with:` whose `node-version` is a plain number. Any
 * other line of the job that names `actions/setup-node` (another indent, a comment), a step with no block-style
 * `with:`, or a `node-version` that is not a plain number (an expression, an `env:` value, a flow-style mapping) is
 * refused as unread, never passed. A setup reached without the name `actions/setup-node` (a composite action, a
 * local action) is outside what it can see, and so is what the job's commands do with that Node.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PUBLISHED = ['core', 'cli', 'mcp'];

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n'); // a Windows checkout's CRLF

/** The one floor the published packages state, as its major: `>=22` → 22. */
function publishedFloor(): number {
  const ranges = PUBLISHED.map((p) => JSON.parse(read(`packages/${p}/package.json`))?.engines?.node);
  expect(new Set(ranges).size, `one engines.node across ${PUBLISHED.join(', ')}: ${ranges.join(' | ')}`).toBe(1);
  const m = /^>=(\d+)$/.exec(String(ranges[0]));
  if (!m) throw new Error(`engines.node is not of the form >=N: ${ranges[0]}`);
  return Number(m[1]);
}

/** The lines of one job in ci.yml: its `  <id>:` line to the next key at the jobs' indent. */
function jobLines(yaml: string, id: string): string[] {
  const lines = yaml.split('\n');
  const start = lines.indexOf(`  ${id}:`);
  if (start < 0) throw new Error(`no job ${id} in ci.yml`);
  let end = start + 1;
  while (end < lines.length && !/^ {2}[A-Za-z]/.test(lines[end] ?? '') && !/^\S/.test(lines[end] ?? '')) end++;
  return lines.slice(start, end);
}

/** The job's steps: each from its `      - ` line to the next one (or the job's end). */
function steps(job: string[]): string[][] {
  const out: string[][] = [];
  for (const line of job) {
    if (/^ {6}- /.test(line)) out.push([line]);
    else out.at(-1)?.push(line);
  }
  return out;
}

/** Each `actions/setup-node` step of a job, with its `node-version` read from a block-style `with:`. */
function setupNodeVersions(job: string[]): string[] {
  const named = job.filter((l) => l.includes('actions/setup-node')).length;
  const versions: string[] = [];
  for (const step of steps(job)) {
    if (!step.some((l) => /^ {6}- uses: actions\/setup-node@|^ {8}uses: actions\/setup-node@/.test(l))) continue;
    const at = step.findIndex((l) => /^ {8}with:\s*$/.test(l));
    if (at < 0) throw new Error(`a setup-node step without a block-style with: (${step[0]?.trim()})`);
    let version: string | undefined;
    for (let j = at + 1; j < step.length && /^ {10}\S/.test(step[j] ?? ''); j++) {
      const kv = /^ {10}node-version:\s*(.*)$/.exec(step[j] ?? '');
      if (kv) version = (kv[1] ?? '').replace(/\s+#.*$/, '').trim();
    }
    if (!version || !/^\d+(\.\d+\.\d+)?$/.test(version)) throw new Error(`a setup-node node-version this reader does not read: ${version}`);
    versions.push(version);
  }
  // A line naming setup-node that no step above was read from (another indent, a comment) is refused, never passed.
  if (named !== versions.length) throw new Error(`${named} lines name actions/setup-node in the job, ${versions.length} steps were read`);
  return versions;
}

describe('the engines floor is tested at the floor', () => {
  const floor = publishedFloor();
  const job = jobLines(read('.github/workflows/ci.yml'), `runtime-node${floor}`);

  it('the floor job is named for the published floor', () => {
    expect(job).toContain(`    name: runtime smoke (Node ${floor} engines floor)`);
  });

  it('it builds on Node N and runs the build on the floor itself, N.0.0, in exactly two setup-node steps', () => {
    expect(setupNodeVersions(job)).toEqual([String(floor), `${floor}.0.0`]);
  });
});
