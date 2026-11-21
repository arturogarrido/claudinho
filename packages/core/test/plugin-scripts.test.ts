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
import { afterAll, describe, expect, it } from 'vitest';

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
  /** Every folder a case staged, removed when the cases are done. */
  const bases: string[] = [];
  afterAll(() => {
    for (const b of bases) rmSync(b, { recursive: true, force: true });
  });
  /** A root holding the script, the plugin and its kit; a `bin` with the fake `claude`; its log. */
  const stage = () => {
    const base = mkdtempSync(join(tmpdir(), 'plugin-test-'));
    bases.push(base);
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
      // Deep in the kit, at a path the plugin does not hold.
      (kit: string) => {
        mkdirSync(join(kit, 'hooks/fixtures/deep/er'), { recursive: true });
        symlinkSync(join(kit, 'hooks/world.tsx'), join(kit, 'hooks/fixtures/deep/er/extra.test.tsx'));
      },
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

// The control for CI's strict validation. `claude plugin validate --strict` is the plugin's type-check only while the
// validator reports a type error and strict mode fails on it: a validator that stopped type-checking would leave the
// strict lines green and saying nothing. `scripts/plugin-strict-control.sh` writes a type error into a COPY of the
// plugin and requires the validator to refuse it for that reason; here it runs against fake validators.
describe.skipIf(process.platform === 'win32')('scripts/plugin-strict-control.sh, run', () => {
  const bases: string[] = [];
  afterAll(() => {
    for (const b of bases) rmSync(b, { recursive: true, force: true });
  });
  /**
   * A root with the script and the plugin, and a fake `claude` whose `plugin validate <folder> --strict` behaves as
   * `kind` says: `honest` refuses a folder whose celebration module holds the control's line AFTER the module's own
   * text, with that line's type error in its report, and passes any other; `blind` passes everything; `other`
   * refuses the control's folder for a reason that is no type error; `elsewhere` refuses it with a different type
   * error (the one a module that lost its exports would give); `broken` refuses every folder.
   */
  const stage = (kind: 'honest' | 'blind' | 'other' | 'elsewhere' | 'broken') => {
    const base = mkdtempSync(join(tmpdir(), 'plugin-control-'));
    bases.push(base);
    const root = join(base, 'root');
    mkdirSync(join(root, 'scripts'), { recursive: true });
    cpSync(join(ROOT, 'scripts/plugin-strict-control.sh'), join(root, 'scripts/plugin-strict-control.sh'));
    for (const f of tracked('packages/plugin')) cpSync(join(ROOT, 'packages/plugin', f), join(root, 'packages/plugin', f), { recursive: true });
    const bin = join(base, 'bin');
    mkdirSync(bin);
    const log = join(base, 'claude.log');
    const verdict = {
      honest: 'if has_control; then echo "  line 164, column 14: error TS2322: Type \'null\' is not assignable to type \'number\'."; exit 1; fi; exit 0',
      elsewhere: 'if has_control; then echo "  line 19, column 10: error TS2305: Module \'\"./celebration\"\' has no exported member \'goalRow\'."; exit 1; fi; exit 0',
      blind: 'exit 0',
      other: 'if has_control; then echo "  author: No author information provided."; exit 1; fi; exit 0',
      broken: 'echo "  line 1, column 1: error TS2322: something else."; exit 1',
    }[kind];
    writeFileSync(
      join(bin, 'claude'),
      `#!/usr/bin/env bash\n[ "$#" -eq 4 ] && [ "$1 $2" = "plugin validate" ] && [ -d "$3" ] && [ "$4" = "--strict" ] || exit 64\necho "$3" >> "${log}"\nhas_control() { grep -q 'strictControl' "$3/hooks/celebration.tsx" && grep -q 'export const celebrationRow' "$3/hooks/celebration.tsx"; }\n${verdict.replace(/has_control/g, 'has_control "$@"')}\n`,
    );
    chmodSync(join(bin, 'claude'), 0o755);
    const run = (path = `${bin}:/usr/bin:/bin`) => spawnSync('bash', [join(root, 'scripts/plugin-strict-control.sh')], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, PATH: path } });
    const seen = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
    return { root, run, seen };
  };
  const hashes = (root: string) => tracked('packages/plugin').map((f) => `${f} ${readFileSync(join(root, 'packages/plugin', f)).toString('base64').length}`);

  it('the copy keeps the module whole: a control that REPLACED the module with its line is not refused by the honest fake, and fails', () => {
    const s = stage('honest');
    const sh = join(s.root, 'scripts/plugin-strict-control.sh');
    const text = readFileSync(sh, 'utf8');
    expect(text).toContain('>>');
    // The append turned into an overwrite: the fake sees no module text beside the line and passes the folder.
    writeFileSync(sh, text.replace(/>>(\s*"[^"\n]*celebration\.tsx")/, '>$1'));
    expect(readFileSync(sh, 'utf8')).not.toBe(text);
    const r = s.run();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/did not refuse/);
  });

  it('passes when the validator passes the plugin as it is and refuses the copy with the type error, for that error', () => {
    const s = stage('honest');
    const before = hashes(s.root);
    const r = s.run();
    expect(r.status, r.stderr).toBe(0);
    // Two validations, each of a folder outside the checkout, both removed; the plugin's own files untouched.
    expect(s.seen()).toHaveLength(2);
    for (const dir of s.seen()) {
      expect(dir.startsWith(s.root)).toBe(false);
      expect(existsSync(dir)).toBe(false);
    }
    expect(hashes(s.root)).toEqual(before);
    expect(readFileSync(join(s.root, 'packages/plugin/hooks/celebration.tsx'), 'utf8')).not.toContain('strictControl');
  });

  it('fails when the validator passes the type error: strict validation would then prove nothing', () => {
    const r = stage('blind').run();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/did not refuse/);
  });

  it('fails when the validator refuses the copy for another reason, a different type error included, and when it refuses the plugin as it is', () => {
    const other = stage('other').run();
    expect(other.status).toBe(1);
    expect(other.stderr).toMatch(/error TS/);
    // A type error that is not the planted one (null given to a number) proves nothing about strict null checks.
    const elsewhere = stage('elsewhere').run();
    expect(elsewhere.status).toBe(1);
    expect(elsewhere.stderr).toMatch(/TS2322/);
    const broken = stage('broken').run();
    expect(broken.status).toBe(1);
    expect(broken.stderr).toMatch(/as it is/);
  });

  it('refuses a PATH with no claude, and its error is one only strict null checks catch', () => {
    const off = stage('honest').run('/usr/bin:/bin');
    expect(off.status).toBe(1);
    expect(off.stderr).toMatch(/claude is not on PATH/);
    const sh = read('scripts/plugin-strict-control.sh');
    expect(sh).toMatch(/^set -euo pipefail\r?$/m);
    expect(sh).toContain('export const strictControl: number = null');
  });
});
