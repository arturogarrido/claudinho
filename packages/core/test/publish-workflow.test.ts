/**
 * The release workflow's Registry job (0.11 · 2.7c): npm serves a freshly
 * published version minutes after the publish job ends (0.10.0 on the
 * publisher's attempt 6 of 6, 0.10.1 on 8 of 12), so the job WAITS for npm to
 * serve the version before the first `mcp-publisher publish`, and the
 * publisher's own retries are spent on Registry errors only.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const yml = readFileSync(fileURLToPath(new URL('../../../.github/workflows/publish.yml', import.meta.url)), 'utf8');

describe('publish.yml, the mcp-registry job', () => {
  it('polls npm for the version before the first publish attempt, bounded, and still fails when it never appears', () => {
    const job = yml.slice(yml.indexOf('mcp-registry:'));
    const wait = job.indexOf('npm view @claudinho/mcp@');
    const publish = job.indexOf('mcp-publisher publish');
    expect(wait, 'an npm view poll in the Registry job').toBeGreaterThan(0);
    expect(publish).toBeGreaterThan(0);
    expect(wait, 'the poll comes before the publisher').toBeLessThan(publish);
    const waitBlock = job.slice(wait - 400, wait + 400);
    expect(waitBlock).toMatch(/seq 1 \d+|for \w+ in \$\(seq/);
    expect(waitBlock).toMatch(/sleep \d+/);
    expect(job).toMatch(/::error::/);
  });
});
