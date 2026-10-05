/**
 * 0.11 PR 2.1d — the partial-read verdict on the MCP server's remaining
 * tools: `get_live`, `get_today`, the bundled `get_match`, `get_market_signal`,
 * and their share cards; `data` against the declared schemas, strictly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { EspnAdapter, FakeMarketProvider, type ProviderAdapter } from '@claudinho/core';
import { z } from 'zod/v3';
import { DISCLAIMER } from '../src/format';
import { buildServer, OUTPUT_SCHEMAS, toContent } from '../src/server';
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
function feed(competition: string, opts: { events?: Ev[]; season?: unknown; fail?: boolean } = {}) {
  const events = opts.events ?? [];
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    if (url.includes('/standings')) return json({});
    if (opts.fail) return json({ code: 503 }, 503);
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
    expect(mixed.data).toMatchObject({ partial: { omitted: 1 }, source: 'espn', served: ['760414'] });
    strict('get_today', mixed.data);
    const allStatic = await toolGetToday({ date: '2026-06-11', tz: 'UTC', adapter: feed('fifa.world', { events: [{ ...OPENER, raw: REFUSED }, { ...KOR_CZE, state: 'in' }] }) });
    expect(allStatic.text).toContain('Mexico');
    expect(allStatic.text).toContain(SENTENCE);
    expect(allStatic.text).not.toContain('Live data');
    expect(allStatic.footer).not.toContain('Live data');
    // `served` is the SHOWN fixtures the window held (bounded like the rows it interprets): none here, the window's
    // other record being on another date.
    expect(allStatic.data).toMatchObject({ partial: { omitted: 1 }, source: 'espn', served: [] });
    strict('get_today', allStatic.data);
  });

  it('today off the bundle, and on the bundle’s slug for another year: the empty partial body says no fixture was read for the date', async () => {
    // A readable record on the adjacent day keeps each three-day window a PARTIAL read (a window whose only
    // record is refused is a failed read); it is outside the displayed UTC date, so the day's body is empty.
    const off = await toolGetToday({ date: '2026-10-17', tz: 'UTC', competition: 'eng.1', adapter: feed('eng.1', { season: PL, events: [{ id: '41', date: '2026-10-17T14:00Z', home: ARS, away: CHE, raw: REFUSED }, { id: '42', date: '2026-10-18T14:00Z', home: CHE, away: ARS }] }) });
    expect(off.text).toContain(SENTENCE);
    expect(off.text).not.toContain('No matches scheduled');
    expect(off.text).not.toContain('Chelsea');
    expect(off.data).toMatchObject({ partial: { omitted: 1 } });
    strict('get_today', off.data);
    const other = await toolGetToday({ date: '2026-06-11', tz: 'UTC', adapter: feed('fifa.world', { season: { ...WC_SEASON, year: 2022 }, events: [{ ...OPENER, raw: REFUSED }, KOR_CZE] }) });
    expect(other.text).not.toContain('No matches scheduled');
    expect(other.text).not.toContain('Mexico');
    expect(other.text).not.toContain('Korea');
    expect(other.text).toContain(SENTENCE);
  });

  it('a FAILED read off the bundle: the text says the provider could not be reached, never "No matches scheduled" nor "showing the bundled schedule"; on the bundle unchanged', async () => {
    const off = await toolGetToday({ date: '2026-10-17', tz: 'UTC', competition: 'eng.1', adapter: feed('eng.1', { season: PL, fail: true }) });
    expect(off.text).toMatch(/no fixtures confirmed/);
    expect(off.text).not.toContain('No matches scheduled');
    expect(off.text).not.toContain('bundled schedule');
    expect(off.data).toMatchObject({ degraded: true, source: null });
    expect(off.data).not.toHaveProperty('partial');
    strict('get_today', off.data);
    const es = await toolGetToday({ date: '2026-10-17', tz: 'UTC', lang: 'es', competition: 'eng.1', adapter: feed('eng.1', { season: PL, fail: true }) } as never);
    expect(es.text).not.toMatch(/no fixtures confirmed/);
    expect(es.text).not.toContain('No matches scheduled');
    const on = await toolGetToday({ date: '2026-06-11', tz: 'UTC', adapter: feed('fifa.world', { fail: true }) });
    expect(on.text).toContain('Mexico');
    expect(on.text).toContain('showing the bundled schedule');
    // A rest day on the bundle, the provider unreachable: the bundle's answer, as today.
    const rest = await toolGetToday({ date: '2026-06-10', tz: 'UTC', adapter: feed('fifa.world', { fail: true }) });
    expect(rest.text).toContain('No matches scheduled');
    expect(rest.text).toContain('showing the bundled schedule');
    expect(rest.text).not.toMatch(/no fixtures confirmed/);
  });

  it('the share cards: live and date carry the note and the key; the date card drops its source with the line', async () => {
    const live = await toolGetShareSnippet({ live: true, now: NOW, adapter: feed('fifa.world', { events: [{ ...OPENER, state: 'in' }, { ...KOR_CZE, raw: REFUSED }] }) } as never);
    expect(live.text).toContain(SENTENCE);
    expect(live.data).toMatchObject({ partial: { omitted: 1 } });
    strict('get_share_snippet', live.data);
    const date = await toolGetShareSnippet({ date: '2026-06-11', tz: 'UTC', adapter: feed('fifa.world', { events: [{ ...OPENER, raw: REFUSED }, { ...KOR_CZE, state: 'in' }] }) });
    expect(date.text).toContain(SENTENCE);
    expect(date.text).toMatch(/1 fixture .*bundled schedule/);
    expect(date.text).not.toContain('Live data');
    expect(date.data).toMatchObject({ partial: { omitted: 1 }, source: null, served: [] });
    strict('get_share_snippet', date.data);
    // A MIXED day: the count sentence is the only thing on the card that qualifies its provider line.
    const second: Ev = { id: '760414', date: '2026-06-11T22:00Z', home: KOR, away: CZE, state: 'in' };
    const mixed = await toolGetShareSnippet({ date: '2026-06-11', tz: 'UTC', adapter: feed('fifa.world', { events: [{ ...OPENER, raw: REFUSED }, second] }) });
    expect(mixed.text).toContain('Live data');
    expect(mixed.text).toMatch(/1 fixture .*bundled schedule/);
    expect(mixed.data).toMatchObject({ source: 'espn', served: ['760414'] });
    strict('get_share_snippet', mixed.data);
  });
});

describe('the bundled get_match and get_market_signal (0.11 2.1d)', () => {
  it('get_match whose OWN record was refused: the bundle’s row named as the bundle’s (as get_today names it), the key, no provider; the card the same', async () => {
    const adapter = feed('fifa.world', { events: [{ ...OPENER, raw: REFUSED }, { ...KOR_CZE, state: 'in' }] });
    const r = await toolGetMatch({ id: '760415', adapter });
    expect(r.text).toContain(SENTENCE);
    expect(r.text).toMatch(/1 fixture .*bundled schedule/);
    expect(r.footer ?? '').not.toContain('Live data');
    expect(r.data).toMatchObject({ partial: { omitted: 1 }, source: null, served: [] });
    strict('get_match', r.data);
    const sibling = await toolGetMatch({ id: '760414', adapter });
    expect(sibling.data).toMatchObject({ partial: { omitted: 1 }, source: 'espn', served: ['760414'] });
    const card = await toolGetShareSnippet({ matchId: '760415', adapter } as never);
    expect(card.text).toMatch(/1 fixture .*bundled schedule/);
    strict('get_share_snippet', card.data);
  });

  it('a whole read carries no `served`: it rides beside `partial` only, so whole reads keep their shape', async () => {
    const adapter = feed('fifa.world', { events: [{ ...OPENER, state: 'in' }] });
    const today = await toolGetToday({ date: '2026-06-11', tz: 'UTC', adapter });
    expect(today.data).not.toHaveProperty('served');
    expect(today.data).not.toHaveProperty('partial');
    const match = await toolGetMatch({ id: '760415', adapter });
    expect(match.data).not.toHaveProperty('served');
    const card = await toolGetShareSnippet({ date: '2026-06-11', tz: 'UTC', adapter });
    expect(card.data).not.toHaveProperty('served');
  });

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

describe('the day’s attribution is decided over what the text finally shows (0.11 2.1d)', () => {
  // A label the trust layer admits can run to 400 code points (50 clusters of a letter and seven combining
  // marks, one column each; "b" so NFC composes nothing away), so 40 rows of such names pass the text cut; a cut
  // keeps the footer, and on a read that was not whole the rows it drops may be every served one. The rule: on a
  // read that was not whole, a cut keeps the disclaimer and DROPS the attribution line (the cut text may show
  // none of what was served); a whole read keeps it, as today. The structured `source` keeps the provider either way.
  const LONG = Array.from({ length: 50 }, () => 'b\u0301\u0301\u0301\u0301\u0301\u0301\u0301').join('');
  const long = (id: number): Ev => ({ id: String(9_000_000 + id), date: '2026-06-11T23:00Z', home: { id: String(100 + id), abbr: 'LNG', name: `${LONG}` }, away: { id: String(200 + id), abbr: 'LNA', name: `${LONG}` } });
  const many = Array.from({ length: 40 }, (_, i) => long(i + 1));
  const textOf = (r: Awaited<ReturnType<typeof toolGetToday>>) => (toContent(r).content[0]?.text ?? '');

  it('a cut on a read that was not whole drops the attribution line and keeps the disclaimer; a whole read keeps both', async () => {
    // The bundle's opener (refused: the bundle's row, unserved) sorts first; the 40 served rows after it are what
    // the cut drops. Deciding over the bounded list alone would keep "Live data" above the one row left.
    const partial = await toolGetToday({ date: '2026-06-11', tz: 'UTC', adapter: feed('fifa.world', { events: [{ ...OPENER, raw: REFUSED }, ...many] }) });
    const cut = textOf(partial);
    expect(cut).toContain('(truncated)');
    expect(cut).toContain('Mexico');
    expect(cut).not.toContain('Live data');
    expect(cut).toMatch(/not affiliated/i);
    expect(cut).toContain(SENTENCE);
    expect(partial.data).toMatchObject({ source: 'espn', partial: { omitted: 1 } });
    const whole = await toolGetToday({ date: '2026-06-11', tz: 'UTC', adapter: feed('fifa.world', { events: [OPENER, ...many] }) });
    const kept = textOf(whole);
    expect(kept).toContain('(truncated)');
    expect(kept).toContain('Live data');
    expect(kept).toMatch(/not affiliated/i);
    // The date card through the same cut.
    const card = await toolGetShareSnippet({ date: '2026-06-11', tz: 'UTC', adapter: feed('fifa.world', { events: [{ ...OPENER, raw: REFUSED }, ...many] }) });
    const cardCut = textOf(card);
    expect(cardCut).toContain('(truncated)');
    expect(cardCut).not.toContain('Live data');
    expect(cardCut).toMatch(/not affiliated/i);
    const wholeCard = await toolGetShareSnippet({ date: '2026-06-11', tz: 'UTC', adapter: feed('fifa.world', { events: [OPENER, ...many] }) });
    expect(textOf(wholeCard)).toContain('(truncated)');
    expect(textOf(wholeCard)).toContain('Live data');
  });

  it('a cut barely over the limit keeps nothing of the discarded footer: the prefix ends at the body’s end', () => {
    // Found in review (two readers): the prefix allowance was computed from the SHORTER cut footer and sliced the
    // whole text, so at 32,001 characters it ran into the original footer and kept "Li" of "Live data" before
    // "(truncated)". The retained prefix is capped at the original body's end.
    const MAX = 32_000;
    // The server's own footer (core's one sentence after the fan line, 0.11 · 2.7).
    const footer = `\nLive data: ESPN\n\n${DISCLAIMER}`;
    const cutFooter = `\n\n${DISCLAIMER}`;
    for (const over of [1, 2, 5, 12, 15, 16, 17, 40]) {
      const body = 'x'.repeat(MAX + over - footer.length);
      const text = toContent({ text: body + footer, footer, cutFooter, data: { ok: true } }).content[0]?.text ?? '';
      expect(text.length, String(over)).toBeLessThanOrEqual(MAX);
      // The marker is "\n(truncated)": what precedes its newline is body only.
      const before = text.slice(0, text.indexOf('\n(truncated)'));
      expect(before, String(over)).toMatch(/^x+$/);
      expect(text, String(over)).not.toMatch(/Live data|\nL/);
      expect(text, String(over)).toContain(DISCLAIMER);
    }
    // Without a cut footer the whole footer is kept and the prefix still ends in the body.
    const body = 'x'.repeat(MAX + 1 - footer.length);
    const text = toContent({ text: body + footer, footer, data: { ok: true } }).content[0]?.text ?? '';
    expect(text.slice(0, text.indexOf('\n(truncated)'))).toMatch(/^x+$/);
    expect(text).toContain('Live data: ESPN');
  });

  it('a cut LIVE list keeps its attribution on a partial read: every row it shows was served (the line is true), and a provider is attributed where it served', async () => {
    // Found in review: the rule had been applied to live lists for uniformity, dropping a true line.
    const inPlay = many.map((m) => ({ ...m, state: 'in' as const }));
    const live = await toolGetLive({ adapter: feed('fifa.world', { events: [{ ...KOR_CZE, raw: REFUSED }, ...inPlay] }), now: new Date('2026-06-11T23:30:00Z') } as never);
    const cut = textOf(live as never);
    expect(cut).toContain('(truncated)');
    expect(cut).toContain(SENTENCE);
    expect(cut).toContain('Live data');
    expect(cut).toMatch(/not affiliated/i);
    const card = await toolGetShareSnippet({ live: true, now: new Date('2026-06-11T23:30:00Z'), adapter: feed('fifa.world', { events: [{ ...KOR_CZE, raw: REFUSED }, ...inPlay] }) } as never);
    expect(textOf(card as never)).toContain('(truncated)');
    expect(textOf(card as never)).toContain('Live data');
  });

  // Found in review: a share card prints its zone beside every time, verbatim, and the MCP schema took any string
  // as `tz`; a 40,000-character "zone" pushed the card past the text cut, which then dropped the one served row
  // and kept "Live data" beside the bundled one. The zone is an IDENTIFIER (a text role, like a team code): it
  // is checked against its grammar at the edge, so no tool prints a zone the formatter cannot resolve, and a
  // date card of bounded rows never reaches the character cut (the record bound is the only cut it meets).
  afterEach(() => vi.restoreAllMocks());

  it('every tool refuses a tz that is not a time zone, before any request is made', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.reject(new Error('no network in this test')));
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const server = buildServer();
    const client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    try {
      for (const tz of ['Not/AZone', 'X'.repeat(40_000), 'America/Mexico_City\u200b']) {
        for (const [name, extra] of [
          ['get_share_snippet', { date: '2026-06-11' }],
          ['get_today', { date: '2026-06-11' }],
          ['get_live', {}],
        ] as const) {
          const r = (await client.callTool({ name, arguments: { ...extra, tz } })) as { isError?: boolean; content: Array<{ text?: string }> };
          expect(r.isError, `${name} ${tz.slice(0, 20)}`).toBe(true);
          expect(r.content.map((c) => c.text ?? '').join(' ')).toMatch(/tz|time zone/i);
        }
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });
});
