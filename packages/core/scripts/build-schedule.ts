/**
 * Generate the bundled static schedule from the ESPN feed.
 *
 *   pnpm -F @claudinho/core gen:schedule
 *
 * Fetches the full tournament window in weekly chunks, dedupes by id, sorts by
 * kickoff, and writes src/data/schedule.2026.json and src/data/bracket.2026.json.
 * Live scores and final results are stripped — the bundle is a resultless skeleton;
 * only team names, kickoffs, venues, and bracket structure ship in the package.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EspnAdapter } from '../src/adapters/espn';
import { buildBracketTopology } from '../src/bracket/build';
import { sanitizeBundledFixture } from '../src/schedule';
import type { Match } from '../src/types';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'src', 'data', 'schedule.2026.json');
const BRACKET_OUT = join(here, '..', 'src', 'data', 'bracket.2026.json');

// Tournament runs 2026-06-11 .. 2026-07-19; fetch in ~weekly windows.
const WINDOWS: ReadonlyArray<readonly [string, string]> = [
  ['20260611', '20260617'],
  ['20260618', '20260624'],
  ['20260625', '20260701'],
  ['20260702', '20260708'],
  ['20260709', '20260715'],
  ['20260716', '20260719'],
];

async function main(): Promise<void> {
  const adapter = new EspnAdapter();
  const byId = new Map<string, Match>();

  for (const [start, end] of WINDOWS) {
    try {
      const matches = await adapter.fetchWindow(start, end);
      for (const m of matches) byId.set(m.id, m);
      console.log(`  ${start}-${end}: ${matches.length} fixtures`);
    } catch (err) {
      console.error(`  ${start}-${end}: FAILED — ${(err as Error).message}`);
    }
  }

  const all = [...byId.values()]
    .map(sanitizeBundledFixture)
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff));

  const problems: string[] = [];
  const withResults = all.filter((m) => m.status !== 'SCHEDULED' || m.score != null);
  if (withResults.length > 0) {
    problems.push(
      `bundled schedule must be resultless: ${withResults.length} fixture(s) still carry status/score after sanitize`,
    );
  }
  const stageCounts = all.reduce<Record<string, number>>((acc, m) => {
    acc[m.stage] = (acc[m.stage] ?? 0) + 1;
    return acc;
  }, {});
  const groupLetters = new Set(all.filter((m) => m.group).map((m) => m.group));
  const EXPECTED: Record<string, number> = {
    GROUP: 72, R32: 16, R16: 8, QF: 4, SF: 2, '3P': 1, F: 1,
  };

  if (all.length !== 104) problems.push(`expected 104 fixtures, got ${all.length}`);
  if (groupLetters.size !== 12) {
    problems.push(`expected 12 groups, got ${groupLetters.size} (${[...groupLetters].sort().join(',')})`);
  }
  for (const [stage, n] of Object.entries(EXPECTED)) {
    if ((stageCounts[stage] ?? 0) !== n) {
      problems.push(`stage ${stage}: expected ${n}, got ${stageCounts[stage] ?? 0}`);
    }
  }

  console.log(`\nstage counts: ${JSON.stringify(stageCounts)}`);
  console.log(`groups (${groupLetters.size}): ${[...groupLetters].sort().join(', ')}`);

  if (problems.length > 0) {
    console.error('\n⚠️  schedule validation FAILED:');
    for (const p of problems) console.error(`   - ${p}`);
    console.error('Not writing the file. Re-check the ESPN feed / mapping.');
    process.exit(1);
  }

  const generatedAt = new Date().toISOString();
  let topology;
  try {
    topology = buildBracketTopology(all, generatedAt);
  } catch (err) {
    console.error('\n⚠️  bracket topology FAILED:');
    console.error(`   ${(err as Error).message}`);
    console.error('Not writing files. Update bracket parsers in src/bracket/parse.ts.');
    process.exit(1);
  }

  writeFileSync(OUT, JSON.stringify(all, null, 2) + '\n');
  writeFileSync(BRACKET_OUT, JSON.stringify(topology, null, 2) + '\n');
  console.log(`\n✓ wrote ${all.length} fixtures -> ${OUT}`);
  console.log(`✓ wrote ${topology.matches.length} bracket nodes -> ${BRACKET_OUT}`);
  for (const m of all.slice(0, 3)) {
    const g = m.group ? ` [${m.group}]` : '';
    console.log(`  e.g. ${m.kickoff}${g}  ${m.home.flag} ${m.home.name} vs ${m.away.name} ${m.away.flag}  @ ${m.venue}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
