/**
 * ESPN adapter — the free, keyless default/fallback source.
 *
 * Uses ESPN's unofficial public scoreboard endpoint:
 *   https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard
 *
 * Undocumented and unguaranteed — but confirmed to return real 2026 fixtures
 * (teams, ISO-UTC kickoffs, venues, status). The SCHEDULED/FT mapping is
 * verified against live data; the in-play minute/score path is best-effort and
 * should be re-verified during an actual live match.
 */
import type { GroupStandings } from '../standings';
import { groups as bundledGroups } from '../schedule';
import { type MapContext, parseEspnEvent, parseEspnEvents, parseEspnStandings } from '../trust/espn';
import type { Match } from '../types';
import { readJsonBounded, ResponseTooLargeError } from './http';
import type { ProviderAdapter, ProviderCapabilities } from './types';

export type { MapContext };

import { isLive } from '../normalize';
import { parsedValue } from '../trust/result';

const ESPN_SOCCER = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
/** Default competition slug (the 2026 World Cup). */
export const DEFAULT_COMPETITION = 'fifa.world';
const DEFAULT_BASE = `${ESPN_SOCCER}/${DEFAULT_COMPETITION}`;
// Versioned so upstream can distinguish releases (and a block aimed at one bad
// version need not be a block on all of them). Inlined at build time via the
// tsup define; '0.0' appears only on unbuilt dev/test runs.
const USER_AGENT = `claudinho/${process.env.CLAUDINHO_VERSION ?? '0.0'} (+https://github.com/arturogarrido/claudinho)`;
/**
 * Reject declared response bodies past this before JSON.parse — a hijacked
 * endpoint must not be able to balloon the refresher's memory every ~15s.
 * (Real scoreboard payloads are well under 1MB.) Shared by the Polymarket
 * provider. Known residual risk, accepted: a body WITHOUT a content-length
 * header (chunked) bypasses the cap — a streaming byte-count cap is
 * gateway-era work; the timeout still bounds how long such a body can flow.
 */
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/**
 * Provider cooldown after a 429/403 (audit A12): the window a throttled
 * adapter refuses to fetch in. `Retry-After` is honoured in both RFC 9110 forms
 * (delay-seconds and HTTP-date) up to MAX_COOLDOWN_MS — a longer request is
 * capped, never silently shortened below the cap — and DEFAULT_COOLDOWN_MS
 * applies when the header is absent or unreadable.
 */
export const DEFAULT_COOLDOWN_MS = 5 * 60_000;
export const MAX_COOLDOWN_MS = 15 * 60_000;

/** The cooldown a `Retry-After` header asks for, as milliseconds from `nowMs`, bounded. */
export function retryAfterMs(header: string | null | undefined, nowMs: number): number {
  if (typeof header !== 'string' || header.trim() === '') return DEFAULT_COOLDOWN_MS;
  const h = header.trim();
  let ms: number | undefined;
  if (/^\d+$/.test(h)) ms = Number(h) * 1000;
  else {
    const at = Date.parse(h);
    if (Number.isFinite(at)) ms = at - nowMs;
  }
  if (ms === undefined || !Number.isFinite(ms)) return DEFAULT_COOLDOWN_MS;
  return Math.min(Math.max(ms, 0), MAX_COOLDOWN_MS);
}

/** Build an ESPN soccer base URL for a competition slug (e.g. "fifa.friendly"). */
export function competitionBase(slug: string): string {
  return `${ESPN_SOCCER}/${slug}`;
}

/**
 * Interactive commands must not hang for the old 15s default when the feed
 * black-holes — `bracket` chains up to two upstream requests, so the worst case
 * is ~2× this before degraded output. Callers with different budgets (tests,
 * the future gateway) still override via `timeoutMs`.
 */
const DEFAULT_TIMEOUT_MS = 6000;

/** How long one standings fetch is shared between fetchStandings/fetchGroupMap. */
const STANDINGS_SHARE_MS = 30_000;

export type ProviderErrorKind = 'http' | 'timeout' | 'parse';

/**
 * Classified provider failure, so a caller that got a degraded result can tell
 * a throttle/block (back off — hammering makes it worse) from a timeout or a
 * shape change (plain degraded, retry on the normal cadence).
 */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status?: number;
  /** For a throttle: how long the adapter will refuse to fetch (bounded). */
  retryAfterMs?: number;
  constructor(message: string, kind: ProviderErrorKind, status?: number) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = status;
  }
  /** 429/403 — the upstream is refusing us; retrying at the live cadence makes it worse. */
  get throttled(): boolean {
    return this.kind === 'http' && (this.status === 429 || this.status === 403);
  }
}

// ---- ESPN response shapes (only the fields we read) ----

// ---- parsing lives at the trust boundary ----
//
// This adapter is now FETCH only. Every rule about what a payload must look
// like — cardinality, identity, roles, bounds — lives in `trust/espn.ts`, so
// there is no second copy to drift from. Ten rounds of review were, over and
// over, one path enforcing a rule its sibling did not.

/**
 * Convert "YYYY-MM-DD" or "YYYYMMDD" to ESPN's compact "YYYYMMDD".
 * Defensive: strips any non-digit so a stray value can't alter the query
 * structure (callers validate dates up front; this is the last line).
 */
function toEspnDate(d: string): string {
  return d.replace(/\D/g, '').slice(0, 8);
}

/** Map a single ESPN event into the canonical Match model. Exported for tests. */
export function mapEspnEvent(ev: unknown, ctx: MapContext = {}): Match | undefined {
  return parsedValue(parseEspnEvent(ev, ctx));
}

/** Project an ESPN standings payload onto group tables. Exported for tests. */
export function parseStandings(data: unknown): GroupStandings[] {
  return [...parseEspnStandings(data).items];
}

/**
 * A readable prefix is usable provider data; an unreadable payload with no
 * usable records is a parse failure, not an authoritative empty answer.
 */
function usableProviderItems<T>(
  kind: 'scoreboard' | 'standings',
  parsed: { readonly items: readonly T[]; readonly total: number; readonly complete: boolean },
  hasUsableRecord = parsed.items.length > 0,
): T[] {
  // A genuinely empty provider list is authoritative. A non-empty list from
  // which we could not accept one record is not, even when every refusal was a
  // `definitive-none` and therefore did not make the batch incomplete.
  if (!hasUsableRecord && (!parsed.complete || parsed.total > 0)) {
    throw new ProviderError(`ESPN ${kind} payload had no readable records`, 'parse');
  }
  return [...parsed.items];
}

export interface EspnAdapterOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /**
   * Expected standings groups for completeness checks and definitive group
   * validation. Defaults to the bundled groups for the default World Cup base;
   * custom bases leave the scope open unless supplied. Declaring custom groups
   * does not authorize use of the bundled World Cup roster on failure.
   */
  expectedStandingsGroups?: readonly string[];
  /**
   * Enrich group-stage matches with their group letter via the standings
   * endpoint (one extra request). Default true. Set false on the hot live-poll
   * path, where group letters aren't needed and the extra call is wasteful.
   */
  enrichGroups?: boolean;
  /** Clock, injectable for tests. Drives the throttle cooldown window. */
  now?: () => number;
}

export class EspnAdapter implements ProviderAdapter {
  readonly name = 'espn';
  readonly capabilities: ProviderCapabilities = { push: false, latencyHintSec: 45 };
  readonly expectedStandingsGroups?: readonly string[];
  readonly standingsFallbackGroups?: readonly string[];

  /** Short-lived team-code -> group-letter map (built lazily from standings). */
  private groupMap?: { at: number; value: Record<string, string> };

  /**
   * One in-flight/recent standings fetch shared by fetchStandings and
   * fetchGroupMap, so a command like `bracket` hits the endpoint once instead
   * of twice, and a long-lived MCP server stays fresh (short TTL). A rejected
   * fetch clears the slot — a transient failure is never cached.
   */
  private standingsShared?: { at: number; promise: Promise<GroupStandings[]> };

  /**
   * The most recent request failure (best-effort under concurrency; cleared
   * when a new request starts). A post-hoc hint for callers whose result path
   * fails closed to `degraded` booleans but who still need to distinguish a
   * throttle (persist a backoff) from an ordinary blip.
   */
  lastError?: ProviderError;

  /**
   * A retained throttle (audit A12): after a 429/403 every call inside the
   * window throws the provider's last answer WITHOUT a request. A server-
   * lifetime MCP adapter is covered by this alone; the CLI pre-arms each
   * process from its persisted cache via `armCooldown`.
   */
  private cooldownUntilMs?: number;
  private cooldownError?: ProviderError;
  private readonly clock: () => number;

  constructor(private readonly opts: EspnAdapterOptions = {}) {
    this.clock = opts.now ?? (() => Date.now());
    const expected =
      opts.expectedStandingsGroups ?? (opts.baseUrl === undefined ? bundledGroups() : undefined);
    this.expectedStandingsGroups = expected ? [...expected] : undefined;
    // A custom base can declare its expected letters for completeness without
    // claiming that its teams match the bundled World Cup roster.
    this.standingsFallbackGroups =
      opts.baseUrl === undefined && expected ? [...expected] : undefined;
  }

  /** Epoch ms until which requests are refused, when a cooldown is armed. */
  get cooldownUntil(): number | undefined {
    return this.cooldownUntilMs;
  }

  /**
   * Arm the cooldown from outside — a fresh CLI process reading the backoff
   * its refresher persisted. The retained error reads as a throttle so every
   * caller's `degraded` path and the refresher's persistence treat it as one.
   */
  armCooldown(untilMs: number, reason?: ProviderError): void {
    const nowMs = this.clock();
    const error =
      reason ?? new ProviderError('ESPN request skipped: provider cooldown in effect', 'http', 429);
    error.retryAfterMs = Math.max(0, untilMs - nowMs);
    this.cooldownUntilMs = untilMs;
    this.cooldownError = error;
  }

  async fetchByDate(dateISO: string): Promise<Match[]> {
    return this.fetchScoreboard(toEspnDate(dateISO));
  }

  async fetchWindow(startDate: string, endDate: string): Promise<Match[]> {
    return this.fetchScoreboard(`${toEspnDate(startDate)}-${toEspnDate(endDate)}`);
  }

  /**
   * In-play matches from ESPN's DEFAULT scoreboard bucket only (no `dates`). This
   * single bucket misses a late kickoff ESPN files under an adjacent day, so it
   * is a fallback for window-less callers — the domain `getLiveMatches` wraps a
   * ±1-day window around this to catch boundary-crossing matches. Prefer it.
   */
  async fetchLive(): Promise<Match[]> {
    const today = await this.fetchScoreboard();
    return today.filter((m) => isLive(m.status));
  }

  /** Standings endpoint URL (lives under apis/v2, not site/v2; derived from base). */
  private standingsUrl(): string {
    const base = this.opts.baseUrl ?? DEFAULT_BASE;
    return `${base.replace('/apis/site/v2/', '/apis/v2/')}/standings`;
  }

  /** The shared standings fetch (see {@link standingsShared}). */
  private sharedStandings(): Promise<GroupStandings[]> {
    const now = Date.now();
    if (this.standingsShared && now - this.standingsShared.at < STANDINGS_SHARE_MS) {
      return this.standingsShared.promise;
    }
    const promise = this.get(this.standingsUrl()).then((d) => {
      const parsed = parseEspnStandings(d);
      return usableProviderItems<GroupStandings>(
        'standings',
        parsed,
        parsed.items.some((table) => table.rows.length > 0),
      );
    });
    this.standingsShared = { at: now, promise };
    // Never cache a transient failure: a rejected fetch frees the slot so the
    // next caller retries instead of inheriting it for 30s. A fulfilled parse,
    // including one that omitted malformed rows, is stable for these bytes.
    void promise.catch(() => {
      if (this.standingsShared?.promise === promise) this.standingsShared = undefined;
    });
    return promise;
  }

  /**
   * Authoritative, cumulative group tables from the standings endpoint. Throws
   * on fetch failure. Group-stage only: non-group `children` are filtered out
   * by {@link parseStandings}; malformed rows are omitted without hiding their
   * readable siblings.
   */
  async fetchStandings(): Promise<GroupStandings[]> {
    return this.sharedStandings();
  }

  /**
   * Build (and briefly cache) a team-code -> group-letter map from the standings
   * endpoint. Best-effort: returns {} if standings are unavailable — but a
   * transient failure is NOT cached, and a partial successful parse expires at
   * the standings TTL, so neither can silently drop group letters for the
   * adapter's lifetime.
   * Reuses the same parse/fetch as {@link fetchStandings}, so the two never
   * drift and one command never fetches standings twice.
   */
  async fetchGroupMap(force = false): Promise<Record<string, string>> {
    const now = Date.now();
    if (!force && this.groupMap && now - this.groupMap.at < STANDINGS_SHARE_MS) {
      return this.groupMap.value;
    }
    try {
      const tables = await this.sharedStandings();
      const map: Record<string, string> = {};
      for (const t of tables) for (const r of t.rows) map[r.team.code] = t.group;
      this.groupMap = { at: Date.now(), value: map };
      return map;
    } catch {
      // standings optional — group letters absent for THIS call; retry next call
      return {};
    }
  }

  private async fetchScoreboard(dates?: string): Promise<Match[]> {
    const base = this.opts.baseUrl ?? DEFAULT_BASE;
    const url = new URL(`${base}/scoreboard`);
    url.searchParams.set('limit', '300');
    if (dates) url.searchParams.set('dates', dates);

    // Group enrichment and the scoreboard are independent requests — run them
    // concurrently so an interactive command pays max(latency), not the sum.
    // fetchGroupMap never rejects, so only a scoreboard failure propagates.
    const [groupByTeam, data] = await Promise.all([
      this.opts.enrichGroups === false
        ? Promise.resolve<Record<string, string>>({})
        : this.fetchGroupMap(),
      this.get(url.toString()),
    ]);
    // One call, one boundary: `parseEspnEvents` bounds the record count BEFORE
    // parsing anything and drops what it cannot read. The adapter no longer
    // decides any of that — which is the point, since every duplicated rule was
    // a place for the two copies to drift.
    const parsed = parseEspnEvents(data, { groupByTeam });
    return usableProviderItems<Match>('scoreboard', parsed);
  }

  private async get(url: string): Promise<unknown> {
    const nowMs = this.clock();
    // Inside a retained throttle window nothing is requested: the provider's
    // last answer is the answer (audit A12).
    if (
      this.cooldownError &&
      this.cooldownUntilMs !== undefined &&
      nowMs < this.cooldownUntilMs
    ) {
      this.lastError = this.cooldownError;
      throw this.cooldownError;
    }
    const doFetch = this.opts.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    this.lastError = undefined;
    try {
      let res: Awaited<ReturnType<typeof doFetch>>;
      try {
        res = await doFetch(url, {
          signal: controller.signal,
          // ESPN never legitimately redirects; following one would sidestep the
          // fixed-host guarantee, so treat any redirect as a failure (degraded).
          redirect: 'error',
          headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        });
      } catch (e) {
        // AbortError is our own timer; anything else is network/TLS/redirect.
        throw (e as Error)?.name === 'AbortError'
          ? new ProviderError(`ESPN request timed out: ${url}`, 'timeout')
          : new ProviderError(`ESPN request failed: ${(e as Error)?.message ?? e}`, 'http');
      }
      if (!res.ok) {
        const pe = new ProviderError(
          `ESPN request failed: ${res.status} ${res.statusText}`,
          'http',
          res.status,
        );
        if (pe.throttled) {
          // The provider asked us to go away: remember for how long, and refuse
          // to ask again until then (Retry-After honoured, bounded).
          pe.retryAfterMs = retryAfterMs(res.headers?.get?.('retry-after'), nowMs);
          this.cooldownUntilMs = nowMs + pe.retryAfterMs;
          this.cooldownError = pe;
        }
        throw pe;
      }
      // Bounded on the bytes actually consumed, declared or not (audit A11).
      try {
        return await readJsonBounded(res, MAX_RESPONSE_BYTES);
      } catch (e) {
        if (e instanceof ResponseTooLargeError) {
          throw new ProviderError(`ESPN response too large: ${e.bytes} bytes`, 'parse');
        }
        throw new ProviderError(
          `ESPN response unparseable: ${(e as Error)?.message ?? e}`,
          'parse',
        );
      }
    } catch (e) {
      const pe =
        e instanceof ProviderError
          ? e
          : new ProviderError(String((e as Error)?.message ?? e), 'http');
      this.lastError = pe;
      // Opt-in diagnostics: live incidents were previously undiagnosable (every
      // failure collapsed to a bare `degraded` boolean). stderr only — stdout
      // belongs to the MCP protocol / statusline.
      if (typeof process !== 'undefined' && process.env?.CLAUDINHO_DEBUG) {
        process.stderr.write(
          `claudinho: espn ${pe.kind}${pe.status ? ` ${pe.status}` : ''}: ${url}\n`,
        );
      }
      throw pe;
    } finally {
      clearTimeout(timer);
    }
  }
}
