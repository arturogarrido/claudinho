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
