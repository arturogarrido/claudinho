/**
 * The Claude Code plugin's files: a hooks module and its manifest under `packages/plugin/` (no package.json: it is
 * not a workspace package and ships through no registry), listed by the root marketplace file. What the plugin
 * validator does not pin: the option's own words, the module the manifest runs, the install line in the README.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const json = (rel: string) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as Record<string, unknown>;

describe('the plugin folder', () => {
  it('ships no package.json (not a workspace package, not published) and no node_modules', () => {
    expect(existsSync(join(ROOT, 'packages/plugin/package.json'))).toBe(false);
    expect(existsSync(join(ROOT, 'packages/plugin/node_modules'))).toBe(false);
  });

  it('the manifest names the plugin, its types contract and nothing it does not ship', () => {
    const m = json('packages/plugin/.claude-plugin/plugin.json');
    expect(m.name).toBe('claudinho');
    expect(m.types).toBe('./types/index.d.ts');
    expect(existsSync(join(ROOT, 'packages/plugin/types/index.d.ts'))).toBe(true);
    const hooks = json('packages/plugin/hooks/hooks.json');
    expect(hooks.modules).toEqual(['./register.tsx']);
    expect(existsSync(join(ROOT, 'packages/plugin/hooks/register.tsx'))).toBe(true);
  });

  it("the toasts option: pinned, all or off, pinned by default, and its description is the one place that says a session with no pin toasts nothing", () => {
    const m = json('packages/plugin/.claude-plugin/plugin.json') as { userConfig?: Record<string, { type?: unknown; options?: unknown; default?: unknown; description?: unknown }> };
    const toasts = m.userConfig?.toasts;
    expect(toasts, 'userConfig.toasts').toBeDefined();
    expect(toasts?.type).toBe('string');
    expect(toasts?.options).toEqual(['pinned', 'all', 'off']);
    expect(toasts?.default).toBe('pinned');
    expect(String(toasts?.description)).toMatch(/no pin|without a pin|nothing/i);
  });

  it('the manifest is the reader\'s-language release, 0.6.0', () => {
    const m = json('packages/plugin/.claude-plugin/plugin.json');
    expect(m.version).toBe('0.6.0');
  });

  it('the language option: auto, en, es, pt or fr, auto by default, beside the other three', () => {
    const m = json('packages/plugin/.claude-plugin/plugin.json') as { userConfig?: Record<string, { type?: unknown; options?: unknown; default?: unknown; description?: unknown }> };
    const language = m.userConfig?.language;
    expect(language, 'userConfig.language').toBeDefined();
    expect(language?.type).toBe('string');
    expect(language?.options).toEqual(['auto', 'en', 'es', 'pt', 'fr']);
    expect(language?.default).toBe('auto');
    expect(String(language?.description).trim()).not.toBe('');
  });

  it('the plugin README names the language option and that the moments follow it', () => {
    const readme = readFileSync(join(ROOT, 'packages/plugin/README.md'), 'utf8');
    expect(readme).toMatch(/`language`/);
  });

  it('the celebrate option: on or off, on by default, beside toasts', () => {
    const m = json('packages/plugin/.claude-plugin/plugin.json') as { userConfig?: Record<string, { type?: unknown; options?: unknown; default?: unknown; description?: unknown }> };
    const celebrate = m.userConfig?.celebrate;
    expect(celebrate, 'userConfig.celebrate').toBeDefined();
    expect(celebrate?.type).toBe('string');
    expect(celebrate?.options).toEqual(['on', 'off']);
    expect(celebrate?.default).toBe('on');
    expect(String(celebrate?.description).trim()).not.toBe('');
  });
});

describe('the context option', () => {
  it('on or off, on by default, and its description says what reaches the model', () => {
    const m = json('packages/plugin/.claude-plugin/plugin.json') as { userConfig?: Record<string, { type?: unknown; options?: unknown; default?: unknown; description?: unknown }> };
    const context = m.userConfig?.context;
    expect(context, 'userConfig.context').toBeDefined();
    expect(context?.type).toBe('string');
    expect(context?.options).toEqual(['on', 'off']);
    expect(context?.default).toBe('on');
    expect(String(context?.description)).toMatch(/prompt/i);
    expect(String(context?.description)).toMatch(/Claude|model/);
  });

  it('the plugin README names it beside the other two', () => {
    const readme = readFileSync(join(ROOT, 'packages/plugin/README.md'), 'utf8');
    expect(readme).toMatch(/`context`/);
  });
});

describe('the plugin directory listing', () => {
  it("the manifest carries the repository's MIT license and links the repository and the plugin's folder", () => {
    const m = json('packages/plugin/.claude-plugin/plugin.json');
    expect(readFileSync(join(ROOT, 'LICENSE'), 'utf8')).toMatch(/^MIT License\r?\n/);
    expect(m.license).toBe('MIT');
    expect(m.repository).toBe('https://github.com/arturogarrido/claudinho');
    expect(m.homepage).toBe('https://github.com/arturogarrido/claudinho/tree/main/packages/plugin');
  });

  it("the privacy policy's scope names the plugin", () => {
    const privacy = readFileSync(join(ROOT, 'PRIVACY.md'), 'utf8').replace(/\s+/g, ' ');
    // The scope sentence, to its full stop: a period inside it (`.mcpb`) is followed by no space.
    expect(privacy).toMatch(/It applies to (?:[^.]|\.(?=\S))*the Claude Code plugin/);
  });

  /** The hooks module's source, and `$`'s member access whatever the spacing or optional chaining (`$ ?. fs`). */
  const hooksSource = () => readFileSync(join(ROOT, 'packages/plugin/hooks/register.tsx'), 'utf8');
  const DOT = String.raw`\s*\??\.\s*`;
  const OPEN = String.raw`\s*(?:\?\.)?\s*\(`;

  /**
   * What PRIVACY.md says the plugin does: no network request, no file written, no conversation read, only the
   * installed `claudinho` CLI run. A vocabulary check over the one module the manifest runs, in which the host is
   * always `$`: every member of `$` it names is one the policy accounts for; `$` is never indexed or assigned; the
   * module imports nothing but types and the host's three state helpers; every run is `claudinho ambient` or
   * `claudinho match`; the filesystem is read twice, nvm's version folder listed and `<version>/bin/claudinho` probed;
   * the prompt handler reads no field of the prompt but its `context` list. A use of the host this grammar cannot see
   * (a name built at run time, `$` handed to code outside the module) is outside it. The validator's `calls:` line is
   * the full inventory, but it fails on none.
   */
  it('the hooks module calls no host capability beyond the ones PRIVACY.md states, and runs only claudinho', () => {
    const src = hooksSource();
    // `$.state` is named in comments alone: the state goes through the host's `read` and `update`.
    const MEMBERS = new Set([
      'clock.after', 'clock.every', 'clock.now', 'clock.sleep', 'command.register', 'env.get', 'fs.exists', 'fs.list',
      'process.run', 'session.surfaces', 'state.', 'state.get', 'state.set', 'ui.invalidate', 'ui.open', 'ui.resolve',
      'ui.toast',
    ]);
    const named = [...src.matchAll(new RegExp(String.raw`\$${DOT}([A-Za-z_]+)(?:${DOT}([A-Za-z_]+))?`, 'g'))];
    expect(named.length).toBeGreaterThan(0);
    expect(named.map((m) => `${m[1] ?? ''}.${m[2] ?? ''}`).filter((c) => !MEMBERS.has(c))).toEqual([]);
    expect(src).not.toMatch(new RegExp(String.raw`\$(?:${DOT}[A-Za-z_]+)*\s*\[`));
    expect(src).not.toMatch(/[=:]\s*\$\s*(?=[;,)}\n]|$)/m);
    expect(src).not.toMatch(/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\brequire\s*\(|\bimport\s*\(|\bglobalThis\b/);
    expect(src).not.toMatch(/(?<![.\w$])process\??\.[A-Za-z_]/);
    const imports = [...src.matchAll(/^import\s+(type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/gm)];
    expect(imports.length).toBe((src.match(/^\s*import\b/gm) ?? []).length);
    expect(imports.filter((m) => m[3] !== 'claude-code' && m[3] !== '../types').map((m) => m[3])).toEqual([]);
    const values = imports.filter((m) => !m[1]).flatMap((m) => (m[2] ?? '').split(',').map((v) => v.trim()));
    expect(values.filter((v) => v !== '').sort()).toEqual(['atom', 'read', 'update']);
    const argv = String.raw`\s*\[\s*(['"][^'"]*['"])\s*,\s*(['"][^'"]*['"])`;
    const runs = [...src.matchAll(new RegExp(String.raw`\$${DOT}process${DOT}run${OPEN}${argv}`, 'g'))];
    expect(runs.length).toBe((src.match(new RegExp(String.raw`\$${DOT}process${DOT}run\b`, 'g')) ?? []).length);
    expect(new Set(runs.map((m) => m[1]))).toEqual(new Set(["'claudinho'"]));
    expect(new Set(runs.map((m) => m[2]))).toEqual(new Set(["'ambient'", "'match'"]));
    const fsCalls = (member: string) => (src.match(new RegExp(String.raw`\$${DOT}fs${DOT}${member}\b`, 'g')) ?? []).length;
    expect([fsCalls('list'), fsCalls('exists')]).toEqual([1, 1]);
    expect(src).toMatch(new RegExp(String.raw`\$${DOT}fs${DOT}list${OPEN}\s*root\s*\)`));
    expect(src.match(/\broot\s*=/g) ?? []).toHaveLength(1);
    expect(src).toContain(`const root = \`\${home}/.nvm/versions/node\``);
    expect(src).toMatch(new RegExp(String.raw`\$${DOT}fs${DOT}exists${OPEN}\s*\`\$\{bin\}/claudinho\`\s*\)`));
    expect(src).toContain(`.map((v) => \`\${root}/\${v.name}/bin\`)`);
    const submit = src.indexOf("on('prompt.submit'");
    expect(submit).toBeGreaterThan(-1);
    const handler = src.slice(submit, src.indexOf('\n  })', submit));
    expect([...handler.matchAll(/\be\s*\??\.\s*([A-Za-z_]+)/g)].map((m) => m[1])).toEqual(['context']);
    expect(handler).not.toMatch(/\be\s*\[|=\s*e\b/);
  });

  it('every environment variable the hooks module reads is named in PRIVACY.md', () => {
    const src = hooksSource();
    const privacy = readFileSync(join(ROOT, 'PRIVACY.md'), 'utf8');
    // The plugin's own section: a name the policy gives another component (`CLAUDINHO_MARKETS`) is not its account.
    const from = privacy.indexOf('## The Claude Code plugin');
    expect(from).toBeGreaterThan(-1);
    const section = privacy.slice(from, privacy.indexOf('\n## ', from + 1));
    const names = [...src.matchAll(new RegExp(String.raw`\$${DOT}env${DOT}get${OPEN}\s*['"]([A-Z_]+)['"]\s*\)`, 'g'))];
    expect(names.length).toBe((src.match(new RegExp(String.raw`\$${DOT}env${DOT}get\b`, 'g')) ?? []).length);
    expect(names.length).toBeGreaterThan(0);
    expect(names.map((m) => m[1]).filter((n) => !section.includes(`\`${n}\``))).toEqual([]);
  });
});

describe('the marketplace file', () => {
  it('lists the plugin from the repository, by its folder', () => {
    const m = json('.claude-plugin/marketplace.json') as { name?: unknown; owner?: { name?: unknown }; plugins?: Array<{ name?: unknown; source?: unknown }> };
    expect(m.name).toBe('claudinho');
    expect(m.owner?.name).toBe('Arturo Garrido');
    expect(m.plugins?.map((p) => [p.name, p.source])).toEqual([['claudinho', './packages/plugin']]);
  });

  it('the README carries the install line, verbatim', () => {
    const readme = readFileSync(join(ROOT, 'packages/plugin/README.md'), 'utf8');
    expect(readme).toContain('/plugin install claudinho --marketplace arturogarrido/claudinho');
    expect(readme).toContain('claudinho init plugin');
  });
});
