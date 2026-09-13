import { emptyBatch } from '../trust/batch';
/**
 * Provider factory + graceful-degradation wrappers, mirroring `live.ts`'s
 * getMatchesForDate contract: a market signal is optional enrichment, so any
 * provider/network/parse error degrades to "no signal" and never throws.
 */
import { DEFAULT_COMPETITION } from '../adapters/espn';
import { resolveCompetition } from '../competition';
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
 * Competitions the market sidecar has per-match data for. Polymarket's football
 * moneylines live in the World Cup series (`soccer-fifwc`, the slugs
 * `deriveEventSlugs` builds); its league markets are season futures — champion,
 * top scorer, qualification — with no per-match legs to read. Outside this set
 * every fixture would derive a `fifwc-…` slug that cannot exist, so the sidecar
 * is switched off by construction instead of issuing doomed requests.
 */
export const MARKET_COMPETITIONS: ReadonlySet<string> = new Set([DEFAULT_COMPETITION]);

/** Whether the market sidecar can say anything about the active competition. */
export function marketsCoverCompetition(competition: string = resolveCompetition()): boolean {
  return MARKET_COMPETITIONS.has(competition);
}

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
      // The rule sits at construction so EVERY caller inherits it — the CLI's
      // on-disk cache path and the MCP server's in-memory one both ask this
      // factory for their provider. A competition without markets gets the
      // network-free no-op: a complete, honest "no signal" and zero requests.
      if (!marketsCoverCompetition()) return new FakeMarketProvider();
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

/** Batch fetch; never throws — an empty, INCOMPLETE batch on any error. */
export async function getMarketSignals(
  provider: MarketProvider,
  matches: readonly Match[],
  options?: MarketSignalOptions,
): Promise<MarketSignalsResult> {
  try {
    return await provider.findSignals(matches, options);
  } catch {
    return emptyBatch();
  }
}
