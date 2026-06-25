import type { GroupStandings, Match, ProviderAdapter } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdTable } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';

const row = (code: string, name: string, flag: string, w: number, d: number, l: number, gd: number) => ({
  team: { code, name, flag },
  played: w + d + l,
  won: w,
  drawn: d,
  lost: l,
  goalsFor: gd >= 0 ? gd : 0,
  goalsAgainst: gd < 0 ? -gd : 0,
  goalDiff: gd,
  points: w * 3 + d,
});

const TABLES: GroupStandings[] = [
  { group: 'A', rows: [row('MEX', 'Mexico', '🇲🇽', 1, 0, 0, 2), row('RSA', 'South Africa', '🇿🇦', 0, 0, 1, -2)] },
  { group: 'B', rows: [row('CAN', 'Canada', '🇨🇦', 1, 0, 0, 1)] },
];

/** Offline adapter named "espn" that serves authoritative tables (happy path). */
const liveAdapter: ProviderAdapter = {
  name: 'espn',
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

/** Adapter with NO fetchStandings → the degraded (roster) path. */
const bareAdapter: ProviderAdapter = {
  name: 'espn',
  capabilities: { push: false, latencyHintSec: 0 },
  async fetchByDate(): Promise<Match[]> {
    return [];
  },
  async fetchLive(): Promise<Match[]> {
    return [];
  },
};

function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return { lang: 'en', tz: 'UTC', json: true, color: false, source: 'espn', flavor: 'off', ...over };
}
const ctx = (adapter: ProviderAdapter, over: Partial<CliConfig> = {}) => ({
  cfg: cfg(over),
  t: makeT('en'),
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

describe('cmdTable --json (authoritative live standings)', () => {
  it('wraps all-groups standings with source attribution, not degraded', async () => {
    await cmdTable(undefined, ctx(liveAdapter));
    const d = json() as { degraded: boolean; source: string | null; tables: Array<{ group: string }> };
    expect(d.degraded).toBe(false);
    expect(d.source).toBe('espn');
    expect(d.tables.map((t) => t.group)).toEqual(['A', 'B']);
    expect(d.tables[0]).toHaveProperty('standings');
  });

  it('keeps the single-group payload under tables', async () => {
    await cmdTable('A', ctx(liveAdapter));
    const d = json() as { source: string | null; tables: { group: string; standings: unknown[] } };
    expect(d.source).toBe('espn');
    expect(d.tables.group).toBe('A');
    expect(d.tables.standings).toHaveLength(2);
  });

  it('an unknown group yields a null table (not an empty one)', async () => {
    await cmdTable('Z', ctx(liveAdapter));
    const d = json() as { degraded: boolean; tables: null };
    expect(d.degraded).toBe(false);
    expect(d.tables).toBeNull();
  });
});

describe('cmdTable — localized live-data attribution (text)', () => {
  it('localizes the attribution under --lang es (wires cfg.lang → dataSource)', async () => {
    await cmdTable('A', { cfg: cfg({ lang: 'es', json: false }), t: makeT('es'), adapter: liveAdapter });
    expect(text()).toContain('Datos en vivo: ESPN');
    expect(text()).not.toContain('Live data:');
  });
});

describe('cmdTable — fail closed', () => {
  it('JSON: degrades with null source when the provider has no fetchStandings', async () => {
    await cmdTable('A', ctx(bareAdapter));
    const d = json() as { degraded: boolean; source: string | null; tables: { standings: unknown[] } };
    expect(d.degraded).toBe(true);
    expect(d.source).toBeNull();
    expect(d.tables.standings).toHaveLength(4); // static roster
  });

  it('text: prints the degraded notice rather than implying live zeros', async () => {
    await cmdTable('A', ctx(bareAdapter, { json: false }));
    expect(text()).toContain('Group A');
    expect(text()).toContain('Live standings unavailable');
  });
});

describe('cmdTable — text output', () => {
  it('renders a real table with attribution', async () => {
    await cmdTable('A', ctx(liveAdapter, { json: false }));
    const o = text();
    expect(o).toContain('Group A');
    expect(o).toContain('Mexico');
    expect(o).toContain('Live data: ESPN');
    expect(o).not.toContain('Live standings unavailable');
  });
});
