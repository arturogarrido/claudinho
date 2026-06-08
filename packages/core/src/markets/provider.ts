/**
 * Provider factory + graceful-degradation wrappers, mirroring `live.ts`'s
 * getMatchesForDate contract: a market signal is optional enrichment, so any
 * provider/network/parse error degrades to "no signal" and never throws.
 */
import type { Match } from '../types';
import { FakeMarketProvider } from './fake';
import { PolymarketProvider } from './polymarket';
import type {
  MarketProvider,
  MarketSignal,
  MarketSignalOptions,
  MarketSignalsResult,
} from './types';

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
 * adapter; honors CLAUDINHO_MARKETS_SOURCE ('fake' = network-free synthetic
 * demo data; 'none'/'off' = network-free no-op). Tests usually inject directly.
 */
export function makeMarketProvider(source?: string): MarketProvider {
  switch (resolveMarketSource(source)) {
    case 'fake':
      return new FakeMarketProvider({ synthesize: true });
    case 'none':
    case 'off':
      return new FakeMarketProvider(); // no synth → yields no signals, no network
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

/** Batch fetch; never throws — empty result (nothing checked) on any error. */
export async function getMarketSignals(
  provider: MarketProvider,
  matches: Match[],
  options?: MarketSignalOptions,
): Promise<MarketSignalsResult> {
  try {
    return await provider.findSignals(matches, options);
  } catch {
    return { signals: new Map(), checked: new Set() };
  }
}
