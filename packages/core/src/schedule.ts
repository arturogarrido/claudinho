/**
 * Static schedule access. The fixtures JSON is generated from the data feed at
 * build time (see scripts/build-schedule.ts) and bundled into the package, so
 * clients have the full fixture list with zero network calls — only live match
 * state needs the network.
 */
import scheduleData from './data/schedule.2026.json';
import type { BracketMatchNode } from './bracket/types';
import { slotRefToTeam } from './bracket/placeholders';
import type { Match } from './types';
import { byKickoff } from './normalize';
import { localDate } from './time';

const SCHEDULE = scheduleData as unknown as Match[];

/**
 * Strip live/final state from a fixture for the bundled skeleton schedule.
 * The JSON ships kickoffs, teams, venues, and bracket structure only — never
 * results. Live scores come from the provider overlay; degraded standings use
 * roster-at-zero, not a stale snapshot table.
 */
export function sanitizeBundledFixture(m: Match, node?: BracketMatchNode): Match {
  const base: Match = {
    id: m.id,
    stage: m.stage,
    group: m.group,
    kickoff: m.kickoff,
    venue: m.venue,
    city: m.city,
    country: m.country,
    home: m.home,
    away: m.away,
    status: 'SCHEDULED',
    updatedAt: m.updatedAt,
  };
  if (node && m.stage !== 'GROUP' && m.stage !== 'FRIENDLY') {
    return {
      ...base,
      home: slotRefToTeam(node.home),
      away: slotRefToTeam(node.away),
    };
  }
  return base;
}

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

/**
 * A group/regular fixture is potentially live from kickoff until ~kickoff + 140
 * min (90' + half-time + stoppage).
 */
export const LIVE_WINDOW_MS = 140 * 60_000;

/**
 * Extra allowance for knockout matches, which can go to extra time (+30') and a
 * penalty shootout, running to ~kickoff + 190 min — well past LIVE_WINDOW_MS.
 * Without it the statusline refresher stops polling at kickoff+140min and the
 * cache goes stale mid-match, so a knockout tie still level after 90' (in ET or
 * penalties) silently drops off the statusline while it's still being played.
 * Numerically matches the slack `marketFixtureForTeam` already applies (live.ts).
 */
export const KNOCKOUT_EXTRA_TIME_MS = 60 * 60_000;

/** Live-window length for a fixture — longer for knockout (extra time + penalties). */
export function liveWindowMsFor(m: Match): number {
  return m.stage === 'GROUP' || m.stage === 'FRIENDLY'
    ? LIVE_WINDOW_MS
    : LIVE_WINDOW_MS + KNOCKOUT_EXTRA_TIME_MS;
}

/** Fixtures whose (stage-aware) live window contains `now` (cheap, static — no network). */
export function fixturesInLiveWindow(
  now = Date.now(),
  fixtures: Match[] = SCHEDULE,
): Match[] {
  return fixtures
    .filter((m) => {
      const k = Date.parse(m.kickoff);
      return now >= k && now <= k + liveWindowMsFor(m);
    })
    .sort(byKickoff);
}

/**
 * The team's in-play fixture when one is inside its live window, else the next
 * upcoming fixture. This is "the match that matters for <team> right now":
 * mid-match, a user (or an agent) asking about a team almost always means the
 * one being played — `nextFixtureForTeam` alone would skip it the moment the
 * kickoff is in the past and silently answer about next week.
 */
export function currentOrNextFixtureForTeam(
  code: string,
  opts: { from?: Date; fixtures?: Match[] } = {},
): Match | undefined {
  const from = opts.from ?? new Date();
  const nowMs = from.getTime();
  const inPlay = fixturesByTeam(code, opts.fixtures ?? SCHEDULE).find((m) => {
    const k = Date.parse(m.kickoff);
    return nowMs >= k && nowMs <= k + liveWindowMsFor(m);
  });
  return inPlay ?? nextFixtureForTeam(code, opts);
}

/** Sorted list of distinct group letters present in the schedule. */
export function groups(fixtures: Match[] = SCHEDULE): string[] {
  const set = new Set<string>();
  for (const m of fixtures) if (m.group) set.add(m.group);
  return [...set].sort();
}
