/**
 * The plugin's demo: a development mod under `packages/plugin-demo/` that shows the plugin's own drawings in the
 * Claude desktop app on a `/demo` command, with no match needed, so a change to what the plugin draws is SEEN in the
 * app before it merges. It is never installed with the plugin and holds no copy of a plugin file: `scripts/plugin-demo.sh`
 * assembles it by copying the plugin's drawing modules beside the demo's own hooks module, so what it shows is what
 * the plugin on this checkout draws.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

  it('the script copies exactly the plugin modules the demo imports, and each exists in the plugin', () => {
    const list = copies();
    expect(list.length).toBeGreaterThan(0);
    for (const f of list) expect(existsSync(join(ROOT, 'packages/plugin/hooks', f)), f).toBe(true);
    // Every relative import of the demo's module is a plugin module the script copies (as .ts or .js).
    const imports = [...read('packages/plugin-demo/hooks/register.tsx').matchAll(/from '\.\/([a-z-]+)(?:\.js)?'/g)].map((m) => m[1] as string);
    expect(imports.length).toBeGreaterThan(0);
    for (const name of imports) expect(list.some((f) => f === `${name}.ts` || f === `${name}.js`), name).toBe(true);
    // What a copied module imports is copied too (team-look.ts needs team-colors.ts and make-colors.js).
    for (const f of list.filter((x) => x.endsWith('.ts') && !x.endsWith('.d.ts'))) {
      for (const m of read(join('packages/plugin/hooks', f)).matchAll(/from '\.\/([a-z-]+)(\.js)?'/g)) {
        const want = m[2] === '.js' ? `${m[1]}.js` : `${m[1]}.ts`;
        expect(list, `${f} imports ${want}`).toContain(want);
      }
    }
    // The plugin's own hooks module is never copied: the demo sets scenes itself, it does not run the plugin.
    expect(list).not.toContain('register.tsx');
  });

  it('the script reads the plugin from this checkout, removes nothing, and refuses a folder that is not a demo', () => {
    const sh = read('scripts/plugin-demo.sh');
    expect(sh).toContain('packages/plugin/hooks');
    expect(sh).toContain('packages/plugin-demo');
    expect(sh).not.toMatch(/\brm\b/);
    expect(sh).toMatch(/claudinho-demo/);
    expect(sh).toMatch(/set -euo pipefail/);
  });

  it('the guides name it: the command, the rule that a drawing change is seen in the app, and the PR\'s check', () => {
    const agents = read('AGENTS.md');
    expect(agents).toContain('`bash scripts/plugin-demo.sh`');
    expect(agents).toContain('`packages/plugin-demo`');
    expect(agents).toMatch(/Seen in the app/);
    expect(read('.github/pull_request_template.md')).toMatch(/Seen in the app/);
    expect(read('packages/plugin-demo/README.md')).toContain('scripts/plugin-demo.sh');
  });
});
