import { describe, expect, it } from 'vitest';
import { computeStandings } from '../src/standings';
import type { Match, Team } from '../src/types';

const T = (code: string): Team => ({ code, name: code, flag: '🏳️' });

function fixture(
  home: string,
  away: string,
  score?: [number, number],
): Match {
  return {
    id: `${home}-${away}`,
    stage: 'GROUP',
    group: 'A',
    kickoff: '2026-06-11T19:00Z',
    venue: 'X',
    home: T(home),
    away: T(away),
    score: score ? { home: score[0], away: score[1] } : undefined,
    status: score ? 'FT' : 'SCHEDULED',
    updatedAt: '2026-06-11T21:00Z',
  };
}

describe('computeStandings', () => {
  it('seeds all teams at zero before any match is played', () => {
    const table = computeStandings([fixture('MEX', 'RSA'), fixture('KOR', 'CZE')]);
    expect(table).toHaveLength(4);
    expect(table.every((r) => r.played === 0 && r.points === 0)).toBe(true);
  });

  it('awards 3 for a win, 1 each for a draw, and orders by points', () => {
    const table = computeStandings([
      fixture('MEX', 'RSA', [2, 0]), // MEX win
      fixture('KOR', 'CZE', [1, 1]), // draw
    ]);
    const mex = table.find((r) => r.team.code === 'MEX')!;
    const kor = table.find((r) => r.team.code === 'KOR')!;
    expect(mex.points).toBe(3);
    expect(mex.won).toBe(1);
    expect(kor.points).toBe(1);
    expect(kor.drawn).toBe(1);
    expect(table[0]!.team.code).toBe('MEX'); // most points first
  });

  it('breaks ties by goal difference then goals for', () => {
    // Both win once: A wins 3-0 (GD+3), B wins 2-1 (GD+1) -> A ranks first.
    const table = computeStandings([
      fixture('AAA', 'CCC', [3, 0]),
      fixture('BBB', 'DDD', [2, 1]),
    ]);
    expect(table[0]!.team.code).toBe('AAA');
    expect(table[0]!.goalDiff).toBe(3);
    expect(table[1]!.team.code).toBe('BBB');
  });

  it('ignores unfinished matches in the tally', () => {
    const table = computeStandings([
      fixture('MEX', 'RSA', [2, 0]),
      fixture('MEX', 'KOR'), // scheduled, should not count
    ]);
    const mex = table.find((r) => r.team.code === 'MEX')!;
    expect(mex.played).toBe(1);
    expect(mex.points).toBe(3);
  });
});
