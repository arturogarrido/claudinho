/**
 * 0.11 PR 2.1b — the knockout-facing RESULTS carry the window's own verdict.
 *
 * The surface tests (CLI and MCP `knockout-surface-coverage`) pin what a reader
 * sees; these pin the domain results underneath them, the one rule that turns
 * a read's account (`fetchMeta`) into the `partial` verdict, and the order a
 * card prints a qualifier in. A verdict is stated only when the read SAID its
 * answer was not whole: an adapter that says nothing states no verdict, and a
 * read that failed is `degraded`, not `partial`.
 */
import { describe, expect, it } from 'vitest';
import { EspnAdapter } from '../src/adapters/espn';
import { attachFetchMeta, type FetchMeta, fetchMeta } from '../src/adapters/meta';
import type { ProviderAdapter } from '../src/adapters/types';
import { formatShareBracket } from '../src/bracket/format';
import { getBracket, getKnockoutFixtures, getNextFixtureForTeam } from '../src/live';
import { formatShareSnippet } from '../src/share/format';
import type { Match } from '../src/types';
import { partialOfRead, verdictExtras, verdictNotice, verdictQualifiers } from '../src/verdict';

const KNOCKOUT_NOW = new Date('2026-06-28T12:00:00Z');
const MEX_FLAG = '\u{1F1F2}\u{1F1FD}';
const ECU_FLAG = '\u{1F1EA}\u{1F1E8}';
/** A confirmed R32 tie the provider filed over the bundled slot 760486. */
const tie = (): Match => ({
  id: '760486',
  stage: 'R32',
  kickoff: '2026-06-30T18:00Z',
  venue: 'SoFi Stadium',
  home: { code: 'MEX', name: 'Mexico', flag: MEX_FLAG },
  away: { code: 'ECU', name: 'Ecuador', flag: ECU_FLAG },
  status: 'SCHEDULED',
  updatedAt: '2026-06-28T00:00Z',
});

/** A knockout window that holds the tie and says `meta` about itself (or fails). */
function adapter(meta: FetchMeta | undefined, opts: { fail?: boolean } = {}): ProviderAdapter {
  return {
    name: 'espn',
    competition: 'fifa.world',
    capabilities: { push: false, latencyHintSec: 0 },
    async fetchByDate() {
      return [];
    },
    async fetchLive() {
      return [];
    },
    async fetchWindow() {
      if (opts.fail) throw new Error('the provider is down');
      const window = [tie()];
      return meta ? attachFetchMeta(window, meta) : window;
    },
  };
}

const reads = async (a: ProviderAdapter) => ({
  next: await getNextFixtureForTeam(a, 'MEX', KNOCKOUT_NOW),
  bracket: await getBracket(a, { stage: 'R32' }),
  knockout: await getKnockoutFixtures(a, KNOCKOUT_NOW),
});

describe('the knockout-facing results state `partial` from the window (0.11 2.1b)', () => {
  it('a window that said it was not whole: the verdict with its count, beside what was read, and not degraded', async () => {
    const { next, bracket, knockout } = await reads(adapter({ complete: false, omitted: 2 }));
    expect(next).toMatchObject({ degraded: false, source: 'espn', partial: { omitted: 2 } });
    expect(next.fixture?.id).toBe('760486');
    expect(bracket).toMatchObject({ degraded: false, source: 'espn', partial: { omitted: 2 } });
    expect(knockout).toMatchObject({ degraded: false, complete: false, partial: { omitted: 2 } });
    expect(knockout.fixtures.map((m) => m.id)).toEqual(['760486']);
  });

  it('without a count it can believe: the verdict without one', async () => {
    for (const omitted of [undefined, 0, -1, 1.5, Number.NaN]) {
      const meta: FetchMeta = omitted === undefined ? { complete: false } : { complete: false, omitted };
      const { next, bracket, knockout } = await reads(adapter(meta));
      for (const r of [next, bracket, knockout]) expect(r.partial, String(omitted)).toEqual({});
    }
  });

  it('a window that was whole, that said nothing, or that failed: no verdict', async () => {
    for (const [label, a] of [
      ['whole', adapter({ complete: true, omitted: 0 })],
      ['silent', adapter(undefined)],
      ['down', adapter({ complete: false, omitted: 1 }, { fail: true })],
    ] as const) {
      const { next, bracket, knockout } = await reads(a);
      for (const r of [next, bracket, knockout]) expect(r, label).not.toHaveProperty('partial');
    }
    // A failed read is the throw path: `degraded`, never `partial`.
    const down = await reads(adapter(undefined, { fail: true }));
    expect(down.next.degraded).toBe(true);
    expect(down.bracket.degraded).toBe(true);
    expect(down.knockout.degraded).toBe(true);
  });

  it('a team whose tie was the record left out: no fixture (never the bundled placeholder), and the verdict', async () => {
    const r = await getNextFixtureForTeam(adapter({ complete: false, omitted: 1 }), 'ARG', KNOCKOUT_NOW);
    expect(r.fixture).toBeUndefined();
    expect(r).toMatchObject({ degraded: false, partial: { omitted: 1 } });
  });
});

describe('a single read states the seasons it saw, as a window does', () => {
  const SEASON = { year: 2026, displayName: '2026-27 Liga MX' };
  const day = (body: unknown) =>
    new EspnAdapter({
      competition: 'mex.1',
      enrichGroups: false,
      fetchImpl: (async () =>
        new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch,
    }).fetchByDate('2026-10-10');

  it('one season, or an empty list when the response stated none', async () => {
    const stated = await day({ leagues: [{ season: SEASON }], events: [] });
    expect(fetchMeta(stated)?.seasons?.map((s) => s.year)).toEqual([2026]);
    expect(fetchMeta(stated)).toMatchObject({ complete: true, omitted: 0 });
    const silent = await day({ leagues: [{}], events: [] });
    expect(fetchMeta(silent)?.seasons).toEqual([]);
    expect(fetchMeta(silent)?.season).toBeUndefined();
  });
});

describe('a read’s account becomes the verdict in one place', () => {
  it('`partialOfRead`: only `complete: false` states it; the count only as a positive integer', () => {
    expect(partialOfRead(undefined)).toEqual({});
    expect(partialOfRead({})).toEqual({});
    expect(partialOfRead({ complete: true, omitted: 0 })).toEqual({});
    expect(partialOfRead({ complete: false })).toEqual({ partial: {} });
    expect(partialOfRead({ complete: false, omitted: 3 })).toEqual({ partial: { omitted: 3 } });
    expect(partialOfRead({ complete: false, omitted: 0 })).toEqual({ partial: {} });
    expect(partialOfRead({ complete: false, omitted: Number.POSITIVE_INFINITY })).toEqual({ partial: {} });
  });

  it('a replacement stands alone: no qualifier is printed beside it, and the keys carry every verdict', () => {
    const both = { unsupported: true, incomplete: true, partial: { omitted: 1 } };
    expect(verdictNotice(both, 'en')).toBe('Not available for this competition yet.');
    expect(verdictQualifiers(both, 'en')).toEqual([]);
    expect(verdictExtras(both)).toEqual({ unsupported: true, incomplete: true, partial: { omitted: 1 } });
    // A `partial` that is not an object states nothing.
    expect(verdictExtras({ partial: null } as unknown as { partial?: { omitted?: number } })).toEqual({});
    expect(verdictQualifiers({ partial: null } as unknown as { partial?: { omitted?: number } }, 'en')).toEqual([]);
  });
});

describe('a card prints its note BEFORE the body, populated or empty', () => {
  const NOTE = 'Fixture data may be incomplete (1 provider record omitted).';

  it('a match card', () => {
    const populated = formatShareSnippet({ title: 'Next up for Mexico', matches: [tie()], note: NOTE });
    expect(populated.indexOf(NOTE)).toBeGreaterThan(populated.indexOf('Next up for Mexico'));
    expect(populated.indexOf(NOTE)).toBeLessThan(populated.indexOf('Ecuador'));
    const empty = formatShareSnippet({ title: 'Next up for ARG', matches: [], emptyNote: 'No upcoming fixture found for ARG.', note: NOTE });
    expect(empty.indexOf(NOTE)).toBeGreaterThan(-1);
    expect(empty.indexOf(NOTE)).toBeLessThan(empty.indexOf('No upcoming fixture found for ARG.'));
  });

  it('a bracket card', () => {
    const view = { stages: [], degraded: false, standingsDegraded: false };
    const empty = formatShareBracket({ view, emptyNote: 'No bracket matches available.', note: NOTE });
    expect(empty.indexOf(NOTE)).toBeGreaterThan(-1);
    expect(empty.indexOf(NOTE)).toBeLessThan(empty.indexOf('No bracket matches available.'));
    // Without a note the card is what it was.
    expect(formatShareBracket({ view, emptyNote: 'No bracket matches available.' })).not.toContain('incomplete');
  });
});
