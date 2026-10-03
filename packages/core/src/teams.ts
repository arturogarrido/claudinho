/**
 * Team roster + a fuzzy name/code resolver.
 *
 * The bundled schedule's GROUP-stage fixtures carry every real nation (knockout
 * slots are resultless placeholders), so the 48-team roster is derived from them.
 * `lookupTeam` turns a free-text name or code ("Mexico", "mex", "DR Congo",
 * "Türkiye") into the FIFA 3-letter code the rest of the API needs. Pure and
 * OFFLINE — no network, no live state. That is the World Cup's roster only.
 *
 * Off the bundled competition a club is resolved by `resolveClub` against the
 * competition's own roster (`rosterFor`: its standings, which a read makes),
 * with the schedule ahead as positive evidence; identity there is the
 * provider's id, never the code.
 */
import { STANDINGS_SHAPE } from './adapters/espn';
import type { ProviderAdapter } from './adapters/types';
import { getStandings } from './live';
import { allFixtures } from './schedule';
import type { Match, Team } from './types';

/** A roster team plus its group letter (A–L). */
export interface TeamInfo extends Team {
  group?: string;
}

/** Lowercase, strip diacritics + non-letters — for tolerant name/code matching. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics (Türkiye → turkiye)
    .replace(/[^a-z]/g, ''); // strip spaces/punctuation (Congo DR → congodr)
}

/**
 * The 48-team roster from the bundled group-stage fixtures, sorted by name.
 * Placeholder/knockout slots (non-3-letter code or 🏳️) are skipped.
 */
export function allTeams(fixtures: Match[] = allFixtures()): TeamInfo[] {
  const seen = new Map<string, TeamInfo>();
  for (const m of fixtures) {
    if (m.stage !== 'GROUP') continue;
    for (const t of [m.home, m.away]) {
      if (!/^[A-Z]{3}$/.test(t.code) || t.flag === '🏳️') continue;
      if (!seen.has(t.code)) seen.set(t.code, { ...t, group: m.group ?? undefined });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Common name variants → FIFA code, for aliases fuzzy matching alone misses
 * (a different word, word order, or exonym). Keyed by the NORMALIZED query.
 */
const TEAM_ALIASES: Record<string, string> = {
  turkey: 'TUR',
  holland: 'NED',
  korea: 'KOR',
  skorea: 'KOR',
  korearepublic: 'KOR',
  republicofkorea: 'KOR',
  czechrepublic: 'CZE',
  congo: 'COD',
  drcongo: 'COD',
  drc: 'COD',
  democraticrepublicofcongo: 'COD',
  democraticrepublicofthecongo: 'COD',
  cotedivoire: 'CIV',
  caboverde: 'CPV',
  bosnia: 'BIH',
  bosniaandherzegovina: 'BIH',
  us: 'USA',
  america: 'USA',
  unitedstatesofamerica: 'USA',
};

export interface TeamLookup {
  query: string;
  /** The single confident match, or null when the query is ambiguous or unknown. */
  team: TeamInfo | null;
  /** All candidate teams, best-first (1+ whenever anything matched). */
  matches: TeamInfo[];
}

/**
 * Resolve a free-text team name or code to a roster team. Precedence: exact code,
 * exact name, alias, then prefix/substring fuzzy on the name (fuzzy only for
 * queries of 3+ letters, so a 1–2 char query can't substring-match noise). A
 * unique fuzzy hit resolves; multiple hits return as candidates with `team: null`.
 */
export function lookupTeam(query: string, fixtures: Match[] = allFixtures()): TeamLookup {
  const roster = allTeams(fixtures);
  const q = norm(query);
  if (!q) return { query, team: null, matches: [] };

  const byCode = roster.find((t) => norm(t.code) === q);
  if (byCode) return { query, team: byCode, matches: [byCode] };

  const byName = roster.find((t) => norm(t.name) === q);
  if (byName) return { query, team: byName, matches: [byName] };

  const aliasCode = TEAM_ALIASES[q];
  if (aliasCode) {
    const t = roster.find((r) => r.code === aliasCode);
    if (t) return { query, team: t, matches: [t] };
  }

  if (q.length < 3) return { query, team: null, matches: [] };
  const prefix = roster.filter((t) => norm(t.name).startsWith(q));
  const substr = roster.filter((t) => norm(t.name).includes(q) && !prefix.includes(t));
  const matches = [...prefix, ...substr];
  return { query, team: matches.length === 1 ? matches[0]! : null, matches };
}

/**
 * A competition's roster, read from its standings, and what that read can
 * PROVE. Off the bundled competition there is no static roster: the clubs are
 * whoever the provider's tables hold.
 */
export interface Roster {
  /** The tables' teams, one per id (a row with no id is kept, once per code and name). */
  teams: Team[];
  /**
   * True only when the roster can prove a name is NOT in the competition: a
   * table was asked for, the read was not degraded, no table is missing from
   * it, none is partial, and every row's team carries an id. Anything less is
   * "not known", never "no such team": the club behind a refused row cannot be
   * ruled out, and a row with no id cannot be resolved by identity.
   */
  complete: boolean;
  /**
   * Whether a table exists to be asked for: false for a competition written
   * down as having none (`STANDINGS_SHAPE` `none`), whose empty document is a
   * complete inventory of nobody. The bundle's groups count as asked.
   */
  tableAsked: boolean;
}

/**
 * The roster of the adapter's competition, from ONE standings read (all
 * tables). Not asked at all for a competition with no table. The adapter
 * shares its standings read for a short while, so a command whose fixture read
 * already enriched from the standings asks once (a failed read is retried).
 */
export async function rosterFor(adapter: ProviderAdapter): Promise<Roster> {
  const tableAsked = STANDINGS_SHAPE[adapter.competition] !== 'none';
  if (!tableAsked) return { teams: [], complete: false, tableAsked };
  const read = await getStandings(adapter);
  const teams: Team[] = [];
  let everyRowHasId = true;
  for (const table of read.tables) {
    for (const row of table.rows) {
      const team = row.team;
      if (team.id === undefined) {
        everyRowHasId = false;
        if (!teams.some((t) => t.id === undefined && t.code === team.code && t.name === team.name)) teams.push(team);
      } else if (!teams.some((t) => t.id === team.id)) {
        teams.push(team);
      }
    }
  }
  const complete =
    !read.degraded &&
    read.incomplete !== true &&
    read.tables.every((table) => table.partial === undefined) &&
    everyRowHasId;
  return { teams, complete, tableAsked };
}

/** What a club query resolves to (see {@link resolveClub}). */
export type ClubResolution =
  | { outcome: 'resolved'; team: Team }
  | { outcome: 'ambiguous'; candidates: Team[] }
  | { outcome: 'unknown' }
  | {
      outcome: 'unresolved';
      /**
       * The teams the query DID match that carry no id (they cannot be
       * resolved by identity). Empty when it matched nothing.
       */
      idless: Team[];
    };

/**
 * Resolve a club's name or code against a competition's roster, with the
 * schedule ahead as POSITIVE evidence: a club found there is known, absence
 * from fourteen days proves nothing. One function for the CLI and MCP.
 *
 * The candidates are `Team`s, never `allTeams` (which keeps three-letter codes
 * only and one team per code: a real club is `O&M`, and two Libertadores clubs
 * are both `CAR`). One per id; a team with no id is a candidate only while no
 * team with an id has its code and name (`sameTeam` as written: the same code
 * and name are the same team), and it can never be the answer: identity needs
 * an id. Precedence as {@link lookupTeam}, with no alias table for clubs:
 * exact code (any case), exact name (normalized), then the name by prefix or
 * substring for a query of 3+ letters. One hit with an id resolves (one hit
 * BY CODE only when the roster was read whole, or no table exists: a code is
 * not known to be unique otherwise); two or more are `ambiguous` (never a
 * silent pick); none is `unknown` only when the roster can prove it
 * (`complete`), and `unresolved` otherwise.
 */
export function resolveClub(query: string, roster: Roster, schedule: readonly Match[]): ClubResolution {
  const candidates: Team[] = [];
  const add = (team: Team) => {
    if (team.id !== undefined) {
      if (!candidates.some((c) => c.id === team.id)) candidates.push(team);
    } else if (!candidates.some((c) => c.code === team.code && c.name === team.name)) {
      candidates.push(team);
    }
  };
  for (const team of roster.teams) add(team);
  for (const m of schedule) {
    add(m.home);
    add(m.away);
  }
  // A team with no id stands only where no team WITH an id has its code and name.
  const pool = candidates.filter(
    (c) => c.id !== undefined || !candidates.some((o) => o.id !== undefined && o.code === c.code && o.name === c.name),
  );

  const raw = query.trim();
  const q = norm(raw);
  const byCode = raw ? pool.filter((t) => t.code.toLowerCase() === raw.toLowerCase()) : [];
  const byName = q ? pool.filter((t) => norm(t.name) === q) : [];
  let hits = byCode.length > 0 ? byCode : byName;
  if (hits.length === 0 && q.length >= 3) {
    const prefix = pool.filter((t) => norm(t.name).startsWith(q));
    const substr = pool.filter((t) => norm(t.name).includes(q) && !prefix.includes(t));
    hits = [...prefix, ...substr];
  }
  if (hits.length > 1) return { outcome: 'ambiguous', candidates: hits };
  const hit = hits[0];
  // A code is shared by real clubs (two Libertadores clubs are both `CAR`), so
  // ONE hit by code proves the code unique only against a roster that was read
  // whole: with a table asked for and not read whole, the other club may be
  // the row that was refused, or a club with no match in the span. Not knowing
  // is not a pick. (With no table at all, the schedule is the only evidence
  // there will ever be, and a code it holds once is answered.)
  if (hit && byCode.length === 1 && roster.tableAsked && !roster.complete) {
    return { outcome: 'unresolved', idless: [] };
  }
  if (hit?.id !== undefined) return { outcome: 'resolved', team: hit };
  if (hit) return { outcome: 'unresolved', idless: [hit] };
  return roster.complete ? { outcome: 'unknown' } : { outcome: 'unresolved', idless: [] };
}
