import { describe, expect, it } from 'vitest';
import { buildBracketView, isGroupStandingsComplete } from '../src/bracket/resolve';
import { loadBracketTopology } from '../src/bracket/topology';
import { allFixtures } from '../src/schedule';
import type { Match } from '../src/types';
import type { GroupStandings } from '../src/standings';

function fx(
  id: string,
  stage: Match['stage'],
  home: string,
  away: string,
  score?: [number, number],
): Match {
  const ht = (code: string) => ({ code, name: code, flag: code === 'TBD' ? '🏳️' : '🇲🇽' });
  return {
    id,
    stage,
    kickoff: '2026-07-04T17:00Z',
    venue: 'X',
    home: ht(home),
    away: ht(away),
    status: score ? 'FT' : 'SCHEDULED',
    score: score ? { home: score[0], away: score[1] } : undefined,
    updatedAt: '2026-07-04T19:00Z',
  };
}

describe('buildBracketView', () => {
  const topology = loadBracketTopology();
  const baseKo = allFixtures().filter((m) => m.stage !== 'GROUP');

  it('FAILS CLOSED on degraded live — no winner advancement from the static bundle', () => {
    const view = buildBracketView(topology, baseKo, [], true, true);
    const r16 = view.stages.find((s) => s.stage === 'R16');
    const slot = r16?.matches[0]?.home;
    expect(slot?.status).toBe('tbd');
    expect(view.degraded).toBe(true);
  });

  it('confirms an R32 winner into the R16 tree when live overlay has FT', async () => {
    const r32node = topology.matches.find((n) => n.stage === 'R32' && n.index === 1)!;
    const merged = baseKo.map((m) =>
      m.id === r32node.matchId ? fx(m.id, 'R32', 'MEX', 'RSA', [2, 0]) : m,
    );
    const view = buildBracketView(topology, merged, [], true, false);
    const r16 = view.stages.find((s) => s.stage === 'R16')!;
    const first = r16.matches[0]!;
    const confirmed = [first.home, first.away].find((p) => p.code === 'MEX');
    expect(confirmed?.status).toBe('confirmed');
  });

  it('advances the winner on a level score when ESPN supplies winnerCode (penalties)', () => {
    const r32node = topology.matches.find((n) => n.stage === 'R32' && n.index === 1)!;
    const merged = baseKo.map((m) =>
      m.id === r32node.matchId
        ? {
            ...fx(m.id, 'R32', 'MEX', 'RSA', [1, 1]),
            winnerCode: 'MEX',
          }
        : m,
    );
    const view = buildBracketView(topology, merged, [], true, false);
    const r16 = view.stages.find((s) => s.stage === 'R16')!;
    const first = r16.matches[0]!;
    const confirmed = [first.home, first.away].find((p) => p.code === 'MEX');
    expect(confirmed?.status).toBe('confirmed');
  });

  it('never confirms host paths from the static bundle', () => {
    const view = buildBracketView(topology, baseKo, [], true, true);
    const r32 = view.stages.find((s) => s.stage === 'R32')!;
    const hostPaths = ['760491', '760489', '760494', '760500'];
    for (const id of hostPaths) {
      const node = r32.matches.find((m) => m.matchId === id);
      expect(node?.home.status).toBe('tbd');
      expect(node?.home.flag).toBe('🏳️');
    }
  });

  it('topology maps host nations to group-winner refs', () => {
    expect(topology.matches.find((n) => n.matchId === '760491')?.home).toEqual({
      kind: 'group',
      position: 1,
      group: 'A',
    });
    expect(topology.matches.find((n) => n.matchId === '760489')?.home).toEqual({
      kind: 'group',
      position: 1,
      group: 'E',
    });
    expect(topology.matches.find((n) => n.matchId === '760494')?.home).toEqual({
      kind: 'group',
      position: 1,
      group: 'D',
    });
    expect(topology.matches.find((n) => n.matchId === '760500')?.home).toEqual({
      kind: 'group',
      position: 1,
      group: 'J',
    });
  });

  it('confirms a host group-winner slot when the group is fully played', () => {
    const tables: GroupStandings[] = [
      {
        group: 'A',
        rows: [
          { team: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' }, played: 3, won: 3, drawn: 0, lost: 0, goalsFor: 5, goalsAgainst: 1, goalDiff: 4, points: 9 },
          { team: { code: 'KOR', name: 'South Korea', flag: '🇰🇷' }, played: 3, won: 1, drawn: 0, lost: 2, goalsFor: 2, goalsAgainst: 4, goalDiff: -2, points: 3 },
          { team: { code: 'CZE', name: 'Czechia', flag: '🇨🇿' }, played: 3, won: 1, drawn: 0, lost: 2, goalsFor: 2, goalsAgainst: 3, goalDiff: -1, points: 3 },
          { team: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' }, played: 3, won: 1, drawn: 0, lost: 2, goalsFor: 1, goalsAgainst: 2, goalDiff: -1, points: 3 },
        ],
      },
    ];
    const view = buildBracketView(topology, baseKo, tables, false, false);
    const mexicoSlot = view.stages
      .find((s) => s.stage === 'R32')
      ?.matches.find((m) => m.matchId === '760491')?.home;
    expect(mexicoSlot?.code).toBe('MEX');
    expect(mexicoSlot?.flag).toBe('🇲🇽');
    expect(mexicoSlot?.status).toBe('confirmed');
  });

  it('confirms group winner and runner-up when the group is fully played', () => {
    const tables: GroupStandings[] = [
      {
        group: 'C',
        rows: [
          { team: { code: 'GER', name: 'Germany', flag: '🇩🇪' }, played: 3, won: 2, drawn: 0, lost: 1, goalsFor: 5, goalsAgainst: 2, goalDiff: 3, points: 6 },
          { team: { code: 'ECU', name: 'Ecuador', flag: '🇪🇨' }, played: 3, won: 1, drawn: 1, lost: 1, goalsFor: 4, goalsAgainst: 4, goalDiff: 0, points: 4 },
          { team: { code: 'CIV', name: 'Ivory Coast', flag: '🇨🇮' }, played: 3, won: 1, drawn: 0, lost: 2, goalsFor: 3, goalsAgainst: 5, goalDiff: -2, points: 3 },
          { team: { code: 'CUW', name: 'Curaçao', flag: '🇨🇼' }, played: 3, won: 0, drawn: 1, lost: 2, goalsFor: 2, goalsAgainst: 3, goalDiff: -1, points: 1 },
        ],
      },
    ];
    const view = buildBracketView(topology, baseKo, tables, false, true);
    const r32 = view.stages.find((s) => s.stage === 'R32')!;
    const groupWinner = r32.matches.find((m) => m.index === 2)?.home;
    expect(groupWinner?.code).toBe('GER');
    expect(groupWinner?.status).toBe('confirmed');
  });

  it('confirms group runner-up when the group is fully played', () => {
    const tables: GroupStandings[] = [
      {
        group: 'A',
        rows: [
          { team: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' }, played: 3, won: 3, drawn: 0, lost: 0, goalsFor: 5, goalsAgainst: 1, goalDiff: 4, points: 9 },
          { team: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' }, played: 3, won: 1, drawn: 1, lost: 1, goalsFor: 2, goalsAgainst: 3, goalDiff: -1, points: 4 },
          { team: { code: 'KOR', name: 'South Korea', flag: '🇰🇷' }, played: 3, won: 1, drawn: 0, lost: 2, goalsFor: 2, goalsAgainst: 4, goalDiff: -2, points: 3 },
          { team: { code: 'CZE', name: 'Czechia', flag: '🇨🇿' }, played: 3, won: 0, drawn: 1, lost: 2, goalsFor: 2, goalsAgainst: 3, goalDiff: -1, points: 1 },
        ],
      },
    ];
    const view = buildBracketView(topology, baseKo, tables, false, false);
    const r32 = view.stages.find((s) => s.stage === 'R32')!;
    const secondPlace = r32.matches.find((m) => m.index === 1)?.home;
    expect(secondPlace?.code).toBe('RSA');
    expect(secondPlace?.status).toBe('confirmed');
  });

  it('confirms group slots when a non-4-team group finishes round-robin', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      team: { code: `T${i}`, name: `Team ${i}`, flag: '🏳️' },
      played: 7,
      won: i === 0 ? 7 : 0,
      drawn: 0,
      lost: i === 0 ? 0 : 7,
      goalsFor: i === 0 ? 14 : 0,
      goalsAgainst: i === 0 ? 0 : 2,
      goalDiff: i === 0 ? 14 : -2,
      points: i === 0 ? 21 : 0,
    }));
    const tables: GroupStandings[] = [{ group: 'Z', rows }];
    expect(isGroupStandingsComplete(tables[0])).toBe(true);
    const incomplete: GroupStandings = {
      group: 'Z',
      rows: rows.map((r, i) => ({ ...r, played: i === 0 ? 7 : 6 })),
    };
    expect(isGroupStandingsComplete(incomplete)).toBe(false);
  });

  it('projects the current group leader mid-tournament from live standings', () => {
    const tables: GroupStandings[] = [
      {
        group: 'C',
        rows: [
          { team: { code: 'GER', name: 'Germany', flag: '🇩🇪' }, played: 2, won: 2, drawn: 0, lost: 0, goalsFor: 4, goalsAgainst: 1, goalDiff: 3, points: 6 },
          { team: { code: 'ECU', name: 'Ecuador', flag: '🇪🇨' }, played: 2, won: 1, drawn: 0, lost: 1, goalsFor: 3, goalsAgainst: 3, goalDiff: 0, points: 3 },
          { team: { code: 'CIV', name: 'Ivory Coast', flag: '🇨🇮' }, played: 2, won: 0, drawn: 1, lost: 1, goalsFor: 2, goalsAgainst: 3, goalDiff: -1, points: 1 },
          { team: { code: 'CUW', name: 'Curaçao', flag: '🇨🇼' }, played: 2, won: 0, drawn: 1, lost: 1, goalsFor: 1, goalsAgainst: 3, goalDiff: -2, points: 1 },
        ],
      },
    ];
    const view = buildBracketView(topology, baseKo, tables, false, false);
    const r32 = view.stages.find((s) => s.stage === 'R32')!;
    const groupWinner = r32.matches.find((m) => m.index === 2)?.home;
    expect(groupWinner?.code).toBe('GER');
    expect(groupWinner?.flag).toBe('🇩🇪');
    expect(groupWinner?.status).toBe('projected');
  });

  it('does not project a group slot before the group has started', () => {
    const tables: GroupStandings[] = [
      {
        group: 'C',
        rows: [
          { team: { code: 'GER', name: 'Germany', flag: '🇩🇪' }, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0 },
          { team: { code: 'ECU', name: 'Ecuador', flag: '🇪🇨' }, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0 },
          { team: { code: 'CIV', name: 'Ivory Coast', flag: '🇨🇮' }, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0 },
          { team: { code: 'CUW', name: 'Curaçao', flag: '🇨🇼' }, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0 },
        ],
      },
    ];
    const view = buildBracketView(topology, baseKo, tables, false, false);
    const r32 = view.stages.find((s) => s.stage === 'R32')!;
    const groupWinner = r32.matches.find((m) => m.index === 2)?.home;
    expect(groupWinner?.status).toBe('tbd');
    expect(groupWinner?.flag).toBe('🏳️');
  });
});
