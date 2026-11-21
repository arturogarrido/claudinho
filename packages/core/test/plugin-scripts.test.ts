/**
 * `scripts/plugin-test.sh` (the plugin's kit against the plugin), RUN, in a copy of the folders it reads, with a fake
 * `claude` on PATH that records the folder it was handed and exits as told: what the script refuses, what it hands
 * the kit, its status and its cleanup. The kit's own cases run under the real `claude` in CI's plugin job, never here.
 *
 * A Windows checkout has no such shell on every runner, and the script is a tool for a development machine and CI's
 * Linux job.
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
    // `claude plugin test <dir>`, those three words and no more, logs the folder and its files, then exits $STUB_EXIT;
    // any other call is a usage error (64), as an added flag would make the real command do something else.
    writeFileSync(join(bin, 'claude'), `#!/usr/bin/env bash\nif [ "$#" -eq 3 ] && [ "$1 $2" = "plugin test" ] && [ -d "$3" ]; then { echo "DIR $3"; (cd "$3" && find . ! -type d | sort); } >> "${log}"; exit "\${STUB_EXIT:-0}"; fi\nexit 64\n`);
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
    // A failing kit: its status is the script's (1 is the real command's for a failed test), and the folder is
    // removed all the same.
    expect(s.run({ STUB_EXIT: '1' }).status).toBe(1);
    const failed = s.run({ STUB_EXIT: '7' });
    expect(failed.status).toBe(7);
    const second = (s.seen().filter((l) => l.startsWith('DIR '))[2] ?? '').replace(/^DIR /, '');
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
      // A kit manifest: a path that starts with a dot is listed too.
      (kit: string) => put(join(kit, '.claude-plugin/plugin.json'), '{ "name": "other" }\n'),
    ]) {
      const s = stage();
      make(s.kit);
      const r = s.run();
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/replace/);
      expect(s.seen()).toEqual([]);
    }
  });

  it('refuses a kit that holds a link anywhere, a test file\'s name included: the engine runs no linked test, so a link would be counted and never run', () => {
    for (const make of [
      (kit: string) => symlinkSync(join(kit, 'hooks/world.tsx'), join(kit, 'hooks/extra.test.tsx')),
      (kit: string) => symlinkSync('/nowhere/at/all', join(kit, 'hooks/notes.txt')),
      (kit: string) => symlinkSync(join(kit, 'hooks'), join(kit, 'more')),
    ]) {
      const s = stage();
      make(s.kit);
      const r = s.run();
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/link/);
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
