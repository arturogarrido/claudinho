/**
 * Polymarket public-data adapter — read-only prediction-market signals.
 *
 * STRICT read-only by design: it touches only the public Gamma events/markets
 * data endpoint. No auth, no wallet, no CLOB/order endpoints, no trading, and no
 * outbound links (sourceMarketId is opaque, never a URL). Any network/parse/host
 * error degrades to "no signal" — it never throws.
 *
 * Payload model (verified against the live Gamma API, see
 * docs/POLYMARKET_MARKET_PREDICTIONS.md): a World Cup match is a Gamma EVENT
 * (`fifwc-{home}-{away}-{date}`) whose payload carries the three moneyline
 * BINARY markets — home win / draw / away win — in one response. Each market is
 * `outcomes: ["Yes","No"]`, and the outcome's probability is its "Yes" price.
 *
 * Matches are mapped by hand (matchId → event slug), not via fuzzy discovery:
 * football titles/rules are ambiguous and a wrong mapping would mislabel an
 * outcome. The bundled table is empty for the beta — populate it per the doc.
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
const WC_SERIES_SLUG = 'soccer-fifwc';
const WC_SPORT = 'fifwc';

/**
 * One match's mapping: the Gamma EVENT it lives in. The event payload carries
 * the three moneyline (home/draw/away) binary markets in a single response.
 */
export interface MarketMapping {
  /** Gamma event slug, e.g. "fifwc-mex-rsa-2026-06-11". */
  eventSlug: string;
  /** Optional Gamma event id (diagnostics; the slug is the lookup key). */
  eventId?: string;
}

export type MarketMappingTable = Record<string, MarketMapping>;

interface MappingFile {
  version: number;
  note?: string;
  markets: MarketMappingTable;
}

const BUNDLED_MAPPING = (mappingJson as unknown as MappingFile).markets;

// Gamma shapes — only the fields we read (verified against the live API).
// outcomes/outcomePrices are JSON-encoded string arrays; liquidity is numeric.
interface GammaMarket {
  id?: string;
  slug?: string;
  groupItemTitle?: string;
  sportsMarketType?: string;
  outcomes?: unknown;
  outcomePrices?: unknown;
  liquidityNum?: unknown;
  liquidity?: unknown;
  active?: boolean;
  closed?: boolean;
  updatedAt?: string;
}
interface GammaEvent {
  id?: string;
  slug?: string;
  title?: string;
  active?: boolean;
  closed?: boolean;
  seriesSlug?: string;
  sport?: { sport?: string };
  markets?: GammaMarket[];
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
      const event = await this.fetchEvent(entry.eventSlug);
      return event ? this.toSignal(match, entry, event, options) : undefined;
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

  private async fetchEvent(slug: string): Promise<GammaEvent | undefined> {
    const base = this.opts.baseUrl ?? DEFAULT_BASE;
    assertAllowedHost(base);
    const url = `${base}/events?slug=${encodeURIComponent(slug)}`;
    const doFetch = this.opts.fetchImpl ?? fetch;
    const res = await doFetch(url, {
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
    if (!res.ok) {
      throw new Error(`Polymarket request failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as unknown;
    const event = Array.isArray(data) ? data[0] : data;
    return event && typeof event === 'object' ? (event as GammaEvent) : undefined;
  }

  private toSignal(
    match: Match,
    entry: MarketMapping,
    event: GammaEvent,
    options?: MarketSignalOptions,
  ): MarketSignal | undefined {
    // Event must be live and, when typed, the World Cup match series.
    if (event.active === false || event.closed === true) return undefined;
    if (
      event.seriesSlug != null &&
      event.seriesSlug !== WC_SERIES_SLUG &&
      event.sport?.sport !== WC_SPORT
    ) {
      return undefined;
    }

    // Only moneyline (match-result) markets; map each to a result kind by team.
    const moneyline = (event.markets ?? []).filter(
      (m) => (m.sportsMarketType ?? 'moneyline') === 'moneyline',
    );
    const homeMarket = pickMarket(moneyline, match.home.code, match.home.name);
    const awayMarket = pickMarket(moneyline, match.away.code, match.away.name);
    const drawMarket = pickDraw(moneyline);
    if (!homeMarket || !awayMarket) return undefined; // need both result legs

    const legs: Array<[MarketOutcomeKind, GammaMarket | undefined, string | undefined, string]> = [
      ['home', homeMarket, match.home.code, match.home.name],
      ['draw', drawMarket, undefined, 'Draw'],
      ['away', awayMarket, match.away.code, match.away.name],
    ];

    const outcomes: MarketOutcome[] = [];
    let asOf = event.updatedAt;
    let liquidity: number | undefined;
    for (const [kind, market, teamCode, label] of legs) {
      if (!market) continue; // draw may be absent for a two-way knockout line
      if (market.closed === true || market.active === false) return undefined;
      const yes = yesPrice(market);
      if (yes == null) return undefined;
      outcomes.push({ kind, teamCode, label, probability: yes });
      if (market.updatedAt && (!asOf || market.updatedAt < asOf)) asOf = market.updatedAt;
      const liq = numberish(market.liquidityNum ?? market.liquidity);
      if (liq != null) liquidity = liquidity == null ? liq : Math.min(liquidity, liq);
    }

    // The raw "Yes" probabilities should form a coherent 1X2 before normalizing;
    // a sum well outside ~1 means we grabbed the wrong markets.
    const rawSum = outcomes.reduce((s, o) => s + o.probability, 0);
    if (rawSum < 0.9 || rawSum > 1.15) return undefined;

    const signal = buildMarketSignal({
      match,
      source: 'polymarket',
      sourceMarketId: entry.eventId ?? event.id ?? entry.eventSlug,
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
}

/** Last dash-segment of a market slug — the outcome token (`mex`/`draw`/`rsa`). */
function slugToken(m: GammaMarket): string {
  return (m.slug ?? '').toLowerCase().split('-').pop() ?? '';
}

/** Find a team's moneyline market by slug token (team code), then by title. */
function pickMarket(
  markets: GammaMarket[],
  teamCode: string,
  teamName: string,
): GammaMarket | undefined {
  const code = teamCode.toLowerCase();
  const bySlug = markets.find((m) => slugToken(m) === code);
  if (bySlug) return bySlug;
  const name = teamName.toLowerCase();
  return markets.find((m) => (m.groupItemTitle ?? '').toLowerCase().includes(name));
}

function pickDraw(markets: GammaMarket[]): GammaMarket | undefined {
  return markets.find(
    (m) => slugToken(m) === 'draw' || (m.groupItemTitle ?? '').toLowerCase().startsWith('draw'),
  );
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
 * Returns undefined for a market that isn't a clean priced Yes/No.
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
