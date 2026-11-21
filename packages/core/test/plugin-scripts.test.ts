/**
 * Two of the plugin's scripts, RUN: `scripts/plugin-test.sh` (the plugin's kit against the plugin) and
 * `scripts/plugin-typecheck.sh` (the plugin's and the demo's modules against the engine's type declarations).
 *
 * Each runs in a copy of the folders it reads. The kit's script gets a fake `claude` on PATH that records the folder
 * it was handed and exits as told: what the script refuses, what it hands the kit, its status and its cleanup (the
 * kit's own cases run under the real `claude` in CI's plugin job, never here). The type-check gets made-up modules
 * and a made-up declarations file with the workspace's own `tsc` on PATH: the real declarations are the engine's,
 * written where it loads a mod, and no command of the `claude` CLI writes them, so no test and no CI job holds them.
 *
 * A Windows checkout has no such shell on every runner, and both scripts are tools for a development machine.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const tracked = (dir: string) =>
  execFileSync('git', ['ls-files', '-z', '--', dir], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .map((f) => f.slice(dir.length + 1))
    .sort();
const put = (file: string, text: string) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};

describe.skipIf(process.platform === 'win32')('scripts/plugin-test.sh, run', () => {
  /** A root holding the script, the plugin and its kit; a `bin` with the fake `claude`; its log. */
  const stage = () => {
    const base = mkdtempSync(join(tmpdir(), 'plugin-test-'));
    const root = join(base, 'root');
    mkdirSync(join(root, 'scripts'), { recursive: true });
    cpSync(join(ROOT, 'scripts/plugin-test.sh'), join(root, 'scripts/plugin-test.sh'));
    for (const dir of ['packages/plugin', 'packages/plugin-tests']) for (const f of tracked(dir)) cpSync(join(ROOT, dir, f), join(root, dir, f), { recursive: true });
    const bin = join(base, 'bin');
    mkdirSync(bin);
    const log = join(base, 'claude.log');
    // `claude plugin test <dir>` logs the folder and its files, then exits $STUB_EXIT.
    writeFileSync(join(bin, 'claude'), `#!/usr/bin/env bash\nif [ "$1 $2" = "plugin test" ]; then { echo "DIR $3"; (cd "$3" && find . ! -type d | sort); } >> "${log}"; exit "\${STUB_EXIT:-0}"; fi\nexit 0\n`);
    chmodSync(join(bin, 'claude'), 0o755);
    const run = (env: NodeJS.ProcessEnv = {}, path = `${bin}:/usr/bin:/bin`) => spawnSync('bash', [join(root, 'scripts/plugin-test.sh')], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, PATH: path, ...env } });
    const seen = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
    return { root, run, seen, kit: join(root, 'packages/plugin-tests'), plugin: join(root, 'packages/plugin') };
  };

  it('hands the kit the plugin with the kit\'s files in it, exits as the kit does, and removes its folder', () => {
    const s = stage();
    const ok = s.run();
    expect(ok.status, ok.stderr).toBe(0);
    const lines = s.seen();
    const dir = (lines[0] ?? '').replace(/^DIR /, '');
    // Both lists sorted here: the shell's `sort` orders by the runner's locale.
    expect(lines.slice(1).sort()).toEqual([...tracked('packages/plugin'), ...tracked('packages/plugin-tests')].map((f) => `./${f}`).sort());
    expect(dir).not.toBe('');
    expect(existsSync(dir)).toBe(false);
    // A failing kit: its status is the script's, and the folder is removed all the same.
    const failed = s.run({ STUB_EXIT: '7' });
    expect(failed.status).toBe(7);
    const second = (s.seen().filter((l) => l.startsWith('DIR '))[1] ?? '').replace(/^DIR /, '');
    expect(second).not.toBe('');
    expect(second).not.toBe(dir);
    expect(existsSync(second)).toBe(false);
  });

  it('refuses a kit entry that would replace a file of the plugin, a link or a folder as much as a file, before any test runs', () => {
    for (const make of [
      (kit: string) => writeFileSync(join(kit, 'hooks/register.tsx'), 'export const register = () => {}\n'),
      (kit: string) => symlinkSync(join(kit, 'hooks/world.tsx'), join(kit, 'hooks/register.tsx')),
      (kit: string) => symlinkSync('/nowhere/at/all', join(kit, 'hooks/celebration.tsx')),
      // A kit folder where the plugin holds a file.
      (kit: string) => mkdirSync(join(kit, 'hooks/register.tsx')),
      // A kit file where the plugin holds a folder.
      (kit: string) => writeFileSync(join(kit, 'types'), 'x\n'),
    ]) {
      const s = stage();
      make(s.kit);
      const r = s.run();
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/replace/);
      expect(s.seen()).toEqual([]);
    }
  });

  it('refuses a kit with no test file, a folder with no plugin, and a PATH with no claude, before anything runs', () => {
    const empty = stage();
    for (const f of tracked('packages/plugin-tests').filter((x) => /\.test\.tsx?$/.test(x))) rmSync(join(empty.kit, f));
    const none = empty.run();
    expect(none.status).toBe(1);
    expect(none.stderr).toMatch(/no test file/);
    expect(empty.seen()).toEqual([]);
    const bare = stage();
    rmSync(join(bare.plugin, '.claude-plugin/plugin.json'));
    const noPlugin = bare.run();
    expect(noPlugin.status).toBe(1);
    expect(noPlugin.stderr).toMatch(/no plugin/);
    expect(bare.seen()).toEqual([]);
    const s = stage();
    const off = s.run({}, '/usr/bin:/bin');
    expect(off.status).toBe(1);
    expect(off.stderr).toMatch(/claude is not on PATH/);
  });

  it('is written like the demo kit\'s script: strict, no CDPATH, the kit run as its last command', () => {
    const sh = read('scripts/plugin-test.sh');
    expect(sh).toMatch(/^set -euo pipefail\r?$/m);
    expect(sh).toMatch(/^unset CDPATH\r?$/m);
    expect(sh).toMatch(/^\s*claude plugin test\b/m);
  });
});

// The type-check. Made-up files: a declarations file that declares the module `claude-code` with one type, a plugin of
// one typed module and its contract, a demo of one module, and the plugin modules the demo's script copies, as
// one-line files. The compiler is the workspace's own.
describe.skipIf(process.platform === 'win32')('scripts/plugin-typecheck.sh, run', () => {
  const TSC_BIN = join(ROOT, 'packages/core/node_modules/.bin');
  const copies = () => (/^copies=\(([^)]*)\)\r?$/m.exec(read('scripts/plugin-demo.sh'))?.[1] ?? '').split(/\s+/).filter(Boolean);
  const DECLARATIONS = "// Written by Claude Code 9.9.9.\ndeclare module 'claude-code' {\n  export type Register = (on: (event: string, hook: () => number) => void) => void\n}\n";
  const stage = () => {
    const base = mkdtempSync(join(tmpdir(), 'plugin-typecheck-'));
    const root = join(base, 'root');
    mkdirSync(join(root, 'scripts'), { recursive: true });
    for (const f of ['scripts/plugin-typecheck.sh', 'scripts/plugin-demo.sh']) cpSync(join(ROOT, f), join(root, f));
    // The plugin: a manifest, its contract, one hooks module that uses both, and the modules the demo's script copies.
    put(join(root, 'packages/plugin/.claude-plugin/plugin.json'), '{ "name": "p", "version": "9.9.9", "types": "./types/index.d.ts" }\n');
    put(join(root, 'packages/plugin/types/index.d.ts'), 'export type Count = { n: number }\n');
    put(join(root, 'packages/plugin/hooks/hooks.json'), '{ "modules": ["./register.tsx"] }\n');
    put(join(root, 'packages/plugin/hooks/register.tsx'), "import type { Register } from 'claude-code'\nimport type { Count } from '../types'\n\nconst count: Count = { n: 1 }\nexport const register: Register = (on) => on('x', () => count.n)\n");
    for (const f of copies()) put(join(root, 'packages/plugin/hooks', f), f.endsWith('.d.ts') ? 'export declare const made: number\n' : 'export const made = 1\n');
    // The demo: its manifest and one module that imports a copied module.
    put(join(root, 'packages/plugin-demo/.claude-plugin/plugin.json'), '{ "name": "d", "version": "0.0.0" }\n');
    put(join(root, 'packages/plugin-demo/hooks/hooks.json'), '{ "modules": ["./register.tsx"] }\n');
    put(join(root, 'packages/plugin-demo/hooks/register.tsx'), "import type { Register } from 'claude-code'\nimport { made } from './team-look'\n\nexport const register: Register = (on) => on('y', () => made)\n");
    const file = join(base, 'claude-code.d.ts');
    writeFileSync(file, DECLARATIONS);
    // The engine's own layout: a folder holding claude-code/index.d.ts.
    const folder = join(base, 'types');
    put(join(folder, 'claude-code/index.d.ts'), DECLARATIONS);
    // The compiler's launcher runs `node`: this process's own is on the PATH beside it.
    const run = (args: string[], path = `${TSC_BIN}:${dirname(process.execPath)}:/usr/bin:/bin`) => spawnSync('bash', [join(root, 'scripts/plugin-typecheck.sh'), ...args], { encoding: 'utf8', timeout: 120_000, env: { ...process.env, PATH: path } });
    return { root, run, file, folder };
  };
  const out = (r: { stdout: string; stderr: string }) => `${r.stdout}\n${r.stderr}`;

  it('passes modules that type-check, given the declarations as a file or as the engine\'s folder, and says which declarations it read', { timeout: 240_000 }, () => {
    const s = stage();
    for (const given of [s.file, s.folder]) {
      const r = s.run([given]);
      expect(r.status, out(r)).toBe(0);
      expect(out(r)).toContain('Written by Claude Code 9.9.9.');
      expect(out(r)).toMatch(/plugin: ok/);
      expect(out(r)).toMatch(/demo: ok/);
    }
  });

  it('fails on a type error in the plugin\'s module, naming the file, and still checks the demo', { timeout: 240_000 }, () => {
    const s = stage();
    put(join(s.root, 'packages/plugin/hooks/register.tsx'), "import type { Register } from 'claude-code'\n\nexport const register: Register = (on) => on('x', () => 'not a number')\n");
    const r = s.run([s.file]);
    expect(r.status).toBe(1);
    expect(out(r)).toMatch(/hooks\/register\.tsx/);
    expect(out(r)).toMatch(/error TS\d+/);
    expect(out(r)).toMatch(/demo: ok/);
    expect(out(r)).not.toMatch(/plugin: ok/);
  });

  it('fails on a type error in the demo\'s module, and on one in a plugin module the demo copies', { timeout: 240_000 }, () => {
    const s = stage();
    put(join(s.root, 'packages/plugin-demo/hooks/register.tsx'), "import type { Register } from 'claude-code'\n\nexport const register: Register = (on) => on(1, () => 2)\n");
    const r = s.run([s.file]);
    expect(r.status).toBe(1);
    expect(out(r)).toMatch(/plugin: ok/);
    expect(out(r)).not.toMatch(/demo: ok/);
    const t = stage();
    put(join(t.root, 'packages/plugin/hooks/team-look.ts'), "export const made: number = 'one'\n");
    const both = t.run([t.file]);
    expect(both.status).toBe(1);
    expect(out(both)).not.toMatch(/plugin: ok/);
    expect(out(both)).not.toMatch(/demo: ok/);
  });

  it('refuses, before any check, with no declarations, with a path that holds none, and with no tsc on PATH', () => {
    const s = stage();
    const none = s.run([]);
    expect(none.status).toBe(1);
    expect(none.stderr).toMatch(/declarations/);
    for (const bad of [join(s.root, 'nowhere.d.ts'), join(s.root, 'scripts')]) {
      const r = s.run([bad]);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/declarations/);
      expect(out(r)).not.toMatch(/: ok/);
    }
    const off = s.run([s.file], '/usr/bin:/bin');
    expect(off.status).toBe(1);
    expect(off.stderr).toMatch(/tsc is not on PATH/);
  });

  it('writes nothing into the checkout: the plugin\'s and the demo\'s folders hold what they held', { timeout: 240_000 }, () => {
    const s = stage();
    const listing = () => execFileSync('find', [s.root, '!', '-type', 'd'], { encoding: 'utf8' }).split('\n').filter(Boolean).sort();
    const before = listing();
    expect(s.run([s.file]).status).toBe(0);
    expect(listing()).toEqual(before);
  });

  it('the guides name it, say it is run by hand, and say why CI does not run it', () => {
    const agents = read('AGENTS.md');
    const bullet = /- `bash scripts\/plugin-typecheck\.sh <declarations>`[^\n]*/.exec(agents)?.[0] ?? '';
    expect(bullet).toMatch(/no command/);
    expect(bullet).toMatch(/CI/);
    expect(read('.github/workflows/ci.yml')).not.toContain('plugin-typecheck');
  });
});
