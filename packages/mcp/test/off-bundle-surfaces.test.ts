/**
 * 0.11 PR 2.1c — the MCP surfaces off the bundle: `get_next_fixture` with a club
 * name or code, `get_match`, `get_bracket`, `get_today`, `get_live`, the share
 * cards; `data` (against the declared schema, strictly) and text.
 *
 * The adapter is the real one over a fake feed; see the CLI twin for the shape.
 */
import { describe, expect, it } from 'vitest';
import { EspnAdapter, type ProviderAdapter } from '@claudinho/core';
import { z } from 'zod/v3';
import { clubArg, INSTRUCTIONS, OUTPUT_SCHEMAS, teamArg } from '../src/server';
import {
  toolGetBracket,
  toolGetLive,
  toolGetMarketSignal,
  toolGetMatch,
  toolGetNextFixture,
  toolGetShareSnippet,
  toolGetToday,
} from '../src/tools';

const STATS = ['gamesPlayed', 'wins', 'ties', 'losses', 'pointsFor', 'pointsAgainst', 'pointDifferential', 'points', 'rank'];
const NOW = new Date('2026-10-10T15:00:00.000Z');
type Season = { year: number; displayName: string; startDate?: string; endDate?: string };
const S2026: Season = { year: 2026, displayName: '2026-27 English Premier League', startDate: '2026-08-01T04:00Z', endDate: '2027-05-30T03:59Z' };
const ENDED: Season = { year: 2026, displayName: '2026 Concacaf Champions Cup', startDate: '2026-02-01T05:00Z', endDate: '2026-10-09T03:59Z' };
type Side = { id?: string; abbr: string; name: string };
type Ev = { id: string; date: string; home: Side; away: Side; state?: 'pre' | 'in' | 'post'; raw?: Record<string, unknown> };
const ARS: Side = { id: '359', abbr: 'ARS', name: 'Arsenal' };
const CHE: Side = { id: '363', abbr: 'CHE', name: 'Chelsea' };
const LIV: Side = { id: '364', abbr: 'LIV', name: 'Liverpool' };
const CARABOBO: Side = { id: '7001', abbr: 'CAR', name: 'Carabobo' };
const ALWAYS_READY: Side = { id: '7002', abbr: 'CAR', name: 'Always Ready' };
function event(e: Ev) {
  const state = e.state ?? 'pre';
  const type = state === 'in' ? { name: 'STATUS_IN_PROGRESS', state: 'in' } : state === 'post' ? { name: 'STATUS_FULL_TIME', state: 'post' } : { name: 'STATUS_SCHEDULED', state: 'pre' };
  const side = (s: Side, homeAway: string, score: string) => ({ homeAway, score, team: { ...(s.id ? { id: s.id } : {}), abbreviation: s.abbr, displayName: s.name } });
  return { id: e.id, date: e.date, season: { slug: 'regular-season' }, status: { type, displayClock: state === 'in' ? "55'" : undefined, period: state === 'in' ? 2 : 0 }, competitions: [{ competitors: [side(e.home, 'home', '1'), side(e.away, 'away', '0')] }], ...e.raw };
}
function table(name: string, sides: Side[]) {
  return { children: [{ name, standings: { entries: sides.map((s, i) => ({ team: { ...(s.id ? { id: s.id } : {}), abbreviation: s.abbr, displayName: s.name }, stats: STATS.map((n) => ({ name: n, value: n === 'rank' ? i + 1 : 0 })) })) } }] };
}
const PL_TABLE = table('2026-27 English Premier League', [ARS, CHE, LIV]);
const NO_TABLE = { name: 'Concacaf Champions Cup', season: { year: 2026 }, seasons: [{ year: 2016 }] };
const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const easternDay = (iso: string) => eastern.format(new Date(iso)).replace(/-/g, '');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
interface FeedOpts { events?: Ev[]; season?: (dates: string) => Season | undefined; standings?: unknown; fail?: (dates: string) => Response | undefined }
function feed(competition: string, opts: FeedOpts = {}) {
  const urls: string[] = [];
  const events = opts.events ?? [];
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('/standings')) return json(opts.standings ?? PL_TABLE);
    const asked = new URL(url).searchParams.get('dates') ?? '';
    const failure = opts.fail?.(asked);
    if (failure) return failure;
    if (asked.includes('-')) return json({ code: 400 }, 400);
    const season = opts.season ? opts.season(asked) : S2026;
    const inBucket = (e: Ev) => (asked.length === 8 ? easternDay(e.date) === asked : asked.length === 6 ? easternDay(e.date).startsWith(asked) : false);
    return json({ leagues: [{ season }], events: events.filter(inBucket).map(event) });
  }) as unknown as typeof fetch;
  return { adapter: new EspnAdapter({ competition, fetchImpl, now: () => NOW.getTime() }) as ProviderAdapter, urls };
}
const strict = (tool: keyof typeof OUTPUT_SCHEMAS, data: unknown) => {
  const res = z.object(OUTPUT_SCHEMAS[tool]).strict().safeParse(data);
  expect(res.success, `${tool}: ${res.success ? '' : JSON.stringify(res.error.issues)}`).toBe(true);
};
const upcoming: Ev[] = [
  { id: '11', date: '2026-10-17T14:00Z', home: LIV, away: ARS },
  { id: '13', date: '2026-10-11T15:00Z', home: CHE, away: LIV },
];
const NOT_YET = 'Not available for this competition yet';

describe('get_next_fixture off the bundle (0.11 2.1c)', () => {
  it('takes a code or a name: the fixture in data and text, attributed, the resolved team in data; the schema holds', async () => {
    for (const team of ['ARS', 'Arsenal', 'arsen']) {
      const r = await toolGetNextFixture({ team, now: NOW, adapter: feed('eng.1', { events: upcoming }).adapter });
      expect(r.text, team).toContain('Liverpool');
      expect(r.text, team).not.toContain(NOT_YET);
      expect(r.data, team).toMatchObject({ degraded: false, fixture: { id: '11' }, team: { id: 'espn:359', name: 'Arsenal' } });
      strict('get_next_fixture', r.data);
    }
  });

  it('the input takes a bounded label (a code or a name); the market tool keeps the code', () => {
    expect(clubArg.safeParse('Ars\u200benal').success).toBe(false); // an invisible character is not a label
    // Review round 3: a control or invisible character at either END is refused too (trimming must not hide it:
    // the raw argument reaches the run cue and the my_team prompt).
    for (const bad of ['\nArsenal', 'Arsenal\r', '\uFEFFArsenal', 'Arsenal\uFEFF', '\tArsenal', 'Ars\n\n', '\u2028Arsenal']) {
      expect(clubArg.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(clubArg.safeParse(' Arsenal ').success).toBe(true); // ordinary spaces at the ends are a label
    expect(clubArg.safeParse('Arsenal').success).toBe(true);
    expect(clubArg.safeParse('O&M').success).toBe(true);
    expect(clubArg.safeParse('ARS').success).toBe(true);
    expect(clubArg.safeParse('x'.repeat(41)).success).toBe(false);
    expect(clubArg.safeParse('').success).toBe(false);
    expect(clubArg.safeParse('Ars\u0007enal').success).toBe(false);
    expect(teamArg.safeParse('Arsenal').success).toBe(false);
  });

  it('two clubs with one code: the candidates in data and text, no fixture', async () => {
    const LIB = table('Group A', [CARABOBO, ALWAYS_READY]);
    const events: Ev[] = [{ id: '20', date: '2026-10-12T22:00Z', home: ALWAYS_READY, away: { id: '7003', abbr: 'BOC', name: 'Boca Juniors' } }];
    const season = () => ({ year: 2026, displayName: '2026 Copa Libertadores', endDate: '2026-11-30T05:00Z' });
    const r = await toolGetNextFixture({ team: 'CAR', now: NOW, adapter: feed('conmebol.libertadores', { events, standings: LIB, season }).adapter });
    expect(r.text).toContain('Carabobo');
    expect(r.text).toContain('Always Ready');
    expect(r.text).not.toContain('Boca');
    expect((r.data as { candidates: Array<{ name: string }> }).candidates.map((c) => c.name).sort()).toEqual(['Always Ready', 'Carabobo']);
    expect((r.data as { fixture: unknown }).fixture).toBeNull();
    strict('get_next_fixture', r.data);
    const one = await toolGetNextFixture({ team: 'Carabobo', now: NOW, adapter: feed('conmebol.libertadores', { events: [{ id: '21', date: '2026-10-15T22:00Z', home: ALWAYS_READY, away: CARABOBO }], standings: LIB, season }).adapter });
    expect(one.data).toMatchObject({ fixture: { id: '21' }, team: { id: 'espn:7001' } });
  });

  it('unknown (a complete roster), the horizon (a whole span), partial (an incomplete one), degraded (a failed one): each its own answer, text and data', async () => {
    const unknown = await toolGetNextFixture({ team: 'Everton', now: NOW, adapter: feed('eng.1', { events: upcoming }).adapter });
    expect(unknown.text).toContain('No team called');
    expect(unknown.data).toMatchObject({ unknownTeam: true, fixture: null });
    strict('get_next_fixture', unknown.data);
    const horizon = await toolGetNextFixture({ team: 'Arsenal', now: NOW, adapter: feed('eng.1', { events: [upcoming[1] as Ev] }).adapter });
    expect(horizon.text).toContain('14 days');
    expect(horizon.data).toMatchObject({ fixture: null, horizon: { days: 14 }, degraded: false });
    expect((horizon.data as { unknownTeam?: unknown }).unknownTeam).toBeUndefined();
    strict('get_next_fixture', horizon.data);
    const broken: Ev = { id: '16', date: '2026-10-14T19:00Z', home: CHE, away: LIV, raw: { status: { type: { name: 'STATUS_NEW', state: 'limbo' } } } };
    const partial = await toolGetNextFixture({ team: 'Arsenal', now: NOW, adapter: feed('eng.1', { events: [broken, upcoming[1] as Ev] }).adapter });
    expect(partial.text).toContain('may be incomplete');
    expect(partial.text).not.toContain('14 days');
    expect(partial.data).toMatchObject({ fixture: null, partial: { omitted: 1 } });
    expect((partial.data as { horizon?: unknown }).horizon).toBeUndefined();
    strict('get_next_fixture', partial.data);
    const degraded = await toolGetNextFixture({ team: 'Arsenal', now: NOW, adapter: feed('eng.1', { events: upcoming, fail: () => json({}, 503) }).adapter });
    expect(degraded.data).toMatchObject({ degraded: true, fixture: null });
    expect(degraded.text).not.toContain('14 days');
    strict('get_next_fixture', degraded.data);
  });

  it('the server instructions no longer send an agent to get_team for a club; get_team says it is the World Cup roster', () => {
    expect(INSTRUCTIONS).not.toMatch(/call get_team FIRST/);
    expect(INSTRUCTIONS).toMatch(/club|competition/i);
  });
});

describe('get_match off the bundle (0.11 2.1c)', () => {
  const inSpan: Ev = { id: '41', date: '2026-10-17T14:00Z', home: LIV, away: ARS };
  const other: Ev = { id: '42', date: '2026-10-11T15:00Z', home: CHE, away: LIV };

  it('found, not found in the window, failed discovery, failed refresh: text and data, the schema holds', async () => {
    const found = await toolGetMatch({ id: '41', adapter: feed('eng.1', { events: [inSpan, other] }).adapter });
    expect(found.text).toContain('Arsenal');
    expect(found.data).toMatchObject({ degraded: false, match: { id: '41' }, source: 'espn' });
    strict('get_match', found.data);
    const notFound = await toolGetMatch({ id: '41', adapter: feed('eng.1', { events: [other] }).adapter });
    expect(notFound.text).toContain('2026-10-24');
    expect(notFound.text).not.toContain('No match found');
    expect(notFound.data).toMatchObject({ match: null, degraded: false, window: { from: '2026-10-09', to: '2026-10-24' } });
    strict('get_match', notFound.data);
    const failed = await toolGetMatch({ id: '41', adapter: feed('eng.1', { events: [inSpan], fail: () => json({}, 503) }).adapter });
    expect(failed.text).not.toContain('No match found');
    expect(failed.text).not.toContain('2026-10-24');
    expect(failed.data).toMatchObject({ degraded: true, match: null });
    strict('get_match', failed.data);
    const stale = await toolGetMatch({ id: '41', adapter: feed('eng.1', { events: [inSpan, other], fail: (d) => (d.length === 8 ? json({}, 503) : undefined) }).adapter });
    expect(stale.text).toContain('Arsenal');
    expect(stale.text).not.toContain('bundled');
    expect(stale.data).toMatchObject({ degraded: true, match: { id: '41' }, source: 'espn' });
    strict('get_match', stale.data);
  });

  it('the share card after a failed refresh says the provider’s earlier record, never "the bundled schedule"; an incomplete empty read says "none read" (review round 1)', async () => {
    const stale = await toolGetShareSnippet({ matchId: '41', adapter: feed('eng.1', { events: [inSpan, other], fail: (d) => (d.length === 8 ? json({}, 503) : undefined) }).adapter });
    expect(stale.text).toContain('Arsenal');
    expect(stale.text).not.toContain('bundled schedule');
    expect(stale.text).toContain('earlier record');
    strict('get_share_snippet', stale.data);
    const broken: Ev = { id: '45', date: '2026-10-14T19:00Z', home: CHE, away: LIV, raw: { status: { type: { name: 'STATUS_NEW', state: 'limbo' } } } };
    const none = await toolGetMatch({ id: '41', adapter: feed('eng.1', { events: [broken, other] }).adapter });
    expect(none.text).toContain('may be incomplete');
    expect(none.text).not.toContain('No match found');
    const noneNext = await toolGetNextFixture({ team: 'Arsenal', now: NOW, adapter: feed('eng.1', { events: [broken, upcoming[1] as Ev] }).adapter });
    expect(noneNext.text).toContain('may be incomplete');
    expect(noneNext.text).not.toContain('No upcoming fixture');
  });

  it('get_share_snippet carries the resolved team and the candidates in data (review round 1)', async () => {
    const resolved = await toolGetShareSnippet({ team: 'arsen', now: NOW, adapter: feed('eng.1', { events: [upcoming[1] as Ev] }).adapter });
    expect(resolved.data).toMatchObject({ team: { id: 'espn:359', name: 'Arsenal' }, horizon: { days: 14 } });
    strict('get_share_snippet', resolved.data);
    const LIB = table('Group A', [CARABOBO, ALWAYS_READY]);
    const events: Ev[] = [{ id: '20', date: '2026-10-12T22:00Z', home: ALWAYS_READY, away: { id: '7003', abbr: 'BOC', name: 'Boca Juniors' } }];
    const season = () => ({ year: 2026, displayName: '2026 Copa Libertadores', endDate: '2026-11-30T05:00Z' });
    const amb = await toolGetShareSnippet({ team: 'CAR', now: NOW, adapter: feed('conmebol.libertadores', { events, standings: LIB, season }).adapter });
    expect((amb.data as { candidates: Array<{ name: string }> }).candidates.map((c) => c.name).sort()).toEqual(['Always Ready', 'Carabobo']);
    strict('get_share_snippet', amb.data);
  });

  it('on the World Cup, get_share_snippet resolves a nation name the way get_next_fixture does: an ambiguous name is the candidates and no request (review round 1)', async () => {
    const f = feed('fifa.world');
    const r = await toolGetShareSnippet({ team: 'South', now: new Date('2026-06-13T12:00:00Z'), adapter: f.adapter });
    expect(r.text).toContain('South Africa');
    expect(r.text).toContain('South Korea');
    expect(r.text).not.toContain('SOUTH');
    expect(f.urls).toEqual([]);
    expect((r.data as { candidates: Array<{ code: string }> }).candidates.map((c) => c.code).sort()).toEqual(['KOR', 'RSA']);
    strict('get_share_snippet', r.data);
    const unknown = await toolGetShareSnippet({ team: 'Narnia', now: new Date('2026-06-13T12:00:00Z'), adapter: feed('fifa.world').adapter });
    expect(unknown.text).not.toContain('NARNIA');
    expect(unknown.text).toMatch(/No team/);
  });

  it('found, the refresh not whole: the partial sentence beside the record in text, the key in data (review round 2)', async () => {
    const broken: Ev = { id: '43', date: '2026-10-17T16:00Z', home: CHE, away: LIV, raw: { status: { type: { name: 'STATUS_NEW', state: 'limbo' } } } };
    const r = await toolGetMatch({ id: '41', adapter: feed('eng.1', { events: [inSpan, broken] }).adapter });
    expect(r.text).toContain('Arsenal');
    expect(r.text).toContain('may be incomplete');
    expect(r.data).toMatchObject({ match: { id: '41' }, partial: { omitted: 1 } });
    strict('get_match', r.data);
  });

  it('a roster that could not be read whole is its own verdict in data and text, not an outage (review round 2)', async () => {
    const r = await toolGetNextFixture({ team: 'ARS', now: NOW, adapter: feed('eng.1', { events: upcoming, standings: () => json({}, 503) }).adapter });
    expect(r.text).not.toContain('reach the data provider');
    expect(r.text).toMatch(/roster/i);
    expect(r.data).toMatchObject({ rosterIncomplete: true, degraded: false });
    strict('get_next_fixture', r.data);
  });

  it('the share cards’ run cue carries the competition off the bundle (review round 2)', async () => {
    const r = await toolGetShareSnippet({ team: 'Arsenal', now: NOW, adapter: feed('eng.1', { events: upcoming }).adapter });
    expect(r.text).toMatch(/CLAUDINHO_COMPETITION=eng\.1 npx @claudinho\/cli next/);
  });

  it('the handlers never carry a raw argument into a card or a prompt: the run cue holds the bounded label (review round 3)', async () => {
    // Below the schema (a direct call), a query with a trailing newline reaches the handler; the cue must not split.
    const r = await toolGetShareSnippet({ team: 'Ars\n\n', now: NOW, adapter: feed('eng.1', { events: upcoming }).adapter });
    const cue = r.text.split('\n').find((line) => line.includes('@claudinho/cli next')) ?? '';
    expect(cue).toMatch(/next "?Ars"?$/);
    expect(r.text).not.toContain('Ars\n\n');
    expect(r.footer.trim().length).toBeGreaterThan(20);
    expect(r.text.endsWith(r.footer)).toBe(true);
    // The next tool the same: the query it names is the bounded label.
    const n = await toolGetNextFixture({ team: 'Everton\n\n', now: NOW, adapter: feed('eng.1', { events: upcoming }).adapter });
    expect(n.text).not.toContain('Everton\n\n');
    expect(n.text).toContain('No team called Everton');
    expect(JSON.stringify(n.data)).not.toContain('\\n');
  });

  it('on the World Cup, get_next_fixture carries the candidates of an ambiguous name in data (review round 2)', async () => {
    const f = feed('fifa.world');
    const r = await toolGetNextFixture({ team: 'South', now: new Date('2026-06-13T12:00:00Z'), adapter: f.adapter });
    expect((r.data as { candidates: Array<{ code: string }> }).candidates.map((c) => c.code).sort()).toEqual(['KOR', 'RSA']);
    expect(f.urls).toEqual([]);
    strict('get_next_fixture', r.data);
  });

  it('on the World Cup an unknown nation’s sentence names the bundled roster, not a table or a span (review round 5)', async () => {
    const f = feed('fifa.world');
    const r = await toolGetNextFixture({ team: 'Italy', now: new Date('2026-06-13T12:00:00Z'), adapter: f.adapter });
    expect(r.text).toMatch(/No team called Italy/);
    expect(r.text).not.toContain('14 days');
    expect(r.text).not.toContain('table');
    expect(r.data).toMatchObject({ unknownTeam: true, rosterEvidence: 'bundle' });
    expect(f.urls).toEqual([]);
    strict('get_next_fixture', r.data);
    const card = await toolGetShareSnippet({ team: 'Italy', now: new Date('2026-06-13T12:00:00Z'), adapter: feed('fifa.world').adapter });
    expect(card.text).not.toContain('14 days');
    strict('get_share_snippet', card.data);
  });

  it('get_market_signal by id stays unsupported off the bundle, with no request', async () => {
    const f = feed('eng.1', { events: [inSpan, other] });
    const r = await toolGetMarketSignal({ matchId: '41', adapter: f.adapter });
    expect(r.text).toContain(NOT_YET);
    expect(f.urls).toEqual([]);
  });
});

describe('get_bracket off the bundle: three values (0.11 2.1c)', () => {
  it('a league with no bracket: inapplicable in data and the sentence in text; the share card too; a cup stays unsupported', async () => {
    const f = feed('eng.1');
    const r = await toolGetBracket({ adapter: f.adapter });
    expect(r.text).toContain('no bracket');
    expect(r.text).not.toContain(NOT_YET);
    expect(r.data).toMatchObject({ inapplicable: true });
    expect((r.data as { unsupported?: unknown }).unsupported).toBeUndefined();
    expect(f.urls).toEqual([]);
    strict('get_bracket', r.data);
    const card = await toolGetShareSnippet({ bracket: true, adapter: feed('esp.1').adapter });
    expect(card.text).toContain('no bracket');
    expect(card.data).toMatchObject({ inapplicable: true });
    strict('get_share_snippet', card.data);
    for (const c of ['ita.1', 'ger.1', 'mex.1', 'uefa.champions']) {
      const cup = await toolGetBracket({ adapter: feed(c).adapter });
      expect(cup.text, c).toContain(NOT_YET);
      expect(cup.data, c).toMatchObject({ unsupported: true });
    }
  });
});

describe('between editions on MCP (0.11 2.1c)', () => {
  const cup = (events: Ev[] = []) => feed('concacaf.champions', { events, standings: NO_TABLE, season: () => ENDED }).adapter;
  const finalFT: Ev = { id: '50', date: '2026-10-09T02:00Z', home: { id: '8001', abbr: 'TOL', name: 'Toluca' }, away: { id: '8002', abbr: 'LAFC', name: 'Los Angeles FC' }, state: 'post' };
  const KEY = { ended: '2026-10-08', label: '2026 Concacaf Champions Cup' };

  it('get_today, get_live, get_next_fixture, get_match and the share cards say so, text and data, the schemas hold', async () => {
    const today = await toolGetToday({ date: '2026-10-10', adapter: cup([finalFT]) });
    expect(today.text).toContain('Between editions');
    expect(today.text).not.toContain('Toluca');
    expect(today.data).toMatchObject({ betweenEditions: KEY });
    strict('get_today', today.data);
    const live = await toolGetLive({ adapter: cup([finalFT]), now: NOW } as never);
    expect(live.text).toContain('Between editions');
    expect(live.data).toMatchObject({ betweenEditions: KEY });
    strict('get_live', live.data);
    const next = await toolGetNextFixture({ team: 'Toluca', now: NOW, adapter: cup([finalFT]) });
    expect(next.text).toContain('Between editions');
    expect(next.text).not.toContain('14 days');
    expect(next.data).toMatchObject({ fixture: null, betweenEditions: KEY });
    strict('get_next_fixture', next.data);
    const match = await toolGetMatch({ id: '99', adapter: cup([finalFT]) });
    expect(match.text).toContain('Between editions');
    expect(match.data).toMatchObject({ match: null, betweenEditions: KEY });
    strict('get_match', match.data);
    for (const args of [{ live: true }, { date: '2026-10-10' }, { team: 'Toluca' }]) {
      const card = await toolGetShareSnippet({ ...args, now: NOW, adapter: cup([finalFT]) } as never);
      expect(card.text, JSON.stringify(args)).toContain('Between editions');
      expect(card.data, JSON.stringify(args)).toMatchObject({ betweenEditions: KEY });
      strict('get_share_snippet', card.data);
    }
  });

  it('a historical date and a scheduled fixture: no sentence', async () => {
    const hist = await toolGetToday({ date: '2026-10-08', tz: 'America/New_York', adapter: cup([finalFT]) });
    expect(hist.text).toContain('Toluca');
    expect(hist.text).not.toContain('Between editions');
    const scheduled: Ev = { id: '51', date: '2026-10-14T02:00Z', home: { id: '8001', abbr: 'TOL', name: 'Toluca' }, away: { id: '8003', abbr: 'MTY', name: 'Monterrey' } };
    const next = await toolGetNextFixture({ team: 'Toluca', now: NOW, adapter: cup([finalFT, scheduled]) });
    expect(next.text).toContain('Monterrey');
    expect(next.text).not.toContain('Between editions');
  });

  it('a UTC viewer asking the final’s UTC date sees it (no key); the day after, the key', async () => {
    const utc9 = await toolGetToday({ date: '2026-10-09', tz: 'UTC', adapter: cup([finalFT]) });
    expect(utc9.text).toContain('Toluca');
    expect(utc9.text).not.toContain('Between editions');
    expect((utc9.data as { betweenEditions?: unknown }).betweenEditions).toBeUndefined();
    const utc10 = await toolGetToday({ date: '2026-10-10', tz: 'UTC', adapter: cup([finalFT]) });
    expect(utc10.text).toContain('Between editions');
    expect(utc10.data).toMatchObject({ betweenEditions: KEY });
  });

  it('localized (pt): the sentence is not English and names the label', async () => {
    const live = await toolGetLive({ adapter: cup([finalFT]), now: NOW, lang: 'pt' } as never);
    expect(live.text).not.toContain('Between editions');
    expect(live.text).toContain('2026 Concacaf Champions Cup');
  });
});
