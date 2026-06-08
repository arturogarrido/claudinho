import type { Match, ProviderAdapter } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdTable } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';

/** Offline adapter named "espn": fetch succeeds → live source attributed. */
const fakeAdapter: ProviderAdapter = {
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
const ctx = (over: Partial<CliConfig> = {}) => ({
  cfg: cfg(over),
  t: makeT('en'),
  adapter: fakeAdapter,
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

describe('cmdTable --json', () => {
  it('wraps all-groups standings with degraded + source attribution', async () => {
    await cmdTable(undefined, ctx());
    const d = json() as { degraded: boolean; source: string | null; tables: unknown[] };
    expect(d.degraded).toBe(false);
    expect(d.source).toBe('espn');
    expect(Array.isArray(d.tables)).toBe(true);
    expect(d.tables.length).toBeGreaterThan(0);
    expect(d.tables[0]).toHaveProperty('group');
    expect(d.tables[0]).toHaveProperty('standings');
  });

  it('keeps the single-group payload under tables', async () => {
    await cmdTable('A', ctx());
    const d = json() as { source: string | null; tables: { group: string; standings: unknown[] } };
    expect(d.source).toBe('espn');
    expect(d.tables.group).toBe('A');
    expect(Array.isArray(d.tables.standings)).toBe(true);
  });
});
