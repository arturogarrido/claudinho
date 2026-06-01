/**
 * Pure tool handlers — the business logic behind each MCP tool, decoupled from
 * the SDK so they can be unit-tested directly. Each returns a `{ text, data }`
 * pair: `text` is the human/LLM-readable summary, `data` is the structured
 * payload embedded as JSON for agents that want to parse it.
 */
import {
  allFixtures,
  computeStandings,
  fixturesByDate,
  fixturesByGroup,
  getLiveMatches,
  getMatchesForDate,
  groups,
  localDate,
  makeAdapter,
  nextFixtureForTeam,
  type Match,
  type ProviderAdapter,
} from '@claudinho/core';
import { DISCLAIMER, matchLine, matchList, standingsTable } from './format';

export interface ToolResult {
  text: string;
  data: unknown;
}

export interface CommonOpts {
  tz?: string;
  lang?: string;
  source?: string;
  /** Injected adapter (tests). Defaults to makeAdapter(source). */
  adapter?: ProviderAdapter;
}

function resolveAdapter(args: CommonOpts): ProviderAdapter {
  return args.adapter ?? makeAdapter(args.source);
}

function withDisclaimer(text: string): string {
  return `${text}\n\n${DISCLAIMER}`;
}

/** today: fixtures for a date (default: today), with live overlay. */
export async function toolGetToday(
  args: { date?: string } & CommonOpts,
): Promise<ToolResult> {
  const adapter = resolveAdapter(args);
  const date = args.date ?? localDate(new Date().toISOString(), args.tz);
  const { matches, degraded } = await getMatchesForDate(adapter, date);
  const todays = fixturesByDate(date, matches);
  const opts = { tz: args.tz, locale: args.lang };
  const text = `Matches on ${date}:\n${matchList(todays, 'No matches scheduled.', opts)}`;
  return {
    text: withDisclaimer(text),
    data: { date, degraded, count: todays.length, matches: todays },
  };
}

/** live: in-progress matches right now. */
export async function toolGetLive(args: CommonOpts = {}): Promise<ToolResult> {
  const adapter = resolveAdapter(args);
  const { matches, degraded } = await getLiveMatches(adapter);
  const opts = { tz: args.tz, locale: args.lang };
  const text = `Live now:\n${matchList(matches, 'No matches in play right now.', opts)}`;
  return {
    text: withDisclaimer(text),
    data: { degraded, count: matches.length, matches },
  };
}

/** match: a single fixture by id, with live overlay for that day. */
export async function toolGetMatch(
  args: { id: string } & CommonOpts,
): Promise<ToolResult> {
  let match = allFixtures().find((m) => m.id === args.id);
  let degraded = false;
  if (match) {
    try {
      const adapter = resolveAdapter(args);
      const live = await adapter.fetchByDate(match.kickoff.slice(0, 10));
      match = live.find((m) => m.id === args.id) ?? match;
    } catch {
      degraded = true;
    }
  }
  if (!match) {
    return { text: withDisclaimer(`No match found with id ${args.id}.`), data: { match: null } };
  }
  const opts = { tz: args.tz, locale: args.lang };
  return { text: withDisclaimer(matchLine(match, opts)), data: { degraded, match } };
}

/** standings: one group table, or all of them. */
export async function toolGetStandings(
  args: { group?: string } & CommonOpts,
): Promise<ToolResult> {
  // Overlay today's results so finished games count.
  let matches: Match[] = allFixtures();
  let degraded = false;
  try {
    const adapter = resolveAdapter(args);
    const live = await adapter.fetchByDate(localDate(new Date().toISOString(), args.tz));
    const byId = new Map(matches.map((m) => [m.id, m]));
    for (const m of live) byId.set(m.id, m);
    matches = [...byId.values()];
  } catch {
    degraded = true;
  }

  const wanted = args.group ? [args.group.toUpperCase()] : groups(matches);
  const tables = wanted.map((g) => ({
    group: g,
    standings: computeStandings(fixturesByGroup(g, matches)),
  }));
  const text = tables
    .map((t) => standingsTable(t.group, t.standings))
    .join('\n\n');
  return {
    text: withDisclaimer(text || `No group found.`),
    data: { degraded, tables: args.group ? (tables[0] ?? null) : tables },
  };
}

/** next_fixture: a team's next match (static schedule). */
export async function toolGetNextFixture(
  args: { team: string } & CommonOpts,
): Promise<ToolResult> {
  const code = args.team.toUpperCase();
  const fixture = nextFixtureForTeam(code);
  if (!fixture) {
    return {
      text: withDisclaimer(`No upcoming fixture found for ${code}.`),
      data: { team: code, fixture: null },
    };
  }
  const opts = { tz: args.tz, locale: args.lang };
  return {
    text: withDisclaimer(`Next up for ${code}:\n${matchLine(fixture, opts)}`),
    data: { team: code, fixture },
  };
}
