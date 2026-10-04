/**
 * 0.11, ledger row D7 — the ORDER of what qualifies a tool's text, beside the
 * position of each sentence (`cut-order.test.ts`): the verdict's qualifiers,
 * then the sentence counting the shown rows a read did not serve, then the
 * tool's own notes in the order they used to follow the body; the body after
 * them all. Also the standings list's truncation note (a list of tables can
 * be longer than the cut), and the one list text no cut reaches
 * (`fixtures://`), whose truncation line stays after its rows.
 */
import { attachFetchMeta, EspnAdapter, type GroupStandings, type MarketProvider, type Match, type ProviderAdapter, type StandingRow } from '@claudinho/core';
import { describe, expect, it } from 'vitest';
import { listTruncation, MAX_LIST_MATCHES, matchList, matchRows } from '../src/format';
import { toContent } from '../src/server';
import { toolGetMatch, toolGetStandings, toolGetToday } from '../src/tools';

const WC_SEASON = { year: 2026, startDate: '2026-06-11T04:00Z', endDate: '2026-12-31T04:59Z', displayName: '2026 FIFA World Cup' };
type Side = { id: string; abbr: string; name: string };
type Ev = { id: string; date: string; home: Side; away: Side; state?: 'pre' | 'in'; raw?: Record<string, unknown> };
const MEX: Side = { id: '203', abbr: 'MEX', name: 'Mexico' };
const RSA: Side = { id: '467', abbr: 'RSA', name: 'South Africa' };
const KOR: Side = { id: '451', abbr: 'KOR', name: 'South Korea' };
const CZE: Side = { id: '478', abbr: 'CZE', name: 'Czechia' };
function event(e: Ev) {
  const state = e.state ?? 'pre';
  const type = state === 'in' ? { name: 'STATUS_IN_PROGRESS', state: 'in' } : { name: 'STATUS_SCHEDULED', state: 'pre' };
  const side = (s: Side, homeAway: string) => ({ homeAway, score: '0', team: { id: s.id, abbreviation: s.abbr, displayName: s.name } });
  return { id: e.id, date: e.date, season: { slug: 'group-stage' }, status: { type, displayClock: state === 'in' ? "55'" : undefined, period: state === 'in' ? 2 : 0 }, competitions: [{ competitors: [side(e.home, 'home'), side(e.away, 'away')] }], ...e.raw };
}
/** A record the parser refuses (no status it knows). */
const REFUSED = { status: { type: { name: 'STATUS_NEW', state: 'limbo' } } };
const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const easternDay = (iso: string) => eastern.format(new Date(iso)).replace(/-/g, '');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function feed(opts: { events?: Ev[]; fail?: boolean } = {}) {
  const events = opts.events ?? [];
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    if (url.includes('/standings')) return json({});
    if (opts.fail) return json({ code: 503 }, 503);
    const asked = new URL(url).searchParams.get('dates') ?? '';
    const inBucket = (e: Ev) => (asked.length === 8 ? easternDay(e.date) === asked : asked.length === 6 ? easternDay(e.date).startsWith(asked) : false);
    return json({ leagues: [{ season: WC_SEASON }], events: events.filter(inBucket).map(event) });
  }) as unknown as typeof fetch;
  return new EspnAdapter({ competition: 'fifa.world', enrichGroups: false, fetchImpl }) as ProviderAdapter;
}
const OPENER: Ev = { id: '760415', date: '2026-06-11T19:00Z', home: MEX, away: RSA };
const NOW = new Date('2026-06-11T20:00:00Z');
/** A market provider whose batch never finishes: every surface must say so. */
const unfinished = { name: 'dead', findSignal: async () => undefined, findSignals: async () => ({ results: new Map(), complete: false }) } as unknown as MarketProvider;
/** Where each needle is, in order: every one present, each after the one before. */
function inOrder(text: string, needles: Array<string | RegExp>) {
  const at = needles.map((n) => {
    const i = typeof n === 'string' ? text.indexOf(n) : text.search(n);
    expect(i, `${String(n)} in:\n${text.slice(0, 900)}`).toBeGreaterThanOrEqual(0);
    return i;
  });
  for (let k = 1; k < at.length; k++) expect(at[k], `${String(needles[k - 1])} before ${String(needles[k])}`).toBeGreaterThan(at[k - 1] as number);
}

describe('get_today: the verdict, the unserved count, the truncation, the markets, then the rows (D7)', () => {
  it('all four on one answer, in that order, and the body after them', async () => {
    // The bundled opener's record is refused (the read is not whole, and the opener shown is the bundle's
    // row: the unserved sentence); a served match in play and 41 more served rows overflow the list.
    const second: Ev = { id: '760414', date: '2026-06-11T22:00Z', home: KOR, away: CZE, state: 'in' };
    const rows: Ev[] = Array.from({ length: 41 }, (_, i) => ({ id: String(9_100_000 + i), date: '2026-06-11T23:00Z', home: { id: String(300 + i), abbr: 'AAA', name: 'Home side' }, away: { id: String(400 + i), abbr: 'BBB', name: 'Away side' } }));
    const r = await toolGetToday({ date: '2026-06-11', tz: 'UTC', adapter: feed({ events: [{ ...OPENER, raw: REFUSED }, second, ...rows] }), marketProvider: unfinished, now: NOW } as never);
    inOrder(r.text, [/Fixture data may be incomplete/, /1 fixture .*bundled schedule/, 'list truncated', 'Market data unavailable or incomplete', 'Matches on 2026-06-11:', 'Mexico']);
    // Nothing but the footer after the rows.
    const last = r.text.slice(r.text.lastIndexOf('\n• ') + 1);
    expect(last.slice(last.indexOf('\n'))).toBe(r.footer);
  });

  it('the outage, then the markets, then the rows', async () => {
    const r = await toolGetToday({ date: '2026-06-11', tz: 'UTC', adapter: feed({ fail: true }), marketProvider: unfinished, now: NOW } as never);
    inOrder(r.text, ['showing the bundled schedule', 'Market data unavailable or incomplete', 'Matches on 2026-06-11:', 'Mexico']);
  });

  it('a whole, healthy day is what it always was: the header, the rows, the footer', async () => {
    const r = await toolGetToday({ date: '2026-06-11', tz: 'UTC', adapter: feed({ events: [OPENER] }) });
    // The mode line first (0.11 · 2.5a: every answer names its competition), then what it always was.
    const [mode, head, line, ...rest] = r.text.split('\n');
    expect(mode).toBe('World Cup');
    expect(head).toBe('Matches on 2026-06-11:');
    expect(line?.startsWith('• 🇲🇽 Mexico')).toBe(true);
    expect(`\n${rest.join('\n')}`).toBe(r.footer);
  });
});

describe('get_match: the outage before the markets, both before the match (D7)', () => {
  it('a degraded match whose market batch did not finish', async () => {
    const r = await toolGetMatch({ id: '760415', adapter: feed({ fail: true }), marketProvider: unfinished, now: NOW } as never);
    inOrder(r.text, ['Live state unavailable', 'Market data unavailable or incomplete', 'Mexico']);
  });
});

describe('get_standings: the verdict, then the list’s truncation, before the tables; kept by a cut (D7)', () => {
  const row = (i: number, rank: number): StandingRow =>
    ({ team: { code: 'TTT', name: `Team number ${i}-${rank} with a long enough name`, flag: '🏳️' }, played: 3, won: 1, drawn: 1, lost: 1, goalsFor: 3, goalsAgainst: 3, goalDiff: 0, points: 4, rank }) as StandingRow;
  /** 41 tables of 20 rows (past the record bound, and past the text cut), and one the provider sent that was not read. */
  const tables: GroupStandings[] = Array.from({ length: 41 }, (_, i) => ({
    group: `A${i + 1}`,
    label: `League ${i + 1}`,
    rows: Array.from({ length: 20 }, (_, k) => row(i, k + 1)),
  }));
  const adapter: ProviderAdapter = {
    name: 'espn',
    competition: 'uefa.nations',
    capabilities: { push: false, latencyHintSec: 0 },
    fetchByDate: async () => [],
    fetchLive: async () => [],
    fetchStandings: async () => attachFetchMeta([...tables], { complete: true, inventoryComplete: false }),
  };

  it('the order, and what a cut keeps', async () => {
    const r = await toolGetStandings({ competition: 'uefa.nations', adapter } as never);
    inOrder(r.text, ['(Some tables could not be read', '(showing 40 of 41 — list truncated)', 'League 1 (A1)']);
    // The truncation note is its own line, not the tail of the last table.
    expect(r.text).not.toMatch(/Team number 39-20[^\n]*\n\(showing/);
    const cut = toContent(r).content[0]?.text ?? '';
    expect(cut).toContain('(truncated)');
    expect(cut).toContain('could not be read');
    expect(cut).toContain('list truncated');
    expect(cut).toMatch(/not affiliated/i);
  });
});

describe('the list helpers: rows, the truncation sentence, and the list a cut never reaches (D7)', () => {
  const m = (i: number): Match => ({
    id: String(i),
    stage: 'GROUP',
    group: 'A',
    kickoff: '2026-06-11T19:00:00Z',
    venue: 'Estadio Azteca',
    city: 'Mexico City',
    country: 'Mexico',
    home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
    away: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' },
    status: 'SCHEDULED',
    updatedAt: '2026-06-08T00:00:00Z',
  });
  const over = Array.from({ length: MAX_LIST_MATCHES + 2 }, (_, i) => m(i));
  const fits = over.slice(0, MAX_LIST_MATCHES);

  it('the sentence, in the words the list always used', () => {
    expect(listTruncation(over)).toBe('(list truncated — 2 more not shown)');
    expect(listTruncation(fits)).toBeUndefined();
  });

  it('the rows say nothing about what they did not show; the list says it after them (fixtures://)', () => {
    expect(matchRows(over, 'none')).not.toContain('truncated');
    expect(matchRows(over, 'none').split('\n')).toHaveLength(MAX_LIST_MATCHES);
    expect(matchList(over, 'none')).toBe(`${matchRows(over, 'none')}\n• (list truncated — 2 more not shown)`);
    expect(matchList(fits, 'none')).toBe(matchRows(fits, 'none'));
    expect(matchList([], 'none')).toBe('none');
  });
});
