import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FakeMarketProvider,
  makeMarketProvider,
  type Match,
  type MarketMappingTable,
  PolymarketProvider,
} from '../src/index';

function match(over: Partial<Match> = {}): Match {
  return {
    id: '760415',
    stage: 'GROUP',
    group: 'A',
    kickoff: '2026-06-11T19:00Z',
    venue: 'Estadio Banorte',
    home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
    away: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' },
    status: 'SCHEDULED',
    updatedAt: '2026-06-01T00:00Z',
    ...over,
  };
}

const NOW = new Date('2026-06-11T15:00:00Z');
const SLUG = 'fifwc-mex-rsa-2026-06-11'; // derived from match()

/** A real-shaped Gamma moneyline (binary Yes/No) market for one outcome. */
function market(token: string, groupItemTitle: string, yes: number, over: Record<string, unknown> = {}) {
  return {
    id: `m-${token}`,
    slug: `mkt-${token}`,
    groupItemTitle,
    sportsMarketType: 'moneyline',
    outcomes: JSON.stringify(['Yes', 'No']),
    outcomePrices: JSON.stringify([String(yes), String(Number((1 - yes).toFixed(4)))]),
    liquidityNum: 120000,
    active: true,
    closed: false,
    updatedAt: '2026-06-11T14:55:00Z',
    ...over,
  };
}

/** A real-shaped Gamma World Cup EVENT carrying its 3 moneyline markets. */
function event(over: Record<string, unknown> = {}, markets?: unknown[]) {
  return {
    id: '351715',
    slug: SLUG,
    title: 'Mexico vs. South Africa',
    startTime: '2026-06-11T19:00:00Z',
    active: true,
    closed: false,
    seriesSlug: 'soccer-fifwc',
    sport: { sport: 'fifwc' },
    updatedAt: '2026-06-11T14:55:00Z',
    markets: markets ?? [
      market('mex', 'Mexico', 0.685),
      market('draw', 'Draw (regular time)', 0.205),
      market('rsa', 'South Africa', 0.105),
    ],
    ...over,
  };
}

/** Fetch stub that only returns the event for the EXACT requested slug. */
function fetchFor(expectedSlug: string, ev: unknown): typeof fetch {
  return (async (url: string | URL) => {
    const slug = new URL(String(url)).searchParams.get('slug');
    return { ok: true, status: 200, statusText: 'OK', json: async () => (slug === expectedSlug ? [ev] : []) };
  }) as unknown as typeof fetch;
}

/** Fetch stub returning the event for any slug query. */
function fetchAny(ev: unknown): typeof fetch {
  return (async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => [ev] })) as unknown as typeof fetch;
}

const fetchThatThrows: typeof fetch = (async () => {
  throw new Error('fetch should not have been called');
}) as unknown as typeof fetch;

/** Provider with NO explicit mapping → slug is derived from the fixture. */
function derived(fetchImpl: typeof fetch): PolymarketProvider {
  return new PolymarketProvider({ fetchImpl, now: NOW });
}

describe('PolymarketProvider — slug derivation', () => {
  it('derives fifwc-{home}-{away}-{date} and maps the event into a 1X2 signal', async () => {
    const sig = await derived(fetchFor(SLUG, event())).findSignal(match());
    expect(sig?.source).toBe('polymarket');
    expect(sig?.sourceMarketId).toBe('351715');
    expect(sig?.ambiguous).toBe(false);
    expect(sig?.outcomes.map((o) => o.kind)).toEqual(['home', 'draw', 'away']);
    expect(sig?.favorite).toMatchObject({ kind: 'home', teamCode: 'MEX', strength: 'clear' });
    expect(sig?.liquidity).toBe(120000);
  });

  it('reads each outcome from its market "Yes" price and normalizes', async () => {
    const sig = await derived(fetchFor(SLUG, event())).findSignal(match());
    const sum = (sig?.outcomes ?? []).reduce((s, o) => s + o.probability, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('is independent of Polymarket home/away ordering (maps by team)', async () => {
    const reversed = match({
      home: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' },
      away: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
    });
    // reversed derives fifwc-rsa-mex-...; serve the event for that slug.
    const sig = await derived(fetchFor('fifwc-rsa-mex-2026-06-11', event({ slug: 'fifwc-rsa-mex-2026-06-11' }))).findSignal(
      reversed,
    );
    expect(sig?.favorite).toMatchObject({ kind: 'away', teamCode: 'MEX' });
    expect(sig?.outcomes.find((o) => o.kind === 'home')?.teamCode).toBe('RSA');
  });

  it('does not derive a slug for placeholder/TBD fixtures (no fetch)', async () => {
    const tbd = match({ home: { code: 'TBD', name: 'TBD', flag: '' } });
    const p = new PolymarketProvider({ fetchImpl: fetchThatThrows, now: NOW });
    expect(await p.findSignal(tbd)).toBeUndefined();
  });

  it('honors an explicit mapping override of the derived slug', async () => {
    const custom = 'fifwc-custom-2026-06-11';
    const mapping: MarketMappingTable = { '760415': { eventSlug: custom } };
    const p = new PolymarketProvider({
      fetchImpl: fetchFor(custom, event({ slug: custom })),
      mapping,
      now: NOW,
    });
    expect(await p.findSignal(match())).toBeDefined();
    // Without the override, the derived slug wouldn't match the served event.
    expect(await derived(fetchFor(custom, event({ slug: custom }))).findSignal(match())).toBeUndefined();
  });
});

describe('PolymarketProvider — fail-closed validation', () => {
  it('rejects an event whose slug does not match the requested slug', async () => {
    const sig = await derived(fetchAny(event({ slug: 'fifwc-other-2026-06-11' }))).findSignal(match());
    expect(sig).toBeUndefined();
  });

  it('rejects an event whose kickoff is outside tolerance', async () => {
    const sig = await derived(fetchFor(SLUG, event({ startTime: '2026-06-20T19:00:00Z' }))).findSignal(match());
    expect(sig).toBeUndefined();
  });

  it('rejects a market that resolves outside regular time', async () => {
    const ev = event({}, [
      market('mex', 'Mexico', 0.6, {
        description: 'Resolves Yes if Mexico advances, including extra time and penalties.',
      }),
      market('draw', 'Draw', 0.2),
      market('rsa', 'South Africa', 0.2),
    ]);
    expect(await derived(fetchFor(SLUG, ev)).findSignal(match())).toBeUndefined();
  });

  it('rejects a closed event / wrong series / closed leg', async () => {
    expect(await derived(fetchFor(SLUG, event({ closed: true }))).findSignal(match())).toBeUndefined();
    expect(
      await derived(fetchFor(SLUG, event({ seriesSlug: 'soccer-epl', sport: { sport: 'soccer' } }))).findSignal(match()),
    ).toBeUndefined();
    const closedLeg = event({}, [
      market('mex', 'Mexico', 0.685, { closed: true }),
      market('draw', 'Draw', 0.205),
      market('rsa', 'South Africa', 0.105),
    ]);
    expect(await derived(fetchFor(SLUG, closedLeg)).findSignal(match())).toBeUndefined();
  });

  it('drops a group match missing the draw market, allows a two-way knockout', async () => {
    const twoWay = (m?: Match) =>
      derived(
        fetchFor(m ? deriveSlug(m) : SLUG, event({ slug: m ? deriveSlug(m) : SLUG }, [
          market('mex', 'Mexico', 0.6),
          market('rsa', 'South Africa', 0.4),
        ])),
      ).findSignal(m ?? match());
    expect(await twoWay()).toBeUndefined(); // group stage needs a draw
    const ko = match({ stage: 'R16', group: undefined });
    const sig = await twoWay(ko);
    expect(sig?.ambiguous).toBe(false);
    expect(sig?.favorite?.kind).toBe('home');
  });

  it('rejects an incoherent market set (Yes prices do not sum to ~1)', async () => {
    const ev = event({}, [
      market('mex', 'Mexico', 0.2),
      market('draw', 'Draw', 0.2),
      market('rsa', 'South Africa', 0.2),
    ]);
    expect(await derived(fetchFor(SLUG, ev)).findSignal(match())).toBeUndefined();
  });

  it('never calls a non-allow-listed host, and degrades on a non-OK response', async () => {
    const evil = new PolymarketProvider({ fetchImpl: fetchThatThrows, baseUrl: 'https://evil.example.com', now: NOW });
    expect(await evil.findSignal(match())).toBeUndefined();
    const bad: typeof fetch = (async () => ({ ok: false, status: 500, statusText: 'ERR', json: async () => [] })) as unknown as typeof fetch;
    expect(await derived(bad).findSignal(match())).toBeUndefined();
  });
});

describe('PolymarketProvider — batch + deadline', () => {
  it('stops fetching at the total deadline', async () => {
    let calls = 0;
    const counting: typeof fetch = (async () => {
      calls++;
      return { ok: true, status: 200, statusText: 'OK', json: async () => [event()] };
    }) as unknown as typeof fetch;
    const p = new PolymarketProvider({ fetchImpl: counting, now: NOW });
    const out = await p.findSignals([match(), match({ id: 'b' })], { deadlineMs: 0 });
    expect(out.size).toBe(0);
    expect(calls).toBe(0);
  });

  it('findSignals returns a map of resolvable matches only', async () => {
    const p = derived(fetchFor(SLUG, event()));
    const other = match({ id: 'x', home: { code: 'AAA', name: 'A', flag: '' }, away: { code: 'BBB', name: 'B', flag: '' } });
    const m = await p.findSignals([match(), other]);
    expect(m.size).toBe(1);
    expect(m.get('760415')?.source).toBe('polymarket');
  });
});

describe('makeMarketProvider', () => {
  const prev = process.env.CLAUDINHO_MARKETS_SOURCE;
  beforeEach(() => {
    delete process.env.CLAUDINHO_MARKETS_SOURCE;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.CLAUDINHO_MARKETS_SOURCE;
    else process.env.CLAUDINHO_MARKETS_SOURCE = prev;
  });

  it('defaults to Polymarket and switches to fake / none on demand', () => {
    expect(makeMarketProvider()).toBeInstanceOf(PolymarketProvider);
    expect(makeMarketProvider('polymarket')).toBeInstanceOf(PolymarketProvider);
    expect(makeMarketProvider('fake')).toBeInstanceOf(FakeMarketProvider);
    expect(makeMarketProvider('none')).toBeInstanceOf(FakeMarketProvider);
  });

  it('honors CLAUDINHO_MARKETS_SOURCE=fake', () => {
    process.env.CLAUDINHO_MARKETS_SOURCE = 'fake';
    expect(makeMarketProvider()).toBeInstanceOf(FakeMarketProvider);
  });
});

/** Mirror of the adapter's slug derivation, for building per-fixture stubs. */
function deriveSlug(m: Match): string {
  return `fifwc-${m.home.code.toLowerCase()}-${m.away.code.toLowerCase()}-${m.kickoff.slice(0, 10)}`;
}
