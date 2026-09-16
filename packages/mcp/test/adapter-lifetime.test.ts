import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveAdapter } from '../src/tools';

/**
 * Audit A12, the MCP half: a retained provider throttle lives inside the
 * adapter, so it only covers calls that share ONE adapter for the server's
 * lifetime. The tools already do; the `standings://` resource built a fresh
 * adapter per read (found by the batch-3 call-site sweep) and now resolves the
 * same one. The second case pins that call in server.ts.
 */
describe('server-lifetime adapter', () => {
  it('resolveAdapter returns the same instance across calls for the same scope', () => {
    const a = resolveAdapter({});
    const b = resolveAdapter({});
    expect(b).toBe(a);
    expect(typeof a.armCooldown).toBe('function');
  });

  it('the standings:// resource reads through resolveAdapter, not a fresh adapter', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/server.ts', import.meta.url)), 'utf8');
    expect(src).toMatch(/standingsResourceText\(group, resolveAdapter\(\{\}\)\)/);
    expect(src).not.toMatch(/standingsResourceText\(group, makeAdapter\(\)\)/);
  });
});
