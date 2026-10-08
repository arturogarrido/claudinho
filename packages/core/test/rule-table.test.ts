/**
 * The rule table in AGENTS.md ("Rules and their enforcers", PR C): every row names an enforcer that exists (a test
 * file under a package's test/, a script under scripts/, a workflow under .github/workflows/), so a rename cannot
 * leave a dangling row; exactly one row says it has none; every row's Refuses and Limit cells are filled. A row
 * naming a real but unrelated enforcer passes this structural test: that is the readers' to catch.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HEADING = '## Rules and their enforcers';
const PACKAGES = ['core', 'cli', 'mcp'];

function section(): string {
  const text = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8').replace(/\r\n/g, '\n'); // a Windows checkout's CRLF
  const a = text.indexOf(HEADING);
  expect(a, HEADING).toBeGreaterThanOrEqual(0);
  const b = text.indexOf('\n## ', a + HEADING.length);
  return text.slice(a, b < 0 ? undefined : b);
}

function rows(): string[][] {
  return section()
    .split('\n')
    .filter((l) => l.startsWith('|'))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
    .filter((cells) => cells.length >= 5 && !/^-+$/.test(cells[0] ?? ''));
}

/** Where a test file lives: every package whose test/ holds it. */
function testPackages(file: string): string[] {
  return PACKAGES.filter((p) => existsSync(join(ROOT, 'packages', p, 'test', file)));
}

describe('the rule table', () => {
  it('has the five columns and at least 22 rows', () => {
    const all = rows();
    expect(all[0]?.map((c) => c.toLowerCase())).toEqual(['rule', 'enforcer', 'refuses', 'limit', 'incident']);
    expect(all.length - 1).toBeGreaterThanOrEqual(22);
  });

  it('every enforcer it names exists; exactly one row has none', () => {
    const all = rows().slice(1);
    let none = 0;
    for (const cells of all) {
      const enforcer = cells[1] ?? '';
      // A row says what its enforcer refuses and what it does not: an empty cell is a claim nobody can read.
      expect((cells[2] ?? '').length, `row "${cells[0]}" has a Refuses cell`).toBeGreaterThan(8);
      expect((cells[3] ?? '').length, `row "${cells[0]}" has a Limit cell`).toBeGreaterThan(3);
      if (/^\*?\*?none\b/i.test(enforcer)) {
        none += 1;
        continue;
      }
      const names = [...enforcer.matchAll(/`([^`]+)`/g)].map((m) => m[1] as string);
      expect(names.length, `row "${cells[0]}" names an enforcer in backticks`).toBeGreaterThan(0);
      for (const n of names) {
        if (n.endsWith('.test.ts')) {
          const where = testPackages(n);
          expect(where.length, `${n} exists under a package's test/`).toBeGreaterThan(0);
          // The parenthesized packages right after THIS file's name are the packages that hold it (a cell may name
          // several files, each with its own group: `a.test.ts` (core, cli), `b.test.ts` (core)).
          const after = enforcer.slice(enforcer.indexOf(`\`${n}\``) + n.length + 2);
          const group = /^\s*\(([a-z, ]+)\)/.exec(after);
          const claimed = group ? (group[1] as string).split(',').map((s) => s.trim()) : [];
          for (const c of claimed) if (PACKAGES.includes(c)) expect(where, `${n} in ${c}`).toContain(c);
        } else if (n.startsWith('scripts/')) {
          expect(existsSync(join(ROOT, n)), n).toBe(true);
        } else if (n.endsWith('.yml')) {
          expect(existsSync(join(ROOT, '.github/workflows', n)) || existsSync(join(ROOT, n)), n).toBe(true);
        } else if (n.startsWith('.github/')) {
          expect(existsSync(join(ROOT, n)), n).toBe(true);
        } else {
          // A constant or an identifier in backticks (CACHE_VERSION) is not an enforcer: the row names a file too.
          expect(/\.(test\.ts|sh|mjs|ts|yml)$/.test(n) || names.some((o) => o !== n && /\.(test\.ts|sh|mjs|ts|yml)$/.test(o)), `${n} is a file or beside one`).toBe(true);
        }
      }
    }
    expect(none, 'exactly one row without an enforcer').toBe(1);
  });

  it('the test files it names are a subset of the files that exist (no dangling name survives a rename)', () => {
    const existing = new Set(PACKAGES.flatMap((p) => readdirSync(join(ROOT, 'packages', p, 'test')).filter((f) => f.endsWith('.test.ts'))));
    for (const cells of rows().slice(1)) {
      for (const n of [...(cells[1] ?? '').matchAll(/`([^`]+\.test\.ts)`/g)].map((m) => m[1] as string)) expect(existing.has(n), n).toBe(true);
    }
  });
});
