import type { GroupStandings, Match, ProviderAdapter } from '@claudinho/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v3';
import { OUTPUT_SCHEMAS } from '../src/server';
import { standingsResourceText, toolGetStandings } from '../src/tools';

/**
 * Audit A01 on the MCP surface: a PARTIAL table reaches structured `data`
 * (`partial` on the table, `rank` on every row), the text says so in the
 * caller's locale, the `standings://` resource says so too, and the advertised
 * output schema still accepts the payload (additive keys, `.passthrough()`).
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
const PARTIAL: GroupStandings = {
  group: 'A',
  rows: [row('MEX', 'Mexico', '🇲🇽', 2), row('CAN', 'Canada', '🇨🇦', 3)],
  partial: { omitted: 2 },
};
const adapter: ProviderAdapter = {
  name: 'espn',
  capabilities: { push: false, latencyHintSec: 0 },
  async fetchByDate(): Promise<Match[]> {
    return [];
  },
  async fetchLive(): Promise<Match[]> {
    return [];
  },
  async fetchStandings(): Promise<GroupStandings[]> {
    return [PARTIAL];
  },
};

describe('get_standings — partial standings (A01)', () => {
  it('data carries partial + rank; text carries the notice; schema still accepts it', async () => {
    const r = await toolGetStandings({ group: 'A', adapter });
    const data = r.data as {
      degraded: boolean;
      tables: { partial?: { omitted: number }; standings: Array<{ rank?: number }> };
    };
    expect(data.degraded).toBe(false);
    expect(data.tables.partial).toEqual({ omitted: 2 });
    expect(data.tables.standings.map((x) => x.rank)).toEqual([2, 3]);
    expect(r.text).toContain('(Partial table — 2 rows could not be read.)');
    expect(r.text).toContain('Mexico');
    expect(() => z.object(OUTPUT_SCHEMAS.get_standings).strict().parse(r.data)).not.toThrow();
  });

  it('all-groups shape and a non-English locale', async () => {
    const r = await toolGetStandings({ adapter, lang: 'pt' });
    const data = r.data as { tables: Array<{ partial?: { omitted: number } }> };
    expect(data.tables[0]?.partial).toEqual({ omitted: 2 });
    expect(r.text).toContain('Tabela parcial — 2 linhas não puderam ser lidas.');
  });

  it('the standings:// resource says the table is partial', async () => {
    const text = await standingsResourceText('A', adapter);
    expect(text).toContain('Partial table — 2 rows could not be read.');
    expect(text).toContain('Mexico');
  });
});
