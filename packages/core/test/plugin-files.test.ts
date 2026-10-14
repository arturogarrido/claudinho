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
