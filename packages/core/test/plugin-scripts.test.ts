/**
 * `scripts/plugin-test.sh` (the plugin's kit against the plugin), RUN, in a copy of the folders it reads, with a fake
 * `claude` on PATH that records the folder it was handed and exits as told: what the script refuses, what it hands
 * the kit, its status and its cleanup. The kit's own cases run under the real `claude` in CI's plugin job, never here.
 *
 * A Windows checkout has no such shell on every runner, and the script is a tool for a development machine and CI's
 * Linux job.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
    // `claude plugin validate <dir> --strict`, those four words and a folder that exists, logs the folder and how many
    // test files it holds, prints a report line when told to refuse, and exits $STUB_VALIDATE_EXIT; `claude plugin test
    // <dir>`, those three words and no more, logs the folder, its files and how many validations came before it, then
    // exits $STUB_EXIT; any other call is a usage error (64), as an added flag would make the real command do something else.
    writeFileSync(
      join(bin, 'claude'),
      `#!/usr/bin/env bash\nif [ "$1 $2" = "plugin validate" ]; then [ "$#" -eq 4 ] && [ -d "$3" ] && [ "$4" = "--strict" ] || exit 64; echo "$3 tests=$(find "$3" -name '*.test.tsx' | wc -l | tr -d ' ')" >> "${log}.validate"; (cd "$3" && find . ! -type d | sort) >> "${log}.validate.files"; [ "\${STUB_VALIDATE_EXIT:-0}" = 0 ] || echo "  line 3, column 1: error TS2322: the fake validator's report."; exit "\${STUB_VALIDATE_EXIT:-0}"; fi\nif [ "$#" -eq 3 ] && [ "$1 $2" = "plugin test" ] && [ -d "$3" ]; then { echo "DIR $3"; (cd "$3" && find . ! -type d | sort); } >> "${log}"; echo "$(cat "${log}.validate" 2>/dev/null | wc -l | tr -d ' ')" >> "${log}.before"; exit "\${STUB_EXIT:-0}"; fi\nexit 64\n`,
    );
    chmodSync(join(bin, 'claude'), 0o755);
    const run = (env: NodeJS.ProcessEnv = {}, path = `${bin}:/usr/bin:/bin`) => spawnSync('bash', [join(root, 'scripts/plugin-test.sh')], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, PATH: path, ...env } });
    const lines = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);
    const seen = () => lines(log);
    /** Each validation: the folder it was handed and the test files that folder held. */
    const validated = () => lines(`${log}.validate`);
    /** For each kit run, how many validations came before it. */
    const before = () => lines(`${log}.before`);
    /** Every file of the folder the validator was handed, as it was then. */
    const validatedFiles = () => lines(`${log}.validate.files`);
    return { root, run, seen, validated, validatedFiles, before, kit: join(root, 'packages/plugin-tests'), plugin: join(root, 'packages/plugin') };
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

  it('validates the plugin WITH its kit strictly before the kit runs: the kit\'s type-check, in the folder the kit then runs in', () => {
    const s = stage();
    const ok = s.run();
    expect(ok.status, ok.stderr).toBe(0);
    const tests = tracked('packages/plugin-tests').filter((x) => /\.test\.tsx$/.test(x)).length;
    const dir = (s.seen()[0] ?? '').replace(/^DIR /, '');
    // One validation, of the very folder the kit ran in, with every test file already in it, and before the run.
    expect(s.validated()).toEqual([`${dir} tests=${tests}`]);
    expect(dir.startsWith('/')).toBe(true);
    expect(s.before()).toEqual(['1']);
    // The folder validated held, then, every file the kit ran with: the plugin's and the kit's, not the kit alone.
    expect(s.validatedFiles()).toEqual(s.seen().slice(1));
    expect(s.validatedFiles()).toContain('./.claude-plugin/plugin.json');
    expect(s.validatedFiles()).toContain('./hooks/register.tsx');
  });

  it('refuses a test file outside the kit\'s hooks folder: the engine would run it, and the validator type-checks no test file there, so it would run without its type-check', () => {
    // At the root, and in folders the validator was measured not to read (`more`, `test`, `lib`) or to read (`tests`):
    // one rule, the kit's layout, whatever the validator reads beyond it.
    for (const name of ['extra.test.tsx', 'extra.test.ts', 'more/extra.test.tsx', 'test/probe.test.ts', 'lib/deep/er/x.test.tsx', 'tests/x.test.ts', 'hooks2/x.test.tsx']) {
      const s = stage();
      mkdirSync(dirname(join(s.kit, name)), { recursive: true });
      writeFileSync(join(s.kit, name), 'export const bad: number = 1\n');
      const r = s.run();
      expect(r.status, name).toBe(1);
      expect(r.stderr, name).toMatch(/hooks/);
      expect(r.stderr, name).toContain(name);
      expect(s.seen(), name).toEqual([]);
      expect(s.validated()).toEqual([]);
    }
    // A helper anywhere is not a test file, and a test file anywhere under hooks is read: neither is refused.
    const s = stage();
    writeFileSync(join(s.kit, 'helper.ts'), 'export const x = 1\n');
    mkdirSync(join(s.kit, 'more'));
    writeFileSync(join(s.kit, 'more/helper.tsx'), 'export const x = 1\n');
    mkdirSync(join(s.kit, 'hooks/sub/deep'), { recursive: true });
    writeFileSync(join(s.kit, 'hooks/sub/deep/extra.test.tsx'), 'export const x = 1\n');
    expect(s.run().status).toBe(0);
  });

  it('a kit whose only test file ends in .test.ts is a kit: counted, validated and run', () => {
    const s = stage();
    for (const f of tracked('packages/plugin-tests').filter((x) => /\.test\.tsx?$/.test(x))) rmSync(join(s.kit, f));
    writeFileSync(join(s.kit, 'hooks/score.test.ts'), 'export const x = 1\n');
    const r = s.run();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain('plugin-test: 1 test files');
    expect(s.seen()).toContain('./hooks/score.test.ts');
    // Refused by the validator, that kit runs no test either.
    const refused = s.run({ STUB_VALIDATE_EXIT: '7' });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('does not validate');
    expect(s.seen().filter((l) => l.startsWith('DIR '))).toHaveLength(1);
  });

  it('a kit the validator refuses runs no test: the report is shown, the status is 1, the folder is removed', () => {
    for (const exit of ['1', '7']) {
      const s = stage();
      const r = s.run({ STUB_VALIDATE_EXIT: exit });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("error TS2322: the fake validator's report.");
      expect(r.stderr).toContain('does not validate');
      expect(s.seen()).toEqual([]);
      expect(s.validated()).toHaveLength(1);
      const dir = (s.validated()[0] ?? '').replace(/ tests=\d+$/, '');
      expect(dir).not.toBe('');
      expect(existsSync(dir)).toBe(false);
    }
  });

  it('counts a test file once whatever its name holds: a newline in a name is one file, not two', () => {
    const s = stage();
    const tests = tracked('packages/plugin-tests').filter((x) => /\.test\.tsx?$/.test(x)).length;
    expect(s.run().stderr).toContain(`plugin-test: ${tests} test files`);
    // Made here, in the staged copy, never committed: a name with a newline whose second line is a test file's name too.
    writeFileSync(join(s.kit, 'hooks/one\nmore.test.tsx'), 'export const x = 1\n');
    const r = s.run();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain(`plugin-test: ${tests + 1} test files`);
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
    // The kit's run is the last command, so the script's status is the kit's; the validation comes before it.
    expect(sh.trimEnd().split('\n').at(-1)).toMatch(/^claude plugin test "\$dir"\r?$/);
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
   * A root with the script, the plugin and its kit, and a fake `claude` whose `plugin validate <folder> --strict`
   * behaves as `kind` says. A folder "holds the control" in a module when its celebration module holds the control's
   * line AFTER the module's own text, and in a test file when the kit's `hooks/band.test.tsx` holds it after the
   * file's own text. `honest` refuses a folder that holds the control in either, with that line's type error in its
   * report, and passes any other; `blind` passes everything; `modules-only` is a validator that reads no test file:
   * it refuses the control's line in any file that is not a test file and passes it in a test file; `other` refuses the module's control
   * for a reason that is no type error; `elsewhere` refuses it with a different type error (the one a module that
   * lost its exports would give); `kit-elsewhere` is honest for the module and refuses the test file's control with
   * a different type error; `broken` refuses every folder; `kit-broken` is honest for the module and refuses every
   * folder that holds the kit.
   */
  const stage = (kind: 'honest' | 'blind' | 'modules-only' | 'other' | 'elsewhere' | 'kit-elsewhere' | 'broken' | 'kit-broken') => {
    const base = mkdtempSync(join(tmpdir(), 'plugin-control-'));
    bases.push(base);
    const root = join(base, 'root');
    mkdirSync(join(root, 'scripts'), { recursive: true });
    cpSync(join(ROOT, 'scripts/plugin-strict-control.sh'), join(root, 'scripts/plugin-strict-control.sh'));
    for (const dir of ['packages/plugin', 'packages/plugin-tests']) for (const f of tracked(dir)) cpSync(join(ROOT, dir, f), join(root, dir, f), { recursive: true });
    const bin = join(base, 'bin');
    mkdirSync(bin);
    const log = join(base, 'claude.log');
    const planted = 'echo "  line 164, column 14: error TS2322: Type \'null\' is not assignable to type \'number\'."; exit 1';
    const verdict = {
      honest: `if has_control || has_kit_control; then ${planted}; fi; exit 0`,
      'modules-only': `if has_control || holds_outside_tests; then ${planted}; fi; exit 0`,
      'kit-elsewhere': `if has_control; then ${planted}; fi; if has_kit_control; then echo "  line 2, column 1: error TS2304: Cannot find name 'describe'."; exit 1; fi; exit 0`,
      'kit-broken': `if has_control; then ${planted}; fi; if [ -f "$3/hooks/band.test.tsx" ]; then echo "  line 1, column 1: error TS2322: something else."; exit 1; fi; exit 0`,
      elsewhere: 'if has_control; then echo "  line 19, column 10: error TS2305: Module \'"./celebration"\' has no exported member \'goalRow\'."; exit 1; fi; exit 0',
      blind: 'exit 0',
      // The real validator's report for a refusal that is no type error: the warning, then its closing line.
      other: 'if has_control; then echo "  author: No author information provided."; echo "Validation failed (--strict treats warnings as errors)"; exit 1; fi; exit 0',
      broken: 'echo "  line 1, column 1: error TS2322: something else."; exit 1',
    }[kind];
    writeFileSync(
      join(bin, 'claude'),
      `#!/usr/bin/env bash\n[ "$#" -eq 4 ] && [ "$1 $2" = "plugin validate" ] && [ -d "$3" ] && [ "$4" = "--strict" ] || exit 64\necho "$3" >> "${log}"\nhas_control() { grep -q 'strictControl' "$3/hooks/celebration.tsx" && grep -q 'export const celebrationRow' "$3/hooks/celebration.tsx"; }\nholds_outside_tests() { grep -rl 'strictControl' "$3" | grep -qv '\\.test\\.tsx$'; }\necho "$(cd "$3" && grep -rl 'strictControl' . | sort | tr '\\n' ' ')" >> "${log}.where"\nhas_kit_control() { [ -f "$3/hooks/band.test.tsx" ] && grep -q 'strictControl' "$3/hooks/band.test.tsx" && grep -q "from 'claude-code/testing'" "$3/hooks/band.test.tsx"; }\n${verdict.replace(/has_(kit_)?control|holds_outside_tests/g, (m) => `${m} "$@"`)}\n`,
    );
    chmodSync(join(bin, 'claude'), 0o755);
    const run = (path = `${bin}:/usr/bin:/bin`) => spawnSync('bash', [join(root, 'scripts/plugin-strict-control.sh')], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, PATH: path } });
    const seen = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
    /** For each validation, the files of its folder that held the control's line. */
    const where = () => (existsSync(`${log}.where`) ? readFileSync(`${log}.where`, 'utf8').split('\n').map((l) => l.trim()) : []).slice(0, -1);
    return { root, run, seen, where };
  };
  const hashes = (root: string) =>
    ['packages/plugin', 'packages/plugin-tests'].flatMap((dir) => tracked(dir).map((f) => `${dir}/${f} ${createHash('sha256').update(readFileSync(join(root, dir, f))).digest('hex')}`));
  /** Every folder the fake validator was handed is gone, and the plugin's own files are as they were. */
  const leftNothing = (s: { root: string; seen: () => string[] }, before: string[]) => {
    for (const dir of s.seen()) expect(existsSync(dir), dir).toBe(false);
    expect(hashes(s.root)).toEqual(before);
  };

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
    // Four validations (the plugin as it is and with the error, then the plugin with its kit as it is and with the
    // error in a test file), each of a folder outside the checkout, all removed; the checkout's files untouched.
    expect(s.seen()).toHaveLength(4);
    expect(new Set(s.seen()).size).toBe(4);
    expect(r.stdout).toMatch(/test file/);
    // The line is planted in one file of each copy with the error and in no other: a control that also wrote it into
    // a module of the copy with the kit would prove nothing about the validator reading test files.
    expect(s.where()).toEqual(['', './hooks/celebration.tsx', '', './hooks/band.test.tsx']);
    for (const dir of s.seen()) {
      expect(dir.startsWith(s.root)).toBe(false);
      expect(existsSync(dir)).toBe(false);
    }
    expect(hashes(s.root)).toEqual(before);
    expect(readFileSync(join(s.root, 'packages/plugin/hooks/celebration.tsx'), 'utf8')).not.toContain('strictControl');
    expect(readFileSync(join(s.root, 'packages/plugin-tests/hooks/band.test.tsx'), 'utf8')).not.toContain('strictControl');
  });

  it('fails when the validator reads no test file: it refuses the error in a module and passes the same error in a test file of the kit', () => {
    const s = stage('modules-only');
    const before = hashes(s.root);
    const r = s.run();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/did not refuse/);
    expect(r.stderr).toMatch(/test file/);
    expect(s.seen()).toHaveLength(4);
    leftNothing(s, before);
    // A refusal of the test file's error for another reason proves nothing either.
    const e = stage('kit-elsewhere');
    const elsewhere = e.run();
    expect(elsewhere.status).toBe(1);
    expect(elsewhere.stderr).toMatch(/TS2322/);
    expect(elsewhere.stderr).toMatch(/test file/);
    // The plugin with its kit, as it is, refused: a refusal of the copy with the error would prove nothing.
    const k = stage('kit-broken');
    const untouched = hashes(k.root);
    const broken = k.run();
    expect(broken.status).toBe(1);
    expect(broken.stderr).toMatch(/as it is/);
    expect(k.seen()).toHaveLength(3);
    leftNothing(k, untouched);
  });

  it('the kit\'s copy keeps the test file whole: a control that REPLACED the test file with its line is not refused by the honest fake, and fails', () => {
    const s = stage('honest');
    const sh = join(s.root, 'scripts/plugin-strict-control.sh');
    const text = readFileSync(sh, 'utf8');
    writeFileSync(sh, text.replace(/>>(\s*"[^"\n]*band\.test\.tsx")/, '>$1'));
    expect(readFileSync(sh, 'utf8')).not.toBe(text);
    const r = s.run();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/did not refuse/);
  });

  it('fails when the validator passes the type error: strict validation would then prove nothing', () => {
    const s = stage('blind');
    const before = hashes(s.root);
    const r = s.run();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/did not refuse/);
    expect(s.seen()).toHaveLength(2);
    leftNothing(s, before);
  });

  it('fails when the validator refuses the copy for another reason, a different type error included, and when it refuses the plugin as it is', () => {
    const o = stage('other');
    const before = hashes(o.root);
    const other = o.run();
    expect(other.status).toBe(1);
    expect(other.stderr).toMatch(/error TS/);
    leftNothing(o, before);
    // A type error that is not the planted one (null given to a number) proves nothing about strict null checks.
    const elsewhere = stage('elsewhere').run();
    expect(elsewhere.status).toBe(1);
    expect(elsewhere.stderr).toMatch(/TS2322/);
    const b = stage('broken');
    const untouched = hashes(b.root);
    const broken = b.run();
    expect(broken.status).toBe(1);
    expect(broken.stderr).toMatch(/as it is/);
    leftNothing(b, untouched);
  });

  it('refuses a plugin or a kit that holds a link anywhere, before anything is copied or validated: an append through a copied link would write into the checkout', () => {
    for (const make of [
      // The module the error is planted in, linked to a file of the checkout.
      (root: string) => {
        writeFileSync(join(root, 'elsewhere.tsx'), 'export const celebrationRow = 1\n');
        rmSync(join(root, 'packages/plugin/hooks/celebration.tsx'));
        symlinkSync(join(root, 'elsewhere.tsx'), join(root, 'packages/plugin/hooks/celebration.tsx'));
      },
      // The plugin holds a link where the kit holds its test file: the kit's copy would be written through it.
      (root: string) => {
        writeFileSync(join(root, 'elsewhere.tsx'), 'x\n');
        symlinkSync(join(root, 'elsewhere.tsx'), join(root, 'packages/plugin/hooks/band.test.tsx'));
      },
      // The plugin's hooks folder, linked.
      (root: string) => {
        cpSync(join(root, 'packages/plugin/hooks'), join(root, 'hooks-real'), { recursive: true });
        rmSync(join(root, 'packages/plugin/hooks'), { recursive: true });
        symlinkSync(join(root, 'hooks-real'), join(root, 'packages/plugin/hooks'));
      },
      // The kit's test file, linked.
      (root: string) => {
        cpSync(join(root, 'packages/plugin-tests/hooks/band.test.tsx'), join(root, 'elsewhere.tsx'));
        rmSync(join(root, 'packages/plugin-tests/hooks/band.test.tsx'));
        symlinkSync(join(root, 'elsewhere.tsx'), join(root, 'packages/plugin-tests/hooks/band.test.tsx'));
      },
      // A link elsewhere in the kit.
      (root: string) => symlinkSync('/nowhere/at/all', join(root, 'packages/plugin-tests/hooks/notes.txt')),
    ]) {
      const s = stage('honest');
      make(s.root);
      const elsewhere = join(s.root, 'elsewhere.tsx');
      const was = existsSync(elsewhere) ? readFileSync(elsewhere, 'utf8') : null;
      const r = s.run();
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/link/);
      expect(s.seen()).toEqual([]);
      if (was !== null) expect(readFileSync(elsewhere, 'utf8')).toBe(was);
    }
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
