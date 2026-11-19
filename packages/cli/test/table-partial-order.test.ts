import type { GroupStandings, Match, ProviderAdapter } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdTable } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';
import { described } from './config-of';

/**
 * Several tables, one of them partial: its line belongs to ITS table. The CLI
 * prints it after that table's rows and before the next table.
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
const adapterServing = (tables: GroupStandings[]): ProviderAdapter => ({
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
    return tables;
  },
});
function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return described({ lang: 'en', tz: 'UTC', json: true, color: false, source: 'espn', competition: 'fifa.world', flavor: 'off', ...over });
}
const ctx = (adapter: ProviderAdapter, over: Partial<CliConfig> = {}) => ({
  cfg: cfg(over),
  t: makeT(over.lang ?? 'en'),
  adapter,
});

const outSpy = vi.spyOn(process.stdout, 'write');
let writes: string[] = [];
beforeEach(() => {
  writes = [];
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
});
afterEach(() => outSpy.mockReset());
const text = () => writes.join('');

describe('table, every table: a partial line sits with its own table', () => {
  it('after its own rows, before the next table, once', async () => {
    await cmdTable(undefined, ctx(adapterServing(TABLES), { json: false }));
    const shown = text();
    const line = 'Partial table — 2 rows could not be read.';
    // A team's cell is its name or its code.
    const at = (name: string, code: string) => Math.max(shown.indexOf(name), shown.indexOf(code));
    expect(shown.split(line)).toHaveLength(2);
    for (const [name, code] of [['Argentina', 'ARG'], ['Mexico', 'MEX'], ['Canada', 'CAN'], ['Brazil', 'BRA']] as const) expect(at(name, code), name).toBeGreaterThan(-1);
    expect(at('Argentina', 'ARG')).toBeLessThan(at('Mexico', 'MEX'));
    expect(at('Canada', 'CAN')).toBeLessThan(shown.indexOf(line));
    expect(shown.indexOf(line)).toBeLessThan(at('Brazil', 'BRA'));
  });
});
