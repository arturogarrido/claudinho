/**
 * 0.11 PR 2.1d — the CLI surfaces of the partial-read verdict, beside
 * `partial-surfaces.test.ts`:
 *   - an empty day whose read was not whole and merged no bundled schedule
 *     says no fixture was READ for it (on a window that also holds a readable
 *     record: a window whose ONLY record is refused is refused whole by the
 *     adapter, which is an outage, `degraded`, not this);
 *   - `markets next <team>` says the fixture read was not whole in its text;
 *   - the dated market answer forwards its fixture read's verdict only where
 *     markets are read: off their scope the scope verdict is the whole answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EspnAdapter, FakeMarketProvider, type ProviderAdapter } from '@claudinho/core';
import { cmdMarkets, cmdShare, cmdToday } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';

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
const LEAGUE_NOW = new Date('2026-10-17T12:00:00Z');
function ctx(adapter: ProviderAdapter, over: Partial<CliConfig> = {}, now = LEAGUE_NOW) {
  const cfg: CliConfig = { lang: 'en', tz: 'UTC', json: false, color: false, source: 'espn', competition: adapter.competition, flavor: 'off', markets: true, ...over };
  return { cfg, t: makeT(over.lang ?? 'en'), adapter, now, marketProvider: new FakeMarketProvider({ synthesize: true, now }) };
}
const SENTENCE = 'Fixture data may be incomplete (1 provider record omitted).';
const outSpy = vi.spyOn(process.stdout, 'write');
const errSpy = vi.spyOn(process.stderr, 'write');
let writes: string[] = [];
beforeEach(() => {
  writes = [];
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
  errSpy.mockImplementation(() => true);
});
afterEach(() => {
  outSpy.mockReset();
  errSpy.mockReset();
});
const text = () => writes.join('');
const parsed = () => JSON.parse(text()) as Record<string, unknown>;

describe('an empty day whose read was not whole and merged no bundled schedule (0.11 2.1d)', () => {
  it('off the bundle: none was READ for that date, beside the sentence; the card the same; --json the key', async () => {
    await cmdToday('2026-10-17', ctx(league()));
    expect(text()).toContain(SENTENCE);
    expect(text()).toContain('No fixture was read for 2026-10-17.');
    expect(text()).not.toContain('No matches scheduled');
    writes = [];
    await cmdShare('2026-10-17', undefined, {}, ctx(league()));
    expect(text()).toContain(SENTENCE);
    // The card names the date as its title does (its label); the CLI prints the ISO date of its header.
    expect(text()).toContain('No fixture was read for Oct 17.');
    writes = [];
    await cmdToday('2026-10-17', ctx(league(), { json: true }));
    expect(parsed()).toMatchObject({ degraded: false, partial: { omitted: 1 }, source: 'espn', matches: [] });
  });

  it('the bundle’s slug stating another year: the same, and no bundled fixture shown', async () => {
    const adapter = feed('fifa.world', { ...WC_SEASON, year: 2022, displayName: '2022 FIFA World Cup' }, [
      { id: '760415', date: '2026-06-11T19:00Z', home: MEX, away: RSA, raw: REFUSED },
      { id: '760414', date: '2026-06-12T02:00Z', home: KOR, away: CZE },
    ]);
    await cmdToday('2026-06-11', ctx(adapter, {}, new Date('2026-06-11T20:00:00Z')));
    expect(text()).toContain(SENTENCE);
    expect(text()).toContain('No fixture was read for 2026-06-11.');
    expect(text()).not.toContain('Mexico');
  });
});

describe('what a day on a read that was not whole says, at the edges (0.11 2.1d)', () => {
  const wc = (events: Ev[]) => feed('fifa.world', WC_SEASON, events);
  const OPENER_REFUSED: Ev = { id: '760415', date: '2026-06-11T19:00Z', home: MEX, away: RSA, raw: REFUSED };
  const KOR_CZE: Ev = { id: '760414', date: '2026-06-12T02:00Z', home: KOR, away: CZE };

  it('on the bundle, a day the bundled schedule has no fixture on: the bundle\'s own empty answer (it merged the schedule), never "none read"', async () => {
    // The window (June 9 to 11) holds a refused record and a readable one: partial, not degraded.
    await cmdToday('2026-06-10', ctx(wc([OPENER_REFUSED, KOR_CZE]), {}, new Date('2026-06-10T12:00:00Z')));
    expect(text()).toContain(SENTENCE);
    expect(text()).toContain('No matches scheduled for this date.');
    expect(text()).not.toMatch(/was read/);
  });

  it('an empty day names the provider still: nothing shown is attributed to it', async () => {
    await cmdToday('2026-10-17', ctx(league()));
    expect(text()).toContain('No fixture was read for 2026-10-17.');
    expect(text()).toContain('Live data');
  });

  it('a WHOLE read whose shown rows the overlay did not hold (the bundle\'s): unchanged, the line kept, no count', async () => {
    // Korea v Czechia is the window's only record (June 11 in the provider's day, June 12 UTC); the opener is the bundle's row.
    await cmdToday('2026-06-11', ctx(wc([KOR_CZE]), {}, new Date('2026-06-11T12:00:00Z')));
    expect(text()).toContain('Mexico');
    expect(text()).toContain('Live data');
    expect(text()).not.toContain('bundled schedule');
    expect(text()).not.toContain('may be incomplete');
  });
});

describe('markets next <team>: the fixture read in the text (0.11 2.1d)', () => {
  it('the knockout window was not whole: the sentence beside the market body', async () => {
    const adapter = feed('fifa.world', WC_SEASON, [
      { id: '760415', date: '2026-06-11T19:00Z', home: MEX, away: RSA },
      { id: '760414', date: '2026-06-12T02:00Z', home: KOR, away: CZE, raw: REFUSED },
    ]);
    await cmdMarkets('next', 'MEX', ctx(adapter, {}, new Date('2026-06-11T12:00:00Z')));
    expect(text()).toContain(SENTENCE);
    expect(text()).toContain('Mexico');
  });
});

describe('markets <date> off the markets’ scope (0.11 2.1d)', () => {
  it('a fixture read that was not whole: the scope verdict alone, no `partial`, no fixture-read sentence', async () => {
    await cmdMarkets('2026-10-17', undefined, ctx(league(), { json: true }));
    expect(parsed().unsupported).toBe(true);
    expect(parsed().partial).toBeUndefined();
    writes = [];
    await cmdMarkets('2026-10-17', undefined, ctx(league()));
    expect(text()).toContain('Market signals cover the World Cup only');
    expect(text()).not.toContain('may be incomplete');
  });
});
