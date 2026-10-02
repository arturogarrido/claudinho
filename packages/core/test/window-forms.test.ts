/**
 * 0.11 PR 2.1a — windows without date ranges.
 *
 * On Oct 2 2026 ESPN began refusing every date-RANGE scoreboard request
 * (`dates=A-B` → HTTP 400) while one day (`dates=YYYYMMDD`) and one month
 * (`dates=YYYYMM`) kept working. `fetchWindow` built exactly the refused form,
 * so every windowed read (live, a date, a match, the knockout span) degraded.
 *
 * A window is now composed from the forms the provider accepts. Measured on the
 * real feed the same day: a day request and a month request both file a
 * fixture under its kickoff's US/Eastern date (35 of 35 events over 16 day
 * requests; a month holds nothing outside itself by Eastern date).
 *
 * The feed below behaves that way, and refuses ranges the way the real one does.
 */
import { describe, expect, it } from 'vitest';
import { EspnAdapter, ProviderError } from '../src/adapters/espn';
import { fetchMeta } from '../src/adapters/meta';
import { getLiveMatches } from '../src/live';

const SEASON = { year: 2026, startDate: '2026-06-01T04:00Z', endDate: '2027-06-01T03:59Z', displayName: '2026-27 Liga MX' };

type Ev = { id: string; date: string; state?: 'pre' | 'in' | 'post'; season?: typeof SEASON; raw?: Record<string, unknown> };
function event(e: Ev) {
  const state = e.state ?? 'pre';
  const name = state === 'in' ? 'STATUS_IN_PROGRESS' : state === 'post' ? 'STATUS_FULL_TIME' : 'STATUS_SCHEDULED';
  return {
    id: e.id,
    date: e.date,
    season: { slug: 'regular-season' },
    status: { type: { name, state }, displayClock: state === 'in' ? "55'" : undefined, period: state === 'in' ? 2 : 0 },
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

/** A feed that buckets like ESPN and refuses ranges like ESPN. */
function feed(events: Ev[], opts: { season?: (dates: string) => typeof SEASON | undefined; fail?: (dates: string) => Response | undefined } = {}) {
  const urls: string[] = [];
  const dates: string[] = [];
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('/standings')) return json({});
    const asked = new URL(url).searchParams.get('dates') ?? '';
    dates.push(asked);
    const failure = opts.fail?.(asked);
    if (failure) return failure;
    if (asked.includes('-')) return json({ code: 400, message: 'Failed to get events endpoint.' }, 400);
    const season = opts.season ? opts.season(asked) : SEASON;
    const inBucket = (e: Ev) =>
      asked.length === 8 ? easternDay(e.date) === asked : asked.length === 6 ? easternDay(e.date).startsWith(asked) : false;
    return json({ leagues: season ? [{ season }] : [{}], events: events.filter(inBucket).map(event) });
  }) as unknown as typeof fetch;
  return { fetchImpl, urls, dates };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const adapterOn = (f: { fetchImpl: typeof fetch }, now?: Date) =>
  new EspnAdapter({ competition: 'mex.1', enrichGroups: false, fetchImpl: f.fetchImpl, ...(now ? { now: () => now.getTime() } : {}) });

// Saturday night in Mexico: two kickoffs that are Sunday in UTC and Saturday for the provider.
const SAT_EARLY: Ev = { id: '1', date: '2026-10-10T23:00Z' }; // Eastern Oct 10
const SAT_LATE: Ev = { id: '2', date: '2026-10-11T01:00Z' }; // Eastern Oct 10, UTC Oct 11
const SUN: Ev = { id: '3', date: '2026-10-11T23:00Z' }; // Eastern Oct 11
const MON_LATE: Ev = { id: '4', date: '2026-10-13T01:05Z' }; // Eastern Oct 12
const NEXT_MONTH: Ev = { id: '5', date: '2026-11-01T03:00Z' }; // Eastern Oct 31, UTC Nov 1
const NOVEMBER: Ev = { id: '6', date: '2026-11-07T23:00Z' }; // Eastern Nov 7
const ALL = [SAT_EARLY, SAT_LATE, SUN, MON_LATE, NEXT_MONTH, NOVEMBER];
const ids = (ms: { id: string }[]) => ms.map((m) => m.id).sort();

describe('the adapter says how the provider files a day', () => {
  const a = adapterOn(feed([]));
  it('a fixture belongs to its kickoff’s US/Eastern date', () => {
    expect(a.bucketDay(new Date('2026-10-11T01:00Z'))).toBe('2026-10-10');
    expect(a.bucketDay(new Date('2026-10-10T23:00Z'))).toBe('2026-10-10');
    expect(a.bucketDay(new Date('2026-10-11T04:00Z'))).toBe('2026-10-11');
  });

  it('through the provider’s daylight-saving change, in both directions', () => {
    // Clocks go back on Nov 1 2026 (06:00Z): the offset is 4 hours before, 5 after.
    expect(a.bucketDay(new Date('2026-11-01T03:59Z'))).toBe('2026-10-31');
    expect(a.bucketDay(new Date('2026-11-01T04:00Z'))).toBe('2026-11-01');
    expect(a.bucketDay(new Date('2026-11-02T04:59Z'))).toBe('2026-11-01');
    expect(a.bucketDay(new Date('2026-11-02T05:00Z'))).toBe('2026-11-02');
    // And forward on Mar 14 2027 (07:00Z).
    expect(a.bucketDay(new Date('2027-03-14T04:59Z'))).toBe('2027-03-13');
    expect(a.bucketDay(new Date('2027-03-15T03:59Z'))).toBe('2027-03-14');
    expect(a.bucketDay(new Date('2027-03-15T04:00Z'))).toBe('2027-03-15');
  });
});

describe('a window is composed from the forms the provider accepts', () => {
  it('never sends a range, and still answers', async () => {
    const f = feed(ALL);
    const got = await adapterOn(f).fetchWindow('2026-10-10', '2026-10-12');
    expect(f.dates.some((d) => d.includes('-'))).toBe(false);
    expect(ids(got)).toEqual(['1', '2', '3', '4']);
  });

  it('up to three days: one request per day', async () => {
    const one = feed(ALL);
    await adapterOn(one).fetchWindow('2026-10-10', '2026-10-10');
    expect(one.dates).toEqual(['20261010']);
    const three = feed(ALL);
    await adapterOn(three).fetchWindow('2026-10-10', '2026-10-12');
    expect([...three.dates].sort()).toEqual(['20261010', '20261011', '20261012']);
  });

  it('a late kickoff is found under the PREVIOUS provider day, not under its UTC date', async () => {
    expect(ids(await adapterOn(feed(ALL)).fetchWindow('2026-10-10', '2026-10-10'))).toEqual(['1', '2']);
    expect(ids(await adapterOn(feed(ALL)).fetchWindow('2026-10-11', '2026-10-11'))).toEqual(['3']);
  });

  it('longer: one request per calendar month, and only the fixtures inside the window', async () => {
    const f = feed(ALL);
    const got = await adapterOn(f).fetchWindow('2026-10-11', '2026-11-03');
    expect([...f.dates].sort()).toEqual(['202610', '202611']);
    // Oct 10's two are in the October response and before the window; Nov 7 is after it.
    expect(ids(got)).toEqual(['3', '4', '5']);
  });

  it('a four-day window inside one month is ONE request', async () => {
    const f = feed(ALL);
    const got = await adapterOn(f).fetchWindow('2026-10-10', '2026-10-13');
    expect(f.dates).toEqual(['202610']);
    expect(ids(got)).toEqual(['1', '2', '3', '4']);
  });

  it('a window over more than three months is refused without a request', async () => {
    const f = feed(ALL);
    await expect(adapterOn(f).fetchWindow('2026-10-01', '2027-01-05')).rejects.toBeInstanceOf(ProviderError);
    expect(f.urls).toEqual([]);
  });

  it('a window that ends before it starts, or is not two dates, is refused without a request', async () => {
    const f = feed(ALL);
    await expect(adapterOn(f).fetchWindow('2026-10-12', '2026-10-10')).rejects.toBeInstanceOf(ProviderError);
    await expect(adapterOn(f).fetchWindow('soon', '2026-10-10')).rejects.toBeInstanceOf(ProviderError);
    await expect(adapterOn(f).fetchWindow('2026-02-30', '2026-03-01')).rejects.toBeInstanceOf(ProviderError);
    expect(f.urls).toEqual([]);
  });
});

describe('one window, one account', () => {
  const broken = { raw: { status: { type: { name: 'STATUS_SOMETHING_NEW', state: 'limbo' } } } };

  it('is complete only if every part is', async () => {
    const whole = await adapterOn(feed(ALL)).fetchWindow('2026-10-10', '2026-10-12');
    expect(fetchMeta(whole)?.complete).toBe(true);
    const withRefusal = await adapterOn(feed([SAT_EARLY, { ...SUN, ...broken }, MON_LATE])).fetchWindow('2026-10-10', '2026-10-12');
    expect(ids(withRefusal)).toEqual(['1', '4']);
    expect(fetchMeta(withRefusal)?.complete).toBe(false);
  });

  it('a day whose only record is unreadable is a refused record, not an outage, while a sibling day is readable', async () => {
    // Asked as one range this was one payload with a readable sibling. Asked a
    // day at a time it must stay that: one batch, one refused record.
    const got = await adapterOn(feed([SAT_EARLY, { ...SUN, ...broken }])).fetchWindow('2026-10-10', '2026-10-11');
    expect(ids(got)).toEqual(['1']);
    expect(fetchMeta(got)?.complete).toBe(false);
  });

  it('a window in which no record at all can be read is a failure, as it was for one payload', async () => {
    const none = feed([{ ...SAT_EARLY, ...broken }, { ...SUN, ...broken }]);
    await expect(adapterOn(none).fetchWindow('2026-10-10', '2026-10-11')).rejects.toBeInstanceOf(ProviderError);
    // And an honestly empty window is an empty answer.
    const empty = await adapterOn(feed([])).fetchWindow('2026-10-10', '2026-10-11');
    expect(empty).toEqual([]);
    expect(fetchMeta(empty)?.complete).toBe(true);
  });

  it('fails when any part fails, with that part’s error', async () => {
    const f = feed(ALL, { fail: (d) => (d === '20261011' ? json({}, 503) : undefined) });
    const a = adapterOn(f);
    await expect(a.fetchWindow('2026-10-10', '2026-10-12')).rejects.toMatchObject({ status: 503 });
    // Not a throttle: the next call asks again.
    const before = f.urls.length;
    await a.fetchWindow('2026-10-10', '2026-10-10');
    expect(f.urls.length).toBe(before + 1);
  });

  it('a throttle on one part arms the cooldown for everything after it', async () => {
    const f = feed(ALL, { fail: (d) => (d === '20261010' ? json({}, 429, { 'retry-after': '120' }) : undefined) });
    const a = adapterOn(f, new Date('2026-10-10T18:00Z'));
    await expect(a.fetchWindow('2026-10-10', '2026-10-12')).rejects.toMatchObject({ status: 429 });
    const sent = f.urls.length;
    expect(sent).toBeLessThanOrEqual(3);
    await expect(a.fetchWindow('2026-10-11', '2026-10-11')).rejects.toMatchObject({ status: 429 });
    await expect(a.fetchByDate('2026-10-11')).rejects.toMatchObject({ status: 429 });
    expect(f.urls.length).toBe(sent);
  });

  it('states a season only when its parts agree', async () => {
    const agree = await adapterOn(feed(ALL)).fetchWindow('2026-10-10', '2026-10-12');
    expect(fetchMeta(agree)?.season?.year).toBe(2026);
    const other = { ...SEASON, year: 2027, displayName: '2027-28 Liga MX' };
    const split = feed(ALL, { season: (d) => (d === '20261012' ? other : SEASON) });
    expect(fetchMeta(await adapterOn(split).fetchWindow('2026-10-10', '2026-10-12'))?.season).toBeUndefined();
    // A part that states none does not veto the ones that do.
    const silent = feed(ALL, { season: (d) => (d === '20261011' ? undefined : SEASON) });
    expect(fetchMeta(await adapterOn(silent).fetchWindow('2026-10-10', '2026-10-12'))?.season?.year).toBe(2026);
  });

  it('two parts never yield two fixtures under one id: the first is kept and the window is not complete', async () => {
    // Cannot happen while the provider files a fixture under one day; if it
    // ever does, it is the parser's own rule for a duplicate, across parts.
    const f = feed([]);
    const twice = (async (input: unknown) => {
      const url = String(input);
      f.urls.push(url);
      return json({ leagues: [{ season: SEASON }], events: [event(SUN)] });
    }) as unknown as typeof fetch;
    const got = await new EspnAdapter({ competition: 'mex.1', enrichGroups: false, fetchImpl: twice }).fetchWindow('2026-10-10', '2026-10-11');
    expect(ids(got)).toEqual(['3']);
    expect(fetchMeta(got)?.complete).toBe(false);
  });
});

describe('the live read asks only for the provider days that can hold a match in play', () => {
  const inPlay = (e: Ev): Ev => ({ ...e, state: 'in' });

  it('one request for most of the day', async () => {
    const f = feed([inPlay({ id: '9', date: '2026-10-10T17:00Z' }), SUN]);
    const now = new Date('2026-10-10T18:00Z'); // 14:00 Eastern
    const r = await getLiveMatches(adapterOn(f, now), now);
    expect(f.dates).toEqual(['20261010']);
    expect(r.degraded).toBe(false);
    expect(ids(r.matches)).toEqual(['9']);
  });

  it('two in the hours after the provider’s midnight, and a match that kicked off before it is found', async () => {
    // Kickoff 22:30 Eastern on the 10th; still in play at 00:10 Eastern on the 11th.
    const late = inPlay({ id: '8', date: '2026-10-11T02:30Z' });
    const f = feed([late, SUN]);
    const now = new Date('2026-10-11T04:10Z');
    const r = await getLiveMatches(adapterOn(f, now), now);
    expect([...f.dates].sort()).toEqual(['20261010', '20261011']);
    expect(ids(r.matches)).toEqual(['8']);
  });

  it('back to one once no match from the previous provider day can still be in play', async () => {
    const f = feed(ALL);
    const now = new Date('2026-10-11T08:30Z'); // 04:30 Eastern
    await getLiveMatches(adapterOn(f, now), now);
    expect(f.dates).toEqual(['20261011']);
  });

  it('an adapter that does not say how it files a day keeps the three-day window', async () => {
    const asked: string[] = [];
    const plain = {
      name: 'other',
      competition: 'mex.1',
      capabilities: { push: false, latencyHintSec: 0 },
      async fetchByDate() {
        return [];
      },
      async fetchLive() {
        return [];
      },
      async fetchWindow(start: string, end: string) {
        asked.push(`${start}..${end}`);
        return [];
      },
    };
    await getLiveMatches(plain, new Date('2026-10-11T04:10Z'));
    expect(asked).toEqual(['2026-10-10..2026-10-12']);
  });
});
