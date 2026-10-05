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
import { readFileSync } from 'node:fs';
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
    expect(wait).toMatch(/\btimeout \d+ npm view|--fetch-timeout=\d+/);
    // The job's own timeout leaves room for the wait and the publisher's retries after it.
    const minutes = Number(/timeout-minutes: (\d+)/.exec(job)?.[1]);
    expect(minutes).toBeGreaterThanOrEqual(15);
  });

  it('exits 0 when npm serves the version, and fails with its own ::error:: past the deadline', () => {
    expect(wait).toMatch(/if \[ "\$GOT" = "\$V" \]; then[^\n]*\bexit 0\b/);
    expect(wait).toMatch(/::error::[^\n]*\bexit 1\b/);
  });
});
