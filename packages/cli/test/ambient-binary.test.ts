/**
 * `claudinho ambient` through the built binary's option parser: `--columns` takes a positive integer and nothing
 * else (a wrong value is refused as every wrong option is: the parser's exit and message, before the command runs);
 * the command itself answers an object and exits 0 whatever the cache holds.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const DIST = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist', 'index.js');

let dir: string;
let env: NodeJS.ProcessEnv;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-ambient-bin-'));
  // A home of its own: no saved choice, no cache, no config.
  env = { ...process.env, HOME: dir, XDG_CACHE_HOME: join(dir, 'cache'), XDG_CONFIG_HOME: join(dir, 'config'), CLAUDINHO_COMPETITION: 'eng.1', CLAUDINHO_FLAGS: '0' };
  delete env.CLAUDINHO_TEAM;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = (...args: string[]) => spawnSync(process.execPath, [DIST, 'ambient', ...args], { env, encoding: 'utf8', input: '', timeout: 15_000 });

describe.skipIf(!existsSync(DIST))('`ambient --columns` through the option parser', () => {
  it('a positive integer fits the line; the command answers one object and exits 0 on an empty cache', () => {
    const r = run('--json', '--columns', '3');
    expect(r.status).toBe(0);
    const v = JSON.parse(r.stdout) as { line: string };
    expect(typeof v.line).toBe('string');
    expect([...v.line].length).toBeLessThanOrEqual(3);
  });

  for (const bad of ['abc', '0', '-4', '2.5']) {
    it(`\`--columns ${bad}\` is refused by the parser, as every wrong option is`, () => {
      const r = run('--json', '--columns', bad);
      expect(r.status).not.toBe(0);
      expect(r.stdout).toBe('');
      expect(r.stderr).toContain('--columns');
    });
  }
});
