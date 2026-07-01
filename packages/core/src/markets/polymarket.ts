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
 * BINARY markets — home win / draw / away win. Each is `outcomes: ["Yes","No"]`
 * and the outcome's probability is its "Yes" price.
 *
 * Mapping is by event slug, which is deterministic — so by default the slug is
 * DERIVED from the fixture (team codes + UTC date) and every match attempts
 * enrichment. A hand-curated entry in mapping.2026.json overrides the derived
 * slug for the rare fixture whose slug doesn't follow the pattern. Because the
 * slug is a guess, validation FAILS CLOSED: the returned event must match the
 * requested slug, line up on kickoff, expose the right moneyline markets, and
 * resolve in regular time — otherwise no signal is produced.
 */
import { shiftUtcDate } from '../time';
import type { Match } from '../types';
import mappingJson from './mapping.2026.json';
import { buildMarketSignal } from './normalize';
import type {
  MarketOutcome,
  MarketOutcomeKind,
  MarketProvider,
  MarketSignal,
  MarketSignalOptions,
  MarketSignalsResult,
} from './types';

const DEFAULT_BASE = 'https://gamma-api.polymarket.com';
const ALLOWED_HOSTS = new Set(['gamma-api.polymarket.com']);
const USER_AGENT = 'claudinho/0.0 (+https://github.com/arturogarrido/claudinho)';
const DEFAULT_TIMEOUT_MS = 8000;
const WC_SERIES_SLUG = 'soccer-fifwc';
const WC_SPORT = 'fifwc';
/** Kickoff must line up with the fixture within this window (catches mis-maps). */
const KICKOFF_TOLERANCE_MS = 6 * 60 * 60_000;
/** A market whose rule resolves outside 90' regular time is NOT a clean 1X2. */
const NON_REGULAR_TIME = /extra time|penalt|to advance|to qualif|win the (group|tournament|cup|title)/i;

/**
 * Optional override of the derived event slug for a fixture whose Polymarket
 * slug doesn't follow `fifwc-{home}-{away}-{date}` (e.g. an abbreviation that
 * differs from the FIFA code). Most matches need no entry — the slug is derived.
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
interface GammaMarket {
  id?: string;
  slug?: string;
  groupItemTitle?: string;
  sportsMarketType?: string;
  description?: string;
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
  startTime?: string;
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
    const deadline =
      options?.deadlineMs != null ? Date.now() + options.deadlineMs : Number.POSITIVE_INFINITY;
    return (await this.resolveOne(match, options, deadline)).signal;
  }

  async findSignals(
    matches: Match[],
    options?: MarketSignalOptions,
  ): Promise<MarketSignalsResult> {
    const signals = new Map<string, MarketSignal>();
    const checked = new Set<string>();
    // Total enrichment deadline: optional odds must never block core output.
    const deadline =
      options?.deadlineMs != null ? Date.now() + options.deadlineMs : Number.POSITIVE_INFINITY;
    for (const m of matches) {
      if (Date.now() >= deadline) break; // skipped (not checked) → retry next time
      const r = await this.resolveOne(m, options, deadline);
      if (r.checked) checked.add(m.id);
      if (r.signal) signals.set(m.id, r.signal);
    }
    return { signals, checked };
  }

  /**
   * Resolve one match. `checked` distinguishes a DEFINITIVE result (reached the
   * source and found no usable market, or the fixture is unmappable) from a
   * provider/network error — so transient failures are retried, not
   * negative-cached.
   */
  private async resolveOne(
    match: Match,
    options?: MarketSignalOptions,
    deadline = Number.POSITIVE_INFINITY,
  ): Promise<{ signal?: MarketSignal; checked: boolean }> {
    const entry = (this.opts.mapping ?? BUNDLED_MAPPING)[match.id];
    // A hand-curated override is authoritative (single slug); otherwise try the
    // derived candidates (UTC date, then the prior day — see deriveEventSlugs).
    const slugs = entry?.eventSlug ? [entry.eventSlug] : deriveEventSlugs(match);
    if (slugs.length === 0) return { checked: true }; // definitively unmappable → no market
    const configured = options?.timeoutMs ?? this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    try {
      for (const slug of slugs) {
        // Enforce the enrichment deadline BETWEEN candidate slugs, not just between
        // fixtures: with team aliases a match can have up to 8 candidates, and
        // default-on rendering must never block. Bound each fetch to the remaining
        // budget too. A deadline abort is NOT "checked" — we didn't finish, so it's
        // retried next time rather than negative-cached as "no market".
        const remaining = deadline - Date.now();
        if (remaining <= 0) return { checked: false };
        const event = await this.fetchEvent(slug, Math.min(configured, remaining));
        const signal = event ? this.toSignal(match, slug, event, options) : undefined;
        if (signal) return { signal, checked: true }; // first candidate that validates wins
      }
      return { checked: true }; // reached the source, no usable market on any candidate
    } catch {
      return { checked: false }; // provider/network error → retry, don't cache
    }
  }

  private async fetchEvent(slug: string, timeoutMs?: number): Promise<GammaEvent | undefined> {
    const base = this.opts.baseUrl ?? DEFAULT_BASE;
    assertAllowedHost(base);
    const url = `${base}/events?slug=${encodeURIComponent(slug)}`;
    const doFetch = this.opts.fetchImpl ?? fetch;
    const res = await doFetch(url, {
      signal: AbortSignal.timeout(timeoutMs ?? this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
    if (res.status === 404) return undefined; // no such event → no market (not an error)
    if (!res.ok) {
      throw new Error(`Polymarket request failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as unknown;
    const event = Array.isArray(data) ? data[0] : data;
    return event && typeof event === 'object' ? (event as GammaEvent) : undefined;
  }

  private toSignal(
    match: Match,
    eventSlug: string,
    event: GammaEvent,
    options?: MarketSignalOptions,
  ): MarketSignal | undefined {
    // ---- fail-closed event validation ----
    if (event.active === false || event.closed === true) return undefined;
    if (
      event.seriesSlug != null &&
      event.seriesSlug !== WC_SERIES_SLUG &&
      event.sport?.sport !== WC_SPORT
    ) {
      return undefined;
    }
    // We guessed/looked-up the slug — confirm the API returned that exact event.
    if (event.slug != null && event.slug !== eventSlug) return undefined;
    // Kickoff must line up with the Claudinho fixture (when the event states it).
    const start = event.startTime ? Date.parse(event.startTime) : Number.NaN;
    const kick = Date.parse(match.kickoff);
    if (
      Number.isFinite(start) &&
      Number.isFinite(kick) &&
      Math.abs(start - kick) > KICKOFF_TOLERANCE_MS
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

    // Reject a degenerate payload where two legs collapse to the same market.
    const legIds = [homeMarket, awayMarket, drawMarket]
      .filter((m): m is GammaMarket => m != null)
      .map((m) => m.id ?? m.slug ?? '');
    if (new Set(legIds).size !== legIds.length) return undefined;

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
      // Regular-time (90') resolution only — reject extra-time/advance markets.
      if (market.description && NON_REGULAR_TIME.test(market.description)) return undefined;
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
      sourceMarketId: event.id ?? eventSlug,
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

/**
 * Polymarket abbreviates some nations differently from their FIFA 3-letter code —
 * mostly ISO-3166 alpha-3, plus a couple of its own (DR Congo `cdr`, Cabo Verde
 * `cvi`). BOTH the event slug (`fifwc-{home}-{away}-{date}`) and each outcome
 * market's slug token use these, so a fixture with one of these teams resolves to
 * no market unless we map the code. Keyed by our uppercase FIFA code → Polymarket's
 * lowercase token. VERIFIED 1:1 against live Gamma events (2026-07-01); every
 * lookup is still fail-closed (exact slug + kickoff + coherent 1X2), so a stale or
 * wrong entry degrades to "no market", never a wrong one. (Curaçao is intentionally
 * absent — Polymarket's data mislabels it under the `kor` token, so we fail closed
 * rather than risk showing South Korea's odds.)
 */
const POLYMARKET_TOKEN: Record<string, string> = {
  SUI: 'che', // Switzerland
  NED: 'nld', // Netherlands
  URU: 'ury', // Uruguay
  POR: 'prt', // Portugal
  CRO: 'hrv', // Croatia
  COD: 'cdr', // DR Congo
  CPV: 'cvi', // Cabo Verde
};

/** Polymarket slug token(s) for a team: its alias (canonical) first, then the FIFA code. */
function pmTokens(code: string): string[] {
  const c = code.toLowerCase();
  const alias = POLYMARKET_TOKEN[code.toUpperCase()];
  return alias && alias !== c ? [alias, c] : [c];
}

/**
 * Candidate Gamma event slugs for a fixture: `fifwc-{home}-{away}-{date}`.
 * Returns [] for placeholder/unresolved fixtures (non-3-letter or TBD codes) so
 * we never query garbage slugs.
 *
 * Polymarket slugs a match by its HOST-LOCAL date, which for the Americas-hosted
 * 2026 WC is the UTC date OR the day before — a late-evening kickoff crosses into
 * the next UTC day (e.g. MEX–ECU at 01:00Z is Jun 30 in the Americas, slugged
 * `…-06-30`, not `…-07-01`). The Americas are always behind UTC, so we only need
 * the UTC date and the prior day. We try the UTC date first; `toSignal`'s
 * kickoff line-up + exact-slug checks reject a wrong-day event, so the prior-day
 * fallback stays fail-closed. The home/away tokens fold in the Polymarket alias
 * (above) so ISO-vs-FIFA teams (e.g. NED→nld, COD→cdr) resolve too.
 */
function deriveEventSlugs(match: Match): string[] {
  const home = match.home.code.toLowerCase();
  const away = match.away.code.toLowerCase();
  if (home === away || home === 'tbd' || away === 'tbd') return [];
  if (!/^[a-z]{3}$/.test(home) || !/^[a-z]{3}$/.test(away)) return [];
  const utcDate = match.kickoff.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(utcDate)) return [];
  const dates = [utcDate, shiftUtcDate(utcDate, -1)];
  const homeToks = pmTokens(match.home.code);
  const awayToks = pmTokens(match.away.code);
  const slugs: string[] = [];
  for (const d of dates) {
    for (const h of homeToks) {
      for (const a of awayToks) {
        slugs.push(`fifwc-${h}-${a}-${d}`);
      }
    }
  }
  return [...new Set(slugs)];
}

/** Last dash-segment of a market slug — the outcome token (`mex`/`draw`/`rsa`). */
function slugToken(m: GammaMarket): string {
  return (m.slug ?? '').toLowerCase().split('-').pop() ?? '';
}

/** Is this the draw market? (slug token `draw`, or a "Draw (...)" group title.) */
function isDrawMarket(m: GammaMarket): boolean {
  return slugToken(m) === 'draw' || (m.groupItemTitle ?? '').trim().toLowerCase().startsWith('draw');
}

/**
 * Find a team's moneyline market by slug token (team code), then by an EXACT
 * normalized group title. Draw markets are excluded so a "Draw (Mexico vs. …)"
 * title can never be mislabeled as a team's market, and the title fallback is
 * exact (not a substring) for the same reason.
 */
function pickMarket(
  markets: GammaMarket[],
  teamCode: string,
  teamName: string,
): GammaMarket | undefined {
  // Match the outcome market's slug token against the team's Polymarket token(s):
  // the alias (e.g. `cdr` for DR Congo) or the FIFA code. Without the alias the
  // away leg of an ISO-vs-FIFA fixture is never found → no signal.
  const tokens = pmTokens(teamCode);
  const name = teamName.trim().toLowerCase();
  const teamMarkets = markets.filter((m) => !isDrawMarket(m));
  const bySlug = teamMarkets.find((m) => tokens.includes(slugToken(m)));
  if (bySlug) return bySlug;
  return teamMarkets.find((m) => (m.groupItemTitle ?? '').trim().toLowerCase() === name);
}

function pickDraw(markets: GammaMarket[]): GammaMarket | undefined {
  return markets.find(isDrawMarket);
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
