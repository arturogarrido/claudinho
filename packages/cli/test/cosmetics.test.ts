/**
 * The matchday cosmetics (0.11 · 2.7c): an empty `next` answer keeps its
 * header (the team asked, then the mode line, then the sentence), and a
 * list's away column is padded so the time column lines up whatever the
 * away names' lengths.
 */
import type { Match, ProviderAdapter } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdNext, cmdToday } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';
import { described } from './config-of';

const AFTER_THE_FINAL = new Date('2026-09-01T12:00:00Z');
const NOW = new Date('2026-10-10T15:00:00Z');

function fixture(i: number, over: Partial<Match> = {}): Match {
  return {
    id: String(800000600 + i),
    stage: 'REGULAR',
    kickoff: '2026-10-10T14:00:00.000Z',
    venue: `Ground ${i}`,
    home: { code: `H${i}`, name: `Home ${i}`, id: `espn:${9200 + i}` },
    away: { code: `A${i}`, name: `Away ${i}`, id: `espn:${9300 + i}` },
    status: 'SCHEDULED',
    updatedAt: NOW.toISOString(),
    ...over,
  };
}
function adapter(competition: string, matches: Match[]): ProviderAdapter {
  return {
    name: 'espn',
    competition,
    capabilities: { push: false, latencyHintSec: 0 },
    async fetchByDate() {
      return matches;
    },
    async fetchLive() {
      return matches.filter((m) => m.status === 'LIVE' || m.status === 'HT');
    },
    async fetchWindow() {
      return matches;
    },
  };
}
function cfg(competition: string, over: Partial<CliConfig> = {}): CliConfig {
  return described({ lang: 'en', tz: 'UTC', json: false, color: false, source: 'espn', competition, flavor: 'off', markets: false, ...over });
}
const ctx = (competition: string, matches: Match[], now: Date, over: Partial<CliConfig> = {}) => ({
  cfg: cfg(competition, over),
  t: makeT(over.lang ?? 'en'),
  adapter: adapter(competition, matches),
  marketProvider: undefined,
  now,
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
const lines = () => text().split('\n');

describe('an empty next answer keeps its header', () => {
  it("on the bundle after the final: 'Next up for MEX' (the bundle names the code, as the found form does), then the mode line, then the sentence", async () => {
    await cmdNext('MEX', ctx('fifa.world', [], AFTER_THE_FINAL));
    const out = lines();
    const header = out.findIndex((l) => l.startsWith('Next up for MEX'));
    const mode = out.findIndex((l) => l.includes('World Cup'));
    const sentence = out.findIndex((l) => /No upcoming fixture found for/.test(l));
    expect(header, text()).toBeGreaterThanOrEqual(0);
    expect(mode).toBeGreaterThan(header);
    expect(sentence).toBeGreaterThan(mode);
  });

  it('in Spanish too, and --json is unchanged (no header key)', async () => {
    await cmdNext('MEX', ctx('fifa.world', [], AFTER_THE_FINAL, { lang: 'es' }));
    expect(lines().findIndex((l) => l.startsWith('Próximo partido de MEX'))).toBeGreaterThanOrEqual(0);
    writes = [];
    await cmdNext('MEX', ctx('fifa.world', [], AFTER_THE_FINAL, { json: true }));
    const j = JSON.parse(text()) as Record<string, unknown>;
    expect(j.fixture).toBeNull();
    expect(j).not.toHaveProperty('header');
  });
});

describe('the away column is padded', () => {
  it('a list with 6- and 7-letter away names prints its time tokens in one column', async () => {
    const list = [
      fixture(1, { home: { code: 'ROU', name: 'Romania', id: 'espn:1' }, away: { code: 'SWE', name: 'Sweden', id: 'espn:2' } }),
      fixture(2, { home: { code: 'UKR', name: 'Ukraine', id: 'espn:3' }, away: { code: 'HUN', name: 'Hungary', id: 'espn:4' } }),
      fixture(3, { home: { code: 'ITA', name: 'Italy', id: 'espn:5' }, away: { code: 'TUR', name: 'Türkiye', id: 'espn:6' } }),
    ];
    await cmdToday('2026-10-10', ctx('uefa.nations', list, NOW));
    const rows = lines().filter((l) => /Sweden|Hungary|Türkiye/.test(l));
    expect(rows.length).toBe(3);
    const cols = rows.map((l) => l.search(/\d\d:\d\d/));
    expect(new Set(cols).size, rows.join('\n')).toBe(1);
  });

  it('the padding is bounded like the home column: one very long away name does not push the rest off the screen', async () => {
    const list = [
      fixture(1, { away: { code: 'LNG', name: 'A Very Long Away Name Indeed Beyond Any Bound', id: 'espn:7' } }),
      fixture(2, { away: { code: 'SHT', name: 'Short', id: 'espn:8' } }),
    ];
    await cmdToday('2026-10-10', ctx('uefa.nations', list, NOW));
    const short = lines().find((l) => l.includes('Short'));
    expect(short).toBeDefined();
    expect((short as string).search(/\d\d:\d\d/)).toBeLessThan(70);
  });
});
