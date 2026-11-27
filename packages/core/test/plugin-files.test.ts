import { createHash } from 'node:crypto';
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
      'hooks/celebration.tsx',
      'hooks/hooks.json',
      'hooks/make-colors.d.ts',
      'hooks/make-colors.js',
      'hooks/register.tsx',
      'hooks/team-colors.ts',
      'hooks/team-look.ts',
      'hooks/team-scenes.ts',
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

  it('the manifest is the release whose pixel stadium sounds its state, 0.13.0', () => {
    const m = json('packages/plugin/.claude-plugin/plugin.json');
    expect(m.version).toBe('0.13.0');
  });

  it('the teamTheme option: off or on, OFF by default (a session holds one theme, and ours would replace the person\'s), and its description says where it shows and what it replaces', () => {
    const m = json('packages/plugin/.claude-plugin/plugin.json') as { userConfig?: Record<string, { type?: unknown; options?: unknown; default?: unknown; description?: unknown }> };
    const teamTheme = m.userConfig?.teamTheme;
    expect(teamTheme, 'userConfig.teamTheme').toBeDefined();
    expect(teamTheme?.type).toBe('string');
    expect(teamTheme?.options).toEqual(['off', 'on']);
    expect(teamTheme?.default).toBe('off');
    expect(String(teamTheme?.description)).toMatch(/desktop/i);
    // The look shows in the desktop app: the phone drew neither its colors nor a scene (Nov 22, 2026).
    expect(String(teamTheme?.description)).not.toMatch(/\bdesktop (?:and|or) mobile app/i);
    expect(String(teamTheme?.description)).toMatch(/replaces/i);
  });

  it('no public copy says the team look shows in the mobile app (the phone drew neither its colors nor a scene, Nov 22, 2026)', () => {
    const files = ['README.md', 'PRIVACY.md', 'AGENTS.md', 'packages/plugin/README.md', 'packages/plugin/.claude-plugin/plugin.json', 'packages/plugin/hooks/register.tsx', 'scripts/plugin-demo.sh'];
    for (const f of files) {
      const text = readFileSync(join(ROOT, f), 'utf8').replace(/\s+/g, ' ');
      // Either order, singular or plural, and the scene's "desktop app only", which says more than one phone test showed.
      expect(text, f).not.toMatch(/\b(?:desktop (?:and|or) mobile|mobile (?:and|or) desktop) app(?:s|lications?)?\b/i);
      expect(text, f).not.toMatch(/\bdesktop app only\b/i);
    }
    const reply = readFileSync(join(ROOT, 'packages/plugin/hooks/register.tsx'), 'utf8');
    expect(reply).toContain("'The team look shows in the Claude desktop app; nothing draws it in this session.'");
  });

  it('the plugin README names the teamTheme option, where it shows and that it replaces the session\'s theme', () => {
    const readme = readFileSync(join(ROOT, 'packages/plugin/README.md'), 'utf8');
    expect(readme).toMatch(/`teamTheme`/);
    expect(readme).toMatch(/\/claudinho theme/);
  });

  it('the team look\'s own modules are pure: no host, no network, no file; the engine\'s builder is the engine\'s bytes', () => {
    const read = (f: string) => readFileSync(join(ROOT, 'packages/plugin/hooks', f), 'utf8');
    for (const f of ['team-look.ts', 'team-scenes.ts', 'team-colors.ts', 'make-colors.js']) {
      const src = read(f);
      expect(src, f).not.toMatch(/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\brequire\s*\(|\bimport\s*\(|\bglobalThis\b/);
      expect(src, f).not.toMatch(/(?<![.\w$])process\??\.[A-Za-z_]/);
      // The engine's file names `$.theme.set` in one of its own messages (a string); ours name no `$` at all.
      if (f !== 'make-colors.js') expect(src, f).not.toMatch(/\$\s*\??\.\s*[A-Za-z_]/);
      else expect(src.match(/\$\s*\??\.\s*[A-Za-z_][\w.]*/g) ?? [], f).toEqual(['$.theme.set']);
    }
    const look = read('team-look.ts');
    const froms = [...look.matchAll(/^import\s+(?:type\s+)?\{[^}]*\}\s+from\s+'([^']+)'/gm)].map((m) => m[1]);
    expect(froms.length).toBe((look.match(/^\s*import\b/gm) ?? []).length);
    expect(froms.filter((f) => f !== 'claude-code' && f !== './make-colors.js' && f !== './team-colors')).toEqual([]);
    expect(read('team-colors.ts')).not.toMatch(/^\s*import\b/m);
    // The scenes are drawn from their arguments alone: the module imports nothing.
    expect(read('team-scenes.ts')).not.toMatch(/^\s*import\b/m);
    // The engine's builder, copied as the engine ships it: its own header says so, and its body hash is the engine's.
    expect(read('make-colors.js')).toMatch(/^\/\/ make-colors\.js: copy this file into your mod's hooks folder, and leave it as it is\.\n/);
    const engine = read('make-colors.js');
    const stated = /^\/\/ body-sha256: ([0-9a-f]{64})$/m.exec(engine)?.[1];
    expect(stated, 'the body hash the engine wrote in the header').toBeDefined();
    expect(createHash('sha256').update(engine.split('\n').slice(4).join('\n')).digest('hex')).toBe(stated);
  });

  it('the celebration\'s drawing is one pure module the hooks module and the demo both import: the mascot is written there and nowhere else', () => {
    const cel = readFileSync(join(ROOT, 'packages/plugin/hooks/celebration.tsx'), 'utf8');
    // Pure: it is handed the surface's elements and draws; it names no host, no network, no file.
    expect(cel).not.toMatch(/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\brequire\s*\(|\bimport\s*\(|\bglobalThis\b/);
    expect(cel).not.toMatch(/(?<![.\w$])process\??\.[A-Za-z_]/);
    expect(cel).not.toMatch(/\$\s*\??\.\s*[A-Za-z_]/);
    // Types alone are imported, each in an `import type` line (an inline `import { type X }` is refused too): the
    // host's module also exports its state helpers as values, and this module holds no state.
    const froms = [...cel.matchAll(/^import\s+type\s+\{[^}]*\}\s+from\s+'([^']+)'/gm)].map((m) => m[1]);
    expect(froms.length).toBe((cel.match(/^\s*import\b/gm) ?? []).length);
    expect(froms.filter((f) => f !== 'claude-code')).toEqual([]);
    // No clock, no timer, no chance, and no binding of the module that can be assigned again. A tripwire over these
    // spellings, not a proof: a `const` object changed in place passes it; the kit's
    // celebration-tree.test.tsx is what draws each frame four times and compares the trees.
    expect(cel).not.toMatch(/\bDate\b|\bperformance\b|\bMath\s*\.\s*random\b|\bsetTimeout\b|\bsetInterval\b|\bqueueMicrotask\b/);
    expect(cel).not.toMatch(/^(?:export\s+)?(?:let|var)\s/m);
    for (const name of ['celebrationRow', 'celebrationBall', 'goalRow', 'resultRow', 'FRAME_MS', 'GOAL_FRAMES', 'FULLTIME_MS']) expect(cel, name).toMatch(new RegExp(`^export const ${name}\\b`, 'm'));
    // The lengths are written once: a frame is 500 ms, a goal six frames, full time 5 s; the hooks module states none.
    expect(cel).toMatch(/^export const FRAME_MS = 500$/m);
    expect(cel).toMatch(/^export const GOAL_FRAMES = 6$/m);
    expect(cel).toMatch(/^export const FULLTIME_MS = 5_000$/m);
    expect(cel.match(/\b(?:FRAMES|GOAL_FRAMES|FRAME_MS|FULLTIME_MS)\s*=\s*\d/g) ?? []).toHaveLength(3);
    // The mascot's glyphs and its rectangles are written in that module alone.
    const GLYPHS = /[\u2588\u2590\u258c\u259b\u259c\u259d\u2598]/;
    expect(cel).toMatch(GLYPHS);
    expect(cel).toContain('<rect');
    const hooks = readFileSync(join(ROOT, 'packages/plugin/hooks/register.tsx'), 'utf8');
    expect(hooks).not.toMatch(GLYPHS);
    expect(hooks).not.toContain('<rect');
    expect(hooks).not.toMatch(/\b(?:FRAMES|GOAL_FRAMES|FRAME_MS|FULLTIME_MS)\s*=\s*\d/);
  });

  it('the toasts option says what a session with no pin gets: its first goal, then one hint on how to pin', () => {
    const m = json('packages/plugin/.claude-plugin/plugin.json') as { userConfig?: Record<string, { description?: unknown }> };
    const d = String(m.userConfig?.toasts?.description);
    expect(d).toMatch(/first goal/i);
    expect(d).toMatch(/hint/i);
    expect(d).not.toMatch(/pinned toasts nothing/);
  });

  it('the marketplace listing: the manifest and the marketplace entry carry one description, the disclaimer its last sentence', () => {
    const DESCRIPTION =
      'Your Claude Code celebrates when your team scores: a toast with the scorer, a short celebration with the Claude mascot, and the score above your prompt. Follow a competition and pin your team with the claudinho CLI on your machine, then open any match\'s goals and cards with /claudinho match. Live data: ESPN. Not affiliated with FIFA, any confederation, league or club, or Anthropic.';
    const m = json('packages/plugin/.claude-plugin/plugin.json');
    const market = json('.claude-plugin/marketplace.json') as { plugins?: Array<{ description?: unknown }> };
    expect(m.description).toBe(DESCRIPTION);
    expect(market.plugins?.[0]?.description).toBe(DESCRIPTION);
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
   * one the policy accounts for; `$` is never indexed or assigned; the module imports nothing but types, the host's
   * three state helpers, the team look's four pure functions, the scenes' three and the celebration's four with its three lengths; every run is `claudinho ambient` or `claudinho match`; the filesystem is read twice, nvm's
   * version folder listed and `<version>/bin/claudinho` probed; the prompt handler uses its event only to pass it on
   * and to add the note, written from the CLI's `context` unchanged; the command handler reads the typed text only
   * to compare it with `match` and the three team-look phrases. It is a tripwire over the shapes the module has, not a proof: a use of the host or of
   * an event this grammar does not name (a name built at run time, `$` handed to code outside the module, another
   * syntax for the same access) is outside it. The validator's `calls:` line is the full inventory, but it fails on
   * none.
   */
  it('the hooks module calls no host capability beyond the ones PRIVACY.md states, and runs only claudinho', () => {
    const src = hooksSource();
    // `$.state` is named in comments alone: the state goes through the host's `read` and `update`.
    const MEMBERS = new Set([
      'clock.after', 'clock.every', 'clock.now', 'clock.sleep', 'command.register', 'env.get', 'fs.exists', 'fs.list',
      'process.run', 'session.surfaces', 'state.', 'state.get', 'state.set', 'theme.clear', 'theme.set', 'ui.invalidate',
      'ui.open', 'ui.resolve', 'ui.toast',
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
    expect(imports.filter((m) => m[3] !== 'claude-code' && m[3] !== '../types' && m[3] !== './team-look' && m[3] !== './team-scenes' && m[3] !== './celebration').map((m) => m[3])).toEqual([]);
    const values = imports.filter((m) => !m[1]).flatMap((m) => (m[2] ?? '').split(',').map((v) => v.trim()));
    expect(values.filter((v) => v !== '').sort()).toEqual(['FRAME_MS', 'FULLTIME_MS', 'GOAL_FRAMES', 'atom', 'bandSvg', 'boardCode', 'buildLook', 'celebrationBall', 'celebrationRow', 'colorsForPick', 'flagForPick', 'goalRow', 'pitchSvg', 'pixelSvg', 'read', 'resultRow', 'update']);
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
    // The typed text: read once, trimmed, and compared with `match` and the three team-look phrases; nothing else.
    const command = handlerOf(src, 'command.run');
    const TYPED = "const typed = typeof e.args === 'string' ? e.args.trim() : ''";
    expect(command).toContain(TYPED);
    const commandRest = command.replace('async ($, e) =>', '').replace(TYPED, '');
    expect(commandRest).not.toMatch(/\be\b/);
    expect(src).toContain("const PANE_WORD = 'match'");
    expect(src).toContain("const THEME_WORD = 'theme'");
    expect(src).toContain("const THEME_OFF_WORDS = 'theme off'");
    expect(src).toContain("const THEME_ON_WORDS = 'theme on'");
    expect(src).toContain('const THEME_OTHER = /^theme\\s/');
    // `typed` is only ever compared, never printed, stored or handed on: EVERY use on a line is read, each one either
    // `typed === <a word>` or the one pattern test, `THEME_OTHER.test(typed)`.
    const uses = [...command.matchAll(/\btyped\b/g)]
      .map((m) => ({ before: command.slice(Math.max(0, m.index - 17), m.index), after: command.slice(m.index, m.index + 40) }))
      .filter((u) => !u.after.startsWith('typed = typeof e.args'));
    expect(uses.length).toBeGreaterThan(0);
    const allowed = (u: { before: string; after: string }) =>
      /^typed === (PANE_WORD|THEME_WORD|THEME_OFF_WORDS|THEME_ON_WORDS)\b/.test(u.after) || (u.before.endsWith('THEME_OTHER.test(') && u.after.startsWith('typed)'));
    expect(uses.filter((u) => !allowed(u))).toEqual([]);
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
