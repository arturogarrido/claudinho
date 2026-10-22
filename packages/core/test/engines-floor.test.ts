/**
 * The engines floor is tested AT the floor (PR #206). The published packages state one floor, `>=N`; CI's floor job
 * (`runtime-node<N>`, named `runtime smoke (Node <N> engines floor)`) builds on a major-only Node and then runs the
 * built output on `<N>.0.0`, the lowest version that floor promises. Both numbers are derived from the packages'
 * `engines.node`, never spelled here, so the next floor bump fails this test until the job follows it.
 *
 * Limit, stated as a tripwire: this is a second reader of ci.yml, narrower than gate-script.test.ts's. It reads the
 * floor job's `actions/setup-node` steps and their block-style `with:` mapping only. A flow-style `with: { ... }`, a
 * `node-version` from an expression or `env:`, or any count of setup-node steps but two is refused as unread, never
 * passed. It does not read what the job's commands do with that Node.
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

/** Each `actions/setup-node` step of a job, with its `node-version` read from a block-style `with:`. */
function setupNodeVersions(job: string[]): string[] {
  const versions: string[] = [];
  job.forEach((line, i) => {
    if (!/^ {6}- uses: actions\/setup-node@/.test(line)) return;
    const withLine = job[i + 1] ?? '';
    if (!/^ {8}with:\s*$/.test(withLine)) throw new Error(`a setup-node step without a block-style with: (${withLine.trim()})`);
    let version: string | undefined;
    for (let j = i + 2; j < job.length && /^ {10}\S/.test(job[j] ?? ''); j++) {
      const kv = /^ {10}node-version:\s*(.*)$/.exec(job[j] ?? '');
      if (kv) version = (kv[1] ?? '').replace(/\s+#.*$/, '').trim();
    }
    if (!version || !/^\d+(\.\d+\.\d+)?$/.test(version)) throw new Error(`a setup-node node-version this reader does not read: ${version}`);
    versions.push(version);
  });
  return versions;
}

describe('the engines floor is tested at the floor', () => {
  const floor = publishedFloor();
  const job = jobLines(read('.github/workflows/ci.yml'), `runtime-node${floor}`);

  it('the floor job is named for the published floor', () => {
    expect(job).toContain(`    name: runtime smoke (Node ${floor} engines floor)`);
  });

  it('it builds on a major-only Node and runs the build on the floor itself, N.0.0', () => {
    expect(setupNodeVersions(job)).toEqual([String(floor), `${floor}.0.0`]);
  });
});
