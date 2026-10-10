/**
 * The README's capability matrix is GENERATED from the table (0.11 · 2.5a, D3):
 * `scripts/gen-readme-matrix.mjs` renders the rows between two markers in the
 * root README, and this guard fails when the committed block differs from the
 * generator's output, so the public matrix cannot drift from the data. The
 * generator takes a table, so a new row renders with no other change.
 *
 * The README is a text file git may check out with CRLF (a default Windows
 * checkout; `.gitattributes` pins only `scripts/`), so the guard compares the
 * block by its lines, whatever the ending, and the generator writes the block
 * with the README's own ending rather than a mixed file.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { type Capabilities, capabilitiesOf, SUPPORTED } from '../src';

const README = fileURLToPath(new URL('../../../README.md', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../../../scripts/gen-readme-matrix.mjs', import.meta.url));
const START = '<!-- competitions:start -->';
const END = '<!-- competitions:end -->';
// The generator takes core's capability rule as its second argument (0.11 · 2.5a: one copy of the rule).
type Generator = { renderMatrix: (table: readonly unknown[], caps: (slug: string, table: never) => Capabilities) => string; withMatrix: (readme: string, block: string) => string };

/** The block between the markers of a README text, line endings normalized. */
const blockOf = (readme: string) => {
  const text = readme.replace(/\r\n/g, '\n');
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  expect(start, 'the start marker').toBeGreaterThan(-1);
  expect(end, 'the end marker').toBeGreaterThan(start);
  return text.slice(start + START.length, end).trim();
};

const tmp = mkdtempSync(join(tmpdir(), 'claudinho-readme-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('the README matrix', () => {
  it('the committed block equals the generator\'s output from the table', async () => {
    const { renderMatrix } = (await import(SCRIPT)) as Generator;
    const committed = blockOf(readFileSync(README, 'utf8'));
    expect(committed).toBe(renderMatrix(SUPPORTED, capabilitiesOf).trim());
    // One row per competition, each naming its alias, and the five capabilities as columns.
    expect(committed.split('\n').filter((l) => l.startsWith('| `')).length).toBe(SUPPORTED.length);
    expect(committed).toContain('premier-league');
    expect(committed).toContain('world-cup');
    expect(committed).toMatch(/scores.*next.*standings.*bracket.*markets/i);
  });

  it('the guard reads the README under either line ending: a CRLF copy and an LF copy of the committed README both pass it', async () => {
    const { renderMatrix } = (await import(SCRIPT)) as Generator;
    // The checkout's own ending is the platform's (CRLF on a default Windows checkout), so both copies are built from a normalized text.
    const lf = readFileSync(README, 'utf8').replace(/\r\n/g, '\n');
    expect(lf).not.toContain('\r');
    const crlf = join(tmp, 'README.crlf.md');
    writeFileSync(crlf, lf.replace(/\n/g, '\r\n'));
    expect(readFileSync(crlf, 'utf8')).toContain('\r\n');
    expect(blockOf(readFileSync(crlf, 'utf8'))).toBe(renderMatrix(SUPPORTED, capabilitiesOf).trim());
    expect(blockOf(lf)).toBe(renderMatrix(SUPPORTED, capabilitiesOf).trim());
  });

  it('a row past the table renders with no other change', async () => {
    const { renderMatrix } = (await import(SCRIPT)) as Generator;
    const fake = { slug: 'fra.1', alias: 'ligue-1', name: 'Ligue 1', teams: 'club', kind: 'league', seasonSlug: 'ligue-1', standings: 'league', bracket: 'not-offered-yet', markets: 'not-offered-yet', cadenceYears: 1 };
    const out = renderMatrix([...SUPPORTED, fake], capabilitiesOf);
    expect(out.split('\n').filter((l) => l.startsWith('| `')).length).toBe(SUPPORTED.length + 1);
    expect(out).toContain('ligue-1');
    expect(out).toContain('Ligue 1');
  });

  it('the generator writes the block with the README\'s own line ending, never a mixed file', async () => {
    const { renderMatrix, withMatrix } = (await import(SCRIPT)) as Generator;
    const block = renderMatrix(SUPPORTED, capabilitiesOf);
    const lfReadme = `# Title\n\n${START}\nstale\n${END}\n\ntail\n`;
    const lfOut = withMatrix(lfReadme, block);
    expect(lfOut).not.toContain('\r');
    expect(blockOf(lfOut)).toBe(block.trim());
    const crlfReadme = lfReadme.replace(/\n/g, '\r\n');
    const crlfOut = withMatrix(crlfReadme, block);
    expect(crlfOut.replace(/\r\n/g, '')).not.toContain('\n');
    expect(crlfOut.replace(/\r\n/g, '\n')).toBe(lfOut);
    expect(blockOf(crlfOut)).toBe(block.trim());
    // A second run on its own output changes nothing, under either ending.
    expect(withMatrix(lfOut, block)).toBe(lfOut);
    expect(withMatrix(crlfOut, block)).toBe(crlfOut);
  });
});
