/**
 * 0.11 PR 2.6b — discovery: the schedule ahead, read once an hour.
 *
 * Off the World Cup the refresher has no schedule to tell it when a match can
 * be in play, so it polled around the clock. `getScheduleAhead` is the read
 * that gives it one: every fixture from yesterday to 14 days ahead, counted in
 * the provider's calendar days, asked a MONTH at a time (one request per month
 * the span touches; never a day request, never a range).
 *
 * Measured on the real feed (Oct 2 2026): a month is one request; a response
 * states the season of the dates asked, and the provider's season turns on
 * June 1, so two months can state two seasons. They are two windows, not one.
 *
 * The feed below buckets by US/Eastern day and refuses ranges, like the real one.
 */
import { describe, expect, it } from 'vitest';
import { EspnAdapter } from '../src/adapters/espn';
import { attachFetchMeta } from '../src/adapters/meta';
import { getLiveMatches, getLiveRead, getScheduleAhead, SCHEDULE_AHEAD_DAYS, SCHEDULE_LOOKBACK_DAYS } from '../src/live';
import type { ProviderAdapter } from '../src/adapters/types';

type Season = { year: number; displayName: string };
const S2025: Season = { year: 2025, displayName: '2025-26 Liga MX' };
const S2026: Season = { year: 2026, displayName: '2026-27 Liga MX' };

type State = 'pre' | 'in' | 'post' | 'postponed';
type Ev = { id: string; date: string; state?: State; raw?: Record<string, unknown> };
function event(e: Ev) {
  const state = e.state ?? 'pre';
  const type =
    state === 'in'
      ? { name: 'STATUS_IN_PROGRESS', state: 'in' }
      : state === 'post'
        ? { name: 'STATUS_FULL_TIME', state: 'post' }
        : state === 'postponed'
          ? { name: 'STATUS_POSTPONED', state: 'post' }
          : { name: 'STATUS_SCHEDULED', state: 'pre' };
  return {
    id: e.id,
    date: e.date,
    season: { slug: 'regular-season' },
    status: { type, displayClock: state === 'in' ? "55'" : undefined, period: state === 'in' ? 2 : 0 },
    competitions: [
      {
        competitors: [
          { homeAway: 'home', score: '1', team: { id: '227', abbreviation: 'AME', displayName: 'América' } },
          { homeAway: 'away', score: '0', team: { id: '219', abbreviation: 'GDL', displayName: 'Guadalajara' } },
        ],
      },
    ],
    ...e.raw,
  };
}

const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const easternDay = (iso: string) => eastern.format(new Date(iso)).replace(/-/g, '');
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** A feed that buckets like ESPN and refuses ranges like ESPN. `extra` adds raw events to a month's answer. */
function feed(
  events: Ev[],
  opts: {
    season?: (dates: string) => Season | undefined;
    fail?: (dates: string) => Response | Promise<Response> | undefined;
    extra?: (dates: string) => unknown[];
  } = {},
) {
  const dates: string[] = [];
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    if (url.includes('/standings')) return json({});
    const asked = new URL(url).searchParams.get('dates') ?? '';
    dates.push(asked);
    const failure = opts.fail?.(asked);
    if (failure) return failure;
    if (asked.includes('-')) return json({ code: 400, message: 'Failed to get events endpoint.' }, 400);
    const season = opts.season ? opts.season(asked) : S2026;
    const inBucket = (e: Ev) =>
      asked.length === 8 ? easternDay(e.date) === asked : asked.length === 6 ? easternDay(e.date).startsWith(asked) : false;
    return json({
      leagues: season ? [{ season }] : [{}],
      events: [...events.filter(inBucket).map(event), ...(opts.extra?.(asked) ?? [])],
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, dates };
}
const adapterOn = (f: { fetchImpl: typeof fetch }, now: Date) =>
  new EspnAdapter({ competition: 'mex.1', enrichGroups: false, fetchImpl: f.fetchImpl, now: () => now.getTime() });
const ids = (ms: readonly { id: string }[]) => ms.map((m) => m.id);

// Saturday Oct 10 2026, 15:00Z: Eastern Oct 10. The span is Oct 9 to Oct 24.
const NOW = new Date('2026-10-10T15:00:00Z');
const BEFORE: Ev = { id: '10', date: '2026-10-08T23:00Z', state: 'post' }; // Eastern Oct 8: before the span
const YESTERDAY: Ev = { id: '11', date: '2026-10-10T01:00Z', state: 'post' }; // Eastern Oct 9
const IN_PLAY: Ev = { id: '12', date: '2026-10-10T14:00Z', state: 'in' };
const TONIGHT: Ev = { id: '13', date: '2026-10-11T01:00Z' }; // Eastern Oct 10, UTC Oct 11
const POSTPONED: Ev = { id: '14', date: '2026-10-17T23:00Z', state: 'postponed' };
const LAST_DAY: Ev = { id: '15', date: '2026-10-25T03:00Z' }; // Eastern Oct 24: the span's last day
const AFTER: Ev = { id: '16', date: '2026-10-25T23:00Z' }; // Eastern Oct 25: after the span
const OCTOBER = [BEFORE, YESTERDAY, IN_PLAY, TONIGHT, POSTPONED, LAST_DAY, AFTER];

describe('the span: yesterday to 14 days ahead, in the provider’s calendar days', () => {
  it('is what it says', () => {
    expect(SCHEDULE_LOOKBACK_DAYS).toBe(1);
    expect(SCHEDULE_AHEAD_DAYS).toBe(14);
  });

  it('one month: ONE request for the month, every fixture of the span in any status, by kickoff', async () => {
    const f = feed(OCTOBER);
    const r = await getScheduleAhead(adapterOn(f, NOW), NOW);
    expect(f.dates).toEqual(['202610']);
    expect(r.degraded).toBe(false);
    expect(ids(r.fixtures)).toEqual(['11', '12', '13', '14', '15']);
    expect(r.fixtures.map((m) => m.status)).toEqual(['FT', 'LIVE', 'SCHEDULED', 'POSTPONED', 'SCHEDULED']);
    expect(r.complete).toBe(true);
    expect(r.season).toMatchObject({ year: 2026 });
  });

  it('is counted in the PROVIDER’s days: at 02:00Z on Nov 1 it is still Oct 31 there', async () => {
    const now = new Date('2026-11-01T02:00:00Z'); // Eastern Oct 31 → span Oct 30 to Nov 14
    const first: Ev = { id: '20', date: '2026-10-30T23:00Z' }; // Eastern Oct 30: in (it is not, counted in UTC days)
    const last: Ev = { id: '21', date: '2026-11-15T01:00Z' }; // Eastern Nov 14: in
    const out: Ev = { id: '22', date: '2026-11-15T23:00Z' }; // Eastern Nov 15: out (it is in, counted in UTC days)
    const f = feed([first, last, out]);
    const r = await getScheduleAhead(adapterOn(f, now), now);
    expect([...f.dates].sort()).toEqual(['202610', '202611']);
    expect(ids(r.fixtures)).toEqual(['20', '21']);
  });

  it('a span that crosses a month is exactly two requests, a month each, sent together', async () => {
    const now = new Date('2026-10-25T15:00:00Z'); // span Oct 24 to Nov 8
    const oct: Ev = { id: '30', date: '2026-10-28T23:00Z' };
    const nov: Ev = { id: '31', date: '2026-11-07T23:00Z' };
    // The first answer waits for the second REQUEST: sent one after the other, this would never settle.
    let release: () => void = () => {};
    const second = new Promise<void>((resolve) => {
      release = resolve;
    });
    let asked = 0;
    const base = feed([oct, nov]);
    const fetchImpl = (async (input: unknown) => {
      asked++;
      if (asked === 1) await second;
      else release();
      return base.fetchImpl(input as never);
    }) as unknown as typeof fetch;
    const r = await getScheduleAhead(adapterOn({ fetchImpl }, now), now);
    expect([...base.dates].sort()).toEqual(['202610', '202611']);
    expect(ids(r.fixtures)).toEqual(['30', '31']);
    expect(r.complete).toBe(true);
  });

  it('a fragment of two or three days is still asked as its MONTH, never a day at a time', async () => {
    const now = new Date('2026-05-20T15:00:00Z'); // span May 19 to June 3: three days of June
    const may: Ev = { id: '40', date: '2026-05-23T23:00Z' };
    const june: Ev = { id: '41', date: '2026-06-02T23:00Z' };
    const f = feed([may, june]);
    const r = await getScheduleAhead(adapterOn(f, now), now);
    expect([...f.dates].sort()).toEqual(['202605', '202606']);
    expect(ids(r.fixtures)).toEqual(['40', '41']);
  });
});

describe('two months that state two seasons are two answers, not a refused window', () => {
  const now = new Date('2026-05-20T15:00:00Z');
  const may: Ev = { id: '40', date: '2026-05-23T23:00Z' };
  const june: Ev = { id: '41', date: '2026-06-02T23:00Z' };
  const seasons = (dates: string) => (dates === '202605' ? S2025 : S2026);

  it('both months’ fixtures are read; an answer whose months state TWO seasons states none', async () => {
    // Found in review: the answer took the season of the month that holds now
    // for all of it. June's fixtures were then stored as "season 2025", and the
    // first incomplete answer after June 1 ("season 2026": another season)
    // replaced the slice and dropped a June fixture it had not read. An answer
    // can only state a season for all its fixtures when its months agree.
    const f = feed([may, june], { season: seasons });
    const r = await getScheduleAhead(adapterOn(f, now), now);
    expect(r.degraded).toBe(false);
    expect(ids(r.fixtures)).toEqual(['40', '41']);
    expect(r.season).toBeUndefined();
    expect(r.complete).toBe(true);
  });

  it('two months that state the SAME season: that season', async () => {
    const f = feed([may, june], { season: () => S2025 });
    const r = await getScheduleAhead(adapterOn(f, now), now);
    expect(r.season).toMatchObject({ year: 2025 });
  });

  it('whichever month holds now: June 1 still touches May, and the answer still states no season', async () => {
    // June 1: yesterday is May 31, so May is asked too.
    const june1 = new Date('2026-06-01T15:00:00Z');
    const f = feed([may, june], { season: seasons });
    const r = await getScheduleAhead(adapterOn(f, june1), june1);
    expect([...f.dates].sort()).toEqual(['202605', '202606']);
    expect(r.season).toBeUndefined();
  });

  it('control: the same two months as ONE window are refused by the adapter', async () => {
    const f = feed([may, june], { season: seasons });
    await expect(adapterOn(f, now).fetchWindow('2026-05-19', '2026-06-03')).rejects.toThrow(/spans seasons/);
  });

  for (const silent of ['202605', '202606']) {
    it(`one of two months states no season (${silent}): the answer states none, whichever month it is`, async () => {
      const f = feed([may, june], { season: (dates) => (dates === silent ? undefined : S2026) });
      const r = await getScheduleAhead(adapterOn(f, now), now);
      expect(r.degraded).toBe(false);
      expect(r.season).toBeUndefined();
    });
  }
});

describe('a discovery that cannot be had is a failed one, whatever the other month says', () => {
  const now = new Date('2026-10-25T15:00:00Z'); // two months
  const oct: Ev = { id: '30', date: '2026-10-28T23:00Z' };
  const nov: Ev = { id: '31', date: '2026-11-07T23:00Z' };

  it('a transport failure on either month', async () => {
    for (const bad of ['202610', '202611']) {
      const f = feed([oct, nov], { fail: (d) => (d === bad ? json({}, 500) : undefined) });
      const r = await getScheduleAhead(adapterOn(f, now), now);
      expect(r, bad).toEqual({ fixtures: [], degraded: true });
      // Both were asked: the failure of one does not skip the other.
      expect([...f.dates].sort(), bad).toEqual(['202610', '202611']);
    }
  });

  it('a month that fills the request’s limit (its tail is unknown)', async () => {
    const full = Array.from({ length: 300 }, (_, i) => event({ id: String(1000 + i), date: '2026-11-07T23:00Z' }));
    const f = feed([oct], { extra: (d) => (d === '202611' ? full : []) });
    expect(await getScheduleAhead(adapterOn(f, now), now)).toEqual({ fixtures: [], degraded: true });
  });

  it('a throttle on one month is retained by the adapter though the other failed first', async () => {
    const f = feed([oct, nov], {
      fail: (d) =>
        d === '202610'
          ? json({}, 500)
          : new Promise<Response>((resolve) => setTimeout(() => resolve(json({}, 429, { 'retry-after': '600' })), 20)),
    });
    const adapter = adapterOn(f, now);
    const r = await getScheduleAhead(adapter, now);
    expect(r.degraded).toBe(true);
    expect((adapter.cooldownUntil ?? 0) - now.getTime()).toBeGreaterThanOrEqual(600_000);
  });

  it('an adapter that cannot ask for a window: no request, a failed discovery', async () => {
    let calls = 0;
    const noWindow = {
      name: 'fake',
      competition: 'mex.1',
      capabilities: {},
      fetchByDate: async () => {
        calls++;
        return [];
      },
      fetchLive: async () => {
        calls++;
        return [];
      },
    } as unknown as ProviderAdapter;
    expect(await getScheduleAhead(noWindow, now)).toEqual({ fixtures: [], degraded: true });
    expect(calls).toBe(0);
  });
});

describe('one refused record is not an outage: "no readable record" is asked of the whole discovery, not of each month', () => {
  // Found in review. Each month is its own window, and a window whose list is
  // not empty and holds no readable record is a failed window. So ONE record
  // nobody can read, alone in next month's answer (a tie whose teams are not
  // set yet, a malformed event), failed every discovery for as long as it was
  // there: no schedule at all, with this month's fixtures read and thrown away.
  const now = new Date('2026-10-25T15:00:00Z'); // span Oct 24 to Nov 8
  const today: Ev = { id: '30', date: '2026-10-25T17:00Z' };
  const oct: Ev = { id: '32', date: '2026-10-28T23:00Z' };
  const unreadable: Array<[string, unknown]> = [
    ['a malformed event', { id: 'not an id', date: 'garbage' }],
    ['a tie whose teams are not set yet', { ...event({ id: '33', date: '2026-11-03T23:00Z' }), competitions: [{ competitors: [] }] }],
  ];

  for (const [what, record] of unreadable) {
    it(`a month whose only record is ${what}, beside a readable month: the readable month, and not whole`, async () => {
      const f = feed([today, oct], { extra: (d) => (d === '202611' ? [record] : []) });
      const r = await getScheduleAhead(adapterOn(f, now), now);
      expect(r.degraded).toBe(false);
      expect(r.complete).toBe(false);
      expect(ids(r.fixtures)).toEqual(['30', '32']);
      expect([...(r.mentioned ?? [])].sort()).toEqual(['30', '32']);
    });
  }

  it('BOTH months hold only records nobody can read: nothing was read, and that is a failed discovery', async () => {
    const f = feed([], { extra: () => [{ id: 'not an id', date: 'garbage' }] });
    expect(await getScheduleAhead(adapterOn(f, now), now)).toEqual({ fixtures: [], degraded: true });
  });

  it('one month alone, its only record unreadable: a failed discovery, as for any window', async () => {
    const f = feed([], { extra: () => [{ id: 'not an id', date: 'garbage' }] });
    expect(await getScheduleAhead(adapterOn(f, NOW), NOW)).toEqual({ fixtures: [], degraded: true });
  });

  it('a month whose ENVELOPE cannot be read is still a failed discovery: that is not a refused record', async () => {
    const f = feed([today, oct], { fail: (d) => (d === '202611' ? json({}) : undefined) });
    expect(await getScheduleAhead(adapterOn(f, now), now)).toEqual({ fixtures: [], degraded: true });
  });
});

describe('an answer that is not whole says so, and says what it READ', () => {
  const now = new Date('2026-10-25T15:00:00Z'); // span Oct 24 to Nov 8
  const early: Ev = { id: '50', date: '2026-10-02T23:00Z', state: 'post' }; // October, before the span
  const oct: Ev = { id: '51', date: '2026-10-28T23:00Z' };
  const nov: Ev = { id: '52', date: '2026-11-07T23:00Z' };
  const late: Ev = { id: '53', date: '2026-11-21T23:00Z' }; // November, after the span

  it('a refused record in one month: the readable rest, `complete: false`, and everything either month held', async () => {
    const refused = { id: 'not an id', date: '2026-11-03T23:00Z' };
    const f = feed([early, oct, nov, late], { extra: (d) => (d === '202611' ? [refused] : []) });
    const r = await getScheduleAhead(adapterOn(f, now), now);
    expect(r.degraded).toBe(false);
    expect(r.complete).toBe(false);
    expect(ids(r.fixtures)).toEqual(['51', '52']);
    // "Was it read?" is asked of this list, taken BEFORE a month is narrowed to the span.
    expect([...(r.mentioned ?? [])].sort()).toEqual(['50', '51', '52', '53']);
  });

  it('a whole answer states `complete: true` and needs no such list', async () => {
    const f = feed([early, oct, nov, late]);
    const r = await getScheduleAhead(adapterOn(f, now), now);
    expect(r.complete).toBe(true);
    expect(r.mentioned).toBeUndefined();
  });

  it('one fixture in BOTH months: the first copy, in month order, counts, and the answer is not whole', async () => {
    // The same id under another kickoff in November's answer (a fixture moved while the two were being answered).
    const moved = event({ id: '51', date: '2026-11-05T23:00Z' });
    const f = feed([oct, nov], { extra: (d) => (d === '202611' ? [moved] : []) });
    const r = await getScheduleAhead(adapterOn(f, now), now);
    expect(r.complete).toBe(false);
    expect(ids(r.fixtures)).toEqual(['51', '52']);
    expect(r.fixtures[0]?.kickoff.startsWith('2026-10-28')).toBe(true);
    expect([...(r.mentioned ?? [])].sort()).toEqual(['51', '52']);
  });

  it('and when the first copy is OUTSIDE the span, the fixture is not in the answer at all', async () => {
    // October's answer files it on Oct 2 (before the span); November's holds the same id on Nov 5.
    // The first copy counts: it is not in the span. Taking the second would be picking the answer we like.
    const first: Ev = { id: '60', date: '2026-10-02T23:00Z' };
    const second = event({ id: '60', date: '2026-11-05T23:00Z' });
    const f = feed([first, oct, nov], { extra: (d) => (d === '202611' ? [second] : []) });
    const r = await getScheduleAhead(adapterOn(f, now), now);
    expect(r.complete).toBe(false);
    expect(ids(r.fixtures)).toEqual(['51', '52']);
    expect([...(r.mentioned ?? [])].sort()).toEqual(['51', '52', '60']);
  });

  it('a fixture whose kickoff is not an instant is not placed anywhere, and the answer is not whole', async () => {
    const odd = {
      name: 'fake',
      competition: 'mex.1',
      capabilities: {},
      fetchByDate: async () => [],
      fetchLive: async () => [],
      // The adapter SAYS its answer is whole, so only the kickoff can make it not so.
      // (Found in review: with no such statement the "says nothing" rule refused first and hid this one.)
      fetchWindow: async () => attachFetchMeta([{ id: '70', kickoff: 'soon' }] as never[], { complete: true }),
    } as unknown as ProviderAdapter;
    // A span inside ONE month: with two, the same record would come back twice
    // and the "one fixture in two months" rule would refuse first (it did, and
    // hid this rule from a mutation pass a second time).
    const r = await getScheduleAhead(odd, NOW);
    expect(r).toMatchObject({ fixtures: [], degraded: false, complete: false });
    expect(r.mentioned).toEqual(['70']);
  });

  it('what a month’s own window read and set aside is part of what the answer read', async () => {
    // A month's response holding a fixture filed under ANOTHER month's day: the
    // window sets it aside and says so (`mentioned`). The discovery's account
    // must include it, or a union would put back a fixture that was read.
    const stray = event({ id: '99', date: '2026-10-20T23:00Z' }); // in November's answer, an October day
    const refused = { id: 'not an id', date: '2026-11-03T23:00Z' };
    const f = feed([oct, nov], { extra: (d) => (d === '202611' ? [stray, refused] : []) });
    const r = await getScheduleAhead(adapterOn(f, now), now);
    expect(r.complete).toBe(false);
    expect(ids(r.fixtures)).toEqual(['51', '52']);
    expect([...(r.mentioned ?? [])].sort()).toEqual(['51', '52', '99']);
  });

  it('an adapter that states nothing about its answer cannot be called whole', async () => {
    const silent = {
      name: 'fake',
      competition: 'mex.1',
      capabilities: {},
      fetchByDate: async () => [],
      fetchLive: async () => [],
      fetchWindow: async () => [],
    } as unknown as ProviderAdapter;
    const r = await getScheduleAhead(silent, now);
    expect(r.degraded).toBe(false);
    expect(r.complete).toBe(false);
  });
});

describe('a live read says whether it was whole (the refresher needs it; no surface prints it)', () => {
  // A match seen in play keeps the refresher polling past its window, and only a
  // read that is WHOLE and holds none in play may end that. `getLiveMatches`
  // dropped the window's verdict; the refresher's read keeps it.
  const now = new Date('2026-10-10T15:00:00Z');
  const inPlay: Ev = { id: '12', date: '2026-10-10T14:00Z', state: 'in' };
  const later: Ev = { id: '13', date: '2026-10-11T01:00Z' };

  it('a whole window: `complete: true`, with the matches in play', async () => {
    const r = await getLiveRead(adapterOn(feed([inPlay, later]), now), now);
    expect(r.degraded).toBe(false);
    expect(ids(r.matches)).toEqual(['12']);
    expect(r.complete).toBe(true);
  });

  it('a refused record anywhere in the window: `complete: false`, though no match in play was lost', async () => {
    const refused = { id: 'not an id', date: '2026-10-10T18:00Z' };
    const f = feed([later], { extra: (d) => (d === '20261010' ? [refused] : []) });
    const r = await getLiveRead(adapterOn(f, now), now);
    expect(r.degraded).toBe(false);
    expect(r.matches).toEqual([]);
    expect(r.complete).toBe(false);
  });

  it('a failed read is degraded and not whole', async () => {
    const f = feed([inPlay], { fail: () => json({}, 500) });
    expect(await getLiveRead(adapterOn(f, now), now)).toEqual({ matches: [], degraded: true, complete: false });
  });

  it('an adapter that says nothing about its answer: absent is not true', async () => {
    const silent = {
      name: 'fake',
      competition: 'mex.1',
      capabilities: {},
      fetchByDate: async () => [],
      fetchLive: async () => [],
    } as unknown as ProviderAdapter;
    expect((await getLiveRead(silent, now)).complete).toBe(false);
  });

  it('`getLiveMatches` is the same result without the refresher\'s boolean, key for key; a read that was not whole states `partial` (0.11 2.1d)', async () => {
    const whole = await getLiveMatches(adapterOn(feed([inPlay, later]), now), now);
    expect(Object.keys(whole).sort()).toEqual(['degraded', 'matches', 'season', 'source']);
    const refused = { id: 'not an id', date: '2026-10-10T18:00Z' };
    const partial = await getLiveMatches(adapterOn(feed([later], { extra: (d) => (d === '20261010' ? [refused] : []) }), now), now);
    expect(Object.keys(partial).sort()).toEqual(['degraded', 'matches', 'partial', 'season', 'source']);
    const failed = await getLiveMatches(adapterOn(feed([inPlay], { fail: () => json({}, 500) }), now), now);
    expect(failed).toEqual({ matches: [], degraded: true });
  });
});
