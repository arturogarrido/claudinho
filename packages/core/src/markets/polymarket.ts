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
import { buildMarketSignal, FUTURE_SKEW_MS } from './normalize';
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
/**
 * Total enrichment budget when a caller does not set one. The CLI and MCP both
 * pass explicit deadlines, but the exported provider defaulted to UNBOUNDED —
 * so an embedder gets a fixture count times the per-fetch timeout before any
 * output. Optional odds must never be able to block a render.
 */
const DEFAULT_DEADLINE_MS = 15_000;
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

/**
 * The provider answered, but not in a shape we can read.
 *
 * Distinct from "no market for this fixture", which is a FACT worth caching.
 * A schema change is not a fact about the fixture, and negative-caching it
 * suppresses the real fetch for the whole TTL — the mirror image of the
 * "never cache a transient error as a real negative" rule.
 */
class MalformedPayloadError extends Error {
  constructor(what: string) {
    super(`Polymarket payload unreadable: ${what}`);
    this.name = 'MalformedPayloadError';
  }
}

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
      Date.now() + (options?.deadlineMs ?? DEFAULT_DEADLINE_MS);
    return (await this.resolveOne(match, options, deadline)).signal;
  }

  async findSignals(
    matches: Match[],
    options?: MarketSignalOptions,
  ): Promise<MarketSignalsResult> {
    const signals = new Map<string, MarketSignal>();
    const checked = new Set<string>();
    // Total enrichment deadline: optional odds must never block core output.
    const deadline = Date.now() + (options?.deadlineMs ?? DEFAULT_DEADLINE_MS);
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
    // Set when a candidate's payload could not be READ (shape/schema), as
    // distinct from a candidate that was read fine and simply has no market.
    let sawMalformed = false;
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
        let signal: MarketSignal | undefined;
        try {
          signal = event ? this.toSignal(match, slug, event, options) : undefined;
        } catch (e) {
          // A payload we could not READ is not the same fact as "this fixture
          // has no market". Caught per-candidate rather than letting it escape,
          // so the alias fan-out still tries the remaining slugs.
          if (!(e instanceof MalformedPayloadError)) throw e;
          sawMalformed = true;
          continue;
        }
        if (signal) return { signal, checked: true }; // first candidate that validates wins
      }
      // `checked` means DEFINITIVE. Reaching the source and finding no usable
      // market is definitive; failing to parse what it sent is not — treating a
      // schema change as "no market" negative-caches it for the full TTL, which
      // is the "never cache a transient error as a real negative" rule inverted.
      return { checked: !sawMalformed };
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
    // One slug, one event. More than one is an answer we cannot resolve, and
    // taking `[0]` was picking whichever the API happened to order first.
    if (Array.isArray(data) && data.length > 1) {
      throw new MalformedPayloadError('slug returned more than one event');
    }
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
    if (typeof event.active !== 'boolean' || typeof event.closed !== 'boolean') {
      throw new MalformedPayloadError('event active/closed is not a boolean');
    }
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
    if (typeof event.slug !== 'string') {
      throw new MalformedPayloadError('event states no slug');
    }
    // A DIFFERENT slug is a real answer ("that is not the event you asked for"),
    // unlike an absent one, which is a shape we cannot read.
    if (event.slug !== eventSlug) return undefined;
    // Kickoff must line up with the Claudinho fixture. `startTime` is REQUIRED:
    // absence skipped the tolerance check entirely, so an event for the wrong
    // day could still be adopted. Verified against the live Gamma API:
    // startTime is present AND parseable on 831/831 series events and 90/90
    // active sports events.
    if (typeof event.startTime !== 'string' || !canonicalTimestamp(event.startTime)) {
      throw new MalformedPayloadError('event startTime missing or unparseable');
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
    if (!Array.isArray(event.markets)) {
      throw new MalformedPayloadError('event markets is not an array');
    }
    const moneyline = event.markets.filter((m) => m?.sportsMarketType === 'moneyline');
    const homeMarket = pickMarket(moneyline, match.home.code, match.home.name);
    const awayMarket = pickMarket(moneyline, match.away.code, match.away.name);
    // A DUPLICATE draw is ambiguous; ABSENT is legitimate on a two-way knockout
    // line. `pickDraw` returns undefined for both, so the two cases have to be
    // told apart here or an ambiguous payload passes as a clean two-way market.
    if (moneyline.filter(isDrawMarket).length > 1) {
      throw new MalformedPayloadError('more than one draw market');
    }
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
        throw new MalformedPayloadError('market active/closed is not a boolean');
      }
      if (market.closed === true || market.active === false) return undefined;
      // Regular-time (90') resolution only — reject extra-time/advance markets.
      if (market.description && NON_REGULAR_TIME.test(market.description)) return undefined;
      const yes = yesPrice(market);
      // A leg we cannot read is a schema failure, not the fact "this fixture has
      // no market" — the distinction `checked` is built on.
      if (yes == null) throw new MalformedPayloadError('market is not a readable Yes/No binary');
      outcomes.push({ kind, teamCode, label, probability: yes });
      // A PRESENT-but-unparseable leg timestamp rejects. Skipping it silently
      // substituted the EVENT's timestamp, which is not when this price was
      // taken — so the displayed "updated HH:MM UTC" would describe a different
      // reading than the number beside it.
      // REQUIRED, not merely valid-when-present. An omitted leg timestamp was
      // accepted and the signal then reported some other leg's time as when this
      // price was taken. Verified present on 312/312 real World Cup markets.
      if (!canonicalTimestamp(market.updatedAt)) {
        throw new MalformedPayloadError('market updatedAt missing or unparseable');
      }
      const marketAsOf = canonicalTimestamp(market.updatedAt);
      // Taking the OLDEST hides a leg dated forward: a 2099 timestamp beside
      // current siblings simply lost the comparison and the signal read fresh.
      // A price that claims to be from the future is not a price.
      const nowMs = (options?.now ?? this.opts.now ?? new Date()).getTime();
      if (Date.parse(marketAsOf) - nowMs > FUTURE_SKEW_MS) {
        throw new MalformedPayloadError('market updatedAt is dated forward');
      }
      if (marketAsOf && (!asOf || Date.parse(marketAsOf) < Date.parse(asOf))) asOf = marketAsOf;
      // A leg whose liquidity is PRESENT but unreadable invalidates the
      // aggregate rather than being skipped: the minimum across legs is what a
      // `minLiquidity` floor is compared against, and quietly omitting the
      // thinnest leg makes the book look deeper than it is.
      const rawLiq = market.liquidityNum ?? market.liquidity;
      const liq = numberish(rawLiq);
      if (rawLiq != null && liq == null) {
        throw new MalformedPayloadError('market liquidity is unreadable');
      }
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
    if (!asOf) throw new MalformedPayloadError('no usable timestamp on the event or its markets');

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
  // EXACTLY one, not the first of several. `find` silently adopted one of two
  // legs claiming the same team, so a payload with two Mexico markets produced a
  // confident signal built from whichever happened to come first — and which one
  // is not a question we can answer, so it is not a question we should guess at.
  const bySlug = teamMarkets.filter((m) => tokens.includes(slugToken(m)));
  if (bySlug.length > 1) return undefined;
  // An EMPTY team name would match any market with no groupItemTitle ('' === ''),
  // adopting an unrelated prop as a result leg. A nameless team is not a match.
  const byTitle = name
    ? teamMarkets.filter((m) => (m.groupItemTitle ?? '').trim().toLowerCase() === name)
    : [];
  if (byTitle.length > 1) return undefined;
  // Both selectors are resolved before choosing, so a payload where the slug
  // names one market and the title names a DIFFERENT one is ambiguous rather
  // than silently resolved by which check happened to run first.
  const candidates = new Set([...bySlug, ...byTitle]);
  return candidates.size === 1 ? [...candidates][0] : undefined;
}

function pickDraw(markets: GammaMarket[]): GammaMarket | undefined {
  // EXACTLY one — the same ambiguity `pickMarket` refuses. Two draw legs is not
  // a payload we can read, and picking the first is guessing.
  const draws = markets.filter(isDrawMarket);
  return draws.length === 1 ? draws[0] : undefined;
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
  const labels = parseJsonArray(market.outcomes).map((l) => l.trim().toLowerCase());
  // `Number('')` is 0, and `parseJsonArray` renders anything unreadable (null,
  // an object) as ''. So a malformed price silently became a valid-looking 0%
  // rather than being refused. Require a real numeric literal.
  const raw = parseJsonArray(market.outcomePrices);
  if (raw.some((v) => v.trim() === '' || !Number.isFinite(Number(v)))) return undefined;
  const prices = raw.map((v) => Number(v));
  if (labels.length !== 2 || prices.length !== 2) return undefined;
  // The WHOLE binary shape, not just the slot we want. Validating only the
  // 'Yes' leg accepted `["Yes","Maybe"]` — which is not a Yes/No market, so its
  // "Yes" price is not the probability of the outcome we are labelling — and
  // accepted a complement that does not complement.
  const i = labels.indexOf('yes');
  const j = labels.indexOf('no');
  if (i < 0 || j < 0) return undefined;
  const yes = prices[i];
  const no = prices[j];
  if (![yes, no].every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)) {
    return undefined;
  }
  // A binary market's two prices are complementary; a pair that isn't means we
  // are not reading what we think we are reading.
  if (Math.abs((yes as number) + (no as number) - 1) > 0.05) return undefined;
  return (yes as number) > 0 ? (yes as number) : undefined;
}

/** Parse a value that may be an array or a JSON-encoded string array. */
function parseJsonArray(v: unknown): string[] {
  // NOT `String(x)`: JSON can hold `{"toString": null}`, and coercing that
  // throws out of a function whose whole contract is that it never does.
  const asText = (x: unknown) => (typeof x === 'string' || typeof x === 'number' ? String(x) : '');
  if (Array.isArray(v)) return v.map(asText);
  if (typeof v === 'string') {
    try {
      const parsed: unknown = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.map(asText) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Coerce a number or numeric string to a finite number, else undefined. */
function numberish(v: unknown): number | undefined {
  // NON-NEGATIVE. Liquidity and volume are quantities of money; a negative one
  // is malformed, and it fed a `minLiquidity` comparison. The cache path has
  // refused these since `finiteOrUndefined` gained its range check — the live
  // path had not, which is the same one-path-of-a-class miss as the rest of
  // this round.
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : undefined;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  }
  return undefined;
}
