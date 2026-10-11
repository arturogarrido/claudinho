/**
 * The cached market read hands the provider the request's clock on EVERY branch: the free source (`fake`/`none`,
 * the test setup's pin) and the Polymarket memory-cache miss, not only an injected provider. A provider stamps a
 * signal's staleness with the clock it is handed (`options.now`); a branch that hands none lets it stamp by the
 * wall clock.
 */
import { allFixtures, buildMarketSignal, type MarketProvider, valid } from '@claudinho/core';
import { afterEach, describe, expect, it } from 'vitest';
import { cachedMarketSignals } from '../src/tools';

const CLOCK = new Date('2026-06-13T11:00:00.000Z');
function recording() {
  const seen: (Date | undefined)[] = [];
  const provider: MarketProvider = {
    name: 'recording',
    findSignal: async () => undefined,
    findSignals: async (_ms, options) => {
      seen.push(options?.now);
      return { results: new Map(), complete: true };
    },
  };
  return { seen, provider };
}
const SOURCE = process.env.CLAUDINHO_MARKETS_SOURCE;
afterEach(() => {
  if (SOURCE === undefined) delete process.env.CLAUDINHO_MARKETS_SOURCE;
  else process.env.CLAUDINHO_MARKETS_SOURCE = SOURCE;
});

describe("the cached market read hands the provider the request's clock on every branch", () => {
  it('the free source: the factory provider gets the clock', async () => {
    process.env.CLAUDINHO_MARKETS_SOURCE = 'none';
    const { seen, provider } = recording();
    await cachedMarketSignals({}, [{ ...allFixtures()[0]!, id: '991201' }], CLOCK, () => provider);
    expect(seen).toEqual([CLOCK]);
  });

  it('the Polymarket memory-cache miss: the factory provider gets the clock', async () => {
    process.env.CLAUDINHO_MARKETS_SOURCE = 'polymarket';
    const { seen, provider } = recording();
    await cachedMarketSignals({}, [{ ...allFixtures()[0]!, id: '991202' }], CLOCK, () => provider);
    expect(seen).toEqual([CLOCK]);
  });
});


/**
 * A cache hit is judged by the request's clock too. The Polymarket branch keeps what it fetched (the MCP server's
 * memory, its TTL on the wall clock); a later request reads it back and the signal's staleness is derived from its `asOf`
 * against THAT request's clock, never the wall clock and never the writer's.
 */
describe("a cached signal is judged by the reading request's clock", () => {
  const T = new Date('2026-06-13T11:00:00.000Z');
  const asOf = new Date(T.getTime() - 5 * 60_000); // five minutes before T: fresh at T
  function pricing() {
    let calls = 0;
    const provider: MarketProvider = {
      name: 'pricing',
      findSignal: async () => undefined,
      findSignals: async (ms, options) => {
        calls += 1;
        return {
          results: new Map(
            ms.map((m) => [
              m.id,
              valid(
                buildMarketSignal({
                  match: m,
                  source: 'polymarket',
                  asOf: asOf.toISOString(),
                  fetchedAt: asOf.toISOString(),
                  outcomes: [
                    { kind: 'home', teamCode: m.home.code, label: m.home.name, probability: 0.56 },
                    { kind: 'draw', label: 'Draw', probability: 0.25 },
                    { kind: 'away', teamCode: m.away.code, label: m.away.name, probability: 0.19 },
                  ],
                  liquidity: 250_000,
                  now: options?.now,
                }),
              ),
            ] as const),
          ),
          complete: true,
        };
      },
    };
    return { provider, calls: () => calls };
  }
  const fixture = (id: string) => ({ ...allFixtures().find((m) => m.status === 'SCHEDULED')!, id });

  it('the same request clock twice: fetched once, fresh both times', async () => {
    process.env.CLAUDINHO_MARKETS_SOURCE = 'polymarket';
    const { provider, calls } = pricing();
    const m = fixture('991203');
    const first = await cachedMarketSignals({}, [m], T, () => provider);
    const second = await cachedMarketSignals({}, [m], T, () => provider);
    expect(calls()).toBe(1);
    expect(first.signals.get(m.id)?.stale).toBe(false);
    expect(second.signals.get(m.id)?.stale).toBe(false);
  });

  it('written under a later clock (stale then), read under an earlier one (fresh now): fresh, not refetched', async () => {
    process.env.CLAUDINHO_MARKETS_SOURCE = 'polymarket';
    const { provider, calls } = pricing();
    const m = fixture('991204');
    const later = new Date(T.getTime() + 30 * 60_000);
    const first = await cachedMarketSignals({}, [m], later, () => provider);
    expect(first.signals.get(m.id)?.stale).toBe(true);
    const second = await cachedMarketSignals({}, [m], T, () => provider);
    expect(calls()).toBe(1);
    expect(second.signals.get(m.id)?.stale).toBe(false);
  });
});
