/**
 * The cached market read hands the provider the request's clock on EVERY branch: the free source (`fake`/`none`,
 * the test setup's pin) and the Polymarket memory-cache miss, not only an injected provider. A provider stamps a
 * signal's staleness with the clock it is handed (`options.now`); a branch that hands none lets it stamp by the
 * wall clock.
 */
import { allFixtures, type MarketProvider } from '@claudinho/core';
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
