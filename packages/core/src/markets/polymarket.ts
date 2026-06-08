/**
 * Polymarket public-data adapter — read-only prediction-market signals.
 *
 * STRICT read-only by design: it touches only the public Gamma "markets" data
 * endpoint. No auth, no wallet, no CLOB/order endpoints, no trading, and no
 * outbound links (sourceMarketId is opaque, never a URL). Any network/parse/host
 * error degrades to "no signal" — it never throws.
 *
 * Payload model (verified against the live Gamma API): Polymarket markets are
 * BINARY (`outcomes: ["Yes","No"]`); a multi-outcome question is a negRisk
 * EVENT composed of one binary market per outcome. So a football 1X2 result is
 * up to three binary markets — home win / draw / away win — and each outcome's
 * probability is that market's "Yes" price. The hand-curated mapping therefore
 * points each result kind at a Gamma binary-market id (see mapping.2026.json).
 *
 * Matches are mapped by hand, not via fuzzy discovery: football market titles
 * and rules are ambiguous and a wrong mapping would mislabel an outcome. The
 * bundled table is empty for the beta — populate it per
 * docs/POLYMARKET_MARKET_PREDICTIONS.md.
 */
import type { Match } from '../types';
import mappingJson from './mapping.2026.json';
import { buildMarketSignal } from './normalize';
import type {
  MarketOutcome,
  MarketOutcomeKind,
  MarketProvider,
  MarketSignal,
  MarketSignalOptions,
} from './types';

const DEFAULT_BASE = 'https://gamma-api.polymarket.com';
const ALLOWED_HOSTS = new Set(['gamma-api.polymarket.com']);
const USER_AGENT = 'claudinho/0.0 (+https://github.com/arturogarrido/claudinho)';
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * One match's manual mapping. Each result kind points at a Gamma BINARY market
 * id whose "Yes" price is that outcome's probability. `draw` is required for a
 * group-stage 90' result and omitted for a two-way knockout line.
 */
export interface MarketMapping {
  /** Documents the matched market rule, e.g. "match-result-90". */
  ruleType: string;
  /** Binary-market id: "Yes" price = home-win probability. */
  home: string;
  /** Binary-market id: "Yes" price = draw probability (group stage). */
  draw?: string;
  /** Binary-market id: "Yes" price = away-win probability. */
  away: string;
}

export type MarketMappingTable = Record<string, MarketMapping>;

interface MappingFile {
  version: number;
  note?: string;
  markets: MarketMappingTable;
}

const BUNDLED_MAPPING = (mappingJson as unknown as MappingFile).markets;

// Gamma market shape — only the fields we read. `outcomes`/`outcomePrices` come
// back as JSON-encoded string arrays; `liquidity`/`volume` as numeric strings
// (with parallel `*Num` numeric fields).
interface GammaMarket {
  id?: string;
  closed?: boolean;
  active?: boolean;
  outcomes?: unknown;
  outcomePrices?: unknown;
  liquidity?: unknown;
  liquidityNum?: unknown;
  volume?: unknown;
  volumeNum?: unknown;
  updatedAt?: string;
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
      return await this.toSignal(match, entry, options);
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

  private async toSignal(
    match: Match,
    entry: MarketMapping,
    options?: MarketSignalOptions,
  ): Promise<MarketSignal | undefined> {
    // Each result kind is its own binary market; the "Yes" price is the
    // outcome's probability. home/away are required; draw is optional (knockout).
    const legs: Array<[MarketOutcomeKind, string | undefined, string | undefined, string]> = [
      ['home', entry.home, match.home.code, match.home.name],
      ['draw', entry.draw, undefined, 'Draw'],
      ['away', entry.away, match.away.code, match.away.name],
    ];

    const outcomes: MarketOutcome[] = [];
    let asOf: string | undefined;
    let liquidity: number | undefined;

    for (const [kind, marketId, teamCode, label] of legs) {
      if (!marketId) continue; // optional leg (e.g. no draw on a knockout line)
      const market = await this.fetchMarket(marketId);
      if (market.closed === true || market.active === false) return undefined;
      const yes = yesPrice(market);
      if (yes == null) return undefined; // can't price this leg → drop the signal
      outcomes.push({ kind, teamCode, label, probability: yes });
      // Oldest leg wins for asOf (most conservative for staleness); weakest leg
      // for liquidity (the signal is only as fresh/liquid as its thinnest market).
      if (market.updatedAt && (!asOf || market.updatedAt < asOf)) asOf = market.updatedAt;
      const liq = numberish(market.liquidityNum ?? market.liquidity);
      if (liq != null) liquidity = liquidity == null ? liq : Math.min(liquidity, liq);
    }

    const signal = buildMarketSignal({
      match,
      source: 'polymarket',
      sourceMarketId: entry.home,
      asOf: asOf ?? new Date().toISOString(),
      outcomes,
      liquidity,
      now: options?.now ?? this.opts.now,
      maxAgeMs: options?.maxAgeMs ?? this.opts.maxAgeMs,
    });
    // Adapter contract: a cleanly-mapped signal or nothing. An ambiguous result
    // (e.g. a group match missing its draw leg) is dropped here.
    return signal.ambiguous ? undefined : signal;
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

/**
 * The "Yes" price of a binary Gamma market = the outcome's implied probability.
 * Returns undefined when the market isn't a clean priced Yes/No (missing prices,
 * no "Yes" label, or an out-of-range value).
 */
function yesPrice(market: GammaMarket): number | undefined {
  const labels = parseJsonArray(market.outcomes);
  const prices = parseJsonArray(market.outcomePrices).map((p) => Number(p));
  if (labels.length === 0 || labels.length !== prices.length) return undefined;
  const i = labels.findIndex((l) => l.trim().toLowerCase() === 'yes');
  if (i < 0) return undefined;
  const p = prices[i];
  return typeof p === 'number' && Number.isFinite(p) && p > 0 && p <= 1 ? p : undefined;
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
