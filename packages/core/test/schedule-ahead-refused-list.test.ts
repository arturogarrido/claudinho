/**
 * 0.11 PR 2.6b — a month whose list held only records nobody could read.
 *
 * Discovery asks "no readable record" of the WHOLE answer, so it must tell a
 * refused list (the envelope was read, every record was refused) from an
 * envelope nobody could read. The adapter marks the first on its error
 * (`ProviderError.noReadableRecord`) and leaves the second as it was: both are
 * still `parse` failures to every reader of `kind`.
 *
 * Such a month read nothing, but its response did state a season. The answer
 * states one only when every month stated the same: with the refused month's
 * season left out, a month of ANOTHER season beside it would be "the answer's
 * season", and the refresher would replace a slice holding the refused month's
 * fixtures (a union keeps what was not read only while both seasons are the
 * same; another season replaces).
 */
import { describe, expect, it } from 'vitest';
import { EspnAdapter, ProviderError } from '../src/adapters/espn';
import { attachFetchMeta } from '../src/adapters/meta';
import { getScheduleAhead } from '../src/live';

type Season = { year: number; displayName: string };
const S2025: Season = { year: 2025, displayName: '2025-26 Liga MX' };
const S2026: Season = { year: 2026, displayName: '2026-27 Liga MX' };

function event(id: string, date: string) {
  return {
    id,
    date,
    season: { slug: 'regular-season' },
    status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' }, period: 0 },
    competitions: [
      {
        competitors: [
          { homeAway: 'home', score: '0', team: { id: '227', abbreviation: 'AME', displayName: 'América' } },
          { homeAway: 'away', score: '0', team: { id: '219', abbreviation: 'GDL', displayName: 'Guadalajara' } },
        ],
      },
    ],
  };
}
const UNREADABLE = { id: 'not an id', date: 'garbage' };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/** Each `dates` asked gets its own body; anything else, an empty month that states 2026. */
function feed(bodies: Record<string, unknown>) {
  const asked: string[] = [];
  const fetchImpl = (async (input: unknown) => {
    const dates = new URL(String(input)).searchParams.get('dates') ?? '';
    asked.push(dates);
    return json(bodies[dates] ?? { leagues: [{ season: S2026 }], events: [] });
  }) as unknown as typeof fetch;
  return { fetchImpl, asked };
}
const adapterOn = (fetchImpl: typeof fetch, now: Date) =>
  new EspnAdapter({ competition: 'mex.1', enrichGroups: false, fetchImpl, now: () => now.getTime() });

// Oct 25 2026, 15:00Z: the span is Oct 24 to Nov 8, two months.
const NOW = new Date('2026-10-25T15:00:00Z');
const october = (season: Season | undefined) => ({ leagues: [season ? { season } : {}], events: [event('30', '2026-10-28T23:00Z')] });
const refusedList = (season: Season | undefined) => ({ leagues: [season ? { season } : {}], events: [UNREADABLE] });

describe('the adapter marks a refused list, and only that', () => {
  it('a list whose every record was refused: a `parse` failure that says so, with the season its response stated', async () => {
    const { fetchImpl } = feed({ '202611': refusedList(S2026) });
    const failure = await adapterOn(fetchImpl, NOW).fetchWindow('2026-11-01', '2026-11-30').catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ProviderError);
    expect(failure).toMatchObject({ kind: 'parse', noReadableRecord: { season: { year: 2026 } } });
  });

  it('a single read of such a list says so too', async () => {
    const { fetchImpl } = feed({ '20261103': refusedList(undefined) });
    const failure = await adapterOn(fetchImpl, NOW).fetchByDate('2026-11-03').catch((e: unknown) => e);
    expect(failure).toMatchObject({ kind: 'parse', noReadableRecord: {} });
  });

  for (const [what, body] of [
    ['an empty object', {}],
    ['`events` that is no list', { events: 'nope' }],
  ] as const) {
    it(`an envelope nobody could read (${what}) is not marked: it is not a refused list`, async () => {
      const { fetchImpl } = feed({ '202611': body });
      const failure = await adapterOn(fetchImpl, NOW).fetchWindow('2026-11-01', '2026-11-30').catch((e: unknown) => e);
      expect(failure).toMatchObject({ kind: 'parse' });
      expect((failure as ProviderError).noReadableRecord).toBeUndefined();
    });
  }

  it('a standings payload with no list of tables is not marked either', async () => {
    const fetchImpl = (async () => json({ leagues: [] })) as unknown as typeof fetch;
    const failure = await adapterOn(fetchImpl, NOW).fetchStandings().catch((e: unknown) => e);
    expect(failure).toMatchObject({ kind: 'parse' });
    expect((failure as ProviderError).noReadableRecord).toBeUndefined();
  });
});

describe('a refused month still states the season its response stated', () => {
  it('the same season as the month that was read: the answer states it', async () => {
    const { fetchImpl } = feed({ '202610': october(S2026), '202611': refusedList(S2026) });
    const r = await getScheduleAhead(adapterOn(fetchImpl, NOW), NOW);
    expect(r).toMatchObject({ degraded: false, complete: false, season: { year: 2026 } });
    expect(r.fixtures.map((m) => m.id)).toEqual(['30']);
  });

  it('ANOTHER season than the month that was read: the answer states none', async () => {
    const { fetchImpl } = feed({ '202610': october(S2026), '202611': refusedList(S2025) });
    const r = await getScheduleAhead(adapterOn(fetchImpl, NOW), NOW);
    expect(r.degraded).toBe(false);
    expect(r.season).toBeUndefined();
  });

  it('no season at all: the answer states none', async () => {
    const { fetchImpl } = feed({ '202610': october(S2026), '202611': refusedList(undefined) });
    const r = await getScheduleAhead(adapterOn(fetchImpl, NOW), NOW);
    expect(r.degraded).toBe(false);
    expect(r.season).toBeUndefined();
  });

  it('the refused month FIRST: the same rule, whichever month it is', async () => {
    // Nov 1 2026, 15:00Z: the span is Oct 31 to Nov 15; October is refused.
    const now = new Date('2026-11-01T15:00:00Z');
    const november = { leagues: [{ season: S2026 }], events: [event('31', '2026-11-07T23:00Z')] };
    for (const [season, year] of [
      [S2026, 2026],
      [S2025, undefined],
    ] as const) {
      const { fetchImpl } = feed({ '202610': refusedList(season), '202611': november });
      const r = await getScheduleAhead(adapterOn(fetchImpl, now), now);
      expect(r.fixtures.map((m) => m.id)).toEqual(['31']);
      expect(r.season?.year, String(season.year)).toBe(year);
    }
  });
});

describe('the whole discovery holds no readable record', () => {
  it('a month that read an EMPTY list beside a refused one: nothing was read, a failed discovery', async () => {
    const { fetchImpl } = feed({ '202610': { leagues: [{ season: S2026 }], events: [] }, '202611': refusedList(S2026) });
    expect(await getScheduleAhead(adapterOn(fetchImpl, NOW), NOW)).toEqual({ fixtures: [], degraded: true });
  });

  it('an adapter that throws something else for a month keeps the failed discovery it always was', async () => {
    // October reads a fixture; November throws an error that merely LOOKS like the
    // adapter's refusal. Only the adapter's own error says "a list nobody could read".
    const odd = {
      name: 'fake',
      competition: 'mex.1',
      capabilities: {},
      fetchByDate: async () => [],
      fetchLive: async () => [],
      fetchWindow: async (start: string) => {
        if (start.startsWith('2026-11')) throw Object.assign(new Error('no readable records'), { noReadableRecord: {} });
        return attachFetchMeta([{ id: '30', kickoff: '2026-10-28T23:00:00.000Z' }] as never[], { complete: true });
      },
    };
    expect(await getScheduleAhead(odd as never, NOW)).toEqual({ fixtures: [], degraded: true });
  });
});
