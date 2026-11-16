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
    const importsOf = (text: string) => [...text.matchAll(/from '\.\/([a-z-]+)(\.js)?'/g)].map((m) => (m[2] === '.js' ? `${m[1]}.js` : `${m[1]}.ts`));
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

  it('the script reads the plugin from this checkout and holds no command that removes (what it refuses is run below)', () => {
    const sh = read('scripts/plugin-demo.sh');
    expect(sh).toContain('packages/plugin/hooks');
    expect(sh).toContain('packages/plugin-demo');
    expect(sh).not.toMatch(/\brm\b|-delete\b|\bunlink\b|\brmdir\b|\bmv\b|>\s*"?\$dest/);
    expect(sh).toMatch(/claudinho-demo/);
    expect(sh).toMatch(/set -euo pipefail/);
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
    expect(agents).toMatch(/\| A plugin drawing merged without being seen in the app \| `plugin-demo\.test\.ts` \(core\), `scripts\/plugin-demo\.sh` \|/);
    const playbook = read('.claude/skills/claudinho-mode/playbooks/feature.md');
    expect(playbook).toContain('`bash scripts/plugin-demo.sh`');
    expect(playbook).toContain('"Seen in the app"');
    expect(read('.github/pull_request_template.md')).toMatch(/Seen in the app/);
    expect(read('packages/plugin-demo/README.md')).toContain('scripts/plugin-demo.sh');
  });
});

// The script itself, run into temporary folders. It never asks `claude` here (PLUGIN_DEMO_NO_VALIDATE), so the cases
// need only bash and cp; a Windows checkout has no such shell on every runner, and the script is a development tool
// for the machine that has the desktop app.
describe.skipIf(process.platform === 'win32')('scripts/plugin-demo.sh, run', () => {
  const run = (...args: string[]) => spawnSync('bash', [join(ROOT, 'scripts/plugin-demo.sh'), ...args], { encoding: 'utf8', env: { ...process.env, PLUGIN_DEMO_NO_VALIDATE: '1' } });
  const fresh = () => join(mkdtempSync(join(tmpdir(), 'plugin-demo-')), 'out');
  const assembled = () => {
    const dest = fresh();
    expect(run(dest).status).toBe(0);
    return dest;
  };

  it('assembles the demo: its own files, and each copied module byte-equal to the plugin\'s', () => {
    const dest = fresh();
    const r = run(dest);
    expect(r.status).toBe(0);
    expect(r.stdout.trim().endsWith('/out')).toBe(true);
    expect(readdirSync(join(dest, 'hooks')).sort()).toEqual(['hooks.json', 'register.tsx', ...copies()].sort());
    expect(readdirSync(join(dest, '.claude-plugin'))).toEqual(['plugin.json']);
    for (const f of copies()) expect(readFileSync(join(dest, 'hooks', f), 'utf8'), f).toBe(read(join('packages/plugin/hooks', f)));
    expect(readFileSync(join(dest, 'hooks/register.tsx'), 'utf8')).toBe(read('packages/plugin-demo/hooks/register.tsx'));
  });

  it('refuses an empty name, and prints the folder as an absolute path whatever way it was named', () => {
    const r = run('');
    expect(r.status).toBe(1);
    for (const only of ['/', '//', '/.']) expect(run(only).status, only).toBe(1);
    expect(r.stderr).toContain('empty');
    const base = mkdtempSync(join(tmpdir(), 'plugin-demo-'));
    const rel = spawnSync('bash', [join(ROOT, 'scripts/plugin-demo.sh'), 'rel/out'], { cwd: base, encoding: 'utf8', env: { ...process.env, PLUGIN_DEMO_NO_VALIDATE: '1' } });
    expect(rel.status).toBe(0);
    expect(rel.stdout.trim().startsWith('/')).toBe(true);
    expect(rel.stdout.trim().endsWith('/rel/out')).toBe(true);
    expect(existsSync(join(base, 'rel/out/hooks/register.tsx'))).toBe(true);
  });

  it('with no argument, assembles into a new folder and prints it', () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(existsSync(join(r.stdout.trim(), 'hooks/register.tsx'))).toBe(true);
  });

  it('accepts its own earlier output, and the types the app lays beside a loaded mod, and writes the demo again', () => {
    const dest = assembled();
    mkdirSync(join(dest, '.claude-plugin/types/claude-code'), { recursive: true });
    writeFileSync(join(dest, '.claude-plugin/types/claude-code/index.d.ts'), 'export {}\n');
    writeFileSync(join(dest, 'tsconfig.json'), '{}\n');
    writeFileSync(join(dest, 'hooks/register.tsx'), 'stale\n');
    expect(run(dest).status).toBe(0);
    expect(readFileSync(join(dest, 'hooks/register.tsx'), 'utf8')).toBe(read('packages/plugin-demo/hooks/register.tsx'));
    expect(readFileSync(join(dest, '.claude-plugin/types/claude-code/index.d.ts'), 'utf8')).toBe('export {}\n');
  });

  it('refuses a folder that holds anything else, before it writes: an earlier demo with one more file keeps its files as they were', () => {
    for (const extra of ['notes.txt', 'hooks/notes.txt', '.claude-plugin/other.json', 'hooks/register.ts']) {
      const dest = assembled();
      writeFileSync(join(dest, extra), 'mine\n');
      writeFileSync(join(dest, 'hooks/register.tsx'), 'mine too\n');
      const r = run(dest);
      expect(r.status, extra).toBe(1);
      expect(r.stderr, extra).toContain('not this demo');
      expect(readFileSync(join(dest, 'hooks/register.tsx'), 'utf8'), extra).toBe('mine too\n');
      expect(readFileSync(join(dest, extra), 'utf8'), extra).toBe('mine\n');
    }
  });

  it('refuses an entry that is the demo\'s by name and something else by kind: a second name for an outside file, a folder where a file goes, a pipe', () => {
    // A hard link: the same file under another name, outside the folder. Writing the entry would write that file.
    const a = assembled();
    const outside = join(mkdtempSync(join(tmpdir(), 'plugin-demo-outside-')), 'kept.tsx');
    writeFileSync(outside, 'outside\n');
    execFileSync('mv', [join(a, 'hooks/register.tsx'), join(a, 'hooks-register-was')]);
    execFileSync('ln', [outside, join(a, 'hooks/register.tsx')]);
    execFileSync('mv', [join(a, 'hooks-register-was'), join(mkdtempSync(join(tmpdir(), 'plugin-demo-')), 'was')]);
    expect(run(a).status).toBe(1);
    expect(readFileSync(outside, 'utf8')).toBe('outside\n');
    // A folder named as one of the copied modules.
    const b = assembled();
    execFileSync('mv', [join(b, 'hooks/team-look.ts'), join(mkdtempSync(join(tmpdir(), 'plugin-demo-')), 'was')]);
    mkdirSync(join(b, 'hooks/team-look.ts'));
    expect(run(b).status).toBe(1);
    expect(readdirSync(join(b, 'hooks/team-look.ts'))).toEqual([]);
    // A pipe where the module goes: refused at once, never opened (a copy into it would wait for ever).
    const c = assembled();
    execFileSync('mv', [join(c, 'hooks/register.tsx'), join(mkdtempSync(join(tmpdir(), 'plugin-demo-')), 'was')]);
    execFileSync('mkfifo', [join(c, 'hooks/register.tsx')]);
    const r = spawnSync('bash', [join(ROOT, 'scripts/plugin-demo.sh'), c], { encoding: 'utf8', timeout: 20_000, env: { ...process.env, PLUGIN_DEMO_NO_VALIDATE: '1' } });
    expect(r.status).toBe(1);
  });

  it('a folder whose name starts with a dash is a name, never an option', () => {
    const base = mkdtempSync(join(tmpdir(), 'plugin-demo-'));
    const first = spawnSync('bash', [join(ROOT, 'scripts/plugin-demo.sh'), '-P'], { cwd: base, encoding: 'utf8', timeout: 20_000, env: { ...process.env, PLUGIN_DEMO_NO_VALIDATE: '1' } });
    expect(first.status).toBe(0);
    expect(existsSync(join(base, '-P/hooks/register.tsx'))).toBe(true);
    const again = spawnSync('bash', [join(ROOT, 'scripts/plugin-demo.sh'), '-P'], { cwd: base, encoding: 'utf8', timeout: 20_000, env: { ...process.env, PLUGIN_DEMO_NO_VALIDATE: '1' } });
    expect(again.status).toBe(0);
    expect(again.stdout.trim().endsWith('/-P')).toBe(true);
  });

  it('refuses a folder that is not a demo at all, and a file', () => {
    const other = mkdtempSync(join(tmpdir(), 'plugin-demo-'));
    mkdirSync(join(other, '.claude-plugin'));
    writeFileSync(join(other, '.claude-plugin/plugin.json'), '{ "name": "something-else" }\n');
    expect(run(other).status).toBe(1);
    expect(existsSync(join(other, 'hooks'))).toBe(false);
    const file = join(mkdtempSync(join(tmpdir(), 'plugin-demo-')), 'a-file');
    writeFileSync(file, 'x\n');
    expect(run(file).status).toBe(1);
    expect(readFileSync(file, 'utf8')).toBe('x\n');
  });

  it('never writes through a link: a linked folder, a linked hooks folder, a linked file, linked types', () => {
    const target = mkdtempSync(join(tmpdir(), 'plugin-demo-target-'));
    writeFileSync(join(target, 'register.tsx'), 'the real one\n');
    // The folder itself is a link.
    const link = join(mkdtempSync(join(tmpdir(), 'plugin-demo-')), 'link');
    symlinkSync(target, link);
    expect(run(link).status).toBe(1);
    // A link to an earlier demo, named with a trailing slash or /. (a shell follows such a name): refused the same.
    const earlier = assembled();
    const named = join(mkdtempSync(join(tmpdir(), 'plugin-demo-')), 'named');
    symlinkSync(earlier, named);
    writeFileSync(join(earlier, 'hooks/register.tsx'), 'as it was\n');
    for (const spelling of [named, `${named}/`, `${named}/.`, `${named}//`, `${named}/./`]) {
      expect(run(spelling).status, spelling).toBe(1);
      expect(readFileSync(join(earlier, 'hooks/register.tsx'), 'utf8'), spelling).toBe('as it was\n');
    }
    // A link to an EMPTY folder: nothing in it to refuse, so only the rule about the folder itself stops it.
    const empty = mkdtempSync(join(tmpdir(), 'plugin-demo-empty-'));
    const toEmpty = join(mkdtempSync(join(tmpdir(), 'plugin-demo-')), 'to-empty');
    symlinkSync(empty, toEmpty);
    expect(run(toEmpty).status).toBe(1);
    expect(readdirSync(empty)).toEqual([]);
    // An earlier demo whose hooks folder is a link to another folder (the checkout's plugin, say).
    const a = assembled();
    const moved = join(a, 'hooks-was');
    execFileSync('mv', [join(a, 'hooks'), moved]);
    symlinkSync(target, join(a, 'hooks'));
    expect(run(a).status).toBe(1);
    // An earlier demo one of whose files is a link.
    const b = assembled();
    execFileSync('mv', [join(b, 'hooks/register.tsx'), join(b, 'hooks/team-look.ts')]);
    symlinkSync(join(target, 'register.tsx'), join(b, 'hooks/register.tsx'));
    expect(run(b).status).toBe(1);
    // The app's types folder replaced by a link.
    const c = assembled();
    symlinkSync(target, join(c, '.claude-plugin/types'));
    expect(run(c).status).toBe(1);
    expect(readFileSync(join(target, 'register.tsx'), 'utf8')).toBe('the real one\n');
    expect(readdirSync(target)).toEqual(['register.tsx']);
  });
});
