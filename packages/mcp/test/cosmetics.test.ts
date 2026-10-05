/**
 * The matchday cosmetics on the MCP server (0.11 · 2.7c): an empty
 * `get_next_fixture` keeps its "Next up for X:" label, and the text of
 * `get_live` and `get_today` carries no English token under es, pt or fr
 * (the section titles, the status tokens, the stage words come from core's
 * catalog).
 */
import { t, type Match, type ProviderAdapter } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toolGetLive, toolGetMatch, toolGetNextFixture, toolGetToday } from '../src/tools';

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
  it("on the bundle after the final: 'Next up for MEX:' (the bundle names the code, as the found form does) then the sentence", async () => {
    process.env.CLAUDINHO_COMPETITION = 'fifa.world';
    const r = await toolGetNextFixture({ team: 'MEX', adapter: adapter('fifa.world', []), now: AFTER_THE_FINAL });
    expect(r.text).toMatch(/^Next up for MEX:/m);
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

describe('the MCP empty-state and outage sentences are localized too', () => {
  it('get_live with nothing in play, get_today with no fixture, get_next_fixture with no fixture: the catalog sentence under es, pt, fr', async () => {
    for (const lang of ['es', 'pt', 'fr']) {
      const live = await toolGetLive({ adapter: adapter('eng.1', []), now: NOW, lang, flavor: 'off' });
      expect(live.text, `live ${lang}`).not.toMatch(/No matches in play right now/);
      const today = await toolGetToday({ date: '2026-10-10', adapter: adapter('eng.1', []), now: NOW, lang, flavor: 'off' });
      expect(today.text, `today ${lang}`).not.toMatch(/No matches scheduled|No fixture was read for/);
      process.env.CLAUDINHO_COMPETITION = 'fifa.world';
      const next = await toolGetNextFixture({ team: 'MEX', adapter: adapter('fifa.world', []), now: AFTER_THE_FINAL, lang });
      expect(next.text, `next ${lang}`).not.toMatch(/No upcoming fixture found for/);
      process.env.CLAUDINHO_COMPETITION = 'eng.1';
    }
  });

  it('the degraded line under es, pt, fr is the catalog sentence, not English', async () => {
    const failing: ProviderAdapter = {
      name: 'espn',
      competition: 'eng.1',
      capabilities: { push: false, latencyHintSec: 0 },
      async fetchByDate() {
        throw new Error('down');
      },
      async fetchLive() {
        throw new Error('down');
      },
      async fetchWindow() {
        throw new Error('down');
      },
    };
    for (const lang of ['es', 'pt', 'fr']) {
      const live = await toolGetLive({ adapter: failing, now: NOW, lang, flavor: 'off' });
      expect(live.text, `live ${lang}`).not.toMatch(/couldn't reach the data provider|Live scores unavailable/);
      expect((live.data as Record<string, unknown>).degraded).toBe(true);
    }
  });
});

/** An adapter whose every read fails: the provider is down. */
function down(competition: string): ProviderAdapter {
  const fail = async (): Promise<Match[]> => {
    throw new Error('down');
  };
  return { name: 'espn', competition, capabilities: { push: false, latencyHintSec: 0 }, fetchByDate: fail, fetchLive: fail, fetchWindow: fail };
}
const LANGS = ['es', 'pt', 'fr'];
// The bundled opener (Jun 11, 2026, 19:00 UTC), read before the tournament: a
// SCHEDULED record whose kickoff has passed on any clock these tests run on, as
// a stale record or the bundle's skeleton during an outage is.
const BEFORE_THE_OPENER = new Date('2026-06-01T12:00:00Z');
const OPENER = '760415';

describe("the countdown says 'now' in the reader's language (round 1)", () => {
  for (const lang of LANGS) {
    it(`get_today, get_match and get_next_fixture under ${lang}: the language's word, never the English 'now'`, async () => {
      process.env.CLAUDINHO_COMPETITION = 'fifa.world';
      const wc = adapter('fifa.world', []);
      const texts = [
        (await toolGetToday({ date: '2026-06-11', tz: 'UTC', adapter: wc, now: BEFORE_THE_OPENER, lang, flavor: 'off' })).text,
        (await toolGetMatch({ id: OPENER, adapter: wc, now: BEFORE_THE_OPENER, lang, flavor: 'off' })).text,
        (await toolGetNextFixture({ team: 'MEX', adapter: wc, now: BEFORE_THE_OPENER, lang, flavor: 'off' })).text,
      ];
      for (const text of texts) {
        expect(text, lang).toContain(`(${t(lang, 'countdown.now')})`);
        expect(text, lang).not.toMatch(/\bnow\b/);
      }
    });
  }
  it("under en: '(now)', not '(in now)'", async () => {
    process.env.CLAUDINHO_COMPETITION = 'fifa.world';
    const r = await toolGetToday({ date: '2026-06-11', tz: 'UTC', adapter: adapter('fifa.world', []), now: BEFORE_THE_OPENER, flavor: 'off' });
    expect(r.text).toContain('(now)');
    expect(r.text).not.toMatch(/\bin now\b/);
  });
});

describe('the outage and ambiguous sentences under a localized heading are localized (round 1)', () => {
  for (const lang of LANGS) {
    it(`under ${lang}: get_next_fixture's outage keeps the team, its ambiguous answer the candidates, get_match's outage the id`, async () => {
      process.env.CLAUDINHO_COMPETITION = 'fifa.world';
      // After the group stage, Mexico's knockout slots are the bundle's placeholders: no fixture, and the read failed.
      const unreachable = await toolGetNextFixture({ team: 'MEX', adapter: down('fifa.world'), now: new Date('2026-07-20T12:00:00Z'), lang });
      expect(unreachable.text).toContain(t(lang, 'next.unreachable', { team: 'MEX' }));
      expect(unreachable.text).not.toMatch(/Couldn't reach|no upcoming fixture confirmed/);
      expect((unreachable.data as Record<string, unknown>).degraded).toBe(true);
      // "South" is two of the bundle's nations: the candidates, no fixture.
      const ambiguous = await toolGetNextFixture({ team: 'South', adapter: adapter('fifa.world', []), now: new Date('2026-06-13T12:00:00Z'), lang });
      expect(ambiguous.text).toContain(t(lang, 'team.ambiguous', { query: 'South' }));
      expect(ambiguous.text).toMatch(/South Africa \(RSA\)/);
      expect(ambiguous.text).not.toMatch(/is ambiguous|Did you mean/);
      // The question closes after the candidates, set off with a space in French.
      expect(ambiguous.text).toMatch(lang === 'fr' ? /\([A-Z]{3}\) \?/ : /\([A-Z]{3}\)\?/);
      process.env.CLAUDINHO_COMPETITION = 'eng.1';
      const match = await toolGetMatch({ id: '401999999', adapter: down('eng.1'), now: NOW, lang });
      expect(match.text).toContain(t(lang, 'match.unreachable', { id: '401999999' }));
      expect(match.text).not.toMatch(/Couldn't reach|could not be looked up/);
    });
  }
});

describe('every named localization of the MCP text is the catalog sentence (round 1)', () => {
  it("get_today's degraded line: the bundled schedule's on the bundle, the provider's outage off it", async () => {
    process.env.CLAUDINHO_COMPETITION = 'fifa.world';
    const on = await toolGetToday({ date: '2026-06-11', tz: 'UTC', adapter: down('fifa.world'), now: BEFORE_THE_OPENER, lang: 'es', flavor: 'off' });
    expect(on.text).toContain(`(${t('es', 'feed.degraded')})`);
    process.env.CLAUDINHO_COMPETITION = 'eng.1';
    const off = await toolGetToday({ date: '2026-10-10', tz: 'UTC', adapter: down('eng.1'), now: NOW, lang: 'es', flavor: 'off' });
    expect(off.text).toContain(`(${t('es', 'live.degraded')})`);
  });

  it("get_match's degraded line and its unknown-id sentence", async () => {
    process.env.CLAUDINHO_COMPETITION = 'fifa.world';
    const degraded = await toolGetMatch({ id: OPENER, adapter: down('fifa.world'), now: BEFORE_THE_OPENER, lang: 'es', flavor: 'off' });
    expect(degraded.text).toContain(`(${t('es', 'feed.degraded')})`);
    const unknown = await toolGetMatch({ id: '999999', adapter: adapter('fifa.world', []), now: BEFORE_THE_OPENER, lang: 'es' });
    expect(unknown.text).toContain(t('es', 'match.none', { id: '999999' }));
  });

  it("get_next_fixture's title", async () => {
    process.env.CLAUDINHO_COMPETITION = 'fifa.world';
    const r = await toolGetNextFixture({ team: 'MEX', adapter: adapter('fifa.world', []), now: BEFORE_THE_OPENER, lang: 'es', flavor: 'off' });
    expect(r.text).toContain(`${t('es', 'heading', { title: t('es', 'next.label', { team: 'MEX' }) })}\n`);
  });

  it('the French title sets its colon off with a space', async () => {
    const list = [fixture(1, { status: 'LIVE', minute: 30, score: { home: 1, away: 0 } })];
    const live = await toolGetLive({ adapter: adapter('eng.1', list), now: NOW, lang: 'fr', flavor: 'off' });
    expect(live.text).toContain(`${t('fr', 'live.title')} :\n`);
    const today = await toolGetToday({ date: '2026-10-10', adapter: adapter('eng.1', list), now: NOW, lang: 'fr', flavor: 'off' });
    expect(today.text).toContain(`${t('fr', 'today.onDate', { date: '2026-10-10' })} :\n`);
  });

  it("half-time and full-time are the MCP's words in every language, not the CLI's column tokens", async () => {
    const list = [fixture(1, { status: 'HT', score: { home: 0, away: 0 } }), fixture(2, { status: 'FT', score: { home: 1, away: 1 } })];
    for (const lang of ['en', ...LANGS]) {
      expect(t(lang, 'status.halfTime'), lang).not.toBe(t(lang, 'status.ht'));
      expect(t(lang, 'status.fullTime'), lang).not.toBe(t(lang, 'status.ft'));
      const r = await toolGetToday({ date: '2026-10-10', adapter: adapter('eng.1', list), now: NOW, lang, flavor: 'off' });
      expect(r.text, lang).toContain(`— ${t(lang, 'status.halfTime')} ·`);
      expect(r.text, lang).toContain(`— ${t(lang, 'status.fullTime')} ·`);
    }
  });
});

describe("the countdown's 'in' is the reader's word too (round 2)", () => {
  // A kickoff a week after a clock set in 2098: the dated read and discovery's
  // span hold it, and the countdown, which reads the real clock, says "in"
  // until 2099.
  const LATE_2098 = new Date('2098-12-25T12:00:00Z');
  const future = fixture(1, { kickoff: '2099-01-01T15:00:00.000Z', home: { code: 'ARS', name: 'Arsenal', id: 'espn:359' } });
  const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const lang of LANGS) {
    it(`get_today, get_match and get_next_fixture under ${lang}: the language's "in" before the countdown, never the English one`, async () => {
      const epl = adapter('eng.1', [future]);
      const texts = [
        (await toolGetToday({ date: '2099-01-01', tz: 'UTC', adapter: epl, now: LATE_2098, lang, flavor: 'off' })).text,
        (await toolGetMatch({ id: future.id, adapter: epl, now: LATE_2098, lang, flavor: 'off' })).text,
        (await toolGetNextFixture({ team: 'Arsenal', adapter: epl, now: LATE_2098, lang, flavor: 'off' })).text,
      ];
      const before = t(lang, 'next.in', { countdown: '\u0000' }).split('\u0000')[0] ?? '';
      for (const text of texts) {
        expect(text, lang).toMatch(new RegExp(`\\(${esc(before)}\\d+[dhm]`));
        expect(text, lang).not.toMatch(/\(in \d/);
      }
    });
  }
});
