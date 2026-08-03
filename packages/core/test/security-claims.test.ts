/**
 * Guard: every test SECURITY.md cites actually exists.
 *
 * The document now binds each security property to the test that proves it,
 * which is only worth anything if the citation cannot rot. Rename or delete a
 * suite and this fails, rather than leaving the policy quietly claiming a
 * property nothing checks any more.
 *
 * This is the smaller half of a lesson that cost six review rounds: the
 * properties the layer claimed lived only in prose, so each round found the
 * same shape somewhere new. Prose that cites nothing is how that happens.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = join(__dirname, '..', '..', '..');
const policy = readFileSync(join(REPO, 'SECURITY.md'), 'utf8');

/** Every `core/test/x.test.ts` or `mcp/test/x.test.ts` the policy cites. */
function citedTests(): string[] {
  return [...new Set([...policy.matchAll(/`((?:core|cli|mcp)\/test\/[\w.-]+\.test\.ts)`/g)].map((m) => m[1] as string))];
}

describe('SECURITY.md cites tests that exist', () => {
  it('cites at least one test per property (guard is wired up)', () => {
    // If the citation format changes, the regex above stops matching and the
    // rest of this file would vacuously pass.
    expect(citedTests().length).toBeGreaterThanOrEqual(5);
  });

  it('every cited test file is present', () => {
    for (const rel of citedTests()) {
      const path = join(REPO, 'packages', rel);
      expect(existsSync(path), `SECURITY.md cites ${rel}, which does not exist`).toBe(true);
    }
  });

  it('no bullet in the properties list is left without a citation', () => {
    const start = policy.indexOf('**Untrusted input is treated as untrusted.**');
    const end = policy.indexOf('**Subprocesses.**');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const section = policy.slice(start, end);
    // Top-level bullets only: continuation lines are indented.
    const bullets = section.split('\n- ').slice(1);
    expect(bullets.length).toBeGreaterThanOrEqual(6);
    for (const b of bullets) {
      const claim = b.split('\n')[0]?.slice(0, 60);
      expect(/(?:core|cli|mcp)\/test\/[\w.-]+\.test\.ts/.test(b), `no test cited for: ${claim}`).toBe(
        true,
      );
    }
  });
});
