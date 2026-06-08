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

const mapping3way: MarketMappingTable = {
  '760415': {
    marketId: '0xMEXRSA',
    ruleType: 'match-result-90',
    tokens: { home: 'Mexico', draw: 'Draw', away: 'South Africa' },
  },
};

function gamma(over: Record<string, unknown> = {}) {
  return {
    id: '0xMEXRSA',
    question: 'Mexico vs South Africa',
    closed: false,
    active: true,
    outcomes: JSON.stringify(['Mexico', 'Draw', 'South Africa']),
    outcomePrices: JSON.stringify(['0.56', '0.25', '0.19']),
    liquidity: '120000',
    volume: '500000',
    updatedAt: '2026-06-11T14:55:00Z',
    ...over,
  };
}

/** A fetch stub returning a canned body — never touches the network. */
function fetchReturning(body: unknown, ok = true, status = 200): typeof fetch {
  return (async () => ({
    ok,
    status,
    statusText: ok ? 'OK' : 'ERR',
    json: async () => body,
  })) as unknown as typeof fetch;
}

const fetchThatThrows: typeof fetch = (async () => {
  throw new Error('fetch should not have been called');
}) as unknown as typeof fetch;

function provider(fetchImpl: typeof fetch): PolymarketProvider {
  return new PolymarketProvider({ fetchImpl, mapping: mapping3way, now: NOW });
}

describe('PolymarketProvider', () => {
  it('maps a clean 3-way Gamma market into a signal', async () => {
    const sig = await provider(fetchReturning(gamma())).findSignal(match());
    expect(sig?.source).toBe('polymarket');
    expect(sig?.sourceMarketId).toBe('0xMEXRSA');
    expect(sig?.ambiguous).toBe(false);
    expect(sig?.favorite).toMatchObject({ kind: 'home', teamCode: 'MEX', strength: 'slight' });
    expect(sig?.outcomes).toHaveLength(3);
    expect(sig?.liquidity).toBe(120000);
    expect(sig?.stale).toBe(false);
  });

  it('removes vig by normalizing prices', async () => {
    const sig = await provider(
      fetchReturning(gamma({ outcomePrices: JSON.stringify(['0.60', '0.27', '0.21']) })),
    ).findSignal(match());
    const sum = (sig?.outcomes ?? []).reduce((s, o) => s + o.probability, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('rejects a closed market', async () => {
    expect(await provider(fetchReturning(gamma({ closed: true }))).findSignal(match())).toBeUndefined();
  });

  it('rejects a group market missing the draw outcome (ambiguous)', async () => {
    const noDraw: MarketMappingTable = {
      '760415': {
        marketId: '0x2',
        ruleType: 'match-result-90',
        tokens: { home: 'Mexico', away: 'South Africa' },
      },
    };
    const p = new PolymarketProvider({
      fetchImpl: fetchReturning(
        gamma({
          outcomes: JSON.stringify(['Mexico', 'South Africa']),
          outcomePrices: JSON.stringify(['0.6', '0.4']),
        }),
      ),
      mapping: noDraw,
      now: NOW,
    });
    expect(await p.findSignal(match())).toBeUndefined();
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

  it('degrades to undefined on a non-OK response', async () => {
    expect(await provider(fetchReturning({}, false, 500)).findSignal(match())).toBeUndefined();
  });

  it('returns undefined for an unmapped match without fetching', async () => {
    const p = new PolymarketProvider({ fetchImpl: fetchThatThrows, mapping: {}, now: NOW });
    expect(await p.findSignal(match())).toBeUndefined();
  });

  it('findSignals returns a map of mapped matches only', async () => {
    const m = await provider(fetchReturning(gamma())).findSignals([
      match(),
      match({ id: 'unmapped' }),
    ]);
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
