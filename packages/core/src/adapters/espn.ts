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
import { parseEspnSeason } from '../trust/season';
import type { Match, SeasonInfo } from '../types';
import { readJsonBounded, ResponseTooLargeError } from './http';
import { attachFetchMeta, fetchMeta } from './meta';
import type { ProviderAdapter, ProviderCapabilities } from './types';

export type { MapContext };

import { isLive } from '../normalize';
import { parsedValue } from '../trust/result';

const ESPN_SOCCER = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
/** Default competition slug (the 2026 World Cup). */
export const DEFAULT_COMPETITION = 'fifa.world';
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
 * The competition a bare base URL serves: its last path segment, which is what
 * {@link competitionBase} put there. Only for an adapter constructed from a
 * `baseUrl` alone (tests, a custom host); anything that is not a flat slug
 * reads as `custom`, which is never the bundled competition.
 */
function competitionOfBase(baseUrl: string): string {
  const last = baseUrl.replace(/[?#].*$/, '').split('/').filter(Boolean).pop() ?? '';
  return /^[a-zA-Z0-9._-]{1,64}$/.test(last) ? last : 'custom';
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

/**
 * How a window is asked for. ESPN refuses every date RANGE (`dates=A-B`, HTTP
 * 400 since Oct 2 2026) and serves one day (`dates=YYYYMMDD`) and one calendar
 * month (`dates=YYYYMM`). A year is served too, cut at 100 events: never used.
 * So a short window is asked for a day at a time and a longer one a month at a
 * time; a window that would take more requests than that is refused unasked.
 */
export const WINDOW_DAY_REQUESTS = 3;
export const WINDOW_MONTH_REQUESTS = 3;
/** The `limit` sent with every scoreboard request. A response that fills it may have been cut. */
const SCOREBOARD_LIMIT = 300;

/**
 * The zone ESPN files a fixture's day in. Measured on the real feed (Oct 2
 * 2026): over 16 day requests in three competitions, each of the 35 fixtures
 * came back under its kickoff's date in this zone, 9 of them under a different
 * UTC date; a month request holds nothing outside itself by this zone's date.
 * The canary re-checks it daily.
 */
const PROVIDER_ZONE = 'America/New_York';
const providerDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: PROVIDER_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** A calendar date given as `YYYY-MM-DD` or `YYYYMMDD`, as `YYYYMMDD`; nothing if it is not a real date. */
function calendarDay(input: string): string | undefined {
  const digits = typeof input === 'string' ? input.replace(/-/g, '') : '';
  if (!/^\d{8}$/.test(digits)) return undefined;
  const y = Number(digits.slice(0, 4));
  const m = Number(digits.slice(4, 6));
  const d = Number(digits.slice(6, 8));
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
    ? digits
    : undefined;
}

const utcOf = (day: string) =>
  Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)));

/** The requests a window takes: its days, or the months it touches. Bounded before anything is listed. */
function windowAsks(start: string, end: string): { asks: string[]; byMonth: boolean } | undefined {
  const days = Math.round((utcOf(end) - utcOf(start)) / 86_400_000) + 1;
  if (days < 1) return undefined;
  if (days <= WINDOW_DAY_REQUESTS) {
    const asks: string[] = [];
    for (let i = 0; i < days; i++) {
      asks.push(new Date(utcOf(start) + i * 86_400_000).toISOString().slice(0, 10).replace(/-/g, ''));
    }
    return { asks, byMonth: false };
  }
  const asks: string[] = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(4, 6));
  const last = end.slice(0, 6);
  for (;;) {
    const month = `${String(y).padStart(4, '0')}${String(m).padStart(2, '0')}`;
    asks.push(month);
    if (month === last) return { asks, byMonth: true };
    if (asks.length >= WINDOW_MONTH_REQUESTS) return undefined;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
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

/** One parsed scoreboard response and the parser's account of it. */
interface ScoreboardPart {
  readonly items: readonly Match[];
  readonly total: number;
  readonly complete: boolean;
  /** The response filled the request's limit: what came after its last record is unknown. */
  readonly full: boolean;
  readonly season?: SeasonInfo;
}

export interface EspnAdapterOptions {
  /**
   * The competition to fetch (an ESPN slug). Default: the 2026 World Cup. The
   * base URL is derived from it unless `baseUrl` overrides where to fetch.
   */
  competition?: string;
  /** Override the base URL (tests, a custom host). Implies a non-default competition. */
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
  readonly competition: string;
  /** Where this adapter fetches; fixed at construction, like the competition. */
  private readonly base: string;
  readonly capabilities: ProviderCapabilities = { push: false, latencyHintSec: 45 };
  readonly expectedStandingsGroups?: readonly string[];
  readonly standingsFallbackGroups?: readonly string[];

  /** Short-lived group-letter maps, by team code and by team id (built lazily from standings). */
  private groupMap?: { at: number; value: Record<string, string>; byId: Record<string, string> };

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
  private readonly cooldownListeners = new Set<(untilMs: number) => void>();
  private readonly clock: () => number;

  constructor(private readonly opts: EspnAdapterOptions = {}) {
    this.clock = opts.now ?? (() => Date.now());
    this.competition =
      opts.competition ??
      (opts.baseUrl === undefined ? DEFAULT_COMPETITION : competitionOfBase(opts.baseUrl));
    this.base = opts.baseUrl ?? competitionBase(this.competition);
    // The bundled groups and roster describe the default competition only, and
    // only when nothing redirected where we fetch.
    const bundled = this.competition === DEFAULT_COMPETITION && opts.baseUrl === undefined;
    const expected = opts.expectedStandingsGroups ?? (bundled ? bundledGroups() : undefined);
    this.expectedStandingsGroups = expected ? [...expected] : undefined;
    // A custom competition can declare its expected letters for completeness
    // without claiming that its teams match the bundled World Cup roster.
    this.standingsFallbackGroups = bundled && expected ? [...expected] : undefined;
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
    this.arm(untilMs, error);
  }

  /**
   * Be told whenever the cooldown window is armed or EXTENDED — the way a
   * caller persists a throttle that arrives from a still-running request after
   * its own call already returned (review P2 on #128). Returns unsubscribe.
   */
  onCooldown(listener: (untilMs: number) => void): () => void {
    this.cooldownListeners.add(listener);
    return () => {
      this.cooldownListeners.delete(listener);
    };
  }

  /**
   * The ONE place a window is set. Concurrent requests can each carry a
   * Retry-After; the LATEST expiry wins — a shorter one arriving second must
   * never shorten a longer active window (review P2 on #128).
   */
  private arm(untilMs: number, error: ProviderError): void {
    if (this.cooldownUntilMs !== undefined && untilMs <= this.cooldownUntilMs) return;
    this.cooldownUntilMs = untilMs;
    this.cooldownError = error;
    for (const listener of this.cooldownListeners) listener(untilMs);
  }

  async fetchByDate(dateISO: string): Promise<Match[]> {
    return this.fetchScoreboard(toEspnDate(dateISO));
  }

  /**
   * The provider's calendar day (`YYYY-MM-DD`) for an instant: the day a
   * fixture kicking off then is filed under. See {@link PROVIDER_ZONE}. Used
   * to keep, from a month's response, the fixtures a window asked for; the
   * canary checks the rule against the real feed.
   */
  bucketDay(instant: Date): string {
    return Number.isNaN(instant.getTime()) ? '' : providerDay.format(instant);
  }

  /**
   * Every fixture whose provider day is in `[startDate, endDate]`, composed
   * from the request forms the provider accepts (see `WINDOW_DAY_REQUESTS`):
   * never a range. The parts are sent together, so the wait is one timeout,
   * not one per part, and EVERY part is settled before the window answers: a
   * throttle that arrives after a sibling's quick failure has armed the
   * cooldown by the time a caller looks at it.
   *
   * ONE result with ONE account, built in the order the parts were asked for
   * (never the order they arrived in):
   *   - any part's failure fails the window. If a part was throttled, the
   *     window's error is a throttle (the one with the latest deadline);
   *     otherwise it is the first failed part's.
   *   - parts that state different seasons fail the window. "Unknown" would be
   *     the wrong account of a known disagreement: an absent season lets the
   *     bundled schedule apply, and lets a cached slice from another season
   *     stand. A part that states none does not veto the ones that agree.
   *   - a part that filled the request's limit fails the window: its tail is
   *     unknown.
   *   - it is complete only if every part is.
   *   - a fixture is filed under exactly one day, so two parts cannot hold the
   *     same one. If they ever do, it is the parser's rule for a duplicate:
   *     the first is kept and the window says it is not complete.
   * It is a union of responses taken moments apart, not one snapshot: a
   * fixture moved between two parts being answered can be in neither.
   */
  async fetchWindow(startDate: string, endDate: string): Promise<Match[]> {
    const start = calendarDay(startDate);
    const end = calendarDay(endDate);
    const plan = start && end ? windowAsks(start, end) : undefined;
    if (!start || !end || !plan) {
      // Refused before any request: not two real dates, reversed, or longer
      // than the bound. A caller's mistake must not become provider traffic.
      throw new ProviderError(`ESPN window refused: ${startDate}..${endDate}`, 'parse');
    }
    const settled = await Promise.allSettled(plan.asks.map((dates) => this.readScoreboard(dates)));
    const failures = settled.flatMap((r) => (r.status === 'rejected' ? [r.reason as ProviderError] : []));
    if (failures.length > 0) {
      const throttles = failures.filter((e) => e instanceof ProviderError && e.throttled);
      throw throttles.length > 0
        ? throttles.reduce((a, b) => ((b.retryAfterMs ?? 0) > (a.retryAfterMs ?? 0) ? b : a))
        : failures[0];
    }
    const parts = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    // A part that filled its limit lost an unknown tail: later days of the
    // window may be missing, and nothing in the part says which. That is not a
    // refused record beside readable siblings; the window cannot be composed.
    if (parts.some((part) => part.full)) {
      throw new ProviderError(
        `ESPN window ${startDate}..${endDate}: a response filled its limit of ${SCOREBOARD_LIMIT} events and may be cut`,
        'parse',
      );
    }
    const years = new Set(parts.flatMap((part) => (part.season ? [part.season.year] : [])));
    if (years.size > 1) {
      throw new ProviderError(
        `ESPN window ${startDate}..${endDate} spans seasons ${[...years].sort().join(' and ')}`,
        'parse',
      );
    }
    // The window is ONE batch. "A non-empty payload with no readable record is
    // a failure" is asked of all of it: a day whose only record is unreadable
    // is a refused record beside readable siblings, not an outage.
    usableProviderItems<Match>('scoreboard', {
      items: parts.flatMap((part) => part.items),
      total: parts.reduce((n, part) => n + part.total, 0),
      complete: parts.every((part) => part.complete),
    });
    const seen = new Set<string>();
    const fixtures: Match[] = [];
    let complete = true;
    for (const part of parts) {
      if (!part.complete) complete = false;
      for (const m of part.items) {
        if (plan.byMonth) {
          // A month holds more than the window: keep what the window asked for.
          const day = this.bucketDay(new Date(m.kickoff)).replace(/-/g, '');
          if (day < start || day > end) continue;
        }
        if (seen.has(m.id)) {
          complete = false;
          continue;
        }
        seen.add(m.id);
        fixtures.push(m);
      }
    }
    const season = parts.find((part) => part.season)?.season;
    return attachFetchMeta(fixtures, { complete, ...(season ? { season } : {}) });
  }

  /**
   * In-play matches from ESPN's DEFAULT scoreboard bucket only (no `dates`). This
   * single bucket misses a late kickoff ESPN files under an adjacent day, so it
   * is a fallback for window-less callers — the domain `getLiveMatches` wraps a
   * ±1-day window around this to catch boundary-crossing matches. Prefer it.
   */
  async fetchLive(): Promise<Match[]> {
    const today = await this.fetchScoreboard();
    // The filter makes a new array; the response's metadata goes with it.
    return attachFetchMeta(
      today.filter((m) => isLive(m.status)),
      fetchMeta(today),
    );
  }

  /** Standings endpoint URL (lives under apis/v2, not site/v2; derived from base). */
  private standingsUrl(): string {
    return `${this.base.replace('/apis/site/v2/', '/apis/v2/')}/standings`;
  }

  /** The shared standings fetch (see {@link standingsShared}). */
  private sharedStandings(): Promise<GroupStandings[]> {
    const now = Date.now();
    if (this.standingsShared && now - this.standingsShared.at < STANDINGS_SHARE_MS) {
      return this.standingsShared.promise;
    }
    const promise = this.get(this.standingsUrl()).then((d) => {
      const parsed = parseEspnStandings(d);
      // The parser's own account rides on the result, as for a scoreboard: a
      // refused row marks its table partial, but a refused TABLE (a second one
      // contradicting the first, a name that is no group) leaves no trace on
      // the survivors.
      return attachFetchMeta(
        usableProviderItems<GroupStandings>(
          'standings',
          parsed,
          parsed.items.some((table) => table.rows.length > 0),
        ),
        { complete: parsed.complete },
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
    return (await this.groupMaps(force)).value;
  }

  /**
   * Both group maps from one standings read. A fixture's team that has an id
   * is enriched from the id map alone; the code map serves a team with no id,
   * and every team when the standings rows carried no ids (see `MapContext`).
   */
  private async groupMaps(
    force = false,
  ): Promise<{ value: Record<string, string>; byId: Record<string, string> }> {
    const now = Date.now();
    if (!force && this.groupMap && now - this.groupMap.at < STANDINGS_SHARE_MS) {
      return this.groupMap;
    }
    try {
      const tables = await this.sharedStandings();
      const value: Record<string, string> = {};
      const byId: Record<string, string> = {};
      for (const t of tables) {
        for (const r of t.rows) {
          value[r.team.code] = t.group;
          if (r.team.id !== undefined) byId[r.team.id] = t.group;
        }
      }
      this.groupMap = { at: Date.now(), value, byId };
      return this.groupMap;
    } catch {
      // standings optional — group letters absent for THIS call; retry next call
      return { value: {}, byId: {} };
    }
  }

  private async fetchScoreboard(dates?: string): Promise<Match[]> {
    const part = await this.readScoreboard(dates);
    return attachFetchMeta(usableProviderItems<Match>('scoreboard', part), {
      complete: part.complete,
      ...(part.season ? { season: part.season } : {}),
    });
  }

  /**
   * One scoreboard response, parsed, with the parser's account of it. The
   * "a non-empty payload with no readable record is a failure" rule is NOT
   * applied here: it belongs to the whole answer, and a window is one answer
   * made of several of these.
   */
  private async readScoreboard(dates?: string): Promise<ScoreboardPart> {
    const url = new URL(`${this.base}/scoreboard`);
    url.searchParams.set('limit', String(SCOREBOARD_LIMIT));
    if (dates) url.searchParams.set('dates', dates);

    // Group enrichment and the scoreboard are independent requests — run them
    // concurrently so an interactive command pays max(latency), not the sum.
    // fetchGroupMap never rejects, so only a scoreboard failure propagates.
    const [groups, data] = await Promise.all([
      this.opts.enrichGroups === false
        ? Promise.resolve({ value: {}, byId: {} })
        : this.groupMaps(),
      this.get(url.toString()),
    ]);
    // One call, one boundary: `parseEspnEvents` bounds the record count BEFORE
    // parsing anything and drops what it cannot read. The adapter no longer
    // decides any of that — which is the point, since every duplicated rule was
    // a place for the two copies to drift.
    const parsed = parseEspnEvents(data, {
      groupByTeam: groups.value,
      // An EMPTY id map means the standings carried no ids, not that no team is
      // in a group: pass none, so codes are consulted.
      ...(Object.keys(groups.byId).length > 0 ? { groupByTeamId: groups.byId } : {}),
    });
    // What the provider said about THIS response rides on THIS result (see
    // adapters/meta.ts) — never on the adapter, where an overlapping call would
    // overwrite it. An unreadable season is simply absent; it is never guessed.
    const season = parsedValue(parseEspnSeason(data));
    // So is the parser's own account of the payload: a refused record is
    // omitted (its readable siblings stay usable), and the result says that it
    // does not hold everything that was sent.
    // A response that fills the request's limit may have been cut by it, and a
    // cut is silent: the records that are there all parse. Measured (Oct 2
    // 2026): the provider returns a chronological prefix of exactly `limit`
    // events (100 when none is sent; a month asked with limit=10 returns its
    // first 10). So a full response is never called complete. Its readable
    // prefix stays usable to a single read, as a payload over the parser's own
    // cap always was; a WINDOW refuses it (see fetchWindow). The largest month
    // measured holds 79 events.
    const full = parsed.total >= SCOREBOARD_LIMIT;
    return {
      items: parsed.items,
      total: parsed.total,
      complete: parsed.complete && !full,
      full,
      season,
    };
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
          // to ask again until then (Retry-After honoured, bounded). Measured
          // from RECEIPT, not from when the request started — a slow response
          // must not have its latency subtracted from the delay (review P2).
          const receiptMs = this.clock();
          pe.retryAfterMs = retryAfterMs(res.headers?.get?.('retry-after'), receiptMs);
          this.arm(receiptMs + pe.retryAfterMs, pe);
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
