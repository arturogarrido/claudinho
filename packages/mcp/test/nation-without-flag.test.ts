import type { ProviderAdapter } from '@claudinho/core';
import { EspnAdapter, FakeMarketProvider } from '@claudinho/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v3';
import { OUTPUT_SCHEMAS } from '../src/server';
import { toolGetLive, toolGetMatch, toolGetShareSnippet, toolGetToday } from '../src/tools';

/**
 * MCP half of the flagless-nation rendering (see the CLI's
 * nation-without-flag.test.ts): Northern Ireland, whose tag sequence `gbnir`
 * Unicode does not recommend (every platform draws a plain black flag), is
 * printed by its name with nothing in the flag's place, in every tool's text
 * and in the share card; its structured record carries no `flag` key; Hungary,
 * beside it, keeps its flag.
 */
const NOW = new Date('2026-11-17T20:30:00.000Z');
type Side = { id: string; abbr: string; name: string };
const HUN: Side = { id: '2611', abbr: 'HUN', name: 'Hungary' };
const NIR: Side = { id: '2617', abbr: 'NIR', name: 'Northern Ireland' };
const SEASON = { year: 2026, displayName: '2026-27 UEFA Nations League', startDate: '2026-09-01T04:00Z', endDate: '2027-06-30T03:59Z' };
function event(state: 'pre' | 'in') {
  const type = state === 'in' ? { name: 'STATUS_IN_PROGRESS', state: 'in' } : { name: 'STATUS_SCHEDULED', state: 'pre' };
  const side = (s: Side, homeAway: string, score: string) => ({ homeAway, ...(state === 'pre' ? {} : { score }), team: { id: s.id, abbreviation: s.abbr, displayName: s.name } });
  return {
    id: '401800001',
    date: '2026-11-17T19:45Z',
    season: { slug: 'league-phase' },
    status: { type, displayClock: state === 'in' ? "50'" : undefined, period: state === 'in' ? 2 : 0 },
    competitions: [{ venue: { fullName: 'Puskás Aréna', address: { city: 'Budapest' } }, competitors: [side(HUN, 'home', '2'), side(NIR, 'away', '1')] }],
  };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function feed(state: 'pre' | 'in'): ProviderAdapter {
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    if (url.includes('/standings')) return json({ code: 404 }, 404);
    const asked = new URL(url).searchParams.get('dates') ?? '';
    if (asked.includes('-')) return json({ code: 400 }, 400);
    const hit = asked === '20261117' || asked === '202611';
    return json({ leagues: [{ season: SEASON }], events: hit ? [event(state)] : [] });
  }) as unknown as typeof fetch;
  return new EspnAdapter({ competition: 'uefa.nations', fetchImpl, now: () => NOW.getTime() }) as ProviderAdapter;
}

const NO_FLAG_SHAPE = /[\u{E0000}-\u{E007F}]|\u{1F3F4}|🏳️|🇬🇧|undefined/u;
const GAP = /Northern Ireland {2}\S|NIR {2}/;
const clean = (t: string, label: string) => {
  expect(t, label).not.toMatch(NO_FLAG_SHAPE);
  expect(t, label).not.toMatch(GAP);
};
const strict = (tool: keyof typeof OUTPUT_SCHEMAS, data: unknown) => expect(() => z.object(OUTPUT_SCHEMAS[tool]).strict().parse(data)).not.toThrow();
type Rec = Record<string, unknown>;
const NIR_RECORD = { code: 'NIR', name: 'Northern Ireland', id: 'espn:2617' };

describe('Northern Ireland renders by name in the MCP tools', () => {
  it('get_today: Hungary\'s flag, Northern Ireland\'s name alone; data with no flag key on it', async () => {
    const r = await toolGetToday({ date: '2026-11-17', competition: 'uefa.nations', adapter: feed('pre'), now: NOW, tz: 'Europe/London' });
    expect(r.text).toContain('🇭🇺 Hungary vs Northern Ireland');
    clean(r.text, 'get_today');
    const m = ((r.data as Rec).matches as Rec[])[0];
    expect((m as Rec).home).toHaveProperty('flag', '🇭🇺');
    expect(m?.away).toEqual(NIR_RECORD);
    strict('get_today', r.data);
  });

  it('get_live and get_match: the score line by names', async () => {
    const live = await toolGetLive({ competition: 'uefa.nations', adapter: feed('in'), now: NOW });
    expect(live.text).toContain('🇭🇺 Hungary 2–1 Northern Ireland');
    clean(live.text, 'get_live');
    expect(((live.data as Rec).matches as Rec[])[0]?.away).toEqual(NIR_RECORD);
    const match = await toolGetMatch({ id: '401800001', competition: 'uefa.nations', adapter: feed('in'), now: NOW });
    expect(match.text).toContain('🇭🇺 Hungary 2–1 Northern Ireland');
    clean(match.text, 'get_match');
    expect(((match.data as Rec).match as Rec).away).toEqual(NIR_RECORD);
  });

  it('get_share_snippet (date, live, match): the social card by name, the compact one by code, no flag shape', async () => {
    for (const style of ['social', 'compact'] as const) {
      for (const [args, state] of [[{ date: '2026-11-17' }, 'pre'], [{ live: true }, 'in'], [{ matchId: '401800001' }, 'in']] as const) {
        const r = await toolGetShareSnippet({ ...args, style, competition: 'uefa.nations', adapter: feed(state), marketProvider: new FakeMarketProvider(), now: NOW });
        const label = `${JSON.stringify(args)} ${style}`;
        // The social card names the teams; the compact one prints every team by its code, Northern Ireland as NIR.
        expect(r.text, label).toContain(style === 'social' ? 'Northern Ireland' : '🇭🇺 HUN');
        if (style === 'compact') expect(r.text, label).toMatch(/\bNIR\b/);
        clean(r.text, label);
        clean((r.data as Rec).snippet as string, `${label} snippet`);
        for (const m of ((r.data as Rec).matches as Rec[]) ?? []) expect(m.away, label).toEqual(NIR_RECORD);
        strict('get_share_snippet', r.data);
      }
    }
  });
});
