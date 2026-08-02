/**
 * The ESPN trust boundary — where an untrusted scoreboard payload becomes a
 * `Match`, or does not.
 *
 * This is the PARSE half of the adapter; `adapters/espn.ts` keeps the FETCH
 * half. Separating them is the point: every rule about what a payload must look
 * like lives here, once, so there is no "the live path checks X but the cache
 * path doesn't" to rediscover.
 *
 * Two rules run the whole file:
 *
 *   1. BOUND BEFORE WORK. Cardinality is checked, and collections are sliced,
 *      before anything is mapped, sorted or sanitized. Capping the result of an
 *      unbounded traversal is not a bound — it is the traversal that costs.
 *   2. IDENTITY IS THE PROVIDER'S, NOT OURS. A participant is the same team as
 *      another iff ESPN says so via `team.id` (present on 208/208 real
 *      competitors, 48 distinct). Comparing codes or names is a heuristic, and
 *      it broke both ways: it accepted `MEX vs MEX` and it rejected the real
 *      knockout pair `RD32 / Round of 32 1 Winner` vs `RD32 / Round of 32 3
 *      Winner`, which share an abbreviation because neither slot is filled yet.
 */
import { nationToFlag } from '../flags';
import { isFinished } from '../normalize';
import type { GroupStandings, StandingRow } from '../standings';
import type { Match, Stage, Status, Team } from '../types';
import { type BoundedList, takeBounded } from './bounded';
import { definitiveNone, malformed, type ParseResult, valid } from './result';
import { MAX_GOALS, MAX_MINUTE, sealMatch, teamCode } from './match';
import {
  canonicalTimestamp,
  count,
  ESPN_ID,
  flag as boolFlag,
  humanLabel,
  member,
  opaqueId,
  productFlag,
} from './roles';

// ---- cardinality budgets, applied BEFORE any per-item work ----
/** Events read from one scoreboard payload — we ask for `limit=300`. */
export const MAX_EVENTS = 300;
/** Groups in a standings payload. The tournament has 12. */
export const MAX_GROUPS = 16;
/** Rows per group. A real group is 4. */
export const MAX_GROUP_ROWS = 32;

const STAGES = new Set<string>(['GROUP', 'R32', 'R16', 'QF', 'SF', '3P', 'F', 'FRIENDLY']);

/** What the raw payload may hold — every field `unknown` until a role accepts it. */
interface RawTeam {
  id?: unknown;
  abbreviation?: unknown;
  displayName?: unknown;
  shortDisplayName?: unknown;
  name?: unknown;
  location?: unknown;
}
interface RawCompetitor {
  homeAway?: unknown;
  score?: unknown;
  shootoutScore?: unknown;
  winner?: unknown;
  team?: RawTeam;
}

/**
 * A participant, with the distinction the old code lacked.
 *
 * An unresolved bracket slot is NOT a team — it is a label for a team we do not
 * know yet. Conflating the two is what made "a team cannot play itself" either
 * useless or wrong depending on which heuristic it used.
 */
type Participant =
  | { readonly kind: 'team'; readonly providerId: string; readonly team: Team }
  | { readonly kind: 'slot'; readonly team: Team };

export interface MapContext {
  groupByTeam?: Record<string, string>;
}

/** Every identifying string a team object might carry, in preference order. */
function teamNames(t: RawTeam | undefined): string[] {
  return [t?.displayName, t?.name, t?.location, t?.shortDisplayName, t?.abbreviation]
    .map((v) => humanLabel(v))
    .filter((v) => v !== '');
}

/**
 * Build a participant from a raw competitor.
 *
 * Identity is validated AFTER sanitizing, not before: a name made entirely of
 * invisible characters passed a "does it have text?" check and then sanitized
 * to nothing, producing a nameless participant that rendered as `TBD`.
 */
function toParticipant(raw: RawCompetitor | undefined): ParseResult<Participant> {
  if (!raw || typeof raw !== 'object') return malformed('competitor is not an object');
  const names = teamNames(raw.team);
  if (names.length === 0) return malformed('competitor names no team');
  const name = names[0] as string;
  const code = teamCode(raw.team?.abbreviation, name);
  // The flag is GENERATED, never taken from the payload — see trust/roles.
  const team: Team = { code, name, flag: productFlag(name) };
  const providerId = opaqueId(raw.team?.id, ESPN_ID);
  // A participant we can name but whose nation we do not recognize is an
  // unresolved bracket slot ("Round of 32 1 Winner"), not a team.
  const known = productFlag(name) !== nationToFlag('');
  return valid(
    providerId && known ? { kind: 'team', providerId, team } : { kind: 'slot', team },
  );
}

/**
 * ESPN's status, or undefined when it is not one we recognize.
 *
 * The `SCHEDULED` fallback this replaces contradicted the rule `sealMatch`
 * states for exactly this field — status DROPS the fixture rather than
 * defaulting — and did the specific damage that rule exists to prevent: a
 * scored 2-0 event whose status ESPN omitted became a valid, SCORELESS,
 * scheduled fixture, so a match being played rendered as one yet to come.
 * Returning undefined lets the seal refuse the record instead.
 *
 * Measured before tightening: 368 real events across 18 competitions produce
 * five distinct `state|name` pairs, every one of them mapped here. The drop
 * rule costs nothing on real data.
 */
function mapStatus(st: unknown): Status | undefined {
  const type = (st as { type?: { name?: unknown; state?: unknown } } | undefined)?.type;
  const name = typeof type?.name === 'string' ? type.name.toUpperCase() : '';
  const state = typeof type?.state === 'string' ? type.state : '';
  if (name.includes('HALFTIME')) return 'HT';
  if (name.includes('POSTPONED')) return 'POSTPONED';
  if (name.includes('CANCEL')) return 'CANCELLED';
  if (state === 'pre') return 'SCHEDULED';
  if (state === 'post') return 'FT';
  if (state === 'in') return 'LIVE';
  return undefined;
}

function parseMinute(st: unknown): number | undefined {
  const s = st as { type?: { state?: unknown }; displayClock?: unknown; clock?: unknown } | undefined;
  if (s?.type?.state !== 'in') return undefined;
  const dc = typeof s.displayClock === 'string' ? s.displayClock.match(/(\d+)/) : null;
  if (dc) return count(Number.parseInt(dc[1] as string, 10), MAX_MINUTE);
  if (typeof s.clock === 'number' && s.clock > 0) {
    const n = Math.floor(s.clock / 60);
    return n > 0 ? count(n, MAX_MINUTE) : undefined;
  }
  return undefined;
}

const SLUG_TO_STAGE: Record<string, Stage> = {
  'group-stage': 'GROUP',
  'round-of-32': 'R32',
  'round-of-16': 'R16',
  quarterfinals: 'QF',
  semifinals: 'SF',
  '3rd-place-match': '3P',
  final: 'F',
};

function stageFromSlug(slug: unknown): Stage {
  if (slug == null || slug === '') return 'GROUP';
  // OWN-property lookup: a bare index walks the prototype chain, so a feed slug
  // of "constructor" put a FUNCTION into the Stage enum slot.
  if (typeof slug === 'string' && Object.hasOwn(SLUG_TO_STAGE, slug)) {
    const mapped = SLUG_TO_STAGE[slug];
    if (mapped) return mapped;
  }
  return 'FRIENDLY';
}

/** A whole number from ESPN's string-or-number numeric fields. */
function toGoals(v: unknown): number | undefined {
  if (typeof v === 'number') return count(v, MAX_GOALS);
  if (typeof v !== 'string' || v.trim() === '') return undefined;
  // WHOLE-string match: `parseInt` stops at the first invalid character, so
  // "1x" silently became 1 — a partial parse presented as an exact score.
  return /^-?\d{1,9}$/.test(v.trim()) ? count(Number(v.trim()), MAX_GOALS) : undefined;
}


/**
 * One ESPN event → a `Match`, or the reason it is not one.
 *
 * Returns `malformed` for a payload we cannot read and `definitive-none` for one
 * we read fine that simply is not a fixture — a distinction the caller needs and
 * `undefined` could not carry.
 */
export function parseEspnEvent(raw: unknown, ctx: MapContext = {}): ParseResult<Match> {
  if (!raw || typeof raw !== 'object') return malformed('event is not an object');
  const ev = raw as Record<string, unknown>;

  const id = opaqueId(ev.id, ESPN_ID);
  if (!id) return malformed('event id is absent or not an identifier');
  const kickoff = canonicalTimestamp(ev.date);
  if (!kickoff) return malformed('event date is absent or not one instant');

  const comp = (Array.isArray(ev.competitions) ? ev.competitions[0] : undefined) as
    | Record<string, unknown>
    | undefined;

  // CARDINALITY FIRST. Exactly two participants, checked before any of them is
  // built — `{}`, `[null]`, `[]` and a third contradictory competitor all
  // produced a fixture nobody is playing.
  const rawCompetitors = takeBounded<RawCompetitor>(comp?.competitors, 4);
  if (rawCompetitors.length !== 2) {
    return definitiveNone(`expected 2 competitors, found ${rawCompetitors.length}`);
  }
  const homeRaw = rawCompetitors.find((c) => c?.homeAway === 'home');
  const awayRaw = rawCompetitors.find((c) => c?.homeAway === 'away');
  if (!homeRaw || !awayRaw) return definitiveNone('competitors do not state home and away');

  const homeP = toParticipant(homeRaw);
  const awayP = toParticipant(awayRaw);
  if (homeP.kind !== 'valid') return homeP as ParseResult<Match>;
  if (awayP.kind !== 'valid') return awayP as ParseResult<Match>;

  // A team cannot play itself. Decided by the PROVIDER'S id when both sides
  // have one — present on 208/208 real competitors — because that is the only
  // stable key; "Mexico" and "México" are the same team and a name comparison
  // says otherwise. When neither side has an id we fall back to code+name,
  // which is what the previous rule did and is still correct for the case that
  // matters: two unresolved bracket slots SHARE an abbreviation ("RD32") and
  // differ only by label, so they are two different slots, not one team twice.
  const h = homeP.value;
  const a = awayP.value;
  // Only the id comparison lives here: it needs the provider ids, which exist on
  // this path and nowhere else, and it catches the case a label test cannot —
  // one team appearing twice under two spellings ("Mexico" / "México").
  //
  // The code+name comparison that used to sit beside it MOVED to `sealMatch`,
  // so the cache path gets it too. Leaving a copy here would recreate in one
  // commit the two-readers-one-rule shape this whole refactor exists to remove.
  if (h.kind === 'team' && a.kind === 'team' && h.providerId === a.providerId) {
    return definitiveNone('both competitors are the same team');
  }

  const home = homeP.value.team;
  const away = awayP.value.team;
  // No `?? 'SCHEDULED'`: an unrecognized status drops the fixture. Refused here
  // rather than left for the seal so the reason names the actual problem, and
  // so the winner/shootout reads below cannot run on a status we never mapped.
  const status = mapStatus(ev.status ?? comp?.status);
  if (!status) return malformed('event status is not a status we recognize');
  const stage = member<Stage>(stageFromSlug((ev.season as { slug?: unknown })?.slug), STAGES) ?? 'FRIENDLY';

  let group: string | undefined;
  if (stage === 'GROUP' && ctx.groupByTeam) {
    group = ctx.groupByTeam[home.code] ?? ctx.groupByTeam[away.code];
  }

  const hs = toGoals(homeRaw.score);
  const as = toGoals(awayRaw.score);
  const hasScore = status !== 'SCHEDULED' && hs !== undefined && as !== undefined;

  // EXACTLY one winner. Checking home first meant a payload claiming both teams
  // won advanced the home side out of a contradiction, and `winnerCode` is what
  // moves a team through the bracket.
  const hShoot = toGoals(homeRaw.shootoutScore);
  const aShoot = toGoals(awayRaw.shootoutScore);
  const shootout =
    hasScore && hShoot !== undefined && aShoot !== undefined
      ? { home: hShoot, away: aShoot }
      : undefined;

  // EXACTLY one competitor may claim the win. Whether that claim AGREES with
  // the result is decided in `sealMatch`, so the live and cache paths share one
  // rule — putting it here is what left the cache path accepting a winnerCode
  // the scoreline contradicts.
  let winnerCode: string | undefined;
  if (isFinished(status)) {
    const winners = [homeRaw, awayRaw].filter((c) => boolFlag(c.winner) === true);
    if (winners.length === 1) winnerCode = winners[0] === homeRaw ? home.code : away.code;
  }

  const venue = comp?.venue as { fullName?: unknown; address?: Record<string, unknown> } | undefined;

  // Both paths end at the SAME seal — see trust/match.ts. Anything asserted
  // about a Match is asserted once, here, for the feed and the cache alike.
  return sealMatch({
    id,
    stage,
    group,
    kickoff,
    venue: venue?.fullName,
    city: venue?.address?.city,
    country: venue?.address?.country,
    home,
    away,
    score: hasScore ? { home: hs, away: as } : undefined,
    shootout,
    minute: parseMinute(ev.status ?? comp?.status),
    status,
    winnerCode,
    updatedAt: new Date().toISOString(),
    events: ev.events,
  });
}

/**
 * A whole scoreboard payload → the fixtures we could read.
 *
 * Bounded on the way in, and `complete` records whether anything was refused —
 * so an empty day is distinguishable from a day we could not parse.
 */
export function parseEspnEvents(raw: unknown, ctx: MapContext = {}): BoundedList<Match> {
  // The TRUE payload size, read BEFORE slicing. Taken afterwards it can only
  // ever say "nothing was dropped" — the same defect `parseCachedMatches` had,
  // which I fixed there and did not grep for here.
  const all = (raw as { events?: unknown })?.events;
  // An envelope we cannot read is NOT an empty day. `{}` and
  // `{events:'nope'}` both yielded `complete: true`, so a 200 carrying garbage
  // reported itself as a genuine "no matches" — the exact shape this type
  // exists to distinguish. An actual `events: []` is a real, complete answer.
  const readable = Array.isArray(all);
  const total = readable ? all.length : 0;
  const considered = takeBounded<unknown>(all, MAX_EVENTS);
  const parsed = considered.map((e) => parseEspnEvent(e, ctx));
  const items = parsed.flatMap((r) => (r.kind === 'valid' ? [r.value] : []));
  return {
    items,
    total,
    shown: items.length,
    truncated: total > considered.length,
    // Some record was unreadable, or the window did not cover the payload, or
    // the envelope itself was not a list — none of those is a complete account
    // of what the provider sent.
    complete: readable && items.length === total,
  };
}

// ---- standings ----
interface RawEntry {
  team?: RawTeam;
  stats?: unknown;
}

/** One numeric stat, bounded. `signed` is for goal difference, the only one that may go below zero. */
function statVal(stats: unknown, name: string, signed = false): number {
  const list = takeBounded<{ name?: unknown; value?: unknown }>(stats, 64);
  const v = list.find((s) => s?.name === name)?.value;
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  const n = Math.round(v);
  const limit = 1000;
  return n > limit || n < (signed ? -limit : 0) ? 0 : n;
}

function entryToRow(e: RawEntry): ParseResult<StandingRow & { providerId?: string }> {
  const names = teamNames(e?.team);
  if (names.length === 0) return definitiveNone('standings entry names no team');
  const name = names[0] as string;
  const code = teamCode(e?.team?.abbreviation, name);
  return valid({
    team: { code, name, flag: productFlag(name) },
    played: statVal(e.stats, 'gamesPlayed'),
    won: statVal(e.stats, 'wins'),
    drawn: statVal(e.stats, 'ties'),
    lost: statVal(e.stats, 'losses'),
    goalsFor: statVal(e.stats, 'pointsFor'),
    goalsAgainst: statVal(e.stats, 'pointsAgainst'),
    goalDiff: statVal(e.stats, 'pointDifferential', true),
    points: statVal(e.stats, 'points'),
    providerId: opaqueId(e?.team?.id, ESPN_ID),
  });
}

/**
 * A standings payload → group tables.
 *
 * Groups are bounded AND deduped, rows are bounded BEFORE the sort, and a team
 * appears at most once per table. Every one of those was a separate finding,
 * and every one is the same mistake: validating after doing the work.
 */
export function parseEspnStandings(raw: unknown): BoundedList<GroupStandings> {
  // Children are per-group entries that may repeat a group name, so `total` is
  // distinct GROUPS, not array length — but the raw length still decides whether
  // we looked at all of them. Read before slicing, for the same reason as
  // parseEspnEvents: a count taken after the slice can only report success.
  const rawChildren = (raw as { children?: unknown })?.children;
  const rawCount = Array.isArray(rawChildren) ? rawChildren.length : 0;
  const children = takeBounded<Record<string, unknown>>(rawChildren, MAX_GROUPS * 4);
  const sawAllChildren = rawCount === children.length;
  let rowsTruncated = false;
  const out: GroupStandings[] = [];
  const seenGroups = new Set<string>();

  for (const child of children) {
    if (out.length >= MAX_GROUPS) break;
    const label = humanLabel(child?.name ?? child?.abbreviation);
    const letter = label.match(/Group\s+([A-L])/i)?.[1]?.toUpperCase();
    if (!letter || seenGroups.has(letter)) continue;
    seenGroups.add(letter);

    // Bounded BEFORE the map and the sort: a 4,000-row group cost ~300ms to
    // produce 32 rows because the cap was applied to the result.
    const rawEntries = (child?.standings as { entries?: unknown } | undefined)?.entries;
    // Detected AT THE SLICE: `ranked` is built from the already-bounded list, so
    // measuring it afterwards can only ever say nothing was dropped — the same
    // count-after-the-fact mistake as `total`.
    if (Array.isArray(rawEntries) && rawEntries.length > MAX_GROUP_ROWS) rowsTruncated = true;
    const entries = takeBounded<RawEntry>(rawEntries, MAX_GROUP_ROWS);
    const seenTeams = new Set<string>();
    const ranked: Array<{ row: StandingRow; rank: number }> = [];
    for (const e of entries) {
      const r = entryToRow(e);
      if (r.kind !== 'valid') continue;
      // A team appears once per table. A duplicate is a payload we cannot read
      // as a table, not two rows about two teams.
      const key = r.value.providerId ?? r.value.team.code;
      if (seenTeams.has(key)) continue;
      seenTeams.add(key);
      const { providerId: _drop, ...row } = r.value;
      ranked.push({ row, rank: statVal(e.stats, 'rank') });
    }
    ranked.sort((a, b) => {
      if (a.rank && b.rank && a.rank !== b.rank) return a.rank - b.rank;
      if (b.row.points !== a.row.points) return b.row.points - a.row.points;
      if (b.row.goalDiff !== a.row.goalDiff) return b.row.goalDiff - a.row.goalDiff;
      return b.row.goalsFor - a.row.goalsFor;
    });
    out.push({ group: letter, rows: ranked.map((x) => x.row) });
  }
  return {
    items: out,
    total: out.length,
    shown: out.length,
    // We stopped early if the child list was cut, we filled the group cap, or
    // any single group's ROWS were cut.
    truncated: !sawAllChildren || out.length >= MAX_GROUPS || rowsTruncated,
    complete: sawAllChildren && !rowsTruncated,
  };
}
