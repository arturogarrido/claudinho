/**
 * The README's capability matrix, GENERATED from the supported table.
 *
 * The supported competitions are ONE table in core (`SUPPORTED`); the matrix
 * the root README shows is rendered from it, between two markers, so the
 * public list cannot drift from the data. `packages/core/test/readme-matrix.test.ts`
 * fails when the committed block differs from what this renders.
 *
 *   pnpm -r build && pnpm gen:readme-matrix
 *
 * `renderMatrix(table)` is pure and takes the table as its input, so a row
 * added to the table renders with no change here. Run as a script, it loads
 * core's BUILT package (the table travels with it), renders it, and rewrites
 * the block between the markers in `README.md`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const START = '<!-- competitions:start -->';
export const END = '<!-- competitions:end -->';

/** How a capability reads in the matrix. */
const CELL = Object.freeze({ offered: 'yes', 'not-offered-yet': 'not yet', 'not-applicable': 'n/a' });
const TEAMS = Object.freeze({ nation: 'nations', club: 'clubs' });

/**
 * A row's five capabilities, by core's definition (`capabilitiesOf`): scores
 * and the next fixture are the generic reads, offered on every competition;
 * standings are offered unless the competition has no table; bracket and
 * markets are the row's own. Read off the row so the renderer needs nothing
 * but the table; the readme-matrix test compares every rendered row with
 * core's `capabilitiesOf`, so the two cannot disagree unnoticed.
 */
function capabilitiesOfRow(entry) {
  return {
    scores: 'offered',
    next: 'offered',
    standings: entry.standings === 'none' ? 'not-applicable' : 'offered',
    bracket: entry.bracket,
    markets: entry.markets,
  };
}

const cell = (capability) => (Object.hasOwn(CELL, capability) ? CELL[capability] : String(capability));

/** The matrix as Markdown: a header naming the five capabilities, one row per entry, then the legend. */
export function renderMatrix(table) {
  const lines = [
    '| Alias | Competition | Teams | Scores | Next | Standings | Bracket | Markets |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const entry of table) {
    const caps = capabilitiesOfRow(entry);
    const teams = Object.hasOwn(TEAMS, entry.teams) ? TEAMS[entry.teams] : String(entry.teams);
    lines.push(
      `| \`${entry.alias}\` | ${entry.name} | ${teams} | ${cell(caps.scores)} | ${cell(caps.next)} | ${cell(caps.standings)} | ${cell(caps.bracket)} | ${cell(caps.markets)} |`,
    );
  }
  lines.push(
    '',
    '`yes` offered · `not yet` not offered yet · `n/a` the competition has no such thing (a league season with no knockout tie has no bracket; a knockout-only cup has no table).',
  );
  return `${lines.join('\n')}\n`;
}

/**
 * The README with the block between the markers replaced; throws when the
 * markers are missing. The block (rendered with LF) is written with the
 * README's OWN line ending, and so are the newlines around it: CRLF when the
 * README has any CRLF (a default Windows checkout), LF otherwise: a README
 * with one ending stays a file with one ending, and a second run on its own
 * output changes nothing.
 */
export function withMatrix(readme, block) {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`README.md has no ${START} … ${END} block`);
  }
  const eol = readme.includes('\r\n') ? '\r\n' : '\n';
  const body = block.trimEnd().replace(/\r?\n/g, eol);
  return `${readme.slice(0, start + START.length)}${eol}${body}${eol}${readme.slice(end)}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
  const dist = resolve(root, 'packages', 'core', 'dist', 'index.js');
  if (!existsSync(dist)) {
    console.error('✗ packages/core/dist not found — run `pnpm -r build` first.');
    process.exit(2);
  }
  const core = await import(pathToFileURL(dist).href);
  const path = resolve(root, 'README.md');
  const before = readFileSync(path, 'utf8');
  const after = withMatrix(before, renderMatrix(core.SUPPORTED));
  if (after !== before) writeFileSync(path, after);
  console.log(after === before ? 'README.md: the matrix is current.' : 'README.md: the matrix was rewritten.');
}
