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
import {
  getBracket,
  getKnockoutFixtures,
  getLiveMatches,
  getMatchById,
  getMatchesForDate,
  getNextFixtureForTeam,
  marketFixtureForTeam,
} from '../src/live';

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
    // Dates that are not on the calendar. (Chosen so that reading them the way
    // `Date` would, as Mar 2 and as Jan 1 of the next year, still gives a
    // forward window: only the calendar check can refuse them.)
    await expect(adapterOn(f).fetchWindow('2026-02-30', '2026-03-05')).rejects.toBeInstanceOf(ProviderError);
    await expect(adapterOn(f).fetchWindow('2026-13-01', '2027-01-02')).rejects.toBeInstanceOf(ProviderError);
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

  it('states the season its parts agree on; asked strictly, parts that state two seasons are a failure, not "unknown"', async () => {
    const agree = await adapterOn(feed(ALL)).fetchWindow('2026-10-10', '2026-10-12');
    expect(fetchMeta(agree)?.season?.year).toBe(2026);
    // An absent season lets the bundled schedule apply and lets a cached slice
    // of another season stand: a KNOWN disagreement must not look like that.
    const other = { ...SEASON, year: 2027, displayName: '2027-28 Liga MX' };
    const split = feed(ALL, { season: (d) => (d === '20261012' ? other : SEASON) });
    await expect(adapterOn(split).fetchWindow('2026-10-10', '2026-10-12')).rejects.toThrow(/seasons 2026 and 2027/);
    // A part that states none does not veto the ones that agree.
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

describe('across a season turn (0.11 2.1b): the LIVE read composes, every other window keeps refusing', () => {
  // Measured Oct 3 2026: a day response states the season of the DATE asked,
  // and each competition turns on its own date (June 1 for `mex.1`). The
  // three-day live window then holds two seasons on two UTC dates a year. A
  // refusal there is a verdict nobody can act on after the three requests were
  // spent: the live read keeps only matches in play and merges nothing. Every
  // caller that merges the bundle or publishes a cached slice keeps the strict
  // window, where an absent season must never hide a known disagreement.
  const other = { ...SEASON, year: 2027, displayName: '2027-28 Liga MX' };
  const turn = (d: string) => (d === '20261012' ? other : SEASON); // Oct 12 is of the next season

  it('asked across seasons: every fixture its parts held, no season, and which seasons were stated', async () => {
    const got = await adapterOn(feed(ALL, { season: turn })).fetchWindow('2026-10-10', '2026-10-12', { acrossSeasons: true });
    expect(ids(got)).toEqual(['1', '2', '3', '4']);
    const meta = fetchMeta(got);
    expect(meta?.complete).toBe(true);
    expect(meta?.season).toBeUndefined();
    expect(meta?.seasons?.map((s) => s.year)).toEqual([2026, 2027]);
  });

  it('asked strictly (the default, and what every adapter that ignores the option does): refused, as today', async () => {
    await expect(adapterOn(feed(ALL, { season: turn })).fetchWindow('2026-10-10', '2026-10-12')).rejects.toThrow(/seasons 2026 and 2027/);
    await expect(adapterOn(feed(ALL, { season: turn })).fetchWindow('2026-10-10', '2026-10-12', { acrossSeasons: false })).rejects.toThrow(/seasons/);
  });

  it('parts that agree state that season in both modes, and `seasons` lists it once; a silent part does not veto', async () => {
    for (const across of [true, false]) {
      const agree = await adapterOn(feed(ALL)).fetchWindow('2026-10-10', '2026-10-12', { acrossSeasons: across });
      expect(fetchMeta(agree)?.season?.year, String(across)).toBe(2026);
      expect(fetchMeta(agree)?.seasons?.map((s) => s.year), String(across)).toEqual([2026]);
      const silent = feed(ALL, { season: (d) => (d === '20261011' ? undefined : SEASON) });
      const got = await adapterOn(silent).fetchWindow('2026-10-10', '2026-10-12', { acrossSeasons: across });
      expect(fetchMeta(got)?.season?.year, String(across)).toBe(2026);
      expect(fetchMeta(got)?.seasons?.map((s) => s.year), String(across)).toEqual([2026]);
    }
    // Parts that state none at all: no season, and an empty list (which a reader must tell from "two").
    const none = await adapterOn(feed(ALL, { season: () => undefined })).fetchWindow('2026-10-10', '2026-10-12', { acrossSeasons: true });
    expect(fetchMeta(none)?.season).toBeUndefined();
    expect(fetchMeta(none)?.seasons).toEqual([]);
  });

  it('across seasons, everything else about the window is as strict: a refused record, a limit-full part, a down part', async () => {
    const broken = { raw: { status: { type: { name: 'STATUS_SOMETHING_NEW', state: 'limbo' } } } };
    const refused = await adapterOn(feed([SAT_EARLY, { ...SUN, ...broken }, MON_LATE], { season: turn })).fetchWindow('2026-10-10', '2026-10-12', { acrossSeasons: true });
    expect(ids(refused)).toEqual(['1', '4']);
    expect(fetchMeta(refused)).toMatchObject({ complete: false, omitted: 1 });
    const down = feed(ALL, { season: turn, fail: (d) => (d === '20261011' ? json({}, 503) : undefined) });
    await expect(adapterOn(down).fetchWindow('2026-10-10', '2026-10-12', { acrossSeasons: true })).rejects.toMatchObject({ status: 503 });
  });

  it('the live read asks across seasons: on a turn day the match in play is served, attributed', async () => {
    const live = await getLiveMatches(adapterOn(feed([{ ...SUN, state: 'in' }, MON_LATE], { season: turn })), new Date('2026-10-11T23:30:00Z'));
    expect(live.degraded).toBe(false);
    expect(live.matches.map((m) => m.id)).toEqual(['3']);
    expect(live.source).toBe('espn');
    expect(live.season).toBeUndefined();
  });

  it('the dated read, which merges the bundle on the bundled competition, asks strictly: still degraded on a turn day (2.1c)', async () => {
    const dated = await getMatchesForDate(adapterOn(feed(ALL, { season: turn })), '2026-10-11');
    expect(dated.degraded).toBe(true);
  });
});

describe('what a window counts as left out (0.11 2.1b)', () => {
  const broken = { raw: { status: { type: { name: 'STATUS_SOMETHING_NEW', state: 'limbo' } } } };

  it('0 exactly when the window is whole', async () => {
    expect(fetchMeta(await adapterOn(feed(ALL)).fetchWindow('2026-10-10', '2026-10-12'))?.omitted).toBe(0);
    expect(fetchMeta(await adapterOn(feed([])).fetchWindow('2026-10-10', '2026-10-11'))?.omitted).toBe(0);
  });

  it('a refused record in one part, and a second copy of a fixture across parts, each count one', async () => {
    const refused = await adapterOn(feed([SAT_EARLY, { ...SUN, ...broken }, MON_LATE])).fetchWindow('2026-10-10', '2026-10-12');
    expect(fetchMeta(refused)).toMatchObject({ complete: false, omitted: 1 });
    // Two parts holding one fixture: the first copy counts, the second is left out.
    const f = feed([]);
    const twice = (async (input: unknown) => {
      f.urls.push(String(input));
      return json({ leagues: [{ season: SEASON }], events: [event(SUN)] });
    }) as unknown as typeof fetch;
    const got = await new EspnAdapter({ competition: 'mex.1', enrichGroups: false, fetchImpl: twice }).fetchWindow('2026-10-10', '2026-10-11');
    expect(ids(got)).toEqual(['3']);
    expect(fetchMeta(got)).toMatchObject({ complete: false, omitted: 1 });
  });

  it('a single day read states it too; a read that filled its limit does not know its count', async () => {
    const day = await adapterOn(feed([SAT_EARLY, { ...SAT_LATE, ...broken }])).fetchByDate('2026-10-10');
    expect(fetchMeta(day)).toMatchObject({ complete: false, omitted: 1 });
    const full = Array.from({ length: 300 }, (_, i) => ({ id: String(1000 + i), date: '2026-10-10T23:00Z' }));
    const cut = await adapterOn(feed(full)).fetchByDate('2026-10-10');
    expect(fetchMeta(cut)?.complete).toBe(false);
    expect(fetchMeta(cut)?.omitted).toBeUndefined();
  });
});

describe('a response that could not be read at all is a failed part', () => {
  // Found in review. An unreadable ENVELOPE (no `events` list) is not a refused
  // record: nothing says what the day holds. Judged with its siblings it passed
  // as one, and "nothing live" was said over a day nobody had read.
  for (const [what, garbage] of [
    ['an empty object', {}],
    ['`events` that is no list', { events: 'nope' }],
  ] as const) {
    it(`${what} beside a readable day fails the window`, async () => {
      const f = feed([{ ...SAT_EARLY, state: 'post' }], { fail: (d) => (d === '20261011' ? json(garbage) : undefined) });
      await expect(adapterOn(f).fetchWindow('2026-10-10', '2026-10-12')).rejects.toMatchObject({ kind: 'parse' });
    });
  }

  it('so "nothing live" is never said over a day that was not read', async () => {
    const f = feed([{ ...SAT_EARLY, state: 'post' }], { fail: (d) => (d === '20261011' ? json({}) : undefined) });
    const r = await getLiveMatches(adapterOn(f), new Date('2026-10-11T20:00Z'));
    expect(r.matches).toEqual([]);
    expect(r.degraded).toBe(true);
  });

  it('a month that could not be read fails a long window too', async () => {
    const f = feed(ALL, { fail: (d) => (d === '202611' ? json({ events: null }) : undefined) });
    await expect(adapterOn(f).fetchWindow('2026-10-11', '2026-11-03')).rejects.toMatchObject({ kind: 'parse' });
  });

  it('a single read of one is the failure it always was', async () => {
    await expect(adapterOn(feed([], { fail: () => json({}) })).fetchByDate('2026-10-10')).rejects.toMatchObject({ kind: 'parse' });
  });
});

describe('one fixture under two parts, when a month is narrowed to the window', () => {
  // Found in review. Records outside the window were dropped BEFORE ids were
  // compared, so a second copy of a fixture that fell outside it (the same id,
  // another kickoff) left the window calling itself complete.
  const months = (june: Ev[], july: Ev[]) =>
    (async (input: unknown) => {
      const asked = new URL(String(input)).searchParams.get('dates') ?? '';
      return json({ leagues: [{ season: SEASON }], events: (asked === '202606' ? june : asked === '202607' ? july : []).map(event) });
    }) as unknown as typeof fetch;
  const on = (fetchImpl: typeof fetch) => new EspnAdapter({ competition: 'mex.1', enrichGroups: false, fetchImpl });

  it('the second copy is outside the window: the first is kept, and the window is not complete', async () => {
    const got = await on(months([{ id: '9', date: '2026-06-29T19:00Z' }], [{ id: '9', date: '2026-07-20T19:00Z' }])).fetchWindow('2026-06-28', '2026-07-19');
    expect(got.map((m) => [m.id, m.kickoff.slice(0, 10)])).toEqual([['9', '2026-06-29']]);
    expect(fetchMeta(got)?.complete).toBe(false);
  });

  it('the FIRST copy is outside the window: it still decides (nothing is kept), and the window is not complete', async () => {
    const got = await on(months([{ id: '9', date: '2026-06-20T19:00Z' }], [{ id: '9', date: '2026-07-05T19:00Z' }])).fetchWindow('2026-06-28', '2026-07-19');
    expect(got).toEqual([]);
    expect(fetchMeta(got)?.complete).toBe(false);
  });

  it('the window says every fixture its parts held, also the ones it did not return', async () => {
    // Found in review (round 2). A caller that keeps a previous answer asks
    // "was this fixture read?". Asked of what the window RETURNS, a fixture the
    // parts held and the window set aside (moved outside it, a second copy)
    // looked unread, and the caller put its old copy back.
    const moved = await on(months([{ id: '8', date: '2026-06-20T19:00Z' }], [{ id: '9', date: '2026-07-05T19:00Z' }, { id: '7', date: '2026-07-25T19:00Z' }])).fetchWindow('2026-06-28', '2026-07-19');
    expect(ids(moved)).toEqual(['9']);
    expect([...(fetchMeta(moved)?.mentioned ?? [])].sort()).toEqual(['7', '8', '9']);
    const twice = await on(months([{ id: '9', date: '2026-06-20T19:00Z' }], [{ id: '9', date: '2026-07-05T19:00Z' }])).fetchWindow('2026-06-28', '2026-07-19');
    expect(twice).toEqual([]);
    expect(fetchMeta(twice)?.mentioned).toEqual(['9']);
  });

  it('a fixture outside the window, held once, takes nothing from a complete answer', async () => {
    const got = await on(months([{ id: '8', date: '2026-06-20T19:00Z' }], [{ id: '9', date: '2026-07-05T19:00Z' }])).fetchWindow('2026-06-28', '2026-07-19');
    expect(ids(got)).toEqual(['9']);
    expect(fetchMeta(got)?.complete).toBe(true);
  });
});

describe('settled before it answers', () => {
  const later = <T,>(value: T, ms: number) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

  it('a throttle that arrives after a sibling’s quick failure is the window’s error, and the cooldown is armed', async () => {
    // Fail-fast would have reported the 503 and returned before the 429 was
    // read: the refresher then publishes with no backoff, and the next process
    // asks again while the provider is saying stop.
    const f = feed(ALL, {
      fail: (d) =>
        d === '20261010'
          ? json({}, 503)
          : d === '20261012'
            ? (later(json({}, 429, { 'retry-after': '300' }), 30) as unknown as Response)
            : undefined,
    });
    const now = new Date('2026-10-11T12:00Z');
    const a = adapterOn(f, now);
    await expect(a.fetchWindow('2026-10-10', '2026-10-12')).rejects.toMatchObject({ status: 429 });
    expect(a.cooldownUntil).toBe(now.getTime() + 300_000);
    const sent = f.urls.length;
    await expect(a.fetchByDate('2026-10-11')).rejects.toMatchObject({ status: 429 });
    expect(f.urls.length).toBe(sent);
  });

  it('of two throttles, the one that asks for the longer silence is kept, whichever arrives first', async () => {
    const f = feed(ALL, {
      fail: (d) =>
        d === '20261010'
          ? (later(json({}, 429, { 'retry-after': '60' }), 30) as unknown as Response)
          : d === '20261011'
            ? json({}, 429, { 'retry-after': '600' })
            : undefined,
    });
    const now = new Date('2026-10-11T12:00Z');
    const a = adapterOn(f, now);
    await expect(a.fetchWindow('2026-10-10', '2026-10-12')).rejects.toMatchObject({ status: 429, retryAfterMs: 600_000 });
    expect(a.cooldownUntil).toBe(now.getTime() + 600_000);
  });

  it('of two throttles, the one whose silence ENDS later is the window’s error: a deadline counts from when it was received', async () => {
    // Found in review: the two were compared by the delay each asked for, with
    // the clock frozen. A 429 asking for 60s at t=0 ends before a 403 asking
    // for 59s that arrives at t=5s.
    const t0 = Date.parse('2026-10-11T12:00Z');
    let clock = t0;
    const f = feed(ALL, {
      fail: (d) =>
        d === '20261010'
          ? json({}, 429, { 'retry-after': '60' })
          : d === '20261012'
            ? (new Promise<Response>((resolve) =>
                setTimeout(() => {
                  clock = t0 + 5_000;
                  resolve(json({}, 403, { 'retry-after': '59' }));
                }, 30),
              ) as unknown as Response)
            : undefined,
    });
    const a = new EspnAdapter({ competition: 'mex.1', enrichGroups: false, fetchImpl: f.fetchImpl, now: () => clock });
    await expect(a.fetchWindow('2026-10-10', '2026-10-12')).rejects.toMatchObject({ status: 403, retryAfterMs: 59_000 });
    expect(a.cooldownUntil).toBe(t0 + 64_000);
  });

  it('without a throttle, the error is the first failed part’s, in the order asked', async () => {
    const f = feed(ALL, {
      fail: (d) =>
        d === '20261010'
          ? (later(json({}, 500), 30) as unknown as Response)
          : d === '20261011'
            ? json({}, 503)
            : undefined,
    });
    await expect(adapterOn(f).fetchWindow('2026-10-10', '2026-10-12')).rejects.toMatchObject({ status: 500 });
  });
});

describe('what a response cannot be trusted to hold', () => {
  it('a response that fills the request’s limit may be cut: a single read keeps its prefix and says it is not complete', async () => {
    // Measured: the provider returns a chronological prefix of exactly `limit`
    // events, and every record in a cut response parses.
    const many: Ev[] = Array.from({ length: 300 }, (_, i) => ({ id: String(1000 + i), date: '2026-10-10T18:00Z' }));
    const f = feed(many);
    const full = await adapterOn(f).fetchByDate('2026-10-10');
    expect(new URL(f.urls[0] ?? '').searchParams.get('limit')).toBe('300');
    expect(full).toHaveLength(300);
    expect(fetchMeta(full)?.complete).toBe(false);
    // One fewer is a whole answer.
    const whole = await adapterOn(feed(many.slice(1))).fetchByDate('2026-10-10');
    expect(whole).toHaveLength(299);
    expect(fetchMeta(whole)?.complete).toBe(true);
  });

  it('a window refuses it: the tail it lost may be the days the window asked for', async () => {
    // 300 fixtures early in October and one on the 30th: a month's response cut
    // at the limit would hold only the first 300, and every one of them parses.
    const early: Ev[] = Array.from({ length: 300 }, (_, i) => ({ id: String(1000 + i), date: '2026-10-02T18:00Z' }));
    const cut = (async (input: unknown) => {
      const url = String(input);
      return new URL(url).searchParams.get('dates') === '202610'
        ? json({ leagues: [{ season: SEASON }], events: early.map(event) })
        : json({ leagues: [{ season: SEASON }], events: [] });
    }) as unknown as typeof fetch;
    const a = new EspnAdapter({ competition: 'mex.1', enrichGroups: false, fetchImpl: cut });
    await expect(a.fetchWindow('2026-10-25', '2026-10-31')).rejects.toThrow(/filled its limit/);
    // The same for a day part of a short window.
    const many: Ev[] = Array.from({ length: 300 }, (_, i) => ({ id: String(1000 + i), date: '2026-10-10T18:00Z' }));
    await expect(adapterOn(feed(many)).fetchWindow('2026-10-10', '2026-10-11')).rejects.toThrow(/filled its limit/);
  });
});

describe('the reads that were degraded, with the provider refusing every range', () => {
  // Bundled World Cup ids, so the overlay lands on the schedule.
  const OPENER: Ev = { id: '760415', date: '2026-06-11T19:00Z', state: 'post' };
  const wcEvent = (e: Ev, home: [string, string, string], away: [string, string, string], slug: string) => ({
    ...event(e),
    season: { slug },
    competitions: [
      {
        competitors: [
          { homeAway: 'home', score: '2', team: { id: home[0], abbreviation: home[1], displayName: home[2] } },
          { homeAway: 'away', score: '0', team: { id: away[0], abbreviation: away[1], displayName: away[2] } },
        ],
      },
    ],
  });
  const WC_SEASON = { year: 2026, startDate: '2026-06-11T04:00Z', endDate: '2026-12-31T04:59Z', displayName: '2026 FIFA World Cup' };
  function wcFeed() {
    const urls: string[] = [];
    const dates: string[] = [];
    const events = [
      wcEvent(OPENER, ['203', 'MEX', 'Mexico'], ['467', 'RSA', 'South Africa'], 'group-stage'),
      wcEvent({ id: '760517', date: '2026-07-19T19:00Z' }, ['164', 'ESP', 'Spain'], ['202', 'ARG', 'Argentina'], 'final'),
    ];
    const fetchImpl = (async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('/standings')) return json({});
      const asked = new URL(url).searchParams.get('dates') ?? '';
      dates.push(asked);
      if (asked.includes('-')) return json({ code: 400, message: 'Failed to get events endpoint.' }, 400);
      const hit = (e: { date: string }) =>
        asked.length === 8 ? easternDay(e.date) === asked : easternDay(e.date).startsWith(asked);
      return json({ leagues: [{ season: WC_SEASON }], events: events.filter(hit) });
    }) as unknown as typeof fetch;
    return { fetchImpl, urls, dates };
  }
  const wcAdapter = (f: { fetchImpl: typeof fetch }, enrichGroups = false) =>
    new EspnAdapter({ competition: 'fifa.world', enrichGroups, fetchImpl: f.fetchImpl });

  it('a date: served, from three day requests', async () => {
    const f = wcFeed();
    const r = await getMatchesForDate(wcAdapter(f), '2026-06-11');
    expect(r.degraded).toBe(false);
    expect(r.matches.find((m) => m.id === '760415')).toMatchObject({ status: 'FT', score: { home: 2, away: 0 } });
    expect([...f.dates].sort()).toEqual(['20260610', '20260611', '20260612']);
  });

  it('a match by id: served', async () => {
    const f = wcFeed();
    const r = await getMatchById(wcAdapter(f), '760415');
    expect(r.degraded).toBe(false);
    expect(r.match?.status).toBe('FT');
    expect(f.dates.some((d) => d.includes('-'))).toBe(false);
  });

  it('live: served, and it still asks for a day either side (the conservative coverage is kept)', async () => {
    const f = wcFeed();
    const r = await getLiveMatches(wcAdapter(f), new Date('2026-06-11T20:00Z'));
    expect(r.degraded).toBe(false);
    expect([...f.dates].sort()).toEqual(['20260610', '20260611', '20260612']);
  });

  it('the knockout span: served, from the two months it touches, and only its fixtures', async () => {
    const f = wcFeed();
    const r = await getKnockoutFixtures(wcAdapter(f), new Date('2026-07-14T12:00Z'));
    expect(r.degraded).toBe(false);
    expect(r.fixtures.map((m) => m.id)).toEqual(['760517']);
    expect(r.fixtures[0]?.home.name).toBe('Spain');
    expect([...f.dates].sort()).toEqual(['202606', '202607']);
    expect(r.complete).toBeUndefined();
  });

  it('next and the bracket: served', async () => {
    const next = await getNextFixtureForTeam(wcAdapter(wcFeed()), 'ESP', new Date('2026-07-14T12:00Z'));
    expect(next).toMatchObject({ degraded: false, source: 'espn' });
    expect(next.fixture?.id).toBe('760517');
    const bracket = await getBracket(wcAdapter(wcFeed()), { stage: 'F' });
    expect(bracket.degraded).toBe(false);
  });

  it('what each read costs, counted: the scoreboard requests and the one standings request beside them', async () => {
    const count = async (run: (a: EspnAdapter) => Promise<unknown>, enrich: boolean) => {
      const f = wcFeed();
      await run(wcAdapter(f, enrich));
      return { scoreboard: f.dates.length, standings: f.urls.filter((u) => u.includes('/standings')).length };
    };
    // The refresher's adapter (no group enrichment).
    expect(await count((a) => getLiveMatches(a, new Date('2026-06-11T20:00Z')), false)).toEqual({ scoreboard: 3, standings: 0 });
    expect(await count((a) => getKnockoutFixtures(a, new Date('2026-07-14T12:00Z')), false)).toEqual({ scoreboard: 2, standings: 0 });
    // An interactive adapter (group letters from standings, shared by the parts of one call).
    expect(await count((a) => getLiveMatches(a, new Date('2026-06-11T20:00Z')), true)).toEqual({ scoreboard: 3, standings: 1 });
    expect(await count((a) => getMatchesForDate(a, '2026-06-11'), true)).toEqual({ scoreboard: 3, standings: 1 });
    expect(await count((a) => getMatchById(a, '760415'), true)).toEqual({ scoreboard: 3, standings: 1 });
    expect(await count((a) => getNextFixtureForTeam(a, 'ESP', new Date('2026-07-14T12:00Z')), true)).toEqual({ scoreboard: 2, standings: 1 });
  });

  it('a market read keeps the tie the overlay resolved when its second read fails', async () => {
    // `markets next` reads the knockout span, then the candidate's own days.
    // When that second read failed, the answer fell back to the BUNDLED
    // fixture, which for a knockout tie is a placeholder.
    const f = wcFeed();
    const daysDown = (async (input: unknown) => {
      const dates = new URL(String(input)).searchParams.get('dates') ?? '';
      return dates.length === 8 ? json({}, 503) : f.fetchImpl(input as string);
    }) as unknown as typeof fetch;
    const adapter = new EspnAdapter({ competition: 'fifa.world', enrichGroups: false, fetchImpl: daysDown });
    const r = await marketFixtureForTeam(adapter, 'ESP', new Date('2026-07-19T19:30Z'));
    expect(r.degraded).toBe(true);
    expect(r.match?.id).toBe('760517');
    expect(r.match?.home.name).toBe('Spain');
    expect(r.match?.away.name).toBe('Argentina');
  });

  it('a match that kicked off on the provider’s previous day is still found in play the next morning', async () => {
    // 03:30Z is 23:30 the evening before for the provider; at 08:30Z (04:30
    // there) the day either side of "now" is what holds it.
    const late: Ev = { id: '760415', date: '2026-06-12T03:30Z', state: 'in' };
    const urls: string[] = [];
    const fetchImpl = (async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      const asked = new URL(url).searchParams.get('dates') ?? '';
      if (asked.includes('-')) return json({ code: 400 }, 400);
      return json({
        leagues: [{ season: WC_SEASON }],
        events: easternDay(late.date) === asked ? [wcEvent(late, ['203', 'MEX', 'Mexico'], ['467', 'RSA', 'South Africa'], 'group-stage')] : [],
      });
    }) as unknown as typeof fetch;
    const r = await getLiveMatches(wcAdapter({ fetchImpl }), new Date('2026-06-12T08:30Z'));
    expect(r.degraded).toBe(false);
    expect(r.matches.map((m) => m.id)).toEqual(['760415']);
  });

  it('what a read costs when the standings request beside it FAILS: it is asked again by each later read of the same call', async () => {
    // The one-standings-request figure holds when that request succeeds (its
    // answer is shared for 30 seconds). A failure is never kept, so a call that
    // reads twice asks twice. Counted, so the budget states both.
    const row = (id: string, code: string, name: string, rank: number) => ({
      team: { id, abbreviation: code, displayName: name },
      stats: ['gamesPlayed', 'wins', 'ties', 'losses', 'pointsFor', 'pointsAgainst', 'pointDifferential', 'points']
        .map((n) => ({ name: n, value: 0 }))
        .concat({ name: 'rank', value: rank }),
    });
    const TABLES = {
      children: [
        {
          name: 'Group A',
          standings: { entries: [row('203', 'MEX', 'Mexico', 1), row('467', 'RSA', 'South Africa', 2), row('451', 'KOR', 'South Korea', 3), row('450', 'CZE', 'Czechia', 4)] },
        },
      ],
    };
    const count = async (run: (a: EspnAdapter) => Promise<unknown>, standingsStatus: number) => {
      const f = wcFeed();
      const urls: string[] = [];
      const fetchImpl = (async (input: unknown) => {
        const url = String(input);
        urls.push(url);
        if (url.includes('/standings')) return standingsStatus === 200 ? json(TABLES) : json({}, standingsStatus);
        return f.fetchImpl(input as string);
      }) as unknown as typeof fetch;
      await run(new EspnAdapter({ competition: 'fifa.world', enrichGroups: true, fetchImpl }));
      const standings = urls.filter((u) => u.includes('/standings')).length;
      return { scoreboard: urls.length - standings, standings };
    };
    const final = new Date('2026-07-19T19:30Z');
    // The bracket reads the span, then the tables.
    expect(await count((a) => getBracket(a, {}), 200)).toEqual({ scoreboard: 2, standings: 1 });
    expect(await count((a) => getBracket(a, {}), 503)).toEqual({ scoreboard: 2, standings: 2 });
    // A market read for a team with a tie in play reads the span, then the tie's own days.
    expect(await count((a) => marketFixtureForTeam(a, 'ESP', final), 200)).toEqual({ scoreboard: 5, standings: 1 });
    expect(await count((a) => marketFixtureForTeam(a, 'ESP', final), 503)).toEqual({ scoreboard: 5, standings: 2 });
    // A read that makes one window asks once either way.
    expect(await count((a) => getMatchesForDate(a, '2026-06-11'), 503)).toEqual({ scoreboard: 3, standings: 1 });
  });

  it('an answer that left a record out also says which fixtures it DID read, whatever became of them', async () => {
    // Found in review. The refresher keeps a held fixture the answer "does not
    // mention". Asked of the upcoming, resolved list, a tie the answer read and
    // set aside (postponed, cancelled, played, no longer resolved) looked
    // unmentioned, and its old scheduled copy was put back.
    const f = wcFeed();
    const july = (async (input: unknown) => {
      const res = await f.fetchImpl(input as string);
      if (!String(input).includes('dates=202607')) return res;
      const body = (await res.json()) as { events: unknown[] };
      body.events.push(
        wcEvent({ id: '760516', date: '2026-07-18T19:00Z', raw: { status: { type: { name: 'STATUS_POSTPONED', state: 'pre' } } } }, ['478', 'FRA', 'France'], ['205', 'BRA', 'Brazil'], '3rd-place-match'),
        event({ id: '760514', date: '2026-07-14T19:00Z', raw: { status: { type: { name: 'STATUS_NEW', state: 'limbo' } } } }),
      );
      return json(body);
    }) as unknown as typeof fetch;
    const r = await getKnockoutFixtures(new EspnAdapter({ competition: 'fifa.world', enrichGroups: false, fetchImpl: july }), new Date('2026-07-14T12:00Z'));
    expect(r.complete).toBe(false);
    expect(r.fixtures.map((m) => m.id)).toEqual(['760517']);
    // The postponed tie was read; the refused record was not. June's opener is
    // outside the span and not a knockout tie, and it was read: this is every
    // fixture the two month responses held, not what the read returns.
    expect([...(r.mentioned ?? [])].sort()).toEqual(['760415', '760516', '760517']);
    // A tie the provider moved OUT of the span was read too (July's response
    // holds it): it is not in the fixtures, and it is in what was read.
    const movedOut = (async (input: unknown) => {
      const res = await f.fetchImpl(input as string);
      if (!String(input).includes('dates=202607')) return res;
      const body = (await res.json()) as { events: unknown[] };
      body.events.push(
        wcEvent({ id: '760516', date: '2026-07-25T19:00Z' }, ['478', 'FRA', 'France'], ['205', 'BRA', 'Brazil'], '3rd-place-match'),
        event({ id: '760514', date: '2026-07-14T19:00Z', raw: { status: { type: { name: 'STATUS_NEW', state: 'limbo' } } } }),
      );
      return json(body);
    }) as unknown as typeof fetch;
    const out = await getKnockoutFixtures(new EspnAdapter({ competition: 'fifa.world', enrichGroups: false, fetchImpl: movedOut }), new Date('2026-07-14T12:00Z'));
    expect(out.fixtures.map((m) => m.id)).toEqual(['760517']);
    expect(out.mentioned).toContain('760516');
    // A whole answer has no need to say.
    const whole = await getKnockoutFixtures(wcAdapter(wcFeed()), new Date('2026-07-14T12:00Z'));
    expect(whole.mentioned).toBeUndefined();
  });

  it('an answer that left a record out says so, so a caller does not take an absence for a fact', async () => {
    const f = wcFeed();
    const withBroken = (async (input: unknown) => {
      const res = await f.fetchImpl(input as string);
      const url = String(input);
      if (!url.includes('dates=202607')) return res;
      const body = (await res.json()) as { events: unknown[] };
      // Two teams, and a status the parser does not know: refused, not "not a fixture".
      body.events.push(event({ id: '760516', date: '2026-07-18T19:00Z', raw: { status: { type: { name: 'STATUS_NEW', state: 'limbo' } } } }));
      return json(body);
    }) as unknown as typeof fetch;
    const r = await getKnockoutFixtures(new EspnAdapter({ competition: 'fifa.world', enrichGroups: false, fetchImpl: withBroken }), new Date('2026-07-14T12:00Z'));
    expect(r.degraded).toBe(false);
    expect(r.fixtures.map((m) => m.id)).toEqual(['760517']);
    expect(r.complete).toBe(false);
  });
});
