/**
 * Build the bundled static schedule from the provider's feed (run by
 * `scripts/gen-schedule.ts`: `pnpm -F @claudinho/core gen:schedule`).
 *
 * Fetches the tournament's windows (the adapter asks for each by calendar
 * month: the provider refuses date ranges), dedupes by id, sorts by kickoff,
 * and writes src/data/schedule.2026.json and src/data/bracket.2026.json. Live
 * scores and final results are stripped — the bundle is a resultless
 * skeleton; only team names, kickoffs, venues, and bracket structure ship in
 * the package.
 *
 * FAILS LOUD. The schedule is built only from reads that said they were whole
 * and of this edition: a window that failed, that carried no account of
 * itself, that was not whole (a record left out, even one whose loss the
 * shape checks below would not notice, like a refused duplicate), or that
 * states a season other than {@link SEASON_YEAR} (or none) stops the run at
 * once, naming the window and the reason, and nothing is written. Then the
 * merged result is checked against the tournament's named facts below and
 * core's canonical knockout counts (never against this run's own topology,
 * which would compare the fetch to itself, nor the file being replaced).
 *
 * This module only exports; it runs nothing on import.
 */
import { fetchMeta } from '../src/adapters/meta';
import type { ProviderAdapter } from '../src/adapters/types';
import { buildBracketTopology } from '../src/bracket/build';
import { isPlaceholderSide } from '../src/bracket/placeholders';
import type { BracketTopology } from '../src/bracket/types';
import { EXPECTED_KNOCKOUT_COUNTS } from '../src/bracket/types';
import { isKnockoutStage, sanitizeBundledFixture } from '../src/schedule';
import { withFlag } from '../src/text';
import type { Match } from '../src/types';

/** The edition the bundle describes: every window must state this season. */
export const SEASON_YEAR = 2026;
/** The group stage: twelve groups of four, each a single round robin. */
export const GROUPS = 12;
export const TEAMS_PER_GROUP = 4;
/** Group matches: every pair in a group plays once. */
const GROUP_MATCHES = (GROUPS * TEAMS_PER_GROUP * (TEAMS_PER_GROUP - 1)) / 2;
/** Every stage's count: the group stage, then core's canonical knockout rounds. */
const EXPECTED_STAGE_COUNTS: Readonly<Record<string, number>> = {
  GROUP: GROUP_MATCHES,
  ...(EXPECTED_KNOCKOUT_COUNTS as Record<string, number>),
};
/** The tournament's fixtures: the sum of its stages. */
const EXPECTED_FIXTURES = Object.values(EXPECTED_STAGE_COUNTS).reduce((a, b) => a + b, 0);

/**
 * The tournament's calendar, in ~weekly windows (inclusive, `YYYYMMDD`): it
 * runs from June 11 to July 19. Written down, like the facts above.
 */
export const WINDOWS: ReadonlyArray<readonly [string, string]> = [
  ['20260611', '20260617'],
  ['20260618', '20260624'],
  ['20260625', '20260701'],
  ['20260702', '20260708'],
  ['20260709', '20260715'],
  ['20260716', '20260719'],
];

/** Where the two files go, relative to the core package (forward slashes on every platform). */
export const SCHEDULE_FILE = 'src/data/schedule.2026.json';
export const BRACKET_FILE = 'src/data/bracket.2026.json';

export interface BuildScheduleIO {
  /** The provider, asked one window at a time (strictly: two seasons in a window are refused). */
  adapter: ProviderAdapter;
  /** Writes a file: a path relative to the core package, and its contents. Called only once every check passed. */
  write: (path: string, body: string) => void;
  log: (line: string) => void;
  error: (line: string) => void;
}

/** Why a window's read cannot be built from, or undefined when it can. */
function refusal(window: string, read: Match[]): string | undefined {
  const meta = fetchMeta(read);
  if (!meta) {
    return `window ${window}: the response carried no account of itself, so it is not known to be whole`;
  }
  if (meta.complete !== true) {
    const count =
      meta.omitted !== undefined
        ? ` (${meta.omitted} provider record(s) left out in the response for this window)`
        : ' (the count of records left out is not known)';
    return `window ${window}: the read was not whole${count}`;
  }
  if (meta.season?.year !== SEASON_YEAR) {
    return `window ${window}: the response states season ${meta.season?.year ?? 'none'}, not ${SEASON_YEAR}`;
  }
  return undefined;
}

/**
 * Fetch every window, validate, and write both files, or throw an Error that
 * names what failed. The writer is never called before every check passed.
 */
export async function buildSchedule({ adapter, write, log, error }: BuildScheduleIO): Promise<void> {
  if (!adapter.fetchWindow) throw new Error('the adapter cannot fetch a window; nothing written');
  const byId = new Map<string, Match>();
  /** The window that first served each fixture: the windows partition the calendar. */
  const servedBy = new Map<string, string>();

  for (const [start, end] of WINDOWS) {
    const window = `${start}-${end}`;
    let matches: Match[];
    try {
      matches = await adapter.fetchWindow(start, end);
    } catch (err) {
      // At once: no further window is asked, and nothing is written.
      throw new Error(`window ${window}: the request failed (${(err as Error).message}); nothing written`);
    }
    const why = refusal(window, matches);
    if (why) throw new Error(`${why}; nothing written`);
    for (const m of matches) {
      // A second copy is a contradiction, never silently the one kept: the
      // adapter refuses one within a window, this refuses one across them.
      const first = servedBy.get(m.id);
      if (first !== undefined) {
        throw new Error(
          first === window
            ? `fixture ${m.id} was served twice by window ${window}; nothing written`
            : `fixture ${m.id} was served by two windows (${first} and ${window}); nothing written`,
        );
      }
      servedBy.set(m.id, window);
      byId.set(m.id, m);
    }
    log(`  ${window}: ${matches.length} fixtures`);
  }

  const raw = [...byId.values()];
  const generatedAt = new Date().toISOString();
  let topology: BracketTopology;
  try {
    topology = buildBracketTopology(raw, generatedAt);
  } catch (err) {
    throw new Error(
      `bracket topology failed: ${(err as Error).message}; nothing written (update the bracket parsers in src/bracket/parse.ts)`,
    );
  }

  const nodeById = new Map(topology.matches.map((n) => [n.matchId, n]));
  const all = raw
    .map((m) => sanitizeBundledFixture(m, nodeById.get(m.id)))
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff));

  const problems: string[] = [];
  const withResults = all.filter((m) => m.status !== 'SCHEDULED' || m.score != null);
  if (withResults.length > 0) {
    problems.push(
      `bundled schedule must be resultless: ${withResults.length} fixture(s) still carry status/score after sanitize`,
    );
  }
  const knockoutLeaks = all.filter(
    (m) =>
      isKnockoutStage(m.stage) && (!isPlaceholderSide(m.home) || !isPlaceholderSide(m.away)),
  );
  if (knockoutLeaks.length > 0) {
    problems.push(
      `knockout bundle must be placeholder-only: ${knockoutLeaks.length} fixture(s) still carry real nation flags`,
    );
  }
  const stageCounts = all.reduce<Record<string, number>>((acc, m) => {
    acc[m.stage] = (acc[m.stage] ?? 0) + 1;
    return acc;
  }, {});
  const groupLetters = new Set(all.filter((m) => m.group).map((m) => m.group));

  if (all.length !== EXPECTED_FIXTURES) problems.push(`expected ${EXPECTED_FIXTURES} fixtures, got ${all.length}`);
  // The match formula does not imply the letters: count the distinct ones.
  if (groupLetters.size !== GROUPS) {
    problems.push(`expected ${GROUPS} groups, got ${groupLetters.size} (${[...groupLetters].sort().join(',')})`);
  }
  for (const [stage, n] of Object.entries(EXPECTED_STAGE_COUNTS)) {
    if ((stageCounts[stage] ?? 0) !== n) {
      problems.push(`stage ${stage}: expected ${n}, got ${stageCounts[stage] ?? 0}`);
    }
  }

  log(`\nstage counts: ${JSON.stringify(stageCounts)}`);
  log(`groups (${groupLetters.size}): ${[...groupLetters].sort().join(', ')}`);

  if (problems.length > 0) {
    error('\nschedule validation FAILED:');
    for (const p of problems) error(`   - ${p}`);
    throw new Error(`schedule validation failed (${problems.length} problem(s)); nothing written`);
  }

  write(SCHEDULE_FILE, `${JSON.stringify(all, null, 2)}\n`);
  write(BRACKET_FILE, `${JSON.stringify(topology, null, 2)}\n`);
  log(`\nwrote ${all.length} fixtures -> ${SCHEDULE_FILE}`);
  log(`wrote ${topology.matches.length} bracket nodes -> ${BRACKET_FILE}`);
  for (const m of all.slice(0, 3)) {
    const g = m.group ? ` [${m.group}]` : '';
    log(`  e.g. ${m.kickoff}${g}  ${withFlag(m.home.name, m.home.flag, 'home')} vs ${withFlag(m.away.name, m.away.flag, 'away')}  @ ${m.venue}`);
  }
}
