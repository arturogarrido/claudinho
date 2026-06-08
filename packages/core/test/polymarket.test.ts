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
const SLUG = 'fifwc-mex-rsa-2026-06-11';

const mapping3way: MarketMappingTable = {
  '760415': { eventSlug: SLUG, eventId: '351715' },
};

/** A real-shaped Gamma moneyline (binary Yes/No) market for one outcome. */
function market(slug: string, groupItemTitle: string, yes: number, over: Record<string, unknown> = {}) {
  return {
    id: `m-${slug}`,
    slug,
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
    active: true,
    closed: false,
    seriesSlug: 'soccer-fifwc',
    sport: { sport: 'fifwc' },
    updatedAt: '2026-06-11T14:55:00Z',
    markets: markets ?? [
      market(`${SLUG}-mex`, 'Mexico', 0.685),
      market(`${SLUG}-draw`, 'Draw (regular time)', 0.205),
      market(`${SLUG}-rsa`, 'South Africa', 0.105),
    ],
    ...over,
  };
}

/** Fetch stub for GET /events?slug=… — returns the event array (offline). */
function fetchEvent(ev: unknown): typeof fetch {
  return (async (url: string | URL) => {
    if (!String(url).includes('/events?slug=')) {
      return { ok: false, status: 404, statusText: 'NF', json: async () => [] };
    }
    return { ok: true, status: 200, statusText: 'OK', json: async () => [ev] };
  }) as unknown as typeof fetch;
}

const fetchThatThrows: typeof fetch = (async () => {
  throw new Error('fetch should not have been called');
}) as unknown as typeof fetch;

function provider(fetchImpl: typeof fetch): PolymarketProvider {
  return new PolymarketProvider({ fetchImpl, mapping: mapping3way, now: NOW });
}

describe('PolymarketProvider (Gamma event → 3 moneyline markets)', () => {
  it('maps an event into a normalized 1X2 signal', async () => {
    const sig = await provider(fetchEvent(event())).findSignal(match());
    expect(sig?.source).toBe('polymarket');
    expect(sig?.sourceMarketId).toBe('351715');
    expect(sig?.ambiguous).toBe(false);
    expect(sig?.outcomes.map((o) => o.kind)).toEqual(['home', 'draw', 'away']);
    expect(sig?.favorite).toMatchObject({ kind: 'home', teamCode: 'MEX', strength: 'clear' });
    expect(sig?.liquidity).toBe(120000);
    expect(sig?.stale).toBe(false);
  });

  it('reads each outcome from its market "Yes" price and normalizes', async () => {
    const sig = await provider(fetchEvent(event())).findSignal(match());
    const sum = (sig?.outcomes ?? []).reduce((s, o) => s + o.probability, 0);
    expect(sum).toBeCloseTo(1, 6);
    const home = sig?.outcomes.find((o) => o.kind === 'home');
    expect(home?.probability).toBeCloseTo(0.685 / (0.685 + 0.205 + 0.105), 4);
  });

  it('is independent of Polymarket home/away ordering (maps by team)', async () => {
    // Claudinho fixture lists South Africa as home — still resolves correctly.
    const reversed = match({
      home: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' },
      away: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
    });
    const sig = await provider(fetchEvent(event())).findSignal(reversed);
    expect(sig?.favorite).toMatchObject({ kind: 'away', teamCode: 'MEX' });
    expect(sig?.outcomes.find((o) => o.kind === 'home')?.teamCode).toBe('RSA');
  });

  it('drops a closed event', async () => {
    const sig = await provider(fetchEvent(event({ closed: true }))).findSignal(match());
    expect(sig).toBeUndefined();
  });

  it('drops an event from the wrong series', async () => {
    const sig = await provider(
      fetchEvent(event({ seriesSlug: 'soccer-epl', sport: { sport: 'soccer' } })),
    ).findSignal(match());
    expect(sig).toBeUndefined();
  });

  it('drops a closed leg', async () => {
    const ev = event({}, [
      market(`${SLUG}-mex`, 'Mexico', 0.685, { closed: true }),
      market(`${SLUG}-draw`, 'Draw', 0.205),
      market(`${SLUG}-rsa`, 'South Africa', 0.105),
    ]);
    expect(await provider(fetchEvent(ev)).findSignal(match())).toBeUndefined();
  });

  it('drops a group match missing the draw market (ambiguous)', async () => {
    const ev = event({}, [
      market(`${SLUG}-mex`, 'Mexico', 0.6),
      market(`${SLUG}-rsa`, 'South Africa', 0.4),
    ]);
    expect(await provider(fetchEvent(ev)).findSignal(match())).toBeUndefined();
  });

  it('allows a two-way knockout line (no draw market needed)', async () => {
    const ko = match({ stage: 'R16', group: undefined });
    const ev = event({}, [
      market(`${SLUG}-mex`, 'Mexico', 0.62),
      market(`${SLUG}-rsa`, 'South Africa', 0.38),
    ]);
    const sig = await provider(fetchEvent(ev)).findSignal(ko);
    expect(sig?.ambiguous).toBe(false);
    expect(sig?.favorite?.kind).toBe('home');
  });

  it('drops an incoherent market set (Yes prices do not sum to ~1)', async () => {
    const ev = event({}, [
      market(`${SLUG}-mex`, 'Mexico', 0.2),
      market(`${SLUG}-draw`, 'Draw', 0.2),
      market(`${SLUG}-rsa`, 'South Africa', 0.2),
    ]);
    expect(await provider(fetchEvent(ev)).findSignal(match())).toBeUndefined();
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
    const bad: typeof fetch = (async () => ({
      ok: false,
      status: 500,
      statusText: 'ERR',
      json: async () => [],
    })) as unknown as typeof fetch;
    expect(await provider(bad).findSignal(match())).toBeUndefined();
  });

  it('returns undefined for an unmapped match without fetching', async () => {
    const p = new PolymarketProvider({ fetchImpl: fetchThatThrows, mapping: {}, now: NOW });
    expect(await p.findSignal(match())).toBeUndefined();
  });

  it('findSignals returns a map of mapped matches only', async () => {
    const p = provider(fetchEvent(event()));
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
