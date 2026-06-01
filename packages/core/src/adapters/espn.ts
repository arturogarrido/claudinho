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
import type { Match, Stage, Status, Team } from '../types';
import type { ProviderAdapter, ProviderCapabilities } from './types';
import { nationToFlag } from '../flags';

const DEFAULT_BASE =
  'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';
const USER_AGENT =
  'claudinho/0.0 (+https://github.com/arturogarrido/claudinho)';

// ---- ESPN response shapes (only the fields we read) ----
interface EspnStatusType {
  name?: string;
  state?: string; // 'pre' | 'in' | 'post'
  completed?: boolean;
  shortDetail?: string;
}
interface EspnStatus {
  type?: EspnStatusType;
  clock?: number;
  displayClock?: string;
  period?: number;
}
interface EspnTeam {
  abbreviation?: string;
  displayName?: string;
  shortDisplayName?: string;
  name?: string;
  location?: string;
}
interface EspnCompetitor {
  homeAway?: 'home' | 'away';
  score?: string;
  winner?: boolean;
  team?: EspnTeam;
}
interface EspnCompetition {
  id?: string;
  date?: string;
  competitors?: EspnCompetitor[];
  venue?: { fullName?: string; address?: { city?: string; country?: string } };
  status?: EspnStatus;
}
interface EspnSeason {
  year?: number;
  slug?: string; // 'group-stage' | 'round-of-32' | ... | 'final'
}
interface EspnEvent {
  id: string;
  date: string;
  name?: string;
  shortName?: string;
  season?: EspnSeason;
  status?: EspnStatus;
  competitions?: EspnCompetition[];
}
interface EspnScoreboard {
  events?: EspnEvent[];
}

// ---- mapping helpers ----
function mapStatus(st?: EspnStatus): Status {
  const name = (st?.type?.name ?? '').toUpperCase();
  const state = st?.type?.state ?? '';
  if (name.includes('HALFTIME')) return 'HT';
  if (name.includes('POSTPONED')) return 'POSTPONED';
  if (name.includes('CANCEL')) return 'CANCELLED';
  if (state === 'pre') return 'SCHEDULED';
  if (state === 'post') return 'FT';
  if (state === 'in') return 'LIVE';
  return 'SCHEDULED';
}

function parseMinute(st?: EspnStatus): number | undefined {
  if (st?.type?.state !== 'in') return undefined;
  const dc = st.displayClock?.match(/(\d+)/);
  if (dc) return parseInt(dc[1]!, 10);
  if (typeof st.clock === 'number' && st.clock > 0) {
    return Math.floor(st.clock / 60) || undefined;
  }
  return undefined;
}

/**
 * Authoritative stage mapping from ESPN's `season.slug`. This is exact and
 * always present — far more reliable than parsing display text (which is empty
 * for real fixtures and uses placeholder names like "Round of 32 1 Winner").
 */
const SLUG_TO_STAGE: Record<string, Stage> = {
  'group-stage': 'GROUP',
  'round-of-32': 'R32',
  'round-of-16': 'R16',
  quarterfinals: 'QF',
  semifinals: 'SF',
  '3rd-place-match': '3P',
  final: 'F',
};

function stageFromSlug(slug?: string): Stage {
  return (slug && SLUG_TO_STAGE[slug]) || 'GROUP';
}

function toInt(s?: string): number | undefined {
  if (s == null || s === '') return undefined;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
}

function toTeam(t?: EspnTeam): Team {
  const name =
    t?.displayName ?? t?.name ?? t?.location ?? t?.shortDisplayName ?? 'TBD';
  const code = (t?.abbreviation ?? name.slice(0, 3)).toUpperCase();
  return { code, name, flag: nationToFlag(t?.displayName ?? t?.abbreviation ?? name) };
}

/** Optional context to enrich mapping (authoritative team->group letter). */
export interface MapContext {
  /** Map of UPPERCASE team code -> group letter ("A".."L"), from standings. */
  groupByTeam?: Record<string, string>;
}

/** Map a single ESPN event into the canonical Match model. Exported for tests. */
export function mapEspnEvent(ev: EspnEvent, ctx: MapContext = {}): Match {
  const comp = ev.competitions?.[0];
  const competitors = comp?.competitors ?? [];
  const homeC =
    competitors.find((c) => c.homeAway === 'home') ?? competitors[0];
  const awayC =
    competitors.find((c) => c.homeAway === 'away') ?? competitors[1];

  const status = mapStatus(ev.status ?? comp?.status);
  const stage = stageFromSlug(ev.season?.slug);

  const home = toTeam(homeC?.team);
  const away = toTeam(awayC?.team);

  // Group letter only applies to the group stage, and comes from the
  // authoritative standings map keyed by team code.
  let group: string | undefined;
  if (stage === 'GROUP' && ctx.groupByTeam) {
    group = ctx.groupByTeam[home.code] ?? ctx.groupByTeam[away.code];
  }

  const hs = toInt(homeC?.score);
  const as = toInt(awayC?.score);
  const hasScore = status !== 'SCHEDULED' && hs !== undefined && as !== undefined;

  return {
    id: ev.id,
    stage,
    group,
    kickoff: ev.date,
    venue: comp?.venue?.fullName ?? '',
    home,
    away,
    score: hasScore ? { home: hs, away: as } : undefined,
    minute: parseMinute(ev.status ?? comp?.status),
    status,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Convert "YYYY-MM-DD" or "YYYYMMDD" to ESPN's compact "YYYYMMDD".
 * Defensive: strips any non-digit so a stray value can't alter the query
 * structure (callers validate dates up front; this is the last line).
 */
function toEspnDate(d: string): string {
  return d.replace(/\D/g, '').slice(0, 8);
}

export interface EspnAdapterOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /**
   * Enrich group-stage matches with their group letter via the standings
   * endpoint (one extra request). Default true. Set false on the hot live-poll
   * path, where group letters aren't needed and the extra call is wasteful.
   */
  enrichGroups?: boolean;
}

// Standings endpoint shapes (only what we read).
interface EspnStandingsEntry {
  team?: { abbreviation?: string; displayName?: string };
}
interface EspnStandingsChild {
  name?: string; // e.g. "Group A"
  abbreviation?: string;
  standings?: { entries?: EspnStandingsEntry[] };
}
interface EspnStandings {
  children?: EspnStandingsChild[];
}

export class EspnAdapter implements ProviderAdapter {
  readonly name = 'espn';
  readonly capabilities: ProviderCapabilities = { push: false, latencyHintSec: 45 };

  /** Cached team-code -> group-letter map (built lazily from standings). */
  private groupMap?: Record<string, string>;

  constructor(private readonly opts: EspnAdapterOptions = {}) {}

  async fetchByDate(dateISO: string): Promise<Match[]> {
    return this.fetchScoreboard(toEspnDate(dateISO));
  }

  async fetchWindow(startDate: string, endDate: string): Promise<Match[]> {
    return this.fetchScoreboard(`${toEspnDate(startDate)}-${toEspnDate(endDate)}`);
  }

  async fetchLive(): Promise<Match[]> {
    const today = await this.fetchScoreboard();
    return today.filter((m) => m.status === 'LIVE' || m.status === 'HT');
  }

  /**
   * Build (and cache) a team-code -> group-letter map from the standings
   * endpoint. Best-effort: returns {} if standings are unavailable.
   */
  async fetchGroupMap(force = false): Promise<Record<string, string>> {
    if (this.groupMap && !force) return this.groupMap;
    const base = this.opts.baseUrl ?? DEFAULT_BASE;
    // Standings live under apis/v2 (not site/v2); derive from the configured base.
    const standingsUrl = `${base.replace('/apis/site/v2/', '/apis/v2/')}/standings`;
    const map: Record<string, string> = {};
    try {
      const data = (await this.get(standingsUrl)) as EspnStandings;
      for (const child of data.children ?? []) {
        const letter = (child.name ?? child.abbreviation ?? '')
          .match(/Group\s+([A-L])/i)?.[1]
          ?.toUpperCase();
        if (!letter) continue;
        for (const e of child.standings?.entries ?? []) {
          const code = e.team?.abbreviation?.toUpperCase();
          if (code) map[code] = letter;
        }
      }
    } catch {
      // standings optional — group letters will simply be absent
    }
    this.groupMap = map;
    return map;
  }

  private async fetchScoreboard(dates?: string): Promise<Match[]> {
    const base = this.opts.baseUrl ?? DEFAULT_BASE;
    const url = new URL(`${base}/scoreboard`);
    url.searchParams.set('limit', '300');
    if (dates) url.searchParams.set('dates', dates);

    const groupByTeam =
      this.opts.enrichGroups === false ? {} : await this.fetchGroupMap();
    const data = (await this.get(url.toString())) as EspnScoreboard;
    return (data.events ?? []).map((ev) => mapEspnEvent(ev, { groupByTeam }));
  }

  private async get(url: string): Promise<unknown> {
    const doFetch = this.opts.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.opts.timeoutMs ?? 15000,
    );
    try {
      const res = await doFetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      });
      if (!res.ok) {
        throw new Error(`ESPN request failed: ${res.status} ${res.statusText}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}
