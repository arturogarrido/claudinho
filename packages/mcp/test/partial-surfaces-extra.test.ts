/**
 * 0.11 PR 2.1d — the MCP tools' partial-read verdict, beside
 * `partial-surfaces.test.ts`:
 *   - an empty day whose read was not whole and merged no bundled schedule
 *     says no fixture was READ for it (get_today and the date card), on a
 *     window that also holds a readable record (a window whose ONLY record is
 *     refused is refused whole by the adapter: `degraded`, not this);
 *   - get_market_signal {team} says the fixture read was not whole in its text;
 *   - get_market_signal {date} forwards its fixture read's verdict only where
 *     markets are read: off their scope the scope verdict is the whole answer;
 *   - get_today decides the day's attribution over the rows it SHOWS, after
 *     the bound: a 41st row the read did not serve is not one the text shows.
 */
import { describe, expect, it } from 'vitest';
import { attachFetchMeta, EspnAdapter, FakeMarketProvider, type Match, type ProviderAdapter } from '@claudinho/core';
import { z } from 'zod/v3';
import { OUTPUT_SCHEMAS } from '../src/server';
import { toolGetMarketSignal, toolGetShareSnippet, toolGetToday } from '../src/tools';

const WC_SEASON = { year: 2026, startDate: '2026-06-11T04:00Z', endDate: '2026-12-31T04:59Z', displayName: '2026 FIFA World Cup' };
const PL = { year: 2026, displayName: '2026-27 English Premier League', startDate: '2026-08-01T04:00Z', endDate: '2027-06-01T03:59Z' };
type Side = { id: string; abbr: string; name: string };
type Ev = { id: string; date: string; home: Side; away: Side; raw?: Record<string, unknown> };
const ARS: Side = { id: '359', abbr: 'ARS', name: 'Arsenal' };
const CHE: Side = { id: '363', abbr: 'CHE', name: 'Chelsea' };
const MEX: Side = { id: '203', abbr: 'MEX', name: 'Mexico' };
const RSA: Side = { id: '467', abbr: 'RSA', name: 'South Africa' };
const KOR: Side = { id: '451', abbr: 'KOR', name: 'South Korea' };
const CZE: Side = { id: '478', abbr: 'CZE', name: 'Czechia' };
/** The refused shape: a status the parser does not know. */
const REFUSED = { status: { type: { name: 'STATUS_NEW', state: 'limbo' } } };
function event(e: Ev) {
  const side = (s: Side, homeAway: string) => ({ homeAway, score: '0', team: { id: s.id, abbreviation: s.abbr, displayName: s.name } });
  return { id: e.id, date: e.date, season: { slug: 'regular-season' }, status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' }, period: 0 }, competitions: [{ competitors: [side(e.home, 'home'), side(e.away, 'away')] }], ...e.raw };
}
const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const easternDay = (iso: string) => eastern.format(new Date(iso)).replace(/-/g, '');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function feed(competition: string, season: unknown, events: Ev[]): ProviderAdapter {
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    if (url.includes('/standings')) return json({});
    const asked = new URL(url).searchParams.get('dates') ?? '';
    if (asked.includes('-')) return json({ code: 400 }, 400);
    const inBucket = (e: Ev) => (asked.length === 8 ? easternDay(e.date) === asked : asked.length === 6 ? easternDay(e.date).startsWith(asked) : false);
    return json({ leagues: [{ season }], events: events.filter(inBucket).map(event) });
  }) as unknown as typeof fetch;
  return new EspnAdapter({ competition, enrichGroups: false, fetchImpl }) as ProviderAdapter;
}
/** A league day whose only record is refused, with a readable record the next day. */
const league = () =>
  feed('eng.1', PL, [
    { id: '41', date: '2026-10-17T14:00Z', home: ARS, away: CHE, raw: REFUSED },
    { id: '42', date: '2026-10-18T14:00Z', home: CHE, away: ARS },
  ]);
const strict = (tool: keyof typeof OUTPUT_SCHEMAS, data: unknown) => {
  const res = z.object(OUTPUT_SCHEMAS[tool]).strict().safeParse(data);
  expect(res.success, `${tool}: ${res.success ? '' : JSON.stringify(res.error.issues)}`).toBe(true);
};
const SENTENCE = 'Fixture data may be incomplete (1 provider record omitted).';

describe('an empty day whose read was not whole and merged no bundled schedule (0.11 2.1d)', () => {
  it('get_today and the date card: none was READ for that date, beside the sentence', async () => {
    const today = await toolGetToday({ date: '2026-10-17', tz: 'UTC', adapter: league() });
    expect(today.text).toContain(SENTENCE);
    expect(today.text).toContain('No fixture was read for 2026-10-17.');
    expect(today.text).not.toContain('No matches scheduled');
    expect(today.data).toMatchObject({ degraded: false, partial: { omitted: 1 }, source: 'espn', count: 0 });
    strict('get_today', today.data);
    const card = await toolGetShareSnippet({ date: '2026-10-17', tz: 'UTC', adapter: league() });
    expect(card.text).toContain(SENTENCE);
    // The card names the date as its title does (its label); the tool prints the ISO date of its header.
    expect(card.text).toContain('No fixture was read for Oct 17.');
    strict('get_share_snippet', card.data);
  });

  it('the bundle’s slug stating another year: the same, and no bundled fixture shown', async () => {
    const adapter = feed('fifa.world', { ...WC_SEASON, year: 2022 }, [
      { id: '760415', date: '2026-06-11T19:00Z', home: MEX, away: RSA, raw: REFUSED },
      { id: '760414', date: '2026-06-12T02:00Z', home: KOR, away: CZE },
    ]);
    const r = await toolGetToday({ date: '2026-06-11', tz: 'UTC', adapter });
    expect(r.text).toContain('No fixture was read for 2026-06-11.');
    expect(r.text).not.toContain('Mexico');
  });
});

describe('what a day or a live answer on a read that was not whole says, at the edges (0.11 2.1d)', () => {
  const wc = (events: Ev[]) => feed('fifa.world', WC_SEASON, events);
  const OPENER_REFUSED: Ev = { id: '760415', date: '2026-06-11T19:00Z', home: MEX, away: RSA, raw: REFUSED };
  const KOR_CZE: Ev = { id: '760414', date: '2026-06-12T02:00Z', home: KOR, away: CZE };

  it('on the bundle, a day the bundled schedule has no fixture on: the bundle\'s own empty answer, never "none read"', async () => {
    const r = await toolGetToday({ date: '2026-06-10', tz: 'UTC', adapter: wc([OPENER_REFUSED, KOR_CZE]) });
    expect(r.text).toContain(SENTENCE);
    expect(r.text).toContain('No matches scheduled.');
    expect(r.text).not.toMatch(/was read/);
  });

  it('an empty day names the provider still: nothing shown is attributed to it', async () => {
    const r = await toolGetToday({ date: '2026-10-17', tz: 'UTC', adapter: league() });
    expect(r.footer).toContain('Live data');
  });

  it('a WHOLE read whose shown rows the overlay did not hold (the bundle\'s): unchanged, the line kept, no count', async () => {
    const r = await toolGetToday({ date: '2026-06-11', tz: 'UTC', adapter: wc([KOR_CZE]) });
    expect(r.text).toContain('Mexico');
    expect(r.footer).toContain('Live data');
    expect(r.text).not.toContain('bundled schedule;');
    expect(r.text).not.toContain('may be incomplete');
  });

  it('the live card on a read that was not whole with nothing in play: none in play was READ', async () => {
    // One record refused; a scheduled one beside it keeps the window readable, and nothing is in play.
    const scheduled: Ev = { id: '760415', date: '2026-06-11T19:00Z', home: MEX, away: RSA };
    const adapter = feed('fifa.world', WC_SEASON, [{ ...KOR_CZE, raw: REFUSED }, scheduled]);
    const r = await toolGetShareSnippet({ live: true, now: new Date('2026-06-11T20:00:00Z'), adapter } as never);
    expect(r.text).toContain(SENTENCE);
    expect(r.text).toContain('No match in play was read.');
    expect(r.text).not.toContain('No matches in play right now');
  });
});

describe('get_market_signal (0.11 2.1d)', () => {
  it('{team}: the knockout window was not whole: the sentence first, beside the market body', async () => {
    const at = new Date('2026-06-11T12:00:00Z');
    const adapter = feed('fifa.world', WC_SEASON, [
      { id: '760415', date: '2026-06-11T19:00Z', home: MEX, away: RSA },
      { id: '760414', date: '2026-06-12T02:00Z', home: KOR, away: CZE, raw: REFUSED },
    ]);
    const r = await toolGetMarketSignal({ team: 'MEX', adapter, marketProvider: new FakeMarketProvider({ synthesize: true, now: at }), now: at } as never);
    expect(r.text.indexOf(SENTENCE)).toBe(0);
    expect(r.text).toContain('Mexico');
  });

  it('{date} off the markets’ scope, on a fixture read that was not whole: the scope verdict alone, no `partial`, no fixture-read sentence', async () => {
    const now = new Date('2026-10-17T12:00:00Z');
    const r = await toolGetMarketSignal({
      date: '2026-10-17',
      tz: 'UTC',
      adapter: league(),
      marketProvider: new FakeMarketProvider({ synthesize: true, now }),
      now,
    } as never);
    expect(r.data).toMatchObject({ unsupported: true });
    expect((r.data as Record<string, unknown>).partial).toBeUndefined();
    expect(r.text).not.toContain('may be incomplete');
    strict('get_market_signal', r.data);
  });
});

describe('get_today: the day’s attribution is decided over the rows the tool SHOWS, after the bound (0.11 2.1d)', () => {
  it('forty served rows shown, the bundled opener (not served) beyond the bound: no unserved sentence, the line kept', async () => {
    // Forty records the overlay served, all before the opener on June 11 (UTC);
    // the opener's own record was refused, so its row is the bundle's: the 41st.
    const served: Match[] = Array.from({ length: 40 }, (_, i) => ({
      id: `9${String(i).padStart(5, '0')}`,
      stage: 'FRIENDLY',
      kickoff: `2026-06-11T${String(10 + Math.floor(i / 6)).padStart(2, '0')}:${String((i % 6) * 10).padStart(2, '0')}Z`,
      venue: 'Somewhere',
      home: { code: 'AAA', name: 'Home', flag: '' },
      away: { code: 'BBB', name: 'Away', flag: '' },
      status: 'SCHEDULED',
      updatedAt: '2026-06-11T09:00Z',
    }));
    const season = { year: 2026, label: '2026 FIFA World Cup' };
    const adapter: ProviderAdapter = {
      name: 'espn',
      competition: 'fifa.world',
      capabilities: { push: false, latencyHintSec: 0 },
      async fetchByDate() { return []; },
      async fetchLive() { return []; },
      async fetchWindow() { return attachFetchMeta([...served], { complete: false, omitted: 1, season }); },
    };
    const r = await toolGetToday({ date: '2026-06-11', tz: 'UTC', adapter });
    expect(r.data).toMatchObject({ truncated: true, partial: { omitted: 1 }, source: 'espn' });
    expect((r.data as { matches: Match[] }).matches.some((m) => m.id === '760415')).toBe(false);
    expect(r.text).toContain('may be incomplete');
    expect(r.text).not.toContain('bundled schedule;');
    expect(r.text).toContain('Live data');
  });
});
