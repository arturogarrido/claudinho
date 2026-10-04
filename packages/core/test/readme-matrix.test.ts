/**
 * The README's capability matrix is GENERATED from the table (0.11 · 2.5a, D3):
 * `scripts/gen-readme-matrix.mjs` renders the rows between two markers in the
 * root README, and this guard fails when the committed block differs from the
 * generator's output, so the public matrix cannot drift from the data. The
 * generator takes a table, so a sixteenth row renders with no other change.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SUPPORTED } from '../src';

const README = fileURLToPath(new URL('../../../README.md', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../../../scripts/gen-readme-matrix.mjs', import.meta.url));
const START = '<!-- competitions:start -->';
const END = '<!-- competitions:end -->';

describe('the README matrix', () => {
  it('the committed block equals the generator\'s output from the table', async () => {
    const { renderMatrix } = (await import(SCRIPT)) as { renderMatrix: (table: readonly unknown[]) => string };
    const readme = readFileSync(README, 'utf8');
    const start = readme.indexOf(START);
    const end = readme.indexOf(END);
    expect(start, 'the start marker').toBeGreaterThan(-1);
    expect(end, 'the end marker').toBeGreaterThan(start);
    const committed = readme.slice(start + START.length, end).trim();
    expect(committed).toBe(renderMatrix(SUPPORTED).trim());
    // Fifteen rows, each naming its alias, and the five capabilities as columns.
    expect(committed.split('\n').filter((l) => l.startsWith('| `')).length).toBe(15);
    expect(committed).toContain('premier-league');
    expect(committed).toContain('world-cup');
    expect(committed).toMatch(/scores.*next.*standings.*bracket.*markets/i);
  });

  it('a sixteenth row renders with no other change', async () => {
    const { renderMatrix } = (await import(SCRIPT)) as { renderMatrix: (table: readonly unknown[]) => string };
    const fake = { slug: 'fra.1', alias: 'ligue-1', name: 'Ligue 1', teams: 'club', kind: 'league', seasonSlug: 'ligue-1', standings: 'league', bracket: 'not-offered-yet', markets: 'not-offered-yet', cadenceYears: 1 };
    const out = renderMatrix([...SUPPORTED, fake]);
    expect(out.split('\n').filter((l) => l.startsWith('| `')).length).toBe(16);
    expect(out).toContain('ligue-1');
    expect(out).toContain('Ligue 1');
  });
});
