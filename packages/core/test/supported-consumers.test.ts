/**
 * The table is the ONE place a supported competition is written down
 * (0.11 · 2.5a). The derived views equal the old literal tables, so a test of
 * their VALUES cannot tell a view derived from the table from a copy written
 * beside it, which would not take a new row. This guard asks the source
 * instead: no code outside the table's module spells a supported slug (the
 * bundled competition's slug is written there too, once: `BUNDLED_SLUG`, which
 * the adapter's `DEFAULT_COMPETITION` is).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUNDLE_COMPETITION, DEFAULT_COMPETITION, SUPPORTED } from '../src';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'data' ? [] : sources(path);
    return /\.(ts|mts|mjs)$/.test(name) && !name.endsWith('.d.mts') ? [path] : [];
  });
}

/** Code without its comments (block and line), so a doc comment may name a competition. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('no written fact of a supported competition outside the table', () => {
  it('no source or table consumer spells a supported slug, but the table\'s module', () => {
    // The scripts that consume the table (a smoke seeding a cache file is a fixture, not a fact).
    const files = [
      ...['core', 'cli', 'mcp'].flatMap((p) => sources(join(REPO, 'packages', p, 'src'))),
      join(REPO, 'scripts', 'espn-canary.mjs'),
      join(REPO, 'scripts', 'gen-readme-matrix.mjs'),
    ];
    const allowed = new Set(['packages/core/src/supported.ts']);
    const found: string[] = [];
    for (const file of files) {
      const rel = relative(REPO, file).split(sep).join('/');
      if (allowed.has(rel)) continue;
      const text = code(readFileSync(file, 'utf8'));
      for (const { slug } of SUPPORTED) {
        if (new RegExp(`['"\`]${slug.replace(/\./g, '\\.')}['"\`]`).test(text)) found.push(`${rel}: ${slug}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('each written view is read from the table\'s derived views, by name, in the module that exports it', () => {
    // A view that equals the table's today but is written beside it (a copy,
    // or a set built from another constant) would not take a new row.
    const reads: Array<[string, string[]]> = [
      ['packages/core/src/kinds.ts', ['teamKind', 'competitionKind', 'seasonSlug', 'standingsShape']],
      ['packages/core/src/competition.ts', ['noBracket']],
      ['packages/core/src/markets/provider.ts', ['marketCompetitions']],
    ];
    for (const [file, views] of reads) {
      const text = code(readFileSync(join(REPO, file), 'utf8'));
      for (const view of views) expect(text, `${file} ${view}`).toMatch(new RegExp(`\\bSUPPORTED_TABLES\\.${view}\\b`));
    }
  });

  it('the adapter\'s default is the bundled competition: the one row that offers a bracket', () => {
    expect(DEFAULT_COMPETITION).toBe(BUNDLE_COMPETITION);
    expect(SUPPORTED.filter((e) => e.bracket === 'offered').map((e) => e.slug)).toEqual([BUNDLE_COMPETITION]);
  });
});
