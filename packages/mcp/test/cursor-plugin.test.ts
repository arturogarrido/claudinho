import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The Cursor Marketplace plugin lives at the REPO ROOT (.cursor-plugin/plugin.json
// + mcp.json), outside any package, so nothing else type-checks or lints its shape.
// Guard it here so a malformed manifest can't silently ship and fail Cursor's
// plugin review. Spec: cursor.com/docs/reference/plugins.
const readRoot = (rel: string) =>
  JSON.parse(readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8'));

describe('Cursor Marketplace plugin', () => {
  const plugin = readRoot('.cursor-plugin/plugin.json') as {
    name: string;
    version?: string;
    logo?: string;
    license?: string;
  };
  const mcp = readRoot('mcp.json') as {
    mcpServers: Record<string, { command: string; args: string[] }>;
  };

  it('name is lowercase kebab-case (Cursor plugin spec)', () => {
    expect(plugin.name).toBe('claudinho');
    expect(plugin.name).toMatch(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/);
  });

  it('carries a valid semver version', () => {
    // Decoupled from the npm packages on purpose: the server is fetched via
    // `npx -y @claudinho/mcp` (always latest), so this is the marketplace
    // listing version, not a package pin — just assert it's well-formed.
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('logo path is relative, safe (no `..` / absolute), and the file exists', () => {
    expect(plugin.logo).toBeTruthy();
    expect(plugin.logo?.startsWith('/')).toBe(false);
    expect(plugin.logo?.includes('..')).toBe(false);
    expect(existsSync(new URL(`../../../${plugin.logo}`, import.meta.url))).toBe(true);
  });

  it('mcp.json declares the claudinho server via `npx -y @claudinho/mcp`', () => {
    const s = mcp.mcpServers?.claudinho;
    expect(s?.command).toBe('npx');
    expect(s?.args).toEqual(['-y', '@claudinho/mcp']);
  });
});
