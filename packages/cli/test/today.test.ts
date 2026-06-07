import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdToday } from '../src/commands';
import { makeT } from '../src/i18n';
import type { CliConfig } from '../src/config';
import type { Match, ProviderAdapter } from '@claudinho/core';

/** A fake adapter so the test runs offline against the bundled schedule. */
const fakeAdapter: ProviderAdapter = {
  name: 'fake',
  capabilities: { push: false, latencyHintSec: 0 },
  async fetchByDate(): Promise<Match[]> {
    return [];
  },
  async fetchLive(): Promise<Match[]> {
    return [];
  },
};

function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return { lang: 'en', tz: undefined, json: true, color: false, source: 'espn', flavor: 'off', ...over };
}
const ctx = (over: Partial<CliConfig> = {}) => ({ cfg: cfg(over), t: makeT('en'), adapter: fakeAdapter });

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

const matchesOut = () => (JSON.parse(writes.join('')) as { matches: Match[] }).matches;
const weekday = (iso: string, tz: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: tz, weekday: 'long' });

describe('cmdToday — local-date grouping (timezone bug)', () => {
  it('only lists matches that fall on the requested day in the caller timezone', async () => {
    // 2026-06-13 is a Saturday. In America/Mexico_City a 01:00Z kickoff is the
    // Friday evening before, so it must NOT appear under the 13th here.
    await cmdToday('2026-06-13', ctx({ tz: 'America/Mexico_City' }));
    const matches = matchesOut();
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      expect(weekday(m.kickoff, 'America/Mexico_City')).toBe('Saturday');
    }
  });

  it('groups by UTC when tz is UTC (every match really is on that UTC date)', async () => {
    await cmdToday('2026-06-13', ctx({ tz: 'UTC' }));
    const matches = matchesOut();
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      expect(m.kickoff.slice(0, 10)).toBe('2026-06-13');
    }
  });
});
