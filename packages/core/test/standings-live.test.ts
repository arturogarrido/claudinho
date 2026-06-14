import { describe, expect, it } from 'vitest';
import {
  getStandings,
  parseStandings,
  type GroupStandings,
  type ProviderAdapter,
} from '../src/index';

// --- ESPN-standings-shaped fixtures (mirror the real payload shape) ---
const stat = (name: string, value: number) => ({ name, value });
const entry = (
  abbreviation: string,
  displayName: string,
  stats: Array<{ name: string; value: number }>,
) => ({ team: { abbreviation, displayName }, stats });

const full = (gp: number, w: number, d: number, l: number, gf: number, ga: number, rank: number) => [
  stat('gamesPlayed', gp),
  stat('wins', w),
  stat('ties', d),
  stat('losses', l),
  stat('pointsFor', gf),
  stat('pointsAgainst', ga),
  stat('pointDifferential', gf - ga),
  stat('points', w * 3 + d),
  stat('rank', rank),
];

const ESPN = {
  children: [
    {
      name: 'Group A',
      standings: {
        // Deliberately NOT in rank order — proves we sort by the rank stat.
        entries: [
          entry('RSA', 'South Africa', full(1, 0, 0, 1, 0, 2, 4)),
          entry('MEX', 'Mexico', full(1, 1, 0, 0, 2, 0, 1)),
          entry('KOR', 'South Korea', full(1, 1, 0, 0, 2, 1, 2)),
          // Sparse stats + a non-finite value → both must default to 0.
          entry('CZE', 'Czechia', [
            stat('gamesPlayed', 1),
            stat('points', 0),
            stat('pointDifferential', Number.NaN),
            stat('rank', 3),
          ]),
        ],
      },
    },
    // A knockout child without a "Group X" name — must be filtered out.
    { name: 'Round of 32', standings: { entries: [entry('XXX', 'X', full(0, 0, 0, 0, 0, 0, 1))] } },
  ],
};

describe('parseStandings', () => {
  it('parses a group, filtering non-group children', () => {
    const tables = parseStandings(ESPN);
    expect(tables).toHaveLength(1); // "Round of 32" dropped
    expect(tables[0]?.group).toBe('A');
    expect(tables[0]?.rows).toHaveLength(4);
  });

  it('sorts rows by the rank stat, NOT array order', () => {
    const rows = parseStandings(ESPN)[0]!.rows;
    expect(rows.map((r) => r.team.code)).toEqual(['MEX', 'KOR', 'CZE', 'RSA']);
  });

  it('projects ESPN stats onto StandingRow (goals = soccer points-for/against)', () => {
    const mex = parseStandings(ESPN)[0]!.rows[0]!;
    expect(mex).toMatchObject({
      played: 1,
      won: 1,
      drawn: 0,
      lost: 0,
      goalsFor: 2,
      goalsAgainst: 0,
      goalDiff: 2,
      points: 3,
    });
    expect(mex.team.code).toBe('MEX');
    expect(mex.team.flag).not.toBe(''); // emoji flag resolved
  });

  it('defaults missing / non-finite stats to 0 (never NaN)', () => {
    const cze = parseStandings(ESPN)[0]!.rows.find((r) => r.team.code === 'CZE')!;
    expect(cze.goalDiff).toBe(0); // NaN → 0
    expect(cze.won).toBe(0); // absent → 0
    expect(Number.isNaN(cze.goalDiff)).toBe(false);
  });

  it('is total on malformed / empty input', () => {
    expect(parseStandings({})).toEqual([]);
    expect(parseStandings({ children: [] })).toEqual([]);
    expect(parseStandings({ children: [{ name: 'Group B' }] })[0]?.rows).toEqual([]);
  });
});

// --- getStandings (orchestration + fail-closed) ---
function standingsAdapter(tables: GroupStandings[] | (() => never)): ProviderAdapter {
  return {
    name: 'fake',
    capabilities: { push: false, latencyHintSec: 0 },
    async fetchByDate() {
      return [];
    },
    async fetchLive() {
      return [];
    },
    async fetchStandings() {
      if (typeof tables === 'function') tables();
      return tables as GroupStandings[];
    },
  };
}

/** Adapter with NO fetchStandings (the degraded path). */
const noStandings: ProviderAdapter = {
  name: 'bare',
  capabilities: { push: false, latencyHintSec: 0 },
  async fetchByDate() {
    return [];
  },
  async fetchLive() {
    return [];
  },
};

const TABLES = parseStandings({
  children: [
    { name: 'Group A', standings: { entries: [entry('MEX', 'Mexico', full(1, 1, 0, 0, 2, 0, 1))] } },
    { name: 'Group B', standings: { entries: [entry('CAN', 'Canada', full(1, 1, 0, 0, 1, 0, 1))] } },
  ],
});

describe('getStandings', () => {
  it('returns authoritative tables (not degraded) and filters by group', async () => {
    const all = await getStandings(standingsAdapter(TABLES));
    expect(all.degraded).toBe(false);
    expect(all.source).toBe('fake');
    expect(all.tables.map((t) => t.group)).toEqual(['A', 'B']);

    const one = await getStandings(standingsAdapter(TABLES), 'a');
    expect(one.tables.map((t) => t.group)).toEqual(['A']);
  });

  it('a real fetch missing the asked group is NOT degraded (caller renders "no such group")', async () => {
    const r = await getStandings(standingsAdapter(TABLES), 'Z');
    expect(r.degraded).toBe(false);
    expect(r.tables).toEqual([]);
  });

  it('FAILS CLOSED to a degraded roster when the provider has no fetchStandings', async () => {
    const r = await getStandings(noStandings, 'A');
    expect(r.degraded).toBe(true);
    expect(r.source).toBeUndefined();
    expect(r.tables[0]?.group).toBe('A');
    // Roster from the static schedule: 4 teams, all at zero (no fake results).
    expect(r.tables[0]?.rows.length).toBe(4);
    expect(r.tables[0]?.rows.every((row) => row.played === 0 && row.points === 0)).toBe(true);
  });

  it('FAILS CLOSED to a degraded roster when fetchStandings throws', async () => {
    const boom = standingsAdapter(() => {
      throw new Error('down');
    });
    const r = await getStandings(boom, 'A');
    expect(r.degraded).toBe(true);
    expect(r.tables[0]?.rows.length).toBe(4);
  });
});
