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

  it('resolves via the Polymarket team-code alias (COD→cdr) for both the slug and the outcome market', async () => {
    // Polymarket abbreviates DR Congo `cdr`, not FIFA `COD` — for the event slug
    // AND each outcome market's slug token. The event is served ONLY at the aliased
    // slug with a `cdr` away leg, so a signal proves the alias drove both the slug
    // derivation and pickMarket (pre-fix: derived `…-eng-cod-…` → miss; and even a
    // resolved event's `cdr` leg wouldn't match the `cod` code → no away market).
    const engCod = match({
      id: '760495',
      kickoff: '2026-07-01T16:00Z',
      home: { code: 'ENG', name: 'England', flag: '🏴' },
      away: { code: 'COD', name: 'DR Congo', flag: '🇨🇩' },
    });
    const ev = event(
      {
        id: 'ev-eng-cdr',
        slug: 'fifwc-eng-cdr-2026-07-01',
        title: 'England vs. DR Congo',
        startTime: '2026-07-01T16:00:00Z',
        updatedAt: '2026-07-01T15:00:00Z',
      },
      [
        market('eng', 'England', 0.76, { updatedAt: '2026-07-01T15:00:00Z' }),
        market('draw', 'Draw (England vs. DR Congo)', 0.18, { updatedAt: '2026-07-01T15:00:00Z' }),
        market('cdr', 'DR Congo', 0.05, { updatedAt: '2026-07-01T15:00:00Z' }),
      ],
    );
    const p = new PolymarketProvider({
      fetchImpl: fetchFor('fifwc-eng-cdr-2026-07-01', ev),
      now: new Date('2026-07-01T12:00:00Z'),
    });
    const sig = await p.findSignal(engCod);
    expect(sig?.source).toBe('polymarket');
    expect(sig?.outcomes.map((o) => o.kind)).toEqual(['home', 'draw', 'away']);
    expect(sig?.outcomes.find((o) => o.kind === 'away')?.teamCode).toBe('COD');
    expect(sig?.favorite).toMatchObject({ kind: 'home', teamCode: 'ENG' });
  });

  it('resolves a home-side alias team too (NED→nld)', async () => {
    // Belt-and-suspenders: the COD case exercises the AWAY alias; this covers the
    // HOME slot going through the alias in both the slug and the outcome match.
    const nedSwe = match({
      id: '760xxx',
      kickoff: '2026-06-20T16:00Z',
      home: { code: 'NED', name: 'Netherlands', flag: '🇳🇱' },
      away: { code: 'SWE', name: 'Sweden', flag: '🇸🇪' },
    });
    const ev = event(
      {
        id: 'ev-nld-swe',
        slug: 'fifwc-nld-swe-2026-06-20',
        title: 'Netherlands vs. Sweden',
        startTime: '2026-06-20T16:00:00Z',
        updatedAt: '2026-06-20T15:00:00Z',
      },
      [
        market('nld', 'Netherlands', 0.6, { updatedAt: '2026-06-20T15:00:00Z' }),
        market('draw', 'Draw (Netherlands vs. Sweden)', 0.25, { updatedAt: '2026-06-20T15:00:00Z' }),
        market('swe', 'Sweden', 0.15, { updatedAt: '2026-06-20T15:00:00Z' }),
      ],
    );
    const p = new PolymarketProvider({
      fetchImpl: fetchFor('fifwc-nld-swe-2026-06-20', ev),
      now: new Date('2026-06-20T12:00:00Z'),
    });
    const sig = await p.findSignal(nedSwe);
    expect(sig?.outcomes.find((o) => o.kind === 'home')?.teamCode).toBe('NED');
    expect(sig?.favorite).toMatchObject({ kind: 'home', teamCode: 'NED' });
  });

  it('enforces the enrichment deadline across a fixture’s alias candidate slugs (never blocks)', async () => {
    // ENG-COD derives up to 4 candidate slugs (2 dates × 2 away tokens). A slow,
    // always-empty feed must NOT fire all 4 — the per-fixture deadline (checked
    // between candidates, not just between fixtures) caps it. Regression for the
    // alias-expansion latency P2.
    let calls = 0;
    const slowEmpty = (async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 50));
      return { ok: true, status: 200, statusText: 'OK', json: async () => [] };
    }) as unknown as typeof fetch;
    const engCod = match({
      id: '760495',
      kickoff: '2026-07-01T16:00Z',
      home: { code: 'ENG', name: 'England', flag: '🏴' },
      away: { code: 'COD', name: 'DR Congo', flag: '🇨🇩' },
    });
    const p = new PolymarketProvider({ fetchImpl: slowEmpty, now: new Date('2026-07-01T12:00:00Z') });
    const start = Date.now();
    const { signals, checked } = await p.findSignals([engCod], { deadlineMs: 10 });
    const elapsed = Date.now() - start;
    expect(signals.size).toBe(0);
    expect(checked.has('760495')).toBe(false); // deadline-aborted → retried, not cached
    expect(calls).toBeLessThan(4); // did NOT fetch every candidate
    expect(elapsed).toBeLessThan(200); // bounded, not 4×(per-fetch delay)
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

  it('resolves a day-boundary kickoff via the prior-day slug (UTC date misses)', async () => {
    // MEX–ECU kicks off 01:00Z = Jun 30 evening in the Americas; Polymarket slugs
    // it `…-06-30`, but the UTC date is 07-01. The provider must try the UTC date
    // (miss) then the prior day (hit). Regression for the missing-market bug.
    const ko = match({
      id: '760491',
      stage: 'R32',
      group: undefined,
      kickoff: '2026-07-01T01:00Z',
      home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
      away: { code: 'ECU', name: 'Ecuador', flag: '🇪🇨' },
    });
    const upd = '2026-07-01T00:25:00Z';
    const ev = event({
      slug: 'fifwc-mex-ecu-2026-06-30',
      title: 'Mexico vs. Ecuador',
      startTime: '2026-07-01T01:00:00Z',
      updatedAt: upd,
      markets: [
        market('mex', 'Mexico', 0.45, { updatedAt: upd }),
        market('draw', 'Draw (regular time)', 0.32, { updatedAt: upd }),
        market('ecu', 'Ecuador', 0.23, { updatedAt: upd }),
      ],
    });
    // Only the prior-day slug serves the event; the UTC-date slug returns [].
    const p = new PolymarketProvider({
      fetchImpl: fetchFor('fifwc-mex-ecu-2026-06-30', ev),
      now: new Date('2026-07-01T00:30:00Z'),
    });
    const sig = await p.findSignal(ko);
    expect(sig?.source).toBe('polymarket');
    expect(sig?.outcomes.map((o) => o.kind)).toEqual(['home', 'draw', 'away']);
    expect(sig?.favorite).toMatchObject({ kind: 'home', teamCode: 'MEX' });
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

describe('PolymarketProvider — team-market mapping (no draw mislabel)', () => {
  it('uses an exact title match and never picks the draw market for a team', async () => {
    // Home market's slug token ('mexico') differs from the FIFA code ('mex'),
    // forcing the title fallback; the draw title contains "Mexico" but must NOT match.
    const ev = event({}, [
      market('mexico', 'Mexico', 0.685),
      market('draw', 'Draw (Mexico vs. South Africa)', 0.205),
      market('rsa', 'South Africa', 0.105),
    ]);
    const sig = await derived(fetchFor(SLUG, ev)).findSignal(match());
    expect(sig?.favorite).toMatchObject({ kind: 'home', teamCode: 'MEX', strength: 'clear' });
    const home = sig?.outcomes.find((o) => o.kind === 'home');
    expect(home?.probability).toBeCloseTo(0.685 / (0.685 + 0.205 + 0.105), 4);
  });

  it('rejects a payload where two legs share a market id', async () => {
    const ev = event({}, [
      market('mex', 'Mexico', 0.5, { id: 'DUP' }),
      market('draw', 'Draw', 0.2),
      market('rsa', 'South Africa', 0.3, { id: 'DUP' }),
    ]);
    expect(await derived(fetchFor(SLUG, ev)).findSignal(match())).toBeUndefined();
  });
});

describe('PolymarketProvider — batch + deadline + checked semantics', () => {
  it('stops fetching at the total deadline', async () => {
    let calls = 0;
    const counting: typeof fetch = (async () => {
      calls++;
      return { ok: true, status: 200, statusText: 'OK', json: async () => [event()] };
    }) as unknown as typeof fetch;
    const p = new PolymarketProvider({ fetchImpl: counting, now: NOW });
    const out = await p.findSignals([match(), match({ id: 'b' })], { deadlineMs: 0 });
    expect(out.signals.size).toBe(0);
    expect(calls).toBe(0);
  });

  it('returns signals + the set of resolvable matches', async () => {
    const p = derived(fetchFor(SLUG, event()));
    const other = match({ id: 'x', home: { code: 'AAA', name: 'A', flag: '' }, away: { code: 'BBB', name: 'B', flag: '' } });
    const { signals, checked } = await p.findSignals([match(), other]);
    expect(signals.size).toBe(1);
    expect(signals.get('760415')?.source).toBe('polymarket');
    expect(checked.has('760415')).toBe(true);
    expect(checked.has('x')).toBe(true);
  });

  it('marks no-event / 404 / unmappable as checked, but a provider error as NOT checked', async () => {
    const empty: typeof fetch = (async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => [] })) as unknown as typeof fetch;
    expect((await derived(empty).findSignals([match()])).checked.has('760415')).toBe(true);

    const notFound: typeof fetch = (async () => ({ ok: false, status: 404, statusText: 'NF', json: async () => ({}) })) as unknown as typeof fetch;
    expect((await derived(notFound).findSignals([match()])).checked.has('760415')).toBe(true);

    const boom: typeof fetch = (async () => {
      throw new Error('dns');
    }) as unknown as typeof fetch;
    expect((await derived(boom).findSignals([match()])).checked.has('760415')).toBe(false);

    const tbd = match({ id: 'tbd1', home: { code: 'TBD', name: 'TBD', flag: '' } });
    expect((await derived(boom).findSignals([tbd])).checked.has('tbd1')).toBe(true);
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
