/**
 * Polymarket public-data adapter — read-only prediction-market signals.
 *
 * STRICT read-only by design: it touches only the public Gamma markets data
 * endpoint. No auth, no wallet, no CLOB/order endpoints, no trading, and no
 * outbound links (sourceMarketId is opaque, never a URL). Any network/parse/host
 * error degrades to "no signal" — it never throws.
 *
 * Matches are mapped to markets via a hand-curated table (mapping.2026.json),
 * not fuzzy discovery: football market titles and rules are ambiguous, and a
 * wrong mapping would mislabel an outcome. The bundled table is empty for the
 * beta — populate it per docs/POLYMARKET_MARKET_PREDICTIONS.md.
 */
import type { Match } from '../types';
import mappingJson from './mapping.2026.json';
import { buildMarketSignal } from './normalize';
import type {
  MarketOutcome,
  MarketProvider,
  MarketSignal,
  MarketSignalOptions,
} from './types';

const DEFAULT_BASE = 'https://gamma-api.polymarket.com';
const ALLOWED_HOSTS = new Set(['gamma-api.polymarket.com']);
const USER_AGENT = 'claudinho/0.0 (+https://github.com/arturogarrido/claudinho)';
const DEFAULT_TIMEOUT_MS = 8000;

/** One match's manual mapping to a Polymarket market (group-stage beta only). */
export interface MarketMapping {
  /** Gamma market id. */
  marketId: string;
  /** Documents the matched market rule, e.g. "match-result-90". */
  ruleType: string;
  /** Map Polymarket outcome labels to our result kinds. */
  tokens: { home: string; draw?: string; away: string };
}

export type MarketMappingTable = Record<string, MarketMapping>;

interface MappingFile {
  version: number;
  note?: string;
  markets: MarketMappingTable;
}

const BUNDLED_MAPPING = (mappingJson as unknown as MappingFile).markets;

// Gamma market shape — only the fields we read. `outcomes`/`outcomePrices` come
// back as JSON-encoded string arrays; `liquidity`/`volume` as numeric strings.
interface GammaMarket {
  id?: string;
  question?: string;
  closed?: boolean;
  active?: boolean;
  outcomes?: unknown;
  outcomePrices?: unknown;
  liquidity?: unknown;
  liquidityNum?: unknown;
  volume?: unknown;
  volumeNum?: unknown;
  updatedAt?: string;
  endDate?: string;
}

export interface PolymarketProviderOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Base URL; must resolve to an allow-listed host. */
  baseUrl?: string;
  /** Override the bundled mapping table (tests / future gateway). */
  mapping?: MarketMappingTable;
  now?: Date;
  maxAgeMs?: number;
}

export class PolymarketProvider implements MarketProvider {
  readonly name = 'polymarket';

  constructor(private readonly opts: PolymarketProviderOptions = {}) {}

  async findSignal(
    match: Match,
    options?: MarketSignalOptions,
  ): Promise<MarketSignal | undefined> {
    const entry = (this.opts.mapping ?? BUNDLED_MAPPING)[match.id];
    if (!entry) return undefined; // not mapped → no signal (safe default)
    try {
      const market = await this.fetchMarket(entry.marketId);
      return this.toSignal(match, entry, market, options);
    } catch {
      return undefined; // network/parse/host error → degrade silently
    }
  }

  async findSignals(
    matches: Match[],
    options?: MarketSignalOptions,
  ): Promise<Map<string, MarketSignal>> {
    const out = new Map<string, MarketSignal>();
    // Sequential: the mapped beta set is small, and this respects rate limits.
    for (const m of matches) {
      const s = await this.findSignal(m, options);
      if (s) out.set(m.id, s);
    }
    return out;
  }

  private async fetchMarket(marketId: string): Promise<GammaMarket> {
    const base = this.opts.baseUrl ?? DEFAULT_BASE;
    assertAllowedHost(base);
    const url = `${base}/markets/${encodeURIComponent(marketId)}`;
    const doFetch = this.opts.fetchImpl ?? fetch;
    const res = await doFetch(url, {
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
    if (!res.ok) {
      throw new Error(`Polymarket request failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as GammaMarket;
  }

  private toSignal(
    match: Match,
    entry: MarketMapping,
    market: GammaMarket,
    options?: MarketSignalOptions,
  ): MarketSignal | undefined {
    // Reject closed/inactive markets outright.
    if (market.closed === true || market.active === false) return undefined;

    const labels = parseJsonArray(market.outcomes);
    const prices = parseJsonArray(market.outcomePrices).map((p) => Number(p));
    if (labels.length === 0 || labels.length !== prices.length) return undefined;

    const priceByLabel = new Map<string, number>();
    labels.forEach((label, i) => {
      const p = prices[i];
      if (typeof p === 'number' && Number.isFinite(p)) priceByLabel.set(label, p);
    });

    const home = priceByLabel.get(entry.tokens.home);
    const away = priceByLabel.get(entry.tokens.away);
    if (home == null || away == null) return undefined; // can't map a clean result

    const outcomes: MarketOutcome[] = [
      { kind: 'home', teamCode: match.home.code, label: match.home.name, probability: home },
    ];
    if (entry.tokens.draw) {
      const draw = priceByLabel.get(entry.tokens.draw);
      if (draw != null) outcomes.push({ kind: 'draw', label: 'Draw', probability: draw });
    }
    outcomes.push({
      kind: 'away',
      teamCode: match.away.code,
      label: match.away.name,
      probability: away,
    });

    const signal = buildMarketSignal({
      match,
      source: 'polymarket',
      sourceMarketId: entry.marketId,
      asOf: market.updatedAt ?? new Date().toISOString(),
      outcomes,
      liquidity: numberish(market.liquidityNum ?? market.liquidity),
      volume24h: numberish(market.volumeNum ?? market.volume),
      now: options?.now ?? this.opts.now,
      maxAgeMs: options?.maxAgeMs ?? this.opts.maxAgeMs,
    });
    // Adapter contract: a cleanly-mapped signal or nothing. An ambiguous result
    // (e.g. a group market that priced no draw) is dropped here.
    return signal.ambiguous ? undefined : signal;
  }
}

function assertAllowedHost(base: string): void {
  let host: string;
  try {
    host = new URL(base).host;
  } catch {
    throw new Error(`Invalid Polymarket base URL: ${base}`);
  }
  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error(`Polymarket host not allow-listed: ${host}`);
  }
}

/** Parse a value that may be an array or a JSON-encoded string array. */
function parseJsonArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === 'string') {
    try {
      const parsed: unknown = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Coerce a number or numeric string to a finite number, else undefined. */
function numberish(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}
