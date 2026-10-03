/**
 * 0.11 PR 2.1d — the partial-read verdict on the CLI's remaining surfaces:
 * `live`, `today`, the bundled `match`, `markets`, and their share cards.
 *
 * On this base these commands drop the read's verdict: a refused provider
 * record is invisible, an empty body claims absence, and a day whose shown
 * fixtures the overlay never served is still "Live data: ESPN".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EspnAdapter, FakeMarketProvider, type ProviderAdapter } from '@claudinho/core';
import { cmdLive, cmdMarkets, cmdMatch, cmdShare, cmdToday } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';

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
const OPENER_DAY = new Date('2026-06-11T20:00:00Z');
const PL = { year: 2026, displayName: '2026-27 English Premier League', startDate: '2026-08-01T04:00Z', endDate: '2027-06-01T03:59Z' };

function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return { lang: 'en', tz: 'UTC', json: false, color: false, source: 'espn', competition: 'fifa.world', flavor: 'off', markets: false, ...over };
}
const ctxFor = (adapter: ProviderAdapter, over: Partial<CliConfig> = {}, now = OPENER_DAY) => ({
  cfg: cfg({ competition: adapter.competition, ...over }),
  t: makeT(over.lang ?? 'en'),
  adapter,
  now,
  marketProvider: new FakeMarketProvider({ synthesize: true, now }),
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
const parsed = () => JSON.parse(text()) as Record<string, unknown>;
const SENTENCE = 'Fixture data may be incomplete (1 provider record omitted).';
const count = (t: string, s: string) => t.split(s).length - 1;

describe('live (0.11 2.1d)', () => {
  it('a refused record beside a match in play: the match, the sentence AFTER the list, the key in --json', async () => {
    const adapter = feed('fifa.world', { events: [{ ...OPENER, state: 'in' }, { ...KOR_CZE, raw: REFUSED }] });
    await cmdLive(ctxFor(adapter));
    const t = text();
    expect(t).toContain('Mexico');
    expect(t).toContain(SENTENCE);
    expect(t.indexOf('Mexico')).toBeLessThan(t.indexOf(SENTENCE));
    expect(count(t, 'may be incomplete')).toBe(1);
    writes = [];
    await cmdLive(ctxFor(adapter, { json: true }));
    expect(parsed()).toMatchObject({ partial: { omitted: 1 } });
  });

  it('the only in-play record refused: an empty body that says nothing was READ, never "No matches in play right now"', async () => {
    const adapter = feed('fifa.world', { events: [{ ...OPENER, state: 'post' }, { ...KOR_CZE, state: 'in', raw: REFUSED }] });
    await cmdLive(ctxFor(adapter));
    expect(text()).toContain(SENTENCE);
    expect(text()).not.toContain('No matches in play right now');
    expect(text()).toMatch(/read/i);
    writes = [];
    await cmdShare('live', undefined, {}, ctxFor(adapter));
    expect(text()).toContain(SENTENCE);
    expect(text()).not.toContain('No matches in play right now');
  });

  it('a whole read and a failed read: as today (no sentence, no key)', async () => {
    await cmdLive(ctxFor(feed('fifa.world', { events: [{ ...OPENER, state: 'in' }] }), { json: true }));
    expect(parsed().partial).toBeUndefined();
    expect(text()).not.toContain('may be incomplete');
  });

  it('localized (es): the sentence and the none-read line are not English', async () => {
    const adapter = feed('fifa.world', { events: [{ ...OPENER, state: 'post' }, { ...KOR_CZE, state: 'in', raw: REFUSED }] });
    await cmdLive(ctxFor(adapter, { lang: 'es' }));
    expect(text()).not.toContain('may be incomplete');
    expect(text()).not.toMatch(/was read/);
    expect(text()).toMatch(/1/);
  });
});

describe('today (0.11 2.1d)', () => {
  it('on the bundle, this edition: the day stays whole, the refused fixture shows without a score, the sentence after the list, the unserved count beside it, "Live data" kept because one shown fixture was served', async () => {
    // Both June 11 UTC fixtures: the opener refused, Korea v Czechia (02:00Z Jun 12 is still Jun 11 for... no: it is Jun 12 UTC) — use two UTC-June-11 fixtures.
    const second: Ev = { id: '760414', date: '2026-06-11T22:00Z', home: KOR, away: CZE, state: 'in' };
    const adapter = feed('fifa.world', { events: [{ ...OPENER, raw: REFUSED }, second] });
    await cmdToday('2026-06-11', ctxFor(adapter));
    const t = text();
    expect(t).toContain('Mexico');
    expect(t).toContain('South Korea');
    expect(t).toContain(SENTENCE);
    expect(t).toMatch(/1 fixture .*bundled schedule/);
    expect(t).toContain('Live data');
    expect(count(t, 'may be incomplete')).toBe(1);
    writes = [];
    await cmdToday('2026-06-11', ctxFor(adapter, { json: true }));
    expect(parsed()).toMatchObject({ partial: { omitted: 1 }, source: 'espn' });
  });

  it('on the bundle, the day’s only record refused (an adjacent day readable): the day is the bundle’s, no "Live data" line, --json keeps the provider', async () => {
    const adapter = feed('fifa.world', { events: [{ ...OPENER, raw: REFUSED }, { ...KOR_CZE, state: 'in' }] });
    await cmdToday('2026-06-11', ctxFor(adapter));
    const t = text();
    expect(t).toContain('Mexico');
    expect(t).toContain(SENTENCE);
    expect(t).not.toContain('Live data');
    expect(t).toMatch(/1 fixture .*bundled schedule/);
    writes = [];
    await cmdToday('2026-06-11', ctxFor(adapter, { json: true }));
    expect(parsed()).toMatchObject({ partial: { omitted: 1 }, source: 'espn' });
    writes = [];
    await cmdShare('2026-06-11', undefined, {}, ctxFor(adapter));
    expect(text()).toContain(SENTENCE);
    expect(text()).not.toContain('Live data');
    writes = [];
    await cmdShare('2026-06-11', undefined, {}, ctxFor(adapter, { json: true }));
    expect(parsed()).toMatchObject({ partial: { omitted: 1 } });
    expect(parsed().source).toBeNull();
  });

  it('a whole read with skeleton rows the overlay did not hold: unchanged (attributed, no sentence)', async () => {
    await cmdToday('2026-06-11', ctxFor(feed('fifa.world', { events: [{ ...OPENER, state: 'in' }] })));
    expect(text()).toContain('Live data');
    expect(text()).not.toContain('may be incomplete');
    expect(text()).not.toContain('bundled schedule');
  });

  it('off the bundle, the day’s only fixture refused: the empty body says no fixture was READ for that date, never "No matches scheduled"', async () => {
    const adapter = feed('eng.1', { season: PL, events: [{ id: '41', date: '2026-10-17T14:00Z', home: ARS, away: CHE, raw: REFUSED }] });
    await cmdToday('2026-10-17', ctxFor(adapter, {}, new Date('2026-10-17T12:00:00Z')));
    expect(text()).toContain(SENTENCE);
    expect(text()).not.toContain('No matches scheduled');
    expect(text()).toContain('2026-10-17');
    writes = [];
    await cmdShare('2026-10-17', undefined, {}, ctxFor(adapter, {}, new Date('2026-10-17T12:00:00Z')));
    expect(text()).toContain(SENTENCE);
    expect(text()).not.toContain('No matches scheduled');
  });

  it('the bundle’s slug stating another year (no skeleton merged): the same none-read body', async () => {
    const adapter = feed('fifa.world', { season: { ...WC_SEASON, year: 2022, displayName: '2022 FIFA World Cup' }, events: [{ ...OPENER, raw: REFUSED }] });
    await cmdToday('2026-06-11', ctxFor(adapter));
    expect(text()).toContain(SENTENCE);
    expect(text()).not.toContain('No matches scheduled');
    expect(text()).not.toContain('Mexico');
  });
});

describe('the bundled match and the markets (0.11 2.1d)', () => {
  it('match <id> with a refused sibling: exactly one sentence beside the match, the key; attribution unchanged', async () => {
    const adapter = feed('fifa.world', { events: [{ ...OPENER, state: 'in' }, { ...KOR_CZE, raw: REFUSED }] });
    await cmdMatch('760415', ctxFor(adapter));
    expect(text()).toContain('Mexico');
    expect(count(text(), 'may be incomplete')).toBe(1);
    expect(text()).toContain('Live data');
    writes = [];
    await cmdMatch('760415', ctxFor(adapter, { json: true }));
    expect(parsed()).toMatchObject({ partial: { omitted: 1 }, source: 'espn' });
    writes = [];
    await cmdShare('760415', undefined, {}, ctxFor(adapter));
    expect(count(text(), 'may be incomplete')).toBe(1);
  });

  it('markets <id> and markets next <team>: the fixture read’s sentence beside the market body, the key in --json, separately from complete', async () => {
    const adapter = feed('fifa.world', { events: [{ ...OPENER, state: 'pre' }, { ...KOR_CZE, raw: REFUSED }] });
    await cmdMarkets('760415', undefined, ctxFor(adapter, { markets: true }, new Date('2026-06-11T12:00:00Z')));
    expect(text()).toContain(SENTENCE);
    writes = [];
    await cmdMarkets('760415', undefined, ctxFor(adapter, { markets: true, json: true }, new Date('2026-06-11T12:00:00Z')));
    expect(parsed()).toMatchObject({ partial: { omitted: 1 }, complete: true });
    writes = [];
    await cmdMarkets('next', 'MEX', ctxFor(adapter, { markets: true, json: true }, new Date('2026-06-11T12:00:00Z')));
    expect(parsed()).toMatchObject({ partial: { omitted: 1 } });
  });

  it('markets <date> on a partial fixture read with nothing relevant: the empty body says no signal among the fixtures READ, never none for the date', async () => {
    // The day's only fixture refused; the bundle's row is past its relevance window (kickoff + 150 min).
    const adapter = feed('fifa.world', { events: [{ ...OPENER, raw: REFUSED }, { ...KOR_CZE, state: 'post' }] });
    const at = new Date('2026-06-11T21:30:00Z');
    await cmdMarkets('2026-06-11', undefined, ctxFor(adapter, { markets: true }, at));
    expect(text()).toContain(SENTENCE);
    expect(text()).not.toContain('No market signals available for 2026-06-11');
    expect(text()).toMatch(/read/i);
    writes = [];
    await cmdMarkets('2026-06-11', undefined, ctxFor(adapter, { markets: true, json: true }, at));
    expect(parsed()).toMatchObject({ partial: { omitted: 1 }, complete: true });
  });
});
