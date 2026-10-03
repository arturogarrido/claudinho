/**
 * The canary's `discovery` question (0.11, ledger row D5), beside the cases in
 * `espn-canary.test.ts`: the states it does not reach. Each month is judged
 * by its OWN window on both paths (all served, or a sibling down), never by
 * discovery's aggregate; when a month and discovery's account disagree, the
 * month's finding stands; the row's detail says how many months were asked and
 * what discovery said of its answer. No network: every case injects a fetch.
 */
import { describe, expect, it } from 'vitest';
import { runCanary } from '../../../scripts/espn-canary.mjs';
import * as core from '../src';

const SEASON = { year: 2026, startDate: '2026-06-01T04:00Z', endDate: '2027-06-01T03:59Z', displayName: '2026-27 English Premier League' };
function event(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    date: '2026-10-10T11:30Z',
    season: { slug: 'regular-season' },
    status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
    competitions: [
      {
        competitors: [
          { homeAway: 'home', team: { id: '359', abbreviation: 'ARS', displayName: 'Arsenal' } },
          { homeAway: 'away', team: { id: '363', abbreviation: 'CHE', displayName: 'Chelsea' } },
        ],
      },
    ],
    ...over,
  };
}
const STATS = ['gamesPlayed', 'wins', 'ties', 'losses', 'pointsFor', 'pointsAgainst', 'pointDifferential', 'points', 'rank'];
const standings = {
  children: [
    {
      name: '2026-27 English Premier League',
      standings: { entries: [{ team: { id: '359', abbreviation: 'ARS', displayName: 'Arsenal' }, stats: STATS.map((n) => ({ name: n, value: n === 'rank' ? 1 : 0 })) }] },
    },
  ],
};
const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const providerDay = (iso: string) => eastern.format(new Date(iso)).replace(/-/g, '');
const asked = (url: string) => new URL(url).searchParams.get('dates') ?? '';
/** The events a request's `dates` holds, filed by the provider's day. */
const filed = <T extends { date: string }>(url: string, events: T[]) => {
  const dates = asked(url);
  return dates === '' ? events : events.filter((e) => providerDay(e.date).startsWith(dates) && (dates.length === 6 || providerDay(e.date) === dates));
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** A healthy feed but for the months `month` answers (undefined: healthy). */
const feedWith = (month: (dates: string) => Response | undefined) => async (input: unknown) => {
  const url = String(input);
  if (url.includes('/standings')) return json(standings);
  return month(asked(url)) ?? json({ leagues: [{ season: SEASON }], events: filed(url, [event('401878761')]) });
};
/** Oct 25: the span (Oct 24 to Nov 8) touches two months. */
const TWO = new Date('2026-10-25T12:00:00Z');
const ONE = new Date('2026-10-10T12:00:00Z');
const discoveryRow = async (fetchImpl: (input: unknown) => Promise<Response>, now: Date) => {
  const r = await runCanary({ core, competitions: ['eng.1'], fetchImpl: fetchImpl as typeof fetch, now, pauseMs: 0 });
  return { row: r.rows.find((x) => x.request === 'discovery'), red: r.red };
};
const REFUSED_RECORD = { status: { type: { name: 'STATUS_NEW', state: 'limbo' } } };

describe('a sibling month down: what WAS served is judged month by month, never through discovery’s aggregate', () => {
  it('a healthy month beside a month that was down is neutral, not red', async () => {
    const { row, red } = await discoveryRow(feedWith((d) => (d === '202611' ? json({}, 503) : undefined)), TWO);
    expect(row?.verdict).toBe('unreachable');
    expect(row?.detail).toMatch(/HTTP 503 \(202611, 1 of 2 requests\)/);
    expect(red).toBe(false);
  });

  it('a served month with no `events` list, beside a throttled month: the diagnosis names what is missing, and the month', async () => {
    const { row } = await discoveryRow(
      feedWith((d) => (d === '202610' ? json({ leagues: [{ season: SEASON }] }) : d === '202611' ? json({}, 429) : undefined)),
      TWO,
    );
    expect(row?.verdict).toBe('changed');
    expect(row?.detail).toMatch(/^the response has no `events` list \(202610, 1 of 2 requests\); another request was blocked/);
  });

  it('a month whose only records are refused, beside a month that was down: changed, naming the served month', async () => {
    const broken = event('9', { date: '2026-10-28T15:00Z', ...REFUSED_RECORD });
    const { row, red } = await discoveryRow(
      feedWith((d) => (d === '202610' ? json({ leagues: [{ season: SEASON }], events: [broken] }) : d === '202611' ? json({}, 503) : undefined)),
      TWO,
    );
    expect(row?.verdict).toBe('changed');
    expect(row?.detail).toMatch(/no readable records\) \(202610, 1 of 2 requests\)/);
    expect(row?.detail).toMatch(/another request was unreachable/);
    expect(red).toBe(true);
  });
});

describe('a month and discovery’s account disagree: the month’s finding stands', () => {
  it('a team without an id in a month: discovery calls itself whole (the parser takes an id as optional), the row is changed', async () => {
    const noId = event('7', { date: '2026-10-28T15:00Z' });
    (noId.competitions[0]?.competitors[0]?.team as { id?: string }).id = undefined;
    const { row } = await discoveryRow(feedWith((d) => (d === '202610' ? json({ leagues: [{ season: SEASON }], events: [noId] }) : undefined)), TWO);
    expect(row?.verdict).toBe('changed');
    expect(row?.detail).toMatch(/without an id \(first: Arsenal\) \(202610, 1 of 2 requests\)/);
    expect(row?.detail).toMatch(/discovery complete: true$/);
  });

  it('a month that states no season is changed, whatever discovery requires of the whole (nothing)', async () => {
    const { row } = await discoveryRow(feedWith((d) => (d === '202610' ? json({ leagues: [{}], events: [event('1')] }) : undefined)), ONE);
    expect(row?.verdict).toBe('changed');
    expect(row?.detail).toMatch(/no readable season \(202610\)/);
  });
});

describe('the row says how many months it asked and what discovery said of its answer', () => {
  it('healthy: the fixtures in the span, the requests, complete', async () => {
    const { row } = await discoveryRow(feedWith(() => undefined), ONE);
    expect(row).toMatchObject({ verdict: 'ok', requests: 1 });
    expect(row?.detail).toBe('1 fixture(s) in the span 2026-10-09 to 2026-10-24; requests: 1; discovery complete: true');
  });

  it('two months stating two seasons: ok, and the detail names both', async () => {
    const { row } = await discoveryRow(feedWith((d) => (d === '202611' ? json({ leagues: [{ season: { ...SEASON, year: 2027 } }], events: [] }) : undefined)), TWO);
    expect(row?.verdict).toBe('ok');
    expect(row?.detail).toMatch(/seasons 2026 and 2027; requests: 2; discovery complete: true$/);
  });

  it('a single month of refused records: discovery takes its degraded exit, and the row says so beside the month', async () => {
    const broken = event('9', { date: '2026-10-12T15:00Z', ...REFUSED_RECORD });
    const { row } = await discoveryRow(feedWith((d) => (d === '202610' ? json({ leagues: [{ season: SEASON }], events: [broken] }) : undefined)), ONE);
    expect(row?.verdict).toBe('changed');
    expect(row?.detail).toMatch(/no readable records\) \(202610\); requests: 1; discovery degraded$/);
  });

  it('a refused month: rejected, the month named, discovery degraded', async () => {
    const { row } = await discoveryRow(feedWith((d) => (d.length === 6 ? json({ code: 400, message: 'Failed to get events endpoint.' }, 400) : undefined)), ONE);
    expect(row?.verdict).toBe('rejected');
    expect(row?.detail).toBe('HTTP 400: Failed to get events endpoint. (202610); requests: 1; discovery degraded');
  });
});
