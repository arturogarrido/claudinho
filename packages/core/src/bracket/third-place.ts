import type { GroupStandings, StandingRow } from '../standings';
import type { Team } from '../types';
import { ANNEX_C_ROWS, ANNEX_C_WINNERS } from './third-place-data';

function isGroupStandingsComplete(table: GroupStandings | undefined): boolean {
  const n = table?.rows.length ?? 0;
  if (n < 2) return false;
  const required = n - 1;
  return table!.rows.every((r) => r.played >= required);
}

const ALL_GROUPS = 'ABCDEFGHIJKL'.split('');

const annexCByKey = new Map<string, string>();
for (const row of ANNEX_C_ROWS) {
  annexCByKey.set([...row].sort().join(''), row);
}

/** Which group's third-placed team faces the given group winner under Annex C. */
export function thirdPlaceGroupForWinner(
  qualifyingGroups: string[],
  winnerGroup: string,
): string | undefined {
  if (qualifyingGroups.length !== 8) return undefined;
  const row = annexCByKey.get([...qualifyingGroups].sort().join(''));
  if (!row) return undefined;
  const idx = ANNEX_C_WINNERS.indexOf(winnerGroup as (typeof ANNEX_C_WINNERS)[number]);
  if (idx < 0) return undefined;
  return row[idx];
}

function thirdPlaceByGroup(tables: GroupStandings[]): Map<string, StandingRow> {
  const map = new Map<string, StandingRow>();
  for (const table of tables) {
    if (!isGroupStandingsComplete(table)) continue;
    const third = table.rows[2];
    if (third) map.set(table.group, third);
  }
  return map;
}

/** Rank third-placed teams across groups (points, GD, goals for, name). */
export function rankThirdPlaceTeams(thirdByGroup: Map<string, StandingRow>): StandingRow[] {
  return [...thirdByGroup.values()].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
    return a.team.name.localeCompare(b.team.name);
  });
}

function groupForThird(thirdByGroup: Map<string, StandingRow>, row: StandingRow): string | undefined {
  for (const [group, standing] of thirdByGroup) {
    if (standing.team.code === row.team.code) return group;
  }
  return undefined;
}

export function allGroupStandingsComplete(tables: GroupStandings[]): boolean {
  return ALL_GROUPS.every((g) =>
    isGroupStandingsComplete(tables.find((t) => t.group === g)),
  );
}

/**
 * Resolve a third-place bracket slot from standings when every group has finished.
 * Returns undefined when the combination or assignment is not yet knowable.
 */
export function thirdPlaceTeamFromStandings(
  candidateGroups: string[],
  winnerGroup: string,
  tables: GroupStandings[],
): Team | undefined {
  const thirdByGroup = thirdPlaceByGroup(tables);
  if (!allGroupStandingsComplete(tables) || thirdByGroup.size !== 12) return undefined;

  const ranked = rankThirdPlaceTeams(thirdByGroup);
  const qualifiers = ranked.slice(0, 8);
  const qualifyingGroups = qualifiers
    .map((row) => groupForThird(thirdByGroup, row))
    .filter((g): g is string => g != null);

  const sourceGroup = thirdPlaceGroupForWinner(qualifyingGroups, winnerGroup);
  if (!sourceGroup || !candidateGroups.includes(sourceGroup)) return undefined;

  return thirdByGroup.get(sourceGroup)?.team;
}

/** Find which group a team occupies in third place, if any. */
export function thirdPlaceGroupForTeam(team: Team, tables: GroupStandings[]): string | undefined {
  for (const table of tables) {
    if (table.rows[2]?.team.code === team.code) return table.group;
  }
  return undefined;
}
