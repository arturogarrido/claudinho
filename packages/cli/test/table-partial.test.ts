import { FakeMarketProvider, type GroupStandings, type Match, type ProviderAdapter } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdShare, cmdTable } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';

/**
 * Audit A01 on the CLI surface: a PARTIAL table (rows the provider served that
 * we refused) reaches `--json` as `partial` + per-row `rank`, and the text
 * table says so in the user's locale. Readable rows still render.
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
const FULL: GroupStandings = {
  group: 'B',
  rows: [row('ESP', 'Spain', '🇪🇸', 1), row('ARG', 'Argentina', '🇦🇷', 2)],
};
const adapterServing = (tables: GroupStandings[]): ProviderAdapter => ({
  name: 'espn',
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
  return { lang: 'en', tz: 'UTC', json: true, color: false, source: 'espn', flavor: 'off', ...over };
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
const json = () => JSON.parse(writes.join(''));
const text = () => writes.join('');

describe('cmdTable — partial standings (A01)', () => {
  it('--json carries partial and the provider rank per row', async () => {
    await cmdTable(undefined, ctx(adapterServing([PARTIAL, FULL])));
    const d = json() as {
      degraded: boolean;
      tables: Array<{ group: string; standings: Array<{ rank?: number }>; partial?: { omitted: number } }>;
    };
    expect(d.degraded).toBe(false); // readable rows stay usable
    expect(d.tables[0]?.partial).toEqual({ omitted: 2 });
    expect(d.tables[0]?.standings.map((r) => r.rank)).toEqual([2, 3]);
    expect(d.tables[1]?.partial).toBeUndefined();
  });

  it('--json single group keeps partial on the table object', async () => {
    await cmdTable('A', ctx(adapterServing([PARTIAL])));
    const d = json() as { tables: { partial?: { omitted: number } } };
    expect(d.tables.partial).toEqual({ omitted: 2 });
  });

  it('text says the table is partial, in the locale', async () => {
    await cmdTable('A', ctx(adapterServing([PARTIAL]), { json: false }));
    expect(text()).toContain('Partial table — 2 rows could not be read.');
    expect(text()).toContain('Mexico'); // rows still render
    writes = [];
    await cmdTable('A', ctx(adapterServing([PARTIAL]), { json: false, lang: 'es' }));
    expect(text()).toContain('Tabla parcial — no se pudieron leer 2 filas.');
  });

  it('a complete table carries no partial notice', async () => {
    await cmdTable('B', ctx(adapterServing([FULL]), { json: false }));
    expect(text()).not.toMatch(/partial/i);
  });
});

describe('cmdShare table --json — partial standings (A01, review P2)', () => {
  it('structured output keeps the partial verdict the snippet warns about', async () => {
    await cmdShare('table', 'A', {}, {
      ...ctx(adapterServing([PARTIAL])),
      marketProvider: new FakeMarketProvider(),
      now: new Date('2026-06-20T00:00:00Z'),
    });
    const d = json() as {
      degraded: boolean;
      snippet: string;
      tables: Array<{ standings: Array<{ rank?: number }>; partial?: { omitted: number } }>;
    };
    expect(d.degraded).toBe(false);
    expect(d.snippet).toMatch(/partial table/i);
    expect(d.tables[0]?.partial).toEqual({ omitted: 2 });
    expect(d.tables[0]?.standings.map((r) => r.rank)).toEqual([2, 3]);
  });
});
