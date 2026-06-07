/**
 * Static schedule access. The fixtures JSON is generated from the data feed at
 * build time (see scripts/build-schedule.ts) and bundled into the package, so
 * clients have the full fixture list with zero network calls — only live match
 * state needs the network.
 */
import scheduleData from './data/schedule.2026.json';
import type { Match } from './types';
import { byKickoff } from './normalize';
import { localDate } from './time';

const SCHEDULE = scheduleData as unknown as Match[];

/** The full bundled fixture list. */
export function allFixtures(): Match[] {
  return SCHEDULE;
}

/**
 * Fixtures on a given calendar date ("YYYY-MM-DD"), grouped in the caller's
 * timezone (`tz`; defaults to env/system via `resolveTz`).
 *
 * Grouping uses the *local* date — the same zone the UI shows the weekday in —
 * so a late-UTC kickoff (e.g. `01:00Z`, which is the previous evening in the
 * Americas) lands on the day the user actually experiences it. Filtering on the
 * raw UTC date instead would put it under a header whose weekday contradicts the
 * one rendered for the match (e.g. a Friday match shown under Saturday's date).
 */
export function fixturesByDate(
  dateISO: string,
  fixtures: Match[] = SCHEDULE,
  tz?: string,
): Match[] {
  const day = dateISO.slice(0, 10);
  return fixtures.filter((m) => localDate(m.kickoff, tz) === day).sort(byKickoff);
}

/** All fixtures involving a team code (case-insensitive). */
export function fixturesByTeam(code: string, fixtures: Match[] = SCHEDULE): Match[] {
  const c = code.toUpperCase();
  return fixtures
    .filter((m) => m.home.code.toUpperCase() === c || m.away.code.toUpperCase() === c)
    .sort(byKickoff);
}

/** All fixtures in a group letter ("A".."L"). */
export function fixturesByGroup(group: string, fixtures: Match[] = SCHEDULE): Match[] {
  const g = group.toUpperCase();
  return fixtures.filter((m) => (m.group ?? '').toUpperCase() === g).sort(byKickoff);
}

/** The next upcoming fixture for a team at/after `from` (default now). */
export function nextFixtureForTeam(
  code: string,
  opts: { from?: Date; fixtures?: Match[] } = {},
): Match | undefined {
  const from = opts.from ?? new Date();
  return fixturesByTeam(code, opts.fixtures ?? SCHEDULE).find(
    (m) => new Date(m.kickoff).getTime() >= from.getTime(),
  );
}

/** Sorted list of distinct group letters present in the schedule. */
export function groups(fixtures: Match[] = SCHEDULE): string[] {
  const set = new Set<string>();
  for (const m of fixtures) if (m.group) set.add(m.group);
  return [...set].sort();
}
