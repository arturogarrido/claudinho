/**
 * The Claude Code plugin's files: a hooks module and its manifest under `packages/plugin/` (no package.json: it is
 * not a workspace package and ships through no registry), listed by the root marketplace file. What the plugin
 * validator does not pin: the option's own words, the module the manifest runs, the install line in the README.
 */
import { execFileSync } from 'node:child_process';
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

  // Claude Code copies a plugin's whole folder when it installs it, and Anthropic's directory lists that folder: the
  // folder holds what runs or is read, and the kit (its tests and their helpers) lives in packages/plugin-tests, run
  // against this folder by scripts/plugin-test.sh.
  it('holds only what installs: the manifest, the icon, the hooks module, its contract and the README', () => {
    const tracked = (dir: string) =>
      execFileSync('git', ['ls-files', '-z', '--', dir], { cwd: ROOT, encoding: 'utf8' })
        .split('\0')
        .filter(Boolean)
        .map((f) => f.slice(dir.length + 1))
        .sort();
    expect(tracked('packages/plugin')).toEqual([
      '.claude-plugin/icon.png',
      '.claude-plugin/plugin.json',
      'README.md',
      'hooks/hooks.json',
      'hooks/register.tsx',
      'types/index.d.ts',
    ]);
    const kit = tracked('packages/plugin-tests');
    expect(kit.filter((f) => /\.test\.tsx?$/.test(f)).length).toBeGreaterThan(0);
    expect(kit.filter((f) => existsSync(join(ROOT, 'packages/plugin', f)))).toEqual([]);
  });

  it('the manifest names the plugin and nothing it does not ship; the types contract sits where the validator finds it', () => {
    const m = json('packages/plugin/.claude-plugin/plugin.json');
    expect(m.name).toBe('claudinho');
    // No `types` key: the plugin directory reports it as an unknown field, and the validator (Claude Code 2.1.300 on)
    // finds the contract at types/index.d.ts by itself and holds every `$.state` key to it.
    expect(Object.hasOwn(m, 'types')).toBe(false);
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

  /** The text of the hook registered for `event`, from `on('<event>'` to its closing line. */
  const handlerOf = (src: string, event: string): string => {
    const from = src.indexOf(`on('${event}'`);
    expect(from, event).toBeGreaterThan(-1);
    return src.slice(from, src.indexOf('\n  })', from));
  };

  /**
   * What PRIVACY.md says the plugin does: no network request, no file written, no conversation read, only the
   * installed `claudinho` CLI run. A vocabulary check over the one module the manifest runs, in which the host is
   * always `$` (every hook's first parameter, every binding typed `EngineInterface`): every member of `$` it names is
   * one the policy accounts for; `$` is never indexed or assigned; the module imports nothing but types and the host's
   * three state helpers; every run is `claudinho ambient` or `claudinho match`; the filesystem is read twice, nvm's
   * version folder listed and `<version>/bin/claudinho` probed; the prompt handler uses its event only to pass it on
   * and to add the note, written from the CLI's `context` unchanged; the command handler reads the typed text only
   * to compare it with `match`. It is a tripwire over the shapes the module has, not a proof: a use of the host or of
   * an event this grammar does not name (a name built at run time, `$` handed to code outside the module, another
   * syntax for the same access) is outside it. The validator's `calls:` line is the full inventory, but it fails on
   * none.
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
    expect(src).not.toMatch(new RegExp(String.raw`\$(?:${DOT}[A-Za-z_]+)*\s*(?:\?\.)?\s*\[`));
    const hooks = [...src.matchAll(/\bon\(\s*'[^']+'\s*,\s*(?:\{[^}]*\}\s*,\s*)?(?:async\s*)?\(\s*([A-Za-z_$][\w$]*)/g)];
    expect(hooks.length).toBe((src.match(/\bon\(\s*'/g) ?? []).length);
    expect(hooks.map((m) => m[1]).filter((n) => n !== '$' && n !== '_$')).toEqual([]);
    const typed = [...src.matchAll(/([A-Za-z_$][\w$]*)\s*\??\s*:\s*EngineInterface\b/g)].map((m) => m[1]);
    expect(typed.length).toBeGreaterThan(0);
    expect(typed.filter((n) => n !== '$')).toEqual([]);
    expect(src).not.toMatch(/\bas\s+EngineInterface\b|<EngineInterface>/);
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
    // The prompt's event: passed on, spread into the next one, its `context` list extended by the note; nothing else.
    const submit = handlerOf(src, 'prompt.submit');
    expect(submit).toContain('return next({ ...e, context: [...(e.context ?? []), record.context] })');
    const submitRest = submit
      .replace('async ($, e, next) =>', '')
      .replace('return next({ ...e, context: [...(e.context ?? []), record.context] })', '')
      .split('next(e)')
      .join('');
    expect(submitRest).not.toMatch(/\be\b/);
    // The note is the CLI's `context`, stored unchanged from a current view and cleared otherwise.
    expect(src.match(/update\(\s*\$\s*,\s*lastContext\b/g) ?? []).toHaveLength(2);
    expect(src).toContain("context: typeof view.context === 'string' && view.context !== '' ? view.context : null,");
    expect(src).toContain('await update($, lastContext, () => null)');
    // The typed text: compared with `match`, nothing else.
    const command = handlerOf(src, 'command.run');
    const commandRest = command
      .replace('async ($, e) =>', '')
      .replace("typeof e.args === 'string' && e.args.trim() === PANE_WORD", '');
    expect(commandRest).not.toMatch(/\be\b/);
    expect(src).toContain("const PANE_WORD = 'match'");
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
