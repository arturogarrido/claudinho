/**
 * The disclaimer (0.11 · 2.7, ledger D5 option B): ONE constant in core,
 * `DISCLAIMER`, with `FAN_PROJECT` and `disclaimerLine(host?)` beside it. Every
 * runtime surface imports it; every STATIC copy (the listing JSON files and the
 * public Markdown, which cannot import) is pinned here to the constant, so the
 * sentence cannot drift in one place. The MCP Registry's card is the one stated
 * exception (its description is capped at 100 characters and carries the fan
 * line alone); each listing host's composition is the constant plus
 * `, nor with <host>` before the period, never a second spelling.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DISCLAIMER, disclaimerLine, FAN_PROJECT } from '../src';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
/** Markdown wraps a sentence across lines, and a Windows checkout reads CRLF: compare on collapsed whitespace. */
const collapsed = (text: string) => text.replace(/\s+/g, ' ');
const json = (rel: string) => JSON.parse(read(rel)) as Record<string, unknown>;

const SENTENCE = 'Not affiliated with FIFA, any confederation, league or club, or Anthropic.';

describe('the disclaimer constant', () => {
  it('is the one sentence, with the fan line and the host composition beside it', () => {
    expect(DISCLAIMER).toBe(SENTENCE);
    expect(FAN_PROJECT).toBe('Independent fan project');
    expect(disclaimerLine()).toBe(SENTENCE);
    expect(disclaimerLine('Smithery')).toBe(
      'Not affiliated with FIFA, any confederation, league or club, or Anthropic, nor with Smithery.',
    );
    expect(disclaimerLine('Cursor')).toBe(
      'Not affiliated with FIFA, any confederation, league or club, or Anthropic, nor with Cursor.',
    );
    expect(DISCLAIMER).not.toMatch(/—/); // no em-dash in public copy
  });

  it('is spelled in no src file but its own (every surface imports it)', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|mts|js|mjs)$/.test(name) && !p.endsWith(join('core', 'src', 'disclaimer.ts'))) {
          if (/affiliated with/i.test(readFileSync(p, 'utf8'))) offenders.push(p.slice(ROOT.length));
        }
      }
    };
    for (const pkg of ['core', 'cli', 'mcp']) walk(join(ROOT, 'packages', pkg, 'src'));
    expect(offenders).toEqual([]);
  });
});

describe('the static copies carry the constant', () => {
  it('the three npm descriptions end with it', () => {
    for (const rel of ['packages/cli/package.json', 'packages/mcp/package.json', 'packages/core/package.json']) {
      expect(String(json(rel).description), rel).toMatch(new RegExp(`${escape(disclaimerLine())}$`));
    }
  });

  it("the Smithery manifest's two descriptions end with its host composition, the Cursor plugin's with its own", () => {
    const manifest = json('packages/mcp/mcpb/manifest.json');
    expect(String(manifest.description)).toMatch(new RegExp(`${escape(disclaimerLine('Smithery'))}$`));
    expect(String(manifest.long_description)).toMatch(new RegExp(`${escape(disclaimerLine('Smithery'))}$`));
    const plugin = json('.cursor-plugin/plugin.json');
    expect(String(plugin.description)).toMatch(new RegExp(`${escape(disclaimerLine('Cursor'))}$`));
  });

  it("the MCP Registry's card is the stated exception: the fan line alone, within the schema's 100 characters, and it lists the selection settings", () => {
    const server = json('packages/mcp/server.json');
    expect(String(server.description)).toBe(
      'Live football scores, fixtures and standings for 15 supported competitions. Unofficial fan project.',
    );
    expect(String(server.description).length).toBeLessThanOrEqual(100);
    if (typeof server.title === 'string') expect(server.title.length).toBeLessThanOrEqual(100);
    const vars = JSON.stringify(server);
    expect(vars).toContain('CLAUDINHO_COMPETITION');
    expect(vars).toContain('CLAUDINHO_TEAM');
  });

  it('every public document says the sentence, verbatim, once whitespace is collapsed', () => {
    for (const rel of [
      'README.md',
      'packages/cli/README.md',
      'packages/mcp/README.md',
      'packages/core/README.md',
      '.cursor-plugin/README.md',
      'CONTRIBUTING.md',
      'PRIVACY.md',
      'SECURITY.md',
      'AGENTS.md',
    ]) {
      expect(collapsed(read(rel)), rel).toContain(SENTENCE);
    }
  });
});

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
