/**
 * The countdown in a tool's text is relative to the REQUEST's clock (`now`),
 * the one every other read of the request takes, never the wall clock.
 *
 * Measured on Oct 10, 2026: `get_next_fixture` with `now` six days before a
 * kickoff said "(now)" once the wall clock passed the kickoff, while the dated
 * read, discovery's span and the fixture's state all answered for `now`. The
 * kickoff below has passed on every wall clock that runs this file; the phrase
 * is pinned to the request's clock: five days, twenty hours and forty minutes.
 */
import { EspnAdapter, type Match, type ProviderAdapter } from '@claudinho/core';
import { describe, expect, it } from 'vitest';
import { toolGetMatch, toolGetNextFixture, toolGetShareSnippet, toolGetToday } from '../src/tools';

const REQUEST_CLOCK = new Date('2026-10-04T14:50:00.000Z');
const KICKOFF = '2026-10-10T11:30:00.000Z';
const fixture: Match = {
  id: '800000730',
  stage: 'REGULAR',
  kickoff: KICKOFF,
  venue: 'Emirates Stadium',
  home: { code: 'ARS', name: 'Arsenal', id: 'espn:359' },
  away: { code: 'LEE', name: 'Leeds United', id: 'espn:357' },
  status: 'SCHEDULED',
  updatedAt: REQUEST_CLOCK.toISOString(),
};
function adapter(matches: Match[]): ProviderAdapter {
  return {
    name: 'espn',
    competition: 'eng.1',
    capabilities: { push: false, latencyHintSec: 0 },
    async fetchByDate() {
      return matches;
    },
    async fetchLive() {
      return [];
    },
    async fetchWindow() {
      return matches;
    },
  };
}
const EXPECTED = '(in 5d20h)';

describe("a tool's countdown is relative to the request's clock, not the wall clock", () => {
  it('get_next_fixture: the next fixture says "in 5d20h" for a kickoff the wall clock has passed', async () => {
    const r = await toolGetNextFixture({ team: 'Arsenal', competition: 'eng.1', adapter: adapter([fixture]), now: REQUEST_CLOCK, lang: 'en', flavor: 'off' });
    expect(r.text).toContain(EXPECTED);
  });

  it('get_match: the one match says "in 5d20h" for a kickoff the wall clock has passed', async () => {
    const r = await toolGetMatch({ id: fixture.id, competition: 'eng.1', adapter: adapter([fixture]), now: REQUEST_CLOCK, lang: 'en', flavor: 'off' });
    expect(r.text).toContain(EXPECTED);
  });

  it("get_today: the day's list says \"in 5d20h\" for a kickoff the wall clock has passed", async () => {
    const r = await toolGetToday({ date: '2026-10-10', tz: 'UTC', competition: 'eng.1', adapter: adapter([fixture]), now: REQUEST_CLOCK, lang: 'en', flavor: 'off' });
    expect(r.text).toContain(EXPECTED);
  });
});

/**
 * A request that carries NO clock takes the adapter's read clock (core's
 * `clockOf`: the one a test injects, the wall clock in production), for the
 * read AND the rendering: one instant per request. The adapter clock below is
 * Sep 20, 2026, a day every wall clock has left behind, so a lookup or a
 * countdown that reads the wall clock answers for the wrong span on every day
 * this file runs. (The bump's fix had `get_match` default an absent clock to
 * the wall clock BEFORE the lookup, which CLI `match` and `get_share_snippet`
 * never did: a test green only on the day the two clocks agreed.)
 */
const ADAPTER_CLOCK = new Date('2026-09-20T15:00:00.000Z');
const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const easternDay = (iso: string) => eastern.format(new Date(iso)).replace(/-/g, '');
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
type Ev = { id: string; date: string };
function feed(events: Ev[]): ProviderAdapter {
  const side = (homeAway: string, id: string, abbreviation: string, displayName: string) => ({ homeAway, score: '0', team: { id, abbreviation, displayName } });
  const event = (e: Ev) => ({
    id: e.id,
    date: e.date,
    season: { slug: 'regular-season' },
    status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
    competitions: [{ competitors: [side('home', '364', 'LIV', 'Liverpool'), side('away', '359', 'ARS', 'Arsenal')] }],
  });
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    if (url.includes('/standings')) return json({ name: 'x', season: { year: 2026 } });
    const asked = new URL(url).searchParams.get('dates') ?? '';
    const held = (e: Ev) => (asked.length === 8 ? easternDay(e.date) === asked : asked.length === 6 ? easternDay(e.date).startsWith(asked) : false);
    return json({ leagues: [{ season: { year: 2026, displayName: '2026-27 English Premier League' } }], events: events.filter(held).map(event) });
  }) as unknown as typeof fetch;
  return new EspnAdapter({ competition: 'eng.1', fetchImpl, now: () => ADAPTER_CLOCK.getTime() }) as ProviderAdapter;
}
const IN_SPAN: Ev = { id: '41', date: '2026-09-27T14:00:00Z' }; // Sep 20 15:00Z to Sep 27 14:00Z: six days and twenty-three hours
const OTHER: Ev = { id: '42', date: '2026-09-21T15:00:00Z' };

describe("a request that carries no clock takes the adapter's read clock, for the lookup and the countdown alike", () => {
  it("get_match: the match is found in the adapter clock's span and its countdown counts from that clock", async () => {
    const r = await toolGetMatch({ id: '41', competition: 'eng.1', adapter: feed([IN_SPAN, OTHER]), lang: 'en', flavor: 'off' });
    expect(r.data).toMatchObject({ match: { id: '41' } });
    expect(r.text).toContain('(in 6d23h)');
  });

  it("get_match, not found: the window it names is the adapter clock's span", async () => {
    const r = await toolGetMatch({ id: '41', competition: 'eng.1', adapter: feed([OTHER]), lang: 'en', flavor: 'off' });
    expect(r.data).toMatchObject({ match: null, window: { from: '2026-09-19', to: '2026-10-04' } });
  });

  it("get_share_snippet by match id: the card finds the match in the adapter clock's span", async () => {
    const r = await toolGetShareSnippet({ matchId: '41', competition: 'eng.1', adapter: feed([IN_SPAN, OTHER]), lang: 'en' });
    expect(r.text).toContain('Liverpool');
    expect(r.text).toContain('Arsenal');
  });
});
