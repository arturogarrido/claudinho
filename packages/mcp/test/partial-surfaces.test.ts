/**
 * 0.11 PR 2.1d — the partial-read verdict on the MCP server's remaining
 * tools: `get_live`, `get_today`, the bundled `get_match`, `get_market_signal`,
 * and their share cards; `data` against the declared schemas, strictly.
 */
import { describe, expect, it } from 'vitest';
import { EspnAdapter, FakeMarketProvider, type ProviderAdapter } from '@claudinho/core';
import { z } from 'zod/v3';
import { OUTPUT_SCHEMAS } from '../src/server';
import { toolGetLive, toolGetMarketSignal, toolGetMatch, toolGetShareSnippet, toolGetToday } from '../src/tools';

const WC_SEASON = { year: 2026, startDate: '2026-06-11T04:00Z', endDate: '2026-12-31T04:59Z', displayName: '2026 FIFA World Cup' };
type Side = { id: string; abbr: string; name: string };
type Ev = { id: string; date: string; home: Side; away: Side; state?: 'pre' | 'in' | 'post'; raw?: Record<string, unknown> };
const MEX: Side = { id: '203', abbr: 'MEX', name: 'Mexico' };
const RSA: Side = { id: '467', abbr: 'RSA', name: 'South Africa' };
const KOR: Side = { id: '451', abbr: 'KOR', name: 'South Korea' };
const CZE: Side = { id: '478', abbr: 'CZE', name: 'Czechia' };
const ARS: Side = { id: '359', abbr: 'ARS', name: 'Arsenal' };
const CHE: Side = { id: '363', abbr: 'CHE', name: 'Chelsea' };
function event(e: Ev) {
  const state = e.state ?? 'pre';
  const type = state === 'in' ? { name: 'STATUS_IN_PROGRESS', state: 'in' } : state === 'post' ? { name: 'STATUS_FULL_TIME', state: 'post' } : { name: 'STATUS_SCHEDULED', state: 'pre' };
  const side = (s: Side, homeAway: string, score: string) => ({ homeAway, score, team: { id: s.id, abbreviation: s.abbr, displayName: s.name } });
  return { id: e.id, date: e.date, season: { slug: 'group-stage' }, status: { type, displayClock: state === 'in' ? "55'" : undefined, period: state === 'in' ? 2 : 0 }, competitions: [{ competitors: [side(e.home, 'home', '1'), side(e.away, 'away', '0')] }], ...e.raw };
}
const REFUSED = { status: { type: { name: 'STATUS_NEW', state: 'limbo' } } };
const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const easternDay = (iso: string) => eastern.format(new Date(iso)).replace(/-/g, '');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function feed(competition: string, opts: { events?: Ev[]; season?: unknown } = {}) {
  const events = opts.events ?? [];
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    if (url.includes('/standings')) return json({});
    const asked = new URL(url).searchParams.get('dates') ?? '';
    if (asked.includes('-')) return json({ code: 400 }, 400);
    const inBucket = (e: Ev) => (asked.length === 8 ? easternDay(e.date) === asked : asked.length === 6 ? easternDay(e.date).startsWith(asked) : false);
    return json({ leagues: [{ season: opts.season ?? WC_SEASON }], events: events.filter(inBucket).map(event) });
  }) as unknown as typeof fetch;
  return new EspnAdapter({ competition, enrichGroups: false, fetchImpl }) as ProviderAdapter;
}
const OPENER: Ev = { id: '760415', date: '2026-06-11T19:00Z', home: MEX, away: RSA };
const KOR_CZE: Ev = { id: '760414', date: '2026-06-12T02:00Z', home: KOR, away: CZE };
const NOW = new Date('2026-06-11T20:00:00Z');
const PL = { year: 2026, displayName: '2026-27 English Premier League', startDate: '2026-08-01T04:00Z', endDate: '2027-06-01T03:59Z' };
const strict = (tool: keyof typeof OUTPUT_SCHEMAS, data: unknown) => {
  const res = z.object(OUTPUT_SCHEMAS[tool]).strict().safeParse(data);
  expect(res.success, `${tool}: ${res.success ? '' : JSON.stringify(res.error.issues)}`).toBe(true);
};
const SENTENCE = 'Fixture data may be incomplete (1 provider record omitted).';
const count = (t: string, s: string) => t.split(s).length - 1;
const markets = (now: Date) => new FakeMarketProvider({ synthesize: true, now });

describe('get_live and get_today (0.11 2.1d)', () => {
  it('live: the sentence FIRST in the text, the key in data; the empty partial body says nothing was read', async () => {
    const r = await toolGetLive({ adapter: feed('fifa.world', { events: [{ ...OPENER, state: 'in' }, { ...KOR_CZE, raw: REFUSED }] }), now: NOW } as never);
    expect(r.text).toContain(SENTENCE);
    expect(r.text.indexOf(SENTENCE)).toBeLessThan(r.text.indexOf('Mexico'));
    expect(r.data).toMatchObject({ partial: { omitted: 1 } });
    strict('get_live', r.data);
    const none = await toolGetLive({ adapter: feed('fifa.world', { events: [{ ...OPENER, state: 'post' }, { ...KOR_CZE, state: 'in', raw: REFUSED }] }), now: NOW } as never);
    expect(none.text).toContain(SENTENCE);
    expect(none.text).not.toContain('No matches in play');
    expect(none.data).toMatchObject({ partial: { omitted: 1 } });
    strict('get_live', none.data);
  });

  it('today on the bundle: the day whole, the unserved sentence, "Live data" kept while a shown fixture was served; dropped from the TEXT footer when none was, data.source kept', async () => {
    const second: Ev = { id: '760414', date: '2026-06-11T22:00Z', home: KOR, away: CZE, state: 'in' };
    const mixed = await toolGetToday({ date: '2026-06-11', tz: 'UTC', adapter: feed('fifa.world', { events: [{ ...OPENER, raw: REFUSED }, second] }) });
    expect(mixed.text).toContain(SENTENCE);
    expect(mixed.text).toMatch(/1 fixture .*bundled schedule/);
    expect(mixed.text).toContain('Live data');
    expect(mixed.data).toMatchObject({ partial: { omitted: 1 }, source: 'espn' });
    strict('get_today', mixed.data);
    const allStatic = await toolGetToday({ date: '2026-06-11', tz: 'UTC', adapter: feed('fifa.world', { events: [{ ...OPENER, raw: REFUSED }, { ...KOR_CZE, state: 'in' }] }) });
    expect(allStatic.text).toContain('Mexico');
    expect(allStatic.text).toContain(SENTENCE);
    expect(allStatic.text).not.toContain('Live data');
    expect(allStatic.footer).not.toContain('Live data');
    expect(allStatic.data).toMatchObject({ partial: { omitted: 1 }, source: 'espn' });
    strict('get_today', allStatic.data);
  });

  it('today off the bundle, and on the bundle’s slug for another year: the empty partial body says no fixture was read for the date', async () => {
    const off = await toolGetToday({ date: '2026-10-17', tz: 'UTC', adapter: feed('eng.1', { season: PL, events: [{ id: '41', date: '2026-10-17T14:00Z', home: ARS, away: CHE, raw: REFUSED }] }) });
    expect(off.text).toContain(SENTENCE);
    expect(off.text).not.toContain('No matches scheduled');
    expect(off.data).toMatchObject({ partial: { omitted: 1 } });
    strict('get_today', off.data);
    const other = await toolGetToday({ date: '2026-06-11', tz: 'UTC', adapter: feed('fifa.world', { season: { ...WC_SEASON, year: 2022 }, events: [{ ...OPENER, raw: REFUSED }] }) });
    expect(other.text).not.toContain('No matches scheduled');
    expect(other.text).not.toContain('Mexico');
    expect(other.text).toContain(SENTENCE);
  });

  it('the share cards: live and date carry the note and the key; the date card drops its source with the line', async () => {
    const live = await toolGetShareSnippet({ live: true, now: NOW, adapter: feed('fifa.world', { events: [{ ...OPENER, state: 'in' }, { ...KOR_CZE, raw: REFUSED }] }) } as never);
    expect(live.text).toContain(SENTENCE);
    expect(live.data).toMatchObject({ partial: { omitted: 1 } });
    strict('get_share_snippet', live.data);
    const date = await toolGetShareSnippet({ date: '2026-06-11', tz: 'UTC', adapter: feed('fifa.world', { events: [{ ...OPENER, raw: REFUSED }, { ...KOR_CZE, state: 'in' }] }) });
    expect(date.text).toContain(SENTENCE);
    expect(date.text).not.toContain('Live data');
    expect(date.data).toMatchObject({ partial: { omitted: 1 }, source: null });
    strict('get_share_snippet', date.data);
  });
});

describe('the bundled get_match and get_market_signal (0.11 2.1d)', () => {
  it('get_match with a refused sibling: exactly one sentence, the key, attribution unchanged', async () => {
    const r = await toolGetMatch({ id: '760415', adapter: feed('fifa.world', { events: [{ ...OPENER, state: 'in' }, { ...KOR_CZE, raw: REFUSED }] }) });
    expect(count(r.text, 'may be incomplete')).toBe(1);
    expect(r.data).toMatchObject({ partial: { omitted: 1 }, source: 'espn' });
    strict('get_match', r.data);
  });

  it('get_market_signal by id, team and date: the fixture read’s sentence and key beside the market body, the strict schema holding; the dated empty body says no signal among the fixtures read', async () => {
    const at = new Date('2026-06-11T12:00:00Z');
    const adapter = feed('fifa.world', { events: [OPENER, { ...KOR_CZE, raw: REFUSED }] });
    const byId = await toolGetMarketSignal({ matchId: '760415', adapter, marketProvider: markets(at), now: at } as never);
    expect(byId.text).toContain(SENTENCE);
    expect(byId.data).toMatchObject({ partial: { omitted: 1 }, complete: true });
    strict('get_market_signal', byId.data);
    const byTeam = await toolGetMarketSignal({ team: 'MEX', adapter, marketProvider: markets(at), now: at } as never);
    expect(byTeam.data).toMatchObject({ partial: { omitted: 1 } });
    strict('get_market_signal', byTeam.data);
    const late = new Date('2026-06-11T21:30:00Z');
    const dated = await toolGetMarketSignal({ date: '2026-06-11', tz: 'UTC', adapter: feed('fifa.world', { events: [{ ...OPENER, raw: REFUSED }, { ...KOR_CZE, state: 'post' }] }), marketProvider: markets(late), now: late } as never);
    expect(dated.text).toContain(SENTENCE);
    expect(dated.text).not.toMatch(/No market signals available/);
    expect(dated.text).toMatch(/read/i);
    expect(dated.data).toMatchObject({ partial: { omitted: 1 } });
    strict('get_market_signal', dated.data);
  });
});
