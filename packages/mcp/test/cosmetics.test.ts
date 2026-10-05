/**
 * The matchday cosmetics on the MCP server (0.11 · 2.7c): an empty
 * `get_next_fixture` keeps its "Next up for X:" label, and the text of
 * `get_live` and `get_today` carries no English token under es, pt or fr
 * (the section titles, the status tokens, the stage words come from core's
 * catalog).
 */
import type { Match, ProviderAdapter } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toolGetLive, toolGetNextFixture, toolGetToday } from '../src/tools';

const NOW = new Date('2026-10-10T15:00:00Z');
const AFTER_THE_FINAL = new Date('2026-09-01T12:00:00Z');
function fixture(i: number, over: Partial<Match> = {}): Match {
  return {
    id: String(800000700 + i),
    stage: 'REGULAR',
    kickoff: '2026-10-10T14:00:00.000Z',
    venue: `Ground ${i}`,
    home: { code: `H${i}`, name: `Home ${i}`, id: `espn:${9400 + i}` },
    away: { code: `A${i}`, name: `Away ${i}`, id: `espn:${9500 + i}` },
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
const ORIG = process.env.CLAUDINHO_COMPETITION;
beforeEach(() => {
  process.env.CLAUDINHO_COMPETITION = 'eng.1';
});
afterEach(() => {
  if (ORIG === undefined) delete process.env.CLAUDINHO_COMPETITION;
  else process.env.CLAUDINHO_COMPETITION = ORIG;
});

/** The English tokens the MCP text used to print whatever the language. */
const ENGLISH = [/\bLive now\b/, /\bMatches on\b/, /\bNext up for\b/, /\bLIVE\b/, /\bhalf-time\b/, /\bfull-time\b/, /\bpostponed\b/, /\bcancelled\b/, /\bLeague phase\b/, /\bGroup stage\b/];
const noEnglish = (text: string, label: string) => {
  for (const re of ENGLISH) expect(text, `${label}: ${re}`).not.toMatch(re);
};

describe('the empty get_next_fixture keeps its label', () => {
  it("on the bundle after the final: 'Next up for Mexico:' then the sentence", async () => {
    process.env.CLAUDINHO_COMPETITION = 'fifa.world';
    const r = await toolGetNextFixture({ team: 'MEX', adapter: adapter('fifa.world', []), now: AFTER_THE_FINAL });
    expect(r.text).toMatch(/^Next up for Mexico:/m);
    expect(r.text).toMatch(/No upcoming fixture found for/);
    expect((r.data as Record<string, unknown>).fixture).toBeNull();
  });
});

describe('the MCP text is localized', () => {
  const list = [
    fixture(1, { status: 'LIVE', minute: 30, score: { home: 1, away: 0 } }),
    fixture(2, { status: 'HT', minute: 45, score: { home: 0, away: 0 } }),
    fixture(3, { status: 'FT', score: { home: 2, away: 2 } }),
    fixture(4, { status: 'POSTPONED' }),
    fixture(5, { stage: 'LEAGUE', status: 'SCHEDULED' }),
    fixture(6, { stage: 'GROUP', status: 'SCHEDULED' }),
  ];
  for (const lang of ['es', 'pt', 'fr']) {
    it(`get_today under ${lang} prints no English section title, status token or stage word`, async () => {
      const r = await toolGetToday({ date: '2026-10-10', adapter: adapter('eng.1', list), now: NOW, lang, flavor: 'off' });
      noEnglish(r.text, `get_today ${lang}`);
      expect(r.text).toContain('Home 1');
    });
    it(`get_live under ${lang} prints no English section title or status token`, async () => {
      const r = await toolGetLive({ adapter: adapter('eng.1', list), now: NOW, lang, flavor: 'off' });
      noEnglish(r.text, `get_live ${lang}`);
      expect(r.text).toContain('Home 2');
    });
  }

  it('under en the tokens are the English ones (the catalog, not a blank)', async () => {
    const r = await toolGetToday({ date: '2026-10-10', adapter: adapter('eng.1', list), now: NOW, lang: 'en', flavor: 'off' });
    expect(r.text).toMatch(/Matches on 2026-10-10/);
    expect(r.text).toMatch(/LIVE 30'/);
    expect(r.text).toMatch(/half-time/);
    expect(r.text).toMatch(/full-time/);
    expect(r.text).toMatch(/postponed/);
  });
});
