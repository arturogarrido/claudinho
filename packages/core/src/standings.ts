import type { Match, Team } from './types';
import { isFinished } from './normalize';

/** One row of a group table. */
export interface StandingRow {
  team: Team;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  /**
   * The provider's own rank for this row. Present on every live row (the
   * standings feed states it); absent on a computed or roster-at-zero table,
   * which has no authority to rank anyone. Renderers print THIS, never the
   * array position — on a partial table the two differ (audit A01).
   */
  rank?: number;
}

/**
 * A table: its KEY and its rows in standings order.
 *
 * `group` is the key a surface selects the table by: a group letter (`A`), a
 * numbered group (`A1`), a group under a league (`A-B`), or `LEAGUE` for a
 * league's one table. `label` is the provider's name for the table, sanitized,
 * present for every table EXCEPT a lettered group (which keeps its localized
 * title, "Group A" / "Grupo A").
 */
export interface GroupStandings {
  group: string;
  label?: string;
  rows: StandingRow[];
  /**
   * Present when the provider's table could not be read in full: `omitted` rows
   * were refused (malformed, duplicate, or beyond the row cap). The readable rows
   * stay usable, but a partial table carries no authority to confirm or project
   * qualification, and every surface says it is partial (audit A01).
   */
  partial?: { omitted: number };
}

/** A table as every surface's structured output states it. */
export interface TableData {
  group: string;
  /** The provider's name for the table; absent for a lettered group. */
  label?: string;
  standings: StandingRow[];
  partial?: { omitted: number };
}

/**
 * A table key as a surface accepts it as an ARGUMENT (`table`, `get_standings`,
 * `standings://`, `share table`): 1 to 12 letters, digits or `-`, in any case.
 * It says what may be ASKED FOR, and is wider than what a provider's table can
 * be keyed as: an unknown key is answered "no such group", a string that is
 * not a key at all is refused before anything is fetched.
 */
export const TABLE_KEY_ARG = /^[A-Za-z0-9-]{1,12}$/;

/** The key an argument asks for, upper-cased; undefined when it is not a key. */
export function tableKeyArg(raw: unknown): string | undefined {
  return typeof raw === 'string' && TABLE_KEY_ARG.test(raw) ? raw.toUpperCase() : undefined;
}

/**
 * A table's title on a surface that does not localize it (MCP text, the
 * resource, a share card): `Group A` for a lettered group, and for any other
 * table the provider's label followed by the key that selects it,
 * `League A, Group B (A-B)`.
 */
export function tableTitle(table: { group: string; label?: string }): string {
  return table.label ? `${table.label} (${table.group})` : `Group ${table.group}`;
}

/**
 * A table's structured form: `--json`, MCP `data` and both share cards. ONE
 * mapping, because it carries a verdict (`partial`: rows were left out, so the
 * table confirms nothing). It was written out at four emit sites, and the two
 * share ones had already dropped `partial` once (review of #126).
 */
export function tableData(table: GroupStandings): TableData {
  return {
    group: table.group,
    ...(table.label ? { label: table.label } : {}),
    standings: table.rows,
    ...(table.partial ? { partial: table.partial } : {}),
  };
}

function blankRow(team: Team): StandingRow {
  return {
    team,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDiff: 0,
    points: 0,
  };
}

/**
 * Compute a group table from a set of matches. Teams are seeded from every
 * match (so a pre-tournament table still lists all four teams at 0), and only
 * finished matches with a score contribute to the tally.
 *
 * Sort: points, then goal difference, then goals for, then name. (Real FIFA
 * tiebreakers add head-to-head and fair-play; this is the standard simplified
 * ordering used for display.)
 */
export function computeStandings(matches: Match[]): StandingRow[] {
  const rows = new Map<string, StandingRow>();
  const ensure = (t: Team): StandingRow => {
    let r = rows.get(t.code);
    if (!r) {
      r = blankRow(t);
      rows.set(t.code, r);
    }
    return r;
  };

  for (const m of matches) {
    const home = ensure(m.home);
    const away = ensure(m.away);
    if (!isFinished(m.status) || !m.score) continue;

    const { home: hg, away: ag } = m.score;
    home.played++;
    away.played++;
    home.goalsFor += hg;
    home.goalsAgainst += ag;
    away.goalsFor += ag;
    away.goalsAgainst += hg;

    if (hg > ag) {
      home.won++;
      away.lost++;
      home.points += 3;
    } else if (hg < ag) {
      away.won++;
      home.lost++;
      away.points += 3;
    } else {
      home.drawn++;
      away.drawn++;
      home.points++;
      away.points++;
    }
  }

  for (const r of rows.values()) r.goalDiff = r.goalsFor - r.goalsAgainst;

  return [...rows.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.goalDiff - a.goalDiff ||
      b.goalsFor - a.goalsFor ||
      a.team.name.localeCompare(b.team.name),
  );
}

/**
 * Group roster at zero — the degraded-standings fallback. Lists every team that
 * appears in the group's fixtures with played/W/D/L/points all at 0, regardless
 * of any scores that might be present on the input matches.
 */
export function rosterAtZero(matches: Match[]): StandingRow[] {
  const teams = new Map<string, Team>();
  for (const m of matches) {
    teams.set(m.home.code, m.home);
    teams.set(m.away.code, m.away);
  }
  return [...teams.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(blankRow);
}
