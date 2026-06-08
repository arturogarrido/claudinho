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

// Each result kind maps to a separate Gamma binary market.
const mapping3way: MarketMappingTable = {
  '760415': { ruleType: 'match-result-90', home: '0xHOME', draw: '0xDRAW', away: '0xAWAY' },
};

/**
 * A real-shaped Gamma BINARY market (Yes/No) — field names and JSON-encoded
 * string arrays mirror the live Gamma API (verified). The "Yes" price is the
 * outcome's implied probability.
 */
function binary(yes: number, over: Record<string, unknown> = {}) {
  return {
    id: 'x',
    closed: false,
    active: true,
    outcomes: JSON.stringify(['Yes', 'No']),
    outcomePrices: JSON.stringify([String(yes), String(Number((1 - yes).toFixed(4)))]),
    liquidity: '120000',
    liquidityNum: 120000,
    volume: '500000',
    updatedAt: '2026-06-11T14:55:00Z',
    ...over,
  };
}

/** Fetch stub routing /markets/{id} to a per-id body — never hits the network. */
function fetchByMarket(byId: Record<string, unknown>): typeof fetch {
  return (async (url: string | URL) => {
    const id = decodeURIComponent(String(url).split('/markets/')[1]?.split('?')[0] ?? '');
    const body = byId[id];
    if (!body) return { ok: false, status: 404, statusText: 'NF', json: async () => ({}) };
    return { ok: true, status: 200, statusText: 'OK', json: async () => body };
  }) as unknown as typeof fetch;
}

const fetchThatThrows: typeof fetch = (async () => {
  throw new Error('fetch should not have been called');
}) as unknown as typeof fetch;

function provider(fetchImpl: typeof fetch): PolymarketProvider {
  return new PolymarketProvider({ fetchImpl, mapping: mapping3way, now: NOW });
}

describe('PolymarketProvider (binary Gamma markets)', () => {
  it('maps three binary Yes/No markets into a 1X2 signal', async () => {
    const sig = await provider(
      fetchByMarket({ '0xHOME': binary(0.56), '0xDRAW': binary(0.25), '0xAWAY': binary(0.19) }),
    ).findSignal(match());
    expect(sig?.source).toBe('polymarket');
    expect(sig?.sourceMarketId).toBe('0xHOME');
    expect(sig?.ambiguous).toBe(false);
    expect(sig?.favorite).toMatchObject({ kind: 'home', teamCode: 'MEX', strength: 'slight' });
    expect(sig?.outcomes.map((o) => o.kind)).toEqual(['home', 'draw', 'away']);
    expect(sig?.liquidity).toBe(120000);
    expect(sig?.stale).toBe(false);
  });

  it('normalizes "Yes" prices that carry vig (sum > 1)', async () => {
    const sig = await provider(
      fetchByMarket({ '0xHOME': binary(0.6), '0xDRAW': binary(0.27), '0xAWAY': binary(0.21) }),
    ).findSignal(match());
    const sum = (sig?.outcomes ?? []).reduce((s, o) => s + o.probability, 0);
    expect(sum).toBeCloseTo(1, 6);
    expect(sig?.favorite?.kind).toBe('home');
  });

  it('drops the signal when any leg is closed', async () => {
    const sig = await provider(
      fetchByMarket({
        '0xHOME': binary(0.56, { closed: true }),
        '0xDRAW': binary(0.25),
        '0xAWAY': binary(0.19),
      }),
    ).findSignal(match());
    expect(sig).toBeUndefined();
  });

  it('drops a group match missing the draw leg (ambiguous)', async () => {
    const noDraw: MarketMappingTable = {
      '760415': { ruleType: 'match-result-90', home: '0xHOME', away: '0xAWAY' },
    };
    const p = new PolymarketProvider({
      fetchImpl: fetchByMarket({ '0xHOME': binary(0.6), '0xAWAY': binary(0.4) }),
      mapping: noDraw,
      now: NOW,
    });
    expect(await p.findSignal(match())).toBeUndefined();
  });

  it('allows a two-way knockout line (no draw required)', async () => {
    const ko = match({ stage: 'R16', group: undefined });
    const koMap: MarketMappingTable = {
      '760415': { ruleType: 'match-winner', home: '0xHOME', away: '0xAWAY' },
    };
    const p = new PolymarketProvider({
      fetchImpl: fetchByMarket({ '0xHOME': binary(0.62), '0xAWAY': binary(0.38) }),
      mapping: koMap,
      now: NOW,
    });
    const sig = await p.findSignal(ko);
    expect(sig?.ambiguous).toBe(false);
    expect(sig?.favorite?.kind).toBe('home');
  });

  it('drops a leg with no priced "Yes" outcome', async () => {
    const sig = await provider(
      fetchByMarket({
        '0xHOME': binary(0.56, { outcomePrices: null }),
        '0xDRAW': binary(0.25),
        '0xAWAY': binary(0.19),
      }),
    ).findSignal(match());
    expect(sig).toBeUndefined();
  });

  it('never calls a non-allow-listed host', async () => {
    const p = new PolymarketProvider({
      fetchImpl: fetchThatThrows,
      baseUrl: 'https://evil.example.com',
      mapping: mapping3way,
      now: NOW,
    });
    expect(await p.findSignal(match())).toBeUndefined();
  });

  it('degrades to undefined when a mapped leg 404s', async () => {
    // home resolves, but draw/away are absent from the stub → 404 → throw → undefined.
    const sig = await provider(fetchByMarket({ '0xHOME': binary(0.56) })).findSignal(match());
    expect(sig).toBeUndefined();
  });

  it('returns undefined for an unmapped match without fetching', async () => {
    const p = new PolymarketProvider({ fetchImpl: fetchThatThrows, mapping: {}, now: NOW });
    expect(await p.findSignal(match())).toBeUndefined();
  });

  it('findSignals returns a map of mapped matches only', async () => {
    const p = provider(
      fetchByMarket({ '0xHOME': binary(0.56), '0xDRAW': binary(0.25), '0xAWAY': binary(0.19) }),
    );
    const m = await p.findSignals([match(), match({ id: 'unmapped' })]);
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

  it('defaults to Polymarket and switches to fake on demand', () => {
    expect(makeMarketProvider()).toBeInstanceOf(PolymarketProvider);
    expect(makeMarketProvider('polymarket')).toBeInstanceOf(PolymarketProvider);
    expect(makeMarketProvider('fake')).toBeInstanceOf(FakeMarketProvider);
  });

  it('honors CLAUDINHO_MARKETS_SOURCE=fake', () => {
    process.env.CLAUDINHO_MARKETS_SOURCE = 'fake';
    expect(makeMarketProvider()).toBeInstanceOf(FakeMarketProvider);
  });
});
