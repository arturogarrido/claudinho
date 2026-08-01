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
 * slug is a guess, validation FAILS CLOSED: the returned event must state a
 * slug matching the requested one, state a kickoff that lines up with the
 * fixture, be open, carry a usable timestamp, and expose markets explicitly
 * typed `moneyline` — otherwise no signal is produced. Each of those is
 * required to be PRESENT, because an absent field would otherwise skip the very
 * gate it should fail.
 */
import { MAX_RESPONSE_BYTES } from '../adapters/espn';
import { canonicalTimestamp } from '../sanitize';
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
/**
 * ADVISORY ONLY — a belt-and-braces text check, never the guarantee.
 *
 * What actually establishes that a market is the 90' match result is
 * `sportsMarketType === 'moneyline'`. This regex is wrong in BOTH directions
 * and must not be relied on: it MISSES 7,032 non-moneyline markets in the World
 * Cup series alone (`soccer_halftime_result` says only "within the first 45
 * minutes", `both_teams_to_score` closes with the same "first 90 minutes"
 * sentence as the real moneyline), and on the wider live Gamma corpus it FALSELY
 * REJECTS 2 of 102 legitimate moneyline markets (a cricket line trips on
 * "over-rate penalties", a tennis line on "advances against"). Those false
 * rejections are not reachable today — `deriveEventSlugs` only ever asks for
 * `fifwc-` slugs, and the series gate pins the event to this competition — but
 * they are why this must never become the load-bearing check if either is ever
 * widened. It stays as a second opinion on top of the type check.
 */
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
    const configured = options?.timeoutMs ?? this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    // Slug derivation lives INSIDE the try. It reads `match.kickoff`, and a
    // Match whose kickoff isn't a usable string made deriveEventSlugs throw —
    // from above the try, so the error escaped resolveOne, escaped findSignals
    // (whose header promises it never throws) and was swallowed by
    // getMarketSignals as an empty result. One malformed fixture therefore
    // voided the WHOLE batch's signals AND its `checked` set, turning a
    // single-record problem into a total market outage for that command.
    try {
      const entry = (this.opts.mapping ?? BUNDLED_MAPPING)[match.id];
      // A hand-curated override is authoritative (single slug); otherwise try
      // the derived candidates (UTC date, then the prior day — deriveEventSlugs).
      const slugs = entry?.eventSlug ? [entry.eventSlug] : deriveEventSlugs(match);
      if (slugs.length === 0) return { checked: true }; // unmappable → no market
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
      // Gamma never legitimately redirects; following one would sidestep the
      // host allow-list (it only validates the base URL), so reject redirects.
      redirect: 'error',
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
    if (res.status === 404) return undefined; // no such event → no market (not an error)
    if (!res.ok) {
      throw new Error(`Polymarket request failed: ${res.status} ${res.statusText}`);
    }
    // Size cap BEFORE parsing (optional chaining: test fakes omit headers).
    // Declared bodies only — see MAX_RESPONSE_BYTES for the accepted residual
    // risk on chunked responses.
    const length = Number(res.headers?.get?.('content-length'));
    if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
      throw new Error(`Polymarket response too large: ${length} bytes`);
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
    // Only real booleans are trusted, and both must be PRESENT. `active:
    // "false"` / `closed: "true"` are truthy strings, so an `=== false` /
    // `=== true` test alone read them as "open"; an ABSENT flag skipped the same
    // gate just as silently, which is how an event carrying nothing but
    // `markets` was treated as open. These are the two fields that decide
    // whether a price is still a live price, so neither may be inferred.
    // Verified against the live Gamma API: both are real booleans on 831/831
    // events in series `soccer-fifwc` and 90/90 active sports events — absence
    // is a non-sports signature.
    if (typeof event.active !== 'boolean' || typeof event.closed !== 'boolean') return undefined;
    if (event.active === false || event.closed === true) return undefined;
    // The event must NAME this competition. Stated negatively, the check only
    // fired when `seriesSlug` was PRESENT and wrong — so an event naming no
    // series at all skipped it, as did one naming no series while declaring some
    // other sport. Stating it positively changes the verdict ONLY in those two
    // fail-open cases. Verified against the live Gamma API: all 831 events in
    // the series carry BOTH `seriesSlug === 'soccer-fifwc'` and
    // `sport.sport === 'fifwc'`, so either half alone already satisfies it.
    if (event.seriesSlug !== WC_SERIES_SLUG && event.sport?.sport !== WC_SPORT) {
      return undefined;
    }
    // We guessed/looked-up the slug — confirm the API returned that exact event.
    // PRESENCE is required: an omitted slug SKIPPED the single confirmation
    // standing between a derived guess and what we render. Verified against the
    // live Gamma API: `slug` is present on 831/831 events in series
    // `soccer-fifwc` and 90/90 active sports events, so this rejects nothing
    // real (it is absent only on non-sports events, which the exact-slug
    // comparison already excludes).
    if (typeof event.slug !== 'string' || event.slug !== eventSlug) return undefined;
    // Kickoff must line up with the Claudinho fixture. `startTime` is REQUIRED:
    // absence skipped the tolerance check entirely, so an event for the wrong
    // day could still be adopted. Verified against the live Gamma API:
    // startTime is present AND parseable on 831/831 series events and 90/90
    // active sports events.
    if (typeof event.startTime !== 'string' || !canonicalTimestamp(event.startTime)) {
      return undefined;
    }
    const start = Date.parse(event.startTime);
    const kick = Date.parse(match.kickoff);
    if (!Number.isFinite(start) || !Number.isFinite(kick)) return undefined;
    if (Math.abs(start - kick) > KICKOFF_TOLERANCE_MS) return undefined;

    // Only moneyline (match-result) markets; map each to a result kind by team.
    // PRESENT-and-exact, never defaulted. Verified against the live Gamma API:
    // `sportsMarketType` is present on 100% of sports markets (36,243/36,243
    // across series `soccer-fifwc`) and is exactly 'moneyline' on all 312 World
    // Cup 1X2 legs. Defaulting an absent value to 'moneyline' let a half-time
    // or spread leg be adopted AS THE MATCH RESULT — and the NON_REGULAR_TIME
    // denylist below does not catch it: `soccer_halftime_result` has the same
    // 1X2 shape, the same 'Mexico'/'Draw'/'South Africa' titles, a coherent
    // sum, and a description mentioning neither extra time nor penalties.
    // 7,032 non-moneyline markets in this series escape that denylist.
    // Equality is exact, so the sibling type 'child_moneyline' (a per-game
    // winner) is excluded too.
    // `markets` is cast from an unchecked JSON body, so a non-array made
    // `.filter` throw. resolveOne's catch can only read a throw as a TRANSIENT
    // provider error (`checked: false`), so a permanently malformed payload was
    // re-fetched on every command forever. A body we cannot read is a definitive
    // "no market". A null element is filtered out by the same test.
    if (!Array.isArray(event.markets)) return undefined;
    const moneyline = event.markets.filter((m) => m?.sportsMarketType === 'moneyline');
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
    // Canonicalized, never echoed raw: Date.parse accepts strings carrying an
    // arbitrary RFC-2822 `(comment)` payload, which then reached MCP/JSON
    // verbatim. Compared by EPOCH below, not lexically.
    let asOf = canonicalTimestamp(event.updatedAt);
    let liquidity: number | undefined;
    for (const [kind, market, teamCode, label] of legs) {
      if (!market) continue; // draw may be absent for a two-way knockout line
      // Present-and-boolean, for the same reason as the event-level pair above:
      // an omitted flag skipped the gate rather than failing it, so a leg that
      // declared no lifecycle at all counted as open — the event can be open
      // while an individual leg has been settled or pulled. Verified against the
      // live Gamma API: both are real booleans on 36,243/36,243 markets in the
      // series. This sits after `if (!market) continue`, so a legitimately
      // absent draw leg on a two-way knockout line is unaffected.
      if (typeof market.closed !== 'boolean' || typeof market.active !== 'boolean') {
        return undefined;
      }
      if (market.closed === true || market.active === false) return undefined;
      // Regular-time (90') resolution only — reject extra-time/advance markets.
      if (market.description && NON_REGULAR_TIME.test(market.description)) return undefined;
      const yes = yesPrice(market);
      if (yes == null) return undefined;
      outcomes.push({ kind, teamCode, label, probability: yes });
      // A PRESENT-but-unparseable leg timestamp rejects. Skipping it silently
      // substituted the EVENT's timestamp, which is not when this price was
      // taken — so the displayed "updated HH:MM UTC" would describe a different
      // reading than the number beside it.
      if (market.updatedAt != null && !canonicalTimestamp(market.updatedAt)) return undefined;
      const marketAsOf = canonicalTimestamp(market.updatedAt);
      if (marketAsOf && (!asOf || Date.parse(marketAsOf) < Date.parse(asOf))) asOf = marketAsOf;
      const liq = numberish(market.liquidityNum ?? market.liquidity);
      if (liq != null) liquidity = liquidity == null ? liq : Math.min(liquidity, liq);
    }

    // The raw "Yes" probabilities should form a coherent 1X2 before normalizing;
    // a sum well outside ~1 means we grabbed the wrong markets.
    const rawSum = outcomes.reduce((s, o) => s + o.probability, 0);
    if (rawSum < 0.9 || rawSum > 1.15) return undefined;

    // A market with no usable timestamp IS the "no signal" case. Substituting
    // the wall clock turned a malformed or absent Gamma timestamp into "priced
    // right now" — strictly MORE trusted than an honest stale reading, which
    // the freshness gate would have suppressed. Verified against the live Gamma
    // API: canonicalTimestamp is non-empty for 104/104 World Cup events,
    // 312/312 of their markets and 1,731/1,731 active-sports records, so this
    // branch is unreachable on real data and only ever rescued malformed input.
    if (!asOf) return undefined;

    const signal = buildMarketSignal({
      match,
      source: 'polymarket',
      // Echoed into MCP structured content (tools.ts `market.id`), i.e. straight
      // into an agent's context. Stripping control characters is NOT sufficient
      // there: printable prose ("IGNORE PREVIOUS INSTRUCTIONS") survives that and
      // is precisely what matters for a model reading it. Gamma ids are short
      // opaque tokens, so validate that GRAMMAR and otherwise fall back to the
      // slug we derived ourselves.
      // The fallback is grammar-checked too. It is normally a slug we derived
      // ourselves, but `mapping.2026.json` can override it, so echoing it raw
      // was the one path around the agent-facing filter this line exists for.
      sourceMarketId: safeMarketId(event.id) ?? safeDerivedSlug(eventSlug),
      asOf,
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
 * A Gamma market id we are willing to echo into agent-facing output.
 *
 * Control-stripping alone is not enough here: `market.id` lands in MCP
 * structured content, where PRINTABLE prose ("IGNORE PREVIOUS INSTRUCTIONS") is
 * exactly what matters and survives a control-character filter untouched. Gamma
 * ids are short opaque tokens (numeric in practice), so accept only that grammar
 * and let the caller fall back to the slug we derived ourselves.
 */
function safeMarketId(id: unknown): string | undefined {
  // NUMERIC. `[A-Za-z0-9_-]{1,64}` still admits IGNORE_PREVIOUS_INSTRUCTIONS,
  // and this value lands in MCP structured content. Verified against the live
  // Gamma API: all 104 World Cup event ids and all 312 of their market ids are
  // numeric strings.
  return typeof id === 'string' && /^[0-9]{1,32}$/.test(id) ? id : undefined;
}

/**
 * The slug fallback, validated by ITS OWN grammar rather than the id one.
 *
 * It is normally a slug we derived ourselves, but `mapping.2026.json` can
 * override it, so it is provider-influenced and reaches MCP structured content
 * the same way. This is exactly the shape `deriveEventSlugs` produces.
 */
function safeDerivedSlug(slug: unknown): string | undefined {
  return typeof slug === 'string' && /^fifwc-[a-z]{2,3}-[a-z]{2,3}-\d{4}-\d{2}-\d{2}$/.test(slug)
    ? slug
    : undefined;
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
  // An EMPTY team name would match any market with no groupItemTitle ('' === ''),
  // adopting an unrelated prop as a result leg. A nameless team is not a match.
  if (!name) return undefined;
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
