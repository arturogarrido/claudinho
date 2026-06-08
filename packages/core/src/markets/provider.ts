/**
 * Provider factory + graceful-degradation wrappers, mirroring `live.ts`'s
 * getMatchesForDate contract: a market signal is optional enrichment, so any
 * provider/network/parse error degrades to "no signal" and never throws.
 */
import type { Match } from '../types';
import { FakeMarketProvider } from './fake';
import { PolymarketProvider } from './polymarket';
import type { MarketProvider, MarketSignal, MarketSignalOptions } from './types';

/**
 * Resolve the market-data source: explicit arg > CLAUDINHO_MARKETS_SOURCE env >
 * 'polymarket' (mirrors resolveCompetition). Set CLAUDINHO_MARKETS_SOURCE=fake
 * to preview the UX with synthetic, clearly-labeled "demo data" odds.
 */
export function resolveMarketSource(explicit?: string): string {
  if (explicit) return explicit;
  if (typeof process !== 'undefined' && process.env?.CLAUDINHO_MARKETS_SOURCE) {
    return process.env.CLAUDINHO_MARKETS_SOURCE;
  }
  return 'polymarket';
}

/**
 * Construct a market-signal provider. Defaults to the Polymarket public-data
 * adapter; honors CLAUDINHO_MARKETS_SOURCE (e.g. 'fake' for the network-free
 * synthesizing provider used in local demos). Tests usually inject directly.
 */
export function makeMarketProvider(source?: string): MarketProvider {
  switch (resolveMarketSource(source)) {
    case 'fake':
      return new FakeMarketProvider({ synthesize: true });
    default:
      return new PolymarketProvider();
  }
}

/** Fetch one match's signal; never throws — undefined on any error. */
export async function getMarketSignal(
  provider: MarketProvider,
  match: Match,
  options?: MarketSignalOptions,
): Promise<MarketSignal | undefined> {
  try {
    return await provider.findSignal(match, options);
  } catch {
    return undefined;
  }
}

/** Batch fetch keyed by matchId; never throws — empty map on any error. */
export async function getMarketSignals(
  provider: MarketProvider,
  matches: Match[],
  options?: MarketSignalOptions,
): Promise<Map<string, MarketSignal>> {
  try {
    return await provider.findSignals(matches, options);
  } catch {
    return new Map();
  }
}
