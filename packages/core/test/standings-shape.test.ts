import { describe, expect, it } from 'vitest';
import { EspnAdapter, competitionBase } from '../src/adapters/espn';
import { getStandings } from '../src/live';
import { parseEspnStandings } from '../src/trust/espn';

/**
 * Audit A02 (P2) + A05 (P2), CONTAINED: a standings payload whose tables the
 * parser does not understand (a single league table; numbered Nations League
 * groups `A1`…`D2`) used to become a HEALTHY empty result — `tables: []`,
 * `degraded: false`, attributed to the provider — because every non-`Group <A–L>`
 * child was skipped as if it were not there, and `Group A1` matched as `A`.
 * Now an unsupported table shape is reported as such: the batch is incomplete,
 * the adapter refuses to serve it as an authoritative empty, and the domain
 * degrades with no attribution. Real support (single tables, sub-groups, table
 * keys) is 0.11 scope (2.3); this only stops the lie.
 */
const row = (id: number, name: string, rank: number) => ({
  team: { id: String(id), abbreviation: name.slice(0, 3).toUpperCase(), displayName: name },
  stats: Object.entries({
    gamesPlayed: 1,
    wins: 1,
    ties: 0,
    losses: 0,
    pointsFor: 2,
    pointsAgainst: 0,
    pointDifferential: 2,
    points: 3,
    rank,
  }).map(([n, value]) => ({ name: n, value })),
});
const child = (name: string, entries: unknown[]) => ({ name, standings: { entries } });
const LEAGUE = {
  children: [
    child(
      '2026-27 English Premier League',
      Array.from({ length: 20 }, (_, i) => row(i + 1, `Club ${String.fromCharCode(65 + i)}`, i + 1)),
    ),
  ],
};
const NATIONS = { children: [child('Group A1', [row(1, 'Mexico', 1)]), child('Group A2', [row(2, 'Canada', 1)])] };
const WORLD_CUP = { children: [child('Group A', [row(1, 'Mexico', 1), row(2, 'Canada', 2)])] };
const EMPTY = { children: [] };

const openScope = (payload: unknown) =>
  new EspnAdapter({
    baseUrl: competitionBase('synthetic'),
    fetchImpl: (async () => new Response(JSON.stringify(payload))) as typeof fetch,
  });

describe('parseEspnStandings — unsupported table shapes are not healthy empties', () => {
  it('a single league table (A02) is incomplete, not an empty group set', () => {
    const parsed = parseEspnStandings(LEAGUE);
    expect(parsed.items).toHaveLength(0);
    expect(parsed.complete).toBe(false);
  });

  it('numbered groups (A05) are not collapsed to one lettered table', () => {
    const parsed = parseEspnStandings(NATIONS);
    expect(parsed.items).toHaveLength(0); // never a mislabeled "A"
    expect(parsed.complete).toBe(false);
  });

  it('lettered World Cup groups parse exactly as before', () => {
    const parsed = parseEspnStandings(WORLD_CUP);
    expect(parsed.items.map((t) => t.group)).toEqual(['A']);
    expect(parsed.complete).toBe(true);
  });

  it('a genuinely empty child list is a healthy empty', () => {
    expect(parseEspnStandings(EMPTY).complete).toBe(true);
  });
});

describe('getStandings — through the adapter, open scope', () => {
  it('a league table degrades with no attribution instead of "No standings available"', async () => {
    const r = await getStandings(openScope(LEAGUE));
    expect(r.tables).toEqual([]);
    expect(r.degraded).toBe(true);
    expect(r.source).toBeUndefined();
  });

  it('numbered groups degrade the same way', async () => {
    const r = await getStandings(openScope(NATIONS));
    expect(r.tables).toEqual([]);
    expect(r.degraded).toBe(true);
    expect(r.source).toBeUndefined();
  });

  it('an empty child list stays a healthy, attributed empty (unchanged)', async () => {
    const r = await getStandings(openScope(EMPTY));
    expect(r).toEqual({ tables: [], degraded: false, source: 'espn' });
  });
});
