/**
 * The README matrix generator holds no copy of the capability rule (0.11 ·
 * 2.5a, review): `renderMatrix(table, capabilitiesOf)` takes core's function
 * and renders what it answers, so the matrix, `list_competitions` and the
 * commands read one rule. A source guard refuses a second copy in the script.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Capabilities, type CompetitionEntry, capabilitiesOf, SUPPORTED } from '../src';

const SCRIPT = fileURLToPath(new URL('../../../scripts/gen-readme-matrix.mjs', import.meta.url));
type Generator = { renderMatrix: (table: readonly CompetitionEntry[], caps: (slug: string, table: readonly CompetitionEntry[]) => Capabilities) => string };
const FAKE: CompetitionEntry = {
  slug: 'fra.1',
  alias: 'ligue-1',
  name: 'Ligue 1',
  teams: 'club',
  kind: 'league',
  seasonSlug: 'ligue-1',
  standings: 'none',
  bracket: 'not-offered-yet',
  markets: 'not-offered-yet',
  cadenceYears: 1,
};

describe('renderMatrix takes the rule from core', () => {
  it('renders what the function handed in answers', async () => {
    const { renderMatrix } = (await import(SCRIPT)) as Generator;
    const table = [...SUPPORTED, FAKE];
    const all = (): Capabilities => ({ scores: 'offered', next: 'offered', standings: 'offered', bracket: 'offered', markets: 'offered' });
    const row = (out: string) => out.split('\n').find((l) => l.startsWith('| `ligue-1`')) ?? '';
    expect(row(renderMatrix(table, all))).toBe('| `ligue-1` | Ligue 1 | clubs | yes | yes | yes | yes | yes |');
    expect(row(renderMatrix(table, capabilitiesOf))).toBe('| `ligue-1` | Ligue 1 | clubs | yes | yes | n/a | not yet | not yet |');
  });

  it('the script holds no copy of the rule', () => {
    const source = readFileSync(SCRIPT, 'utf8');
    expect(source).not.toMatch(/standings === 'none'/);
    expect(source).not.toMatch(/scores: 'offered'/);
    expect(source).toMatch(/capabilitiesOf/);
  });
});
