/**
 * Team roster + a fuzzy name/code resolver.
 *
 * The bundled schedule's GROUP-stage fixtures carry every real nation (knockout
 * slots are resultless placeholders), so the 48-team roster is derived from them.
 * `lookupTeam` turns a free-text name or code ("Mexico", "mex", "DR Congo",
 * "Türkiye") into the FIFA 3-letter code the rest of the API needs. Pure and
 * OFFLINE — no network, no live state.
 */
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
