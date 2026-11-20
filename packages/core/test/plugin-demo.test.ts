/**
 * The plugin's demo: a development mod under `packages/plugin-demo/` that shows the plugin's own drawings in the
 * Claude desktop app on a `/demo` command, with no match needed, so a change to what the plugin draws is SEEN in the
 * app before it merges. It is never installed with the plugin and holds no copy of a plugin file: `scripts/plugin-demo.sh`
 * assembles it by copying the plugin's drawing modules beside the demo's own hooks module, so what it shows is what
 * the plugin on this checkout draws.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
/** The plugin files the script copies into the assembled demo: its `copies=( ... )` line. */
const copies = () => {
  const line = /^copies=\(([^)]*)\)\r?$/m.exec(read('scripts/plugin-demo.sh'));
  return (line?.[1] ?? '').split(/\s+/).filter(Boolean);
};

describe('the plugin demo (development only)', () => {
  it('is its manifest, its hooks file, its one module and a README: no copy of a plugin file to drift', () => {
    expect(tracked('packages/plugin-demo')).toEqual(['.claude-plugin/plugin.json', 'README.md', 'hooks/hooks.json', 'hooks/register.tsx']);
    const plugin = new Set(tracked('packages/plugin'));
    for (const f of tracked('packages/plugin-demo')) {
      if (f === '.claude-plugin/plugin.json' || f === 'hooks/hooks.json' || f === 'hooks/register.tsx' || f === 'README.md') continue;
      expect(plugin.has(f), f).toBe(false);
    }
  });

  it('is not the plugin: another name, so its scenes and its toasts are never taken for the plugin\'s', () => {
    const demo = JSON.parse(read('packages/plugin-demo/.claude-plugin/plugin.json')) as Record<string, unknown>;
    const plugin = JSON.parse(read('packages/plugin/.claude-plugin/plugin.json')) as Record<string, unknown>;
    expect(demo.name).toBe('claudinho-demo');
    expect(demo.name).not.toBe(plugin.name);
    expect(typeof demo.version).toBe('string');
    expect(JSON.parse(read('packages/plugin-demo/hooks/hooks.json'))).toEqual({ modules: ['./register.tsx'] });
    // The root marketplace file lists the plugin alone: the demo is never offered for install.
    expect(read('.claude-plugin/marketplace.json')).not.toContain('plugin-demo');
  });

  it('the script copies exactly the plugin modules the demo needs: what its module imports, what those import, and a .js module\'s types', () => {
    const list = copies();
    for (const f of list) expect(existsSync(join(ROOT, 'packages/plugin/hooks', f)), f).toBe(true);
    // A module's file: `.js` as written, else the `.ts` or the `.tsx` the plugin holds under that name.
    // Either quote is read, and an import of a relative path this pattern does not read fails the case (closed).
    const importsOf = (text: string) => {
      const found = [...text.matchAll(/\bfrom\s*(['"])\.\/([a-z-]+)(\.js)?\1/g)];
      expect(found.length).toBe((text.match(/\bfrom\s*['"]\.\.?\//g) ?? []).length);
      return found.map((m) => (m[3] === '.js' ? `${m[2]}.js` : existsSync(join(ROOT, 'packages/plugin/hooks', `${m[2]}.tsx`)) ? `${m[2]}.tsx` : `${m[2]}.ts`));
    };
    const needed = new Set<string>();
    const queue = importsOf(read('packages/plugin-demo/hooks/register.tsx'));
    expect(queue.length).toBeGreaterThan(0);
    while (queue.length > 0) {
      const f = queue.pop() as string;
      if (needed.has(f)) continue;
      needed.add(f);
      if (f.endsWith('.js')) needed.add(f.replace(/\.js$/, '.d.ts'));
      else queue.push(...importsOf(read(join('packages/plugin/hooks', f))));
    }
    expect([...list].sort()).toEqual([...needed].sort());
    // The plugin's own hooks module is never among them: the demo sets scenes itself, it does not run the plugin.
    expect(list).not.toContain('register.tsx');
    expect(list).toContain('celebration.tsx');
  });

  it('the demo plays the celebration with the plugin\'s own drawing: the rows, the ball and the lengths are imported, and no mascot, row or length is written here', () => {
    const src = read('packages/plugin-demo/hooks/register.tsx');
    const SHARED = ['FRAME_MS', 'FULLTIME_MS', 'GOAL_FRAMES', 'celebrationBall', 'celebrationRow', 'goalRow', 'resultRow'];
    const imported = (/import \{([^}]*)\} from '\.\/celebration'/.exec(src)?.[1] ?? '').split(',').map((n) => n.trim()).filter(Boolean);
    expect(imported.sort()).toEqual(SHARED);
    for (const name of SHARED) expect(src, name).not.toMatch(new RegExp(`(function|const|let|var)\\s+${name}\\b`));
    expect(src).not.toMatch(/[\u2588\u2590\u258c\u259b\u259c\u259d\u2598]/);
    // No row of its own beside the mascot (full time's words go through `resultRow`), and no length of its own: a
    // play's frames come from the plugin's three constants.
    expect(src).not.toContain('key="row-1"');
    expect(src).not.toMatch(/\b[A-Z_]*FRAMES?(?:_MS)?\b\s*(?:=|:)\s*(?:\{[^}]*\d|\d)/);
    expect(src).toContain('resultRow(');
    // It is drawn where the plugin draws it, in the band above the prompt.
    expect(src).toMatch(/on\(\s*'ui\.render'\s*,\s*\{\s*component:\s*'AbovePrompt'\s*\}/);
    // That its two commands PLAY is not read from the source: the demo's kit runs them (next case).
    for (const word of ['mascot', 'fulltime']) expect(read('packages/plugin-demo/README.md'), word).toContain(`\`/demo ${word}\``);
    // The command list of AGENTS.md says the demo shows it.
    const bullet = /- `bash scripts\/plugin-demo\.sh`[^\n]*/.exec(read('AGENTS.md'))?.[0] ?? '';
    expect(bullet).toMatch(/celebration/);
  });

  it('the demo has a kit that runs it: tests kept out of the demo\'s folder, run against the assembled demo by a script CI runs', () => {
    // packages/plugin-demo-tests, laid out as the demo is: `scripts/plugin-demo-test.sh` assembles the demo with
    // `scripts/plugin-demo.sh` and runs these against it under `claude plugin test`. They run `/demo mascot` and
    // `/demo fulltime`; the scene commands are not run there.
    const kit = tracked('packages/plugin-demo-tests');
    expect(kit.filter((f) => /\.test\.tsx?$/.test(f)).length).toBeGreaterThan(0);
    // No kit file takes the place of a file the assembled demo holds: the demo's own, or a plugin module copied in.
    const taken = new Set([...tracked('packages/plugin-demo'), ...copies().map((f) => `hooks/${f}`)]);
    expect(kit.filter((f) => taken.has(f))).toEqual([]);
    const kitText = read('packages/plugin-demo-tests/hooks/demo.test.tsx');
    for (const word of ['mascot', 'fulltime', 'off']) expect(kitText, word).toContain(`run('${word}')`);
    // The script: it assembles through the demo's own script (never a copy list of its own) and runs the kit. That it
    // refuses a kit file that would replace an assembled one, and that its status is the kit's, is not read here.
    const script = read('scripts/plugin-demo-test.sh');
    expect(script).toMatch(/^set -euo pipefail$/m);
    expect(script).toMatch(/plugin-demo\.sh/);
    expect(script).not.toMatch(/\bcopies=/);
    expect(script).toMatch(/packages\/plugin-demo-tests|plugin-demo-tests/);
    expect(script).toMatch(/^\s*claude plugin test\b/m);
    // CI's plugin job runs it after the plugin's own kit.
    expect(read('.github/workflows/ci.yml')).toMatch(/bash scripts\/plugin-test\.sh\n\s+bash scripts\/plugin-demo-test\.sh\n/);
    expect(read('AGENTS.md')).toContain('`bash scripts/plugin-demo-test.sh`');
  });

  it('the demo draws with the plugin\'s functions: the scenes, the look and the colors are imported, never written here', () => {
    const src = read('packages/plugin-demo/hooks/register.tsx');
    const imported = (file: string) => (new RegExp(`import \\{([^}]*)\\} from '\\./${file}'`).exec(src)?.[1] ?? '').split(',').map((n) => n.trim()).filter(Boolean);
    expect(imported('team-scenes').sort()).toEqual(['pitchSvg', 'pixelSvg']);
    expect(imported('team-look')).toEqual(expect.arrayContaining(['bandSvg', 'buildLook']));
    expect(imported('team-colors')).toEqual(expect.arrayContaining(['FLAG_COLORS', 'TEAM_COLORS']));
    // No drawing of its own: the only svg it hands the app comes from those functions.
    expect(src).not.toMatch(/<svg|<rect|<path/);
    for (const fn of ['pitchSvg', 'pixelSvg', 'bandSvg', 'buildLook']) expect(src, fn).not.toMatch(new RegExp(`(function|const|let|var)\\s+${fn}\\b`));
  });

  it('the script reads the plugin from this checkout, holds no command that removes, and never makes a parent folder (what it refuses is run below)', () => {
    const sh = read('scripts/plugin-demo.sh');
    expect(sh).toContain('packages/plugin/hooks');
    expect(sh).toContain('packages/plugin-demo');
    expect(sh).not.toMatch(/\brm\b|-delete\b|\bunlink\b|\brmdir\b|\bmv\b|>\s*"?\$dest/);
    expect(sh).toMatch(/claudinho-demo/);
    expect(sh).toMatch(/set -euo pipefail/);
    expect(sh).not.toMatch(/mkdir\s+(-\w*p|--parents)/);
  });

  it('the guides name it: the command, the rule that a drawing change is seen in the app, and the PR\'s check', () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('`bash scripts/plugin-demo.sh`');
    expect(agents).toContain('`packages/plugin-demo`');
    // The rule itself, in "Validation scope": its own bullet names the command and the line a PR carries.
    const scope = agents.slice(agents.indexOf('## Validation scope'), agents.indexOf('### Private-document boundary check'));
    const bullet = /- \*\*A change to what the Claude Code plugin draws\*\*[\s\S]*?(?=\n- )/.exec(scope)?.[0] ?? '';
    expect(bullet).toContain('`bash scripts/plugin-demo.sh`');
    expect(bullet).toContain('"Seen in the app"');
    expect(bullet).toMatch(/a skipped look is\s+not a pass/);
    // The rule's row in the table, and the feature playbook's step.
    expect(agents).toMatch(/\| A plugin drawing merged without being seen in the app \| `plugin-demo\.test\.ts` \(core\), `scripts\/plugin-demo\.sh`, `scripts\/plugin-demo-test\.sh` \|/);
    const playbook = read('.claude/skills/claudinho-mode/playbooks/feature.md');
    expect(playbook).toContain('`bash scripts/plugin-demo.sh`');
    expect(playbook).toContain('"Seen in the app"');
    expect(read('.github/pull_request_template.md')).toMatch(/Seen in the app/);
    expect(read('packages/plugin-demo/README.md')).toContain('scripts/plugin-demo.sh');
  });
});

// The script itself, run into temporary folders. Most cases never ask `claude` (PLUGIN_DEMO_NO_VALIDATE), so they need
// only bash, mkdir and cp; a Windows checkout has no such shell on every runner, and the script is a development tool
// for the machine that has the desktop app.
describe.skipIf(process.platform === 'win32')('scripts/plugin-demo.sh, run', () => {
  const SCRIPT = join(ROOT, 'scripts/plugin-demo.sh');
  const ENV: NodeJS.ProcessEnv = { ...process.env, PLUGIN_DEMO_NO_VALIDATE: '1' };
  const at = (cwd: string, name: string, env: NodeJS.ProcessEnv = ENV) => spawnSync('bash', [SCRIPT, name], { cwd, encoding: 'utf8', timeout: 20_000, env });
  const run = (...args: string[]) => spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', timeout: 20_000, env: ENV });
  const scratch = () => mkdtempSync(join(tmpdir(), 'plugin-demo-'));
  /** Every entry under `dir`, as relative paths, sorted: what a refusal must leave as it was. */
  const listing = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? [e.name, ...listing(join(dir, e.name)).map((n) => `${e.name}/${n}`)] : [e.name]))
      .sort();

  it('makes the folder and assembles the demo: its own files, and each copied module byte-equal to the plugin\'s', () => {
    const dest = join(scratch(), 'out');
    const r = run(dest);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(dest);
    expect(listing(dest)).toEqual(['.claude-plugin', '.claude-plugin/plugin.json', 'hooks', 'hooks/hooks.json', 'hooks/register.tsx', ...copies().map((f) => `hooks/${f}`)].sort());
    for (const f of copies()) expect(readFileSync(join(dest, 'hooks', f), 'utf8'), f).toBe(read(join('packages/plugin/hooks', f)));
    expect(readFileSync(join(dest, 'hooks/register.tsx'), 'utf8')).toBe(read('packages/plugin-demo/hooks/register.tsx'));
    expect(readFileSync(join(dest, '.claude-plugin/plugin.json'), 'utf8')).toBe(read('packages/plugin-demo/.claude-plugin/plugin.json'));
  });

  it('with no argument, assembles into a new folder each time and prints it', () => {
    const a = run();
    const b = run();
    expect(a.status).toBe(0);
    expect(b.status).toBe(0);
    expect(a.stdout.trim()).not.toBe(b.stdout.trim());
    for (const r of [a, b]) expect(existsSync(join(r.stdout.trim(), 'hooks/register.tsx'))).toBe(true);
  });

  it('refuses every name that is taken, whatever it holds, and leaves it as it was', () => {
    const base = scratch();
    // An empty folder; an earlier demo with a file of the reader's changed; a folder of something else; a file.
    mkdirSync(join(base, 'empty'));
    expect(run(join(base, 'demo')).status).toBe(0);
    writeFileSync(join(base, 'demo/hooks/register.tsx'), 'mine\n');
    mkdirSync(join(base, 'other/hooks'), { recursive: true });
    writeFileSync(join(base, 'other/hooks/register.tsx'), 'theirs\n');
    writeFileSync(join(base, 'file'), 'x\n');
    // A link to each of the folders, and a link to nothing.
    symlinkSync(join(base, 'empty'), join(base, 'to-empty'));
    symlinkSync(join(base, 'demo'), join(base, 'to-demo'));
    symlinkSync(join(base, 'other'), join(base, 'to-other'));
    symlinkSync(join(base, 'nowhere'), join(base, 'dangling'));
    const before = listing(base);
    for (const name of ['empty', 'demo', 'other', 'file', 'to-empty', 'to-demo', 'to-other', 'dangling'])
      for (const spelling of [name, `${name}/`, `${name}/.`, `${name}//`, `./${name}`, `x/../${name}`, `${name}/../${name}`]) {
        // The absolute form is built as text: path.join would tidy away the very spelling under test.
        for (const r of [at(base, spelling), run(`${base}/${spelling}`)]) {
          expect(r.status, spelling).toBe(1);
          expect(r.stdout, spelling).toBe('');
          expect(r.stderr, spelling).toContain('plugin-demo:');
        }
      }
    expect(listing(base)).toEqual(before);
    expect(readFileSync(join(base, 'demo/hooks/register.tsx'), 'utf8')).toBe('mine\n');
    expect(readFileSync(join(base, 'other/hooks/register.tsx'), 'utf8')).toBe('theirs\n');
    expect(readFileSync(join(base, 'file'), 'utf8')).toBe('x\n');
  });

  it('makes one folder and no parent: a name through a folder that does not exist is refused, and nothing is made', () => {
    const base = scratch();
    for (const name of ['a/b', 'x/..', 'x/../y', 'a/b/c', './a/./b']) {
      expect(at(base, name).status, name).toBe(1);
      expect(run(`${base}/${name}`).status, name).toBe(1);
    }
    expect(listing(base)).toEqual([]);
    // The working folder itself, its parent, and the root are taken.
    for (const name of ['.', '..', './', '/', '//', '/.']) expect(at(base, name).status, name).toBe(1);
    expect(listing(base)).toEqual([]);
    expect(run('').status).toBe(1);
  });

  it('refuses a name that holds a .. (through a linked folder, the folder made and the folder printed would differ)', () => {
    const base = scratch();
    const far = scratch();
    mkdirSync(join(far, 'sub'));
    mkdirSync(join(base, 'real'));
    symlinkSync(join(far, 'sub'), join(base, 'link'));
    expect(at(base, 'demo').status).toBe(0);
    const before = [listing(base), listing(far)];
    for (const name of ['link/../demo', 'link/../new', 'real/../new', '../new', 'real/..', `${base}/link/../new`, `${base}/real/../new`]) {
      const r = name.startsWith('/') ? run(name) : at(base, name);
      expect(r.status, name).toBe(1);
      expect(r.stdout, name).toBe('');
      expect(r.stderr, name).toContain('..');
    }
    expect([listing(base), listing(far)]).toEqual(before);
    // Dots that are part of a name are a name.
    for (const name of ['..x', 'x..', 'a..b']) expect(at(base, name).status, name).toBe(0);
  });

  it('prints the folder as an absolute path, whatever way it was named', () => {
    const base = scratch();
    mkdirSync(join(base, 'sub'));
    for (const [name, end] of [['out', '/out'], ['./rel', '/rel'], ['sub/in', '/sub/in'], ['trail/', '/trail'], ['with space', '/with space'], ['ñandú', '/ñandú'], ['...', '/...']] as const) {
      const r = at(base, name);
      expect(r.status, name).toBe(0);
      expect(r.stdout.trim().startsWith('/'), name).toBe(true);
      expect(r.stdout.trim().endsWith(end), name).toBe(true);
      expect(existsSync(join(r.stdout.trim(), 'hooks/register.tsx')), name).toBe(true);
    }
  });

  it('a name that starts with a dash, or is a dash, is a name: made under the working folder, then taken', () => {
    for (const name of ['-P', '-', '--', '-n', '-rf', '--help']) {
      const base = scratch();
      const env = { ...ENV, OLDPWD: tmpdir() };
      const first = at(base, name, env);
      expect(first.status, name).toBe(0);
      expect(first.stdout.trim().endsWith(`/${name}`), name).toBe(true);
      expect(readdirSync(base), name).toEqual([name]);
      expect(existsSync(join(base, name, 'hooks/register.tsx')), name).toBe(true);
      expect(at(base, name, env).status, `${name} again`).toBe(1);
    }
  });

  it('an exported CDPATH changes nothing: the script called by its relative name, and a relative folder', () => {
    const base = scratch();
    mkdirSync(join(base, 'elsewhere/scripts'), { recursive: true });
    const env = { ...ENV, CDPATH: `${ROOT}:${join(base, 'elsewhere')}` };
    const dest = join(base, 'here');
    const r = spawnSync('bash', ['scripts/plugin-demo.sh', dest], { cwd: ROOT, encoding: 'utf8', timeout: 20_000, env });
    expect(r.stderr).not.toContain('no demo at');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(dest);
    // A relative folder is made under the working folder, never under a folder along CDPATH.
    expect(at(base, 'out', env).status).toBe(0);
    expect(existsSync(join(base, 'out/hooks/register.tsx'))).toBe(true);
    expect(listing(join(base, 'elsewhere'))).toEqual(['scripts']);
  });

  it('hands the validator the folder as an absolute path, and fails when the validator does', () => {
    // A fake `claude` first on PATH: it records its arguments and refuses one that starts with a dash, as the CLI does.
    const bin = scratch();
    const seen = join(bin, 'seen.txt');
    writeFileSync(join(bin, 'claude'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${seen}'\ncase "$3" in -*) echo "error: unknown option" >&2; exit 1 ;; esac\n[ -z "$FAKE_REFUSES" ] || exit 1\nexit 0\n`, { mode: 0o755 });
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` };
    delete env.PLUGIN_DEMO_NO_VALIDATE;
    const base = scratch();
    const r = at(base, '-P', env);
    expect(r.stderr).toContain('validated');
    expect(r.status).toBe(0);
    const args = readFileSync(seen, 'utf8').trim().split('\n');
    expect(args.slice(0, 2)).toEqual(['plugin', 'validate']);
    expect(args[2]?.startsWith('/')).toBe(true);
    expect(args[2]?.endsWith('/-P')).toBe(true);
    expect(r.stdout.trim()).toBe(args[2]);
    // A demo the validator refuses is an error, and no folder is printed.
    const bad = at(base, 'refused', { ...env, FAKE_REFUSES: '1' });
    expect(bad.status).toBe(1);
    expect(bad.stdout).toBe('');
    expect(bad.stderr).toContain('does not validate');
  });
});
