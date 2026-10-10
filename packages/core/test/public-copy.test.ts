/**
 * Public copy (0.11 · 2.7): the framing every listing says, the counts it
 * carries, the keywords, and the dash rule. The framing names four competitions
 * and counts the rest ("and 11 more"): the digit is `SUPPORTED.length - 4` and
 * the names are rows of the table, so a new row fails here until every
 * copy is updated; "15" or "fifteen" counting the supported set is pinned the
 * same way. No em-dash (U+2014) in authored prose: the listing strings and the
 * public Markdown outside fenced blocks and inline code, with the quoted voice
 * example `— ¡GOOOOL!` the one exception (a renderer's separator, not prose).
 * Every en dash (U+2013: a score, a range, an alt text) stays: each file's count
 * is pinned to the count it had before the sweep.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SUPPORTED } from '../src';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const collapsed = (text: string) => text.replace(/\s+/g, ' ');
const json = (rel: string) => JSON.parse(read(rel)) as Record<string, unknown>;

const NAMED = ['World Cup', 'Premier League', 'LALIGA', 'Champions League'] as const;
/** Every file under a repository-root directory, as root-relative paths (empty when the directory is absent). */
function walk(rel: string): string[] {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return [];
  // Forward slashes whatever the platform: the paths are compared as repository paths (`guides/...`).
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${rel}/${e.name}`) : [`${rel}/${e.name}`]));
}
const REST = SUPPORTED.length - NAMED.length;
const FRAMING = `the World Cup, the Premier League, LALIGA, the Champions League and ${REST} more`;

/** The files that MUST carry the framing sentence (the Registry's card and core's listing carry the count alone). */
const FRAMED = [
  { rel: 'packages/cli/package.json', text: () => String(json('packages/cli/package.json').description) },
  { rel: 'packages/mcp/package.json', text: () => String(json('packages/mcp/package.json').description) },
  { rel: 'packages/mcp/mcpb/manifest.json (description)', text: () => String(json('packages/mcp/mcpb/manifest.json').description) },
  { rel: 'packages/mcp/mcpb/manifest.json (long_description)', text: () => String(json('packages/mcp/mcpb/manifest.json').long_description) },
  { rel: '.cursor-plugin/plugin.json', text: () => String(json('.cursor-plugin/plugin.json').description) },
  { rel: 'README.md', text: () => collapsed(read('README.md')) },
  { rel: 'packages/cli/README.md', text: () => collapsed(read('packages/cli/README.md')) },
  { rel: 'packages/mcp/README.md', text: () => collapsed(read('packages/mcp/README.md')) },
  { rel: 'packages/core/README.md', text: () => collapsed(read('packages/core/README.md')) },
  { rel: 'AGENTS.md', text: () => collapsed(read('AGENTS.md')) },
  { rel: '.cursor-plugin/README.md', text: () => collapsed(read('.cursor-plugin/README.md')) },
];

describe('the framing', () => {
  it('names four rows of the table and counts the rest', () => {
    const names = new Set(SUPPORTED.map((row) => row.name));
    for (const n of NAMED) expect([...names].some((name) => name.includes(n)), n).toBe(true);
    expect(REST).toBeGreaterThan(0);
  });

  it('is said, with the digit the table gives, in every file that must carry it', () => {
    for (const { rel, text } of FRAMED) expect(text(), rel).toContain(FRAMING);
  });

  it('the files that count the supported set count the table', () => {
    const WORDS: Record<number, string> = { 10: 'ten', 11: 'eleven', 12: 'twelve', 13: 'thirteen', 14: 'fourteen', 15: 'fifteen', 16: 'sixteen', 17: 'seventeen', 18: 'eighteen', 19: 'nineteen', 20: 'twenty' };
    const n = SUPPORTED.length;
    // "15 competitions", "15 supported competitions", and core's listing's "(15 supported)" (the draft's verbatim
    // string): the last one the first form of this pattern could not see, so core's count went unpinned.
    const counting = /\b(\d{2}|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty) (?:(?:supported )?competitions\b|supported\b)/gi;
    // The guides (PR C) hold the conventions' moved narration, counts included: every file under guides/ counts the
    // table too (the framing and the dash rule stay on their own lists; a guide may carry em dashes as AGENTS.md does).
    const guides = walk('guides').filter((f) => f.endsWith('.md'));
    expect(guides.length, 'guides/ holds at least one markdown file').toBeGreaterThan(0);
    for (const rel of ['packages/mcp/server.json', 'packages/core/package.json', 'AGENTS.md', 'packages/cli/README.md', 'packages/core/README.md', ...guides]) {
      const text = collapsed(read(rel));
      const hits = [...text.matchAll(counting)].map((m) => String(m[1]).toLowerCase());
      if (!rel.startsWith('guides/')) expect(hits.length, `${rel} counts the supported set`).toBeGreaterThan(0);
      for (const hit of hits) expect(hit === String(n) || hit === WORDS[n], `${rel}: "${hit} competitions"`).toBe(true);
    }
  });
});

describe('the keywords', () => {
  const ALIASES = SUPPORTED.map((row) => row.alias).filter((a) => a !== 'world-cup');
  for (const rel of ['packages/cli/package.json', 'packages/mcp/package.json', 'packages/core/package.json', 'packages/mcp/mcpb/manifest.json', '.cursor-plugin/plugin.json']) {
    it(`${rel} carries every competition's alias, keeps world-cup, and has no bare year`, () => {
      const keywords = json(rel).keywords as string[];
      expect(Array.isArray(keywords)).toBe(true);
      for (const alias of ALIASES) expect(keywords, alias).toContain(alias);
      expect(keywords).toContain('world-cup');
      expect(keywords).not.toContain('2026');
    });
  }
});

/** Authored prose: the text outside fenced blocks and inline code. */
function prose(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

const PUBLIC_MARKDOWN = [
  'README.md',
  'packages/cli/README.md',
  'packages/mcp/README.md',
  'packages/core/README.md',
  'CONTRIBUTING.md',
  'PRIVACY.md',
  'SECURITY.md',
  '.cursor-plugin/README.md',
];
/** The one em-dash that is not prose: the voice example quotes the renderer's own separator. */
const VOICE_EXAMPLE = '— ¡GOOOOL!';

describe('no em-dash in authored prose', () => {
  for (const rel of PUBLIC_MARKDOWN) {
    it(`${rel}: none outside fenced blocks and inline code (the quoted voice example excepted)`, () => {
      const text = prose(read(rel)).split(VOICE_EXAMPLE).join('');
      const lines = text.split('\n').filter((l) => l.includes('—'));
      expect(lines, lines.slice(0, 3).join(' | ')).toEqual([]);
    });
  }

  it('none in the listing strings', () => {
    const strings = [
      String(json('package.json').description),
      String(json('packages/cli/package.json').description),
      String(json('packages/mcp/package.json').description),
      String(json('packages/core/package.json').description),
      String(json('packages/mcp/server.json').description),
      String(json('packages/mcp/mcpb/manifest.json').description),
      String(json('packages/mcp/mcpb/manifest.json').long_description),
      ...((json('packages/mcp/mcpb/manifest.json').tools as { description: string }[]) ?? []).map((t) => t.description),
      String(json('.cursor-plugin/plugin.json').description),
    ];
    for (const s of strings) expect(s, s.slice(0, 60)).not.toMatch(/—/);
  });
});

describe('every en dash stays (a score, a range, an alt text)', () => {
  // The counts each file had before the sweep (Oct 5, 2026, main f48fd45): a sweep that touched one fails here.
  // README.md: 8 → 14 on Oct 6, 2026, when the statusline example became the real eight-match line of the
  // Nations League capture (eight scores); the three dashes of the old hero alt and comment left with it.
  const BEFORE: Record<string, number> = {
    'README.md': 14,
    'packages/cli/README.md': 7,
    'packages/mcp/README.md': 1,
    'packages/core/README.md': 0,
    'CONTRIBUTING.md': 0,
    'PRIVACY.md': 0,
    'SECURITY.md': 0,
    '.cursor-plugin/README.md': 0,
  };
  for (const [rel, n] of Object.entries(BEFORE)) {
    it(`${rel}: ${n}`, () => {
      expect((read(rel).match(/–/g) ?? []).length).toBe(n);
    });
  }
});
