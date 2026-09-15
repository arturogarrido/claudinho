import { describe, expect, it } from 'vitest';
import { EspnAdapter, competitionBase } from '../src/adapters/espn';
import { buildBracketView, isGroupStandingsComplete } from '../src/bracket/resolve';
import type { BracketTopology } from '../src/bracket/types';
import { getStandings } from '../src/live';
import { formatShareTable } from '../src/share/format';
import type { GroupStandings } from '../src/standings';
import { parseEspnStandings } from '../src/trust/espn';

/**
 * Audit A01 (P1): a PARTIAL standings table — rows the parser refused — must not
 * confirm qualifiers, must keep the provider's ranks, and must say it is partial
 * on every surface. Before the fix (repro S8 in the Sep-15 audit): ranks 1 and 4
 * refused, ranks 2 and 3 survive with one draw each, the parser's `complete:false`
 * is dropped at the array boundary, the bracket reads a healthy two-team group
 * with a full round-robin played, and confirms Mexico as group winner and Canada
 * as runner-up — neither was the provider's top two.
 *
 * Readable rows STAY usable (no batch-wide outage): the table renders, degraded
 * stays false, only the authority to infer qualification is withdrawn.
 */

const row = (id: number, name: string, rank: number, bad = false) => ({
  team: { id: String(id), abbreviation: name.slice(0, 3).toUpperCase(), displayName: name },
  stats: bad
    ? []
    : Object.entries({
        gamesPlayed: 1,
        wins: 0,
        ties: 1,
        losses: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        points: 1,
        rank,
      }).map(([n, value]) => ({ name: n, value })),
});
const group = (name: string, entries: unknown[]) => ({ name, standings: { entries } });
// Ranks 1 (Germany) and 4 (Brazil) are refused (rank 0 → malformed); 2 and 3 survive.
const PARTIAL = {
  children: [
    group('Group A', [
      row(1, 'Germany', 1, true),
      row(2, 'Mexico', 2),
      row(3, 'Canada', 3),
      row(4, 'Brazil', 4, true),
    ]),
  ],
};
const FULL = {
  children: [
    group('Group A', [
      row(1, 'Germany', 1),
      row(2, 'Mexico', 2),
      row(3, 'Canada', 3),
      row(4, 'Brazil', 4),
    ]),
  ],
};
const TOPOLOGY: BracketTopology = {
  generatedAt: '2026-09-15T00:00:00.000Z',
  stages: ['QF'],
  matches: [
    {
      matchId: '999999001',
      stage: 'QF',
      index: 1,
      home: { kind: 'group', group: 'A', position: 1 },
      away: { kind: 'group', group: 'A', position: 2 },
    },
  ],
};

async function domainTables(payload: unknown) {
  const adapter = new EspnAdapter({
    baseUrl: competitionBase('synthetic'),
    expectedStandingsGroups: ['A'],
    fetchImpl: (async () => new Response(JSON.stringify(payload))) as typeof fetch,
  });
  return getStandings(adapter);
}

describe('A01 — partial standings (parser)', () => {
  it('keeps the readable rows WITH the provider rank and marks the table partial', () => {
    const parsed = parseEspnStandings(PARTIAL);
    expect(parsed.complete).toBe(false);
    const table = parsed.items[0] as GroupStandings;
    expect(table.rows.map((r) => r.team.name)).toEqual(['Mexico', 'Canada']);
    expect(table.rows.map((r) => r.rank)).toEqual([2, 3]);
    expect(table.partial).toEqual({ omitted: 2 });
  });

  it('a fully readable table carries ranks and no partial marker', () => {
    const table = parseEspnStandings(FULL).items[0] as GroupStandings;
    expect(table.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(table.partial).toBeUndefined();
  });
});

describe('A01 — partial standings (domain, through the adapter)', () => {
  it('the verdict survives the array boundary: partial reaches the domain, degraded stays false', async () => {
    const { tables, degraded } = await domainTables(PARTIAL);
    expect(degraded).toBe(false); // readable rows stay usable — not an outage
    expect(tables[0]?.partial).toEqual({ omitted: 2 });
    expect(tables[0]?.rows.map((r) => r.rank)).toEqual([2, 3]);
  });
});

describe('A01 — group completion', () => {
  it('a partial table is never complete, even when every surviving row looks fully played', async () => {
    const { tables } = await domainTables(PARTIAL);
    expect(isGroupStandingsComplete(tables[0])).toBe(false);
  });

  it('missing roster members cannot shorten the round-robin threshold', () => {
    // Two readable rows, each with the one match a two-team "group" would need —
    // but the group is known to have four teams, so three matches are required.
    const two: GroupStandings = {
      group: 'A',
      rows: [
        { team: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' }, rank: 1, played: 1, won: 0, drawn: 1, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 1 },
        { team: { code: 'CAN', name: 'Canada', flag: '🇨🇦' }, rank: 2, played: 1, won: 0, drawn: 1, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 1 },
      ],
    };
    expect(isGroupStandingsComplete(two, 4)).toBe(false);
    expect(isGroupStandingsComplete(two)).toBe(true); // no roster knowledge: unchanged rule
  });

  it('a complete four-team World Cup group still completes', () => {
    const rows = ['Germany', 'Mexico', 'Canada', 'Brazil'].map((name, i) => ({
      team: { code: name.slice(0, 3).toUpperCase(), name, flag: '🏳️' },
      rank: i + 1,
      played: 3, won: 1, drawn: 1, lost: 1, goalsFor: 3, goalsAgainst: 3, goalDiff: 0, points: 4,
    }));
    expect(isGroupStandingsComplete({ group: 'A', rows }, 4)).toBe(true);
  });
});

describe('A01 — bracket', () => {
  it('a partial table neither confirms nor projects a group slot', async () => {
    const { tables, degraded } = await domainTables(PARTIAL);
    const view = buildBracketView(TOPOLOGY, [], tables, degraded, false);
    const slots = view.stages[0]?.matches[0];
    expect(slots?.home.status).toBe('tbd');
    expect(slots?.away.status).toBe('tbd');
    expect(slots?.home.code).toBeUndefined();
  });

  it('two readable rows of a four-team group project, never confirm (roster size, not survivor count)', async () => {
    // No partial marker (the provider only served two rows), one match each: the
    // old rule read that as a complete two-team round-robin. Group A is a bundled
    // four-team group, so three matches are required — the leader is projected.
    const { tables, degraded } = await domainTables({
      children: [group('Group A', [row(2, 'Mexico', 1), row(3, 'Canada', 2)])],
    });
    expect(tables[0]?.partial).toBeUndefined();
    const view = buildBracketView(TOPOLOGY, [], tables, degraded, false);
    expect(view.stages[0]?.matches[0]?.home).toMatchObject({ code: 'MEX', status: 'projected' });
    expect(view.stages[0]?.matches[0]?.away).toMatchObject({ code: 'CAN', status: 'projected' });
  });

  it('a fully readable, fully played table still confirms (no regression)', async () => {
    const { tables, degraded } = await domainTables({
      children: [
        group('Group A', [
          { ...row(1, 'Germany', 1), stats: row(1, 'Germany', 1).stats.map((s) => (s.name === 'gamesPlayed' ? { ...s, value: 3 } : s.name === 'ties' ? { ...s, value: 3 } : s.name === 'points' ? { ...s, value: 3 } : s)) },
          { ...row(2, 'Mexico', 2), stats: row(2, 'Mexico', 2).stats.map((s) => (s.name === 'gamesPlayed' ? { ...s, value: 3 } : s.name === 'ties' ? { ...s, value: 3 } : s.name === 'points' ? { ...s, value: 3 } : s)) },
          { ...row(3, 'Canada', 3), stats: row(3, 'Canada', 3).stats.map((s) => (s.name === 'gamesPlayed' ? { ...s, value: 3 } : s.name === 'ties' ? { ...s, value: 3 } : s.name === 'points' ? { ...s, value: 3 } : s)) },
          { ...row(4, 'Brazil', 4), stats: row(4, 'Brazil', 4).stats.map((s) => (s.name === 'gamesPlayed' ? { ...s, value: 3 } : s.name === 'ties' ? { ...s, value: 3 } : s.name === 'points' ? { ...s, value: 3 } : s)) },
        ]),
      ],
    });
    const view = buildBracketView(TOPOLOGY, [], tables, degraded, false);
    expect(view.stages[0]?.matches[0]?.home).toMatchObject({ code: 'GER', status: 'confirmed' });
    expect(view.stages[0]?.matches[0]?.away).toMatchObject({ code: 'MEX', status: 'confirmed' });
  });
});

describe('A01 — share table', () => {
  it('prints the provider ranks and says the table is partial', async () => {
    const { tables, source } = await domainTables(PARTIAL);
    const card = formatShareTable({ tables, source });
    expect(card).toContain('2. 🇲🇽 MEX');
    expect(card).toContain('3. 🇨🇦 CAN');
    expect(card).not.toMatch(/^1\. /m);
    expect(card).toMatch(/partial.*2 rows? unreadable/i);
  });

  it('a complete table prints 1..n exactly as before', async () => {
    const { tables, source } = await domainTables(FULL);
    const card = formatShareTable({ tables, source });
    expect(card).toContain('1. 🇩🇪 GER');
    expect(card).toContain('4. 🇧🇷 BRA');
    expect(card).not.toMatch(/partial/i);
  });
});
