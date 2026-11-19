import type { GroupStandings, Match, ProviderAdapter } from '@claudinho/core';
import { describe, expect, it } from 'vitest';
import { toolGetStandings } from '../src/tools';

/**
 * Several tables, one of them partial: its line belongs to ITS table. In a
 * tool's text it comes before that table's rows (a cut from the end loses
 * rows, never what qualifies them) and after the table before it.
 */
const row = (code: string, name: string, flag: string, rank: number) => ({
  team: { code, name, flag },
  rank,
  played: 1,
  won: 0,
  drawn: 1,
  lost: 0,
  goalsFor: 0,
  goalsAgainst: 0,
  goalDiff: 0,
  points: 1,
});
const TABLES: GroupStandings[] = [
  { group: 'A', rows: [row('ESP', 'Spain', '🇪🇸', 1), row('ARG', 'Argentina', '🇦🇷', 2)] },
  { group: 'B', rows: [row('MEX', 'Mexico', '🇲🇽', 2), row('CAN', 'Canada', '🇨🇦', 3)], partial: { omitted: 2 } },
  { group: 'C', rows: [row('BRA', 'Brazil', '🇧🇷', 1), row('FRA', 'France', '🇫🇷', 2)] },
];
const adapter: ProviderAdapter = {
  name: 'espn',
  competition: 'fifa.world',
  capabilities: { push: false, latencyHintSec: 0 },
  async fetchByDate(): Promise<Match[]> {
    return [];
  },
  async fetchLive(): Promise<Match[]> {
    return [];
  },
  async fetchStandings(): Promise<GroupStandings[]> {
    return TABLES;
  },
};

describe('get_standings, every table: a partial line sits with its own table', () => {
  it('after the table before it, before its own rows, once', async () => {
    const r = await toolGetStandings({ adapter, competition: 'world-cup' });
    const line = '(Partial table — 2 rows could not be read.)';
    const at = (s: string) => r.text.indexOf(s);
    expect(r.text.split(line)).toHaveLength(2);
    for (const name of ['Argentina', 'Mexico', 'Canada', 'Brazil']) expect(at(name), name).toBeGreaterThan(-1);
    expect(at('Argentina')).toBeLessThan(at(line));
    expect(at(line)).toBeLessThan(at('Mexico'));
    expect(at('Canada')).toBeLessThan(at('Brazil'));
  });
});
