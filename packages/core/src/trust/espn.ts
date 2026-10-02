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
 *   2. IDENTITY IS THE PROVIDER'S, NOT OURS. ESPN's `team.id` (present on
 *      208/208 real competitors, 48 distinct) is the only stable way to know
 *      that two participants are ONE team: comparing codes alone rejected the
 *      real knockout pair `RD32 / Round of 32 1 Winner` vs `RD32 / Round of 32
 *      3 Winner`, which share an abbreviation because neither slot is filled
 *      yet, and comparing labels alone accepted one team twice under two
 *      spellings. Since 0.11 the id rides ON the `Team` (`espn:<id>`), and the
 *      comparison is made once, in `sealMatch` (`sameTeam`), for the feed and
 *      the cache alike. The rule there is: the same id, OR the same code and
 *      name. An id ADDS a refusal; two different ids never make `Mexico` vs
 *      `Mexico` a fixture.
 */
import { isFinished } from '../normalize';
import type { GroupStandings, StandingRow } from '../standings';
import type { Match, Stage, Status, Team } from '../types';
import { type BoundedList, takeBounded } from './bounded';
import { definitiveNone, malformed, type ParseResult, valid } from './result';
import { MAX_GOALS, MAX_MINUTE, sealMatch, sealTeam } from './match';
import { sealSeason } from './season';
import {
  canonicalTimestamp,
  count,
  ESPN_ID,
  flag as boolFlag,
  humanLabel,
  member,
  opaqueId,
  providerTeamId,
} from './roles';

/** The provider whose ids this module reads; the namespace of every team id it emits. */
const PROVIDER = 'espn';

// ---- cardinality budgets, applied BEFORE any per-item work ----
/** Events read from one scoreboard payload — we ask for `limit=300`. */
export const MAX_EVENTS = 300;
/**
 * Children of a standings payload that are inspected. The largest competition
 * has 14. A payload with more is refused whole: a child nobody inspected could
 * claim a key that was accepted (see `parseEspnStandings`).
 */
export const MAX_TABLE_CHILDREN = 64;
/**
 * Tables whose ROWS are processed: sixteen slots, each taken before the first
 * row of a table is parsed and never given back (a World Cup has 12 tables,
 * the UEFA Nations League 14). With `MAX_GROUP_ROWS` this bounds the row work
 * at 640 parses whatever the payload holds.
 */
export const MAX_GROUPS = 16;
/** Rows per table. A group is 4; the Champions League's league phase is 36. */
export const MAX_GROUP_ROWS = 40;
/** A table's raw name is matched whole, and only up to this length. */
const MAX_TABLE_NAME_UNITS = 64;
/** Display columns of a table's label. */
const MAX_TABLE_LABEL_COLUMNS = 60;

/**
 * How a competition's standings payload is read. `groups`: every table is
 * named by one of the group grammars. `league`: the competition is authorised
 * to serve exactly ONE table, whatever its name (a season, a phase). `none`:
 * the competition has no table (knockout from the first round), and the
 * provider answers with its own document and no table list at all; that
 * answer is then an empty one, not an unreadable one. If such a competition
 * ever serves a child or a table, nothing is read: it is not what was written
 * down.
 */
export type StandingsShape = 'groups' | 'league' | 'none';
/** The key of a league's one table. */
export const LEAGUE_TABLE_KEY = 'LEAGUE';

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

export interface MapContext {
  /**
   * Group letter by team CODE. Used for a team the feed gave NO id, and for
   * every team when there is no id map at all (standings rows that carried
   * none). Never for a team that has an id while an id map exists.
   */
  groupByTeam?: Record<string, string>;
  /**
   * Group letter by team ID. When present it is the ONLY source for a team
   * that has an id: two teams can share a code (`CAR` is two clubs in the
   * Libertadores), so a code that happens to match is another team's row, and
   * a missing row means "no group known", not "try the letters".
   */
  groupByTeamId?: Record<string, string>;
}

/** Every identifying string a team object might carry, in preference order. */
function teamNames(t: RawTeam | undefined): string[] {
  return [t?.displayName, t?.name, t?.location, t?.shortDisplayName, t?.abbreviation]
    .map((v) => humanLabel(v))
    .filter((v) => v !== '');
}

/**
 * A raw ESPN team object → a `Team`, through the one team constructor.
 *
 * The flag is GENERATED from the name and the id is namespaced and checked —
 * see `sealTeam`. A participant we can name but cannot flag ("Round of 32 1
 * Winner", or any club) is still the provider's entity: it keeps the id ESPN
 * gave it, and identity is checked on it like on any other (audit A04).
 */
function toTeam(raw: RawTeam | undefined): Team | undefined {
  const names = teamNames(raw);
  if (names.length === 0) return undefined;
  return sealTeam({
    name: names[0],
    code: raw?.abbreviation,
    id: providerTeamId(PROVIDER, raw?.id, ESPN_ID),
  });
}

/**
 * Build a participant from a raw competitor.
 *
 * Identity is validated AFTER sanitizing, not before: a name made entirely of
 * invisible characters passed a "does it have text?" check and then sanitized
 * to nothing, producing a nameless participant that rendered as `TBD`.
 */
function toParticipant(raw: RawCompetitor | undefined): ParseResult<Team> {
  if (!raw || typeof raw !== 'object') return malformed('competitor is not an object');
  const team = toTeam(raw.team);
  return team ? valid(team) : malformed('competitor names no team');
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

  // "A team cannot play itself" is decided in `sealMatch`, by the ids these
  // teams now carry — one rule for the feed and the cache. The copy that used
  // to sit here existed only because the ids did not survive into the `Team`.
  const home = homeP.value;
  const away = awayP.value;
  // No `?? 'SCHEDULED'`: an unrecognized status drops the fixture. Refused here
  // rather than left for the seal so the reason names the actual problem, and
  // so the winner/shootout reads below cannot run on a status we never mapped.
  const status = mapStatus(ev.status ?? comp?.status);
  if (!status) return malformed('event status is not a status we recognize');
  const stage = member<Stage>(stageFromSlug((ev.season as { slug?: unknown })?.slug), STAGES) ?? 'FRIENDLY';

  // A team with an id is looked up BY ID, and only by id, whenever an id map
  // exists: if its row is missing, the group is unknown — a code that matches
  // is some other club's row (`CAR` is two clubs). Codes serve a team the feed
  // gave no id, and every team when the standings carried no ids at all.
  //
  // IDS FIRST, ON BOTH SIDES, THEN CODES. An id names the group for certain; a
  // code may be another club's. Home-then-away let an id-less home team's
  // shared code answer before the away team's id was asked. A missing group
  // letter is an absent enrichment; a wrong one is a wrong fact.
  let group: string | undefined;
  if (stage === 'GROUP') {
    const byId = (t: Team): string | undefined =>
      t.id !== undefined ? ctx.groupByTeamId?.[t.id] : undefined;
    const byCode = (t: Team): string | undefined =>
      t.id === undefined || !ctx.groupByTeamId ? ctx.groupByTeam?.[t.code] : undefined;
    group = byId(home) ?? byId(away) ?? byCode(home) ?? byCode(away);
  }

  const hs = toGoals(homeRaw.score);
  const as = toGoals(awayRaw.score);
  const scoreExpected = status === 'LIVE' || status === 'HT' || status === 'FT';
  const hasScore = scoreExpected && hs !== undefined && as !== undefined;
  if (scoreExpected && !hasScore) return malformed('event score is absent or unreadable');

  // EXACTLY one winner. Checking home first meant a payload claiming both teams
  // won advanced the home side out of a contradiction, and `winnerCode` is what
  // moves a team through the bracket.
  const hShoot = toGoals(homeRaw.shootoutScore);
  const aShoot = toGoals(awayRaw.shootoutScore);
  const shootoutPresent = homeRaw.shootoutScore !== undefined || awayRaw.shootoutScore !== undefined;
  const shootout =
    shootoutPresent
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
/**
 * A parsed scoreboard payload. `readable` is false when the ENVELOPE could not
 * be read (no `events` list): nothing is known about what the response holds.
 * That is not the same as records that were refused one by one, and a caller
 * composing several responses must be able to tell them apart.
 */
export interface EspnEventList extends BoundedList<Match> {
  readonly readable: boolean;
}

export function parseEspnEvents(raw: unknown, ctx: MapContext = {}): EspnEventList {
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
  const items: Match[] = [];
  const seenIds = new Set<string>();
  let complete = readable && considered.length === total;
  for (const event of considered) {
    const parsed = parseEspnEvent(event, ctx);
    if (parsed.kind !== 'valid') {
      if (parsed.kind !== 'definitive-none') complete = false;
      continue;
    }
    // Two records asserting different facts about one fixture are ambiguous.
    // Keeping whichever arrived last made live scores order-dependent.
    if (seenIds.has(parsed.value.id)) {
      complete = false;
      continue;
    }
    seenIds.add(parsed.value.id);
    items.push(parsed.value);
  }
  return {
    items,
    total,
    shown: items.length,
    truncated: total > considered.length,
    // Some record was unreadable, or the window did not cover the payload, or
    // the envelope itself was not a list — none of those is a complete account
    // of what the provider sent.
    complete,
    readable,
  };
}

// ---- standings ----
interface RawEntry {
  team?: RawTeam;
  stats?: unknown;
}

/** One exact integer stat. `signed` permits fields such as goal difference or deducted points. */
function statVal(stats: unknown, name: string, signed = false): number | undefined {
  if (!Array.isArray(stats) || stats.length > 64) return undefined;
  const matches = takeBounded<{ name?: unknown; value?: unknown }>(stats, 64).filter(
    (s) => s?.name === name,
  );
  if (matches.length !== 1) return undefined;
  const v = matches[0]?.value;
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) return undefined;
  const limit = 1000;
  return v > limit || v < (signed ? -limit : 0) ? undefined : v;
}

/** ESPN emits deductions when applicable; absence means no deduction. */
function optionalStatVal(stats: unknown, name: string): number | undefined {
  if (!Array.isArray(stats) || stats.length > 64) return undefined;
  const matches = takeBounded<{ name?: unknown; value?: unknown }>(stats, 64).filter(
    (s) => s?.name === name,
  );
  if (matches.length === 0) return 0;
  if (matches.length !== 1) return undefined;
  const v = matches[0]?.value;
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1000 ? v : undefined;
}

type ParsedStandingRow = StandingRow & { providerId?: string; providerRank: number };

function entryToRow(e: RawEntry): ParseResult<ParsedStandingRow> {
  const team = toTeam(e?.team);
  if (!team) return definitiveNone('standings entry names no team');
  const played = statVal(e.stats, 'gamesPlayed');
  const won = statVal(e.stats, 'wins');
  const drawn = statVal(e.stats, 'ties');
  const lost = statVal(e.stats, 'losses');
  const goalsFor = statVal(e.stats, 'pointsFor');
  const goalsAgainst = statVal(e.stats, 'pointsAgainst');
  const goalDiff = statVal(e.stats, 'pointDifferential', true);
  const points = statVal(e.stats, 'points', true);
  const deductions = optionalStatVal(e.stats, 'deductions');
  const providerRank = statVal(e.stats, 'rank');
  if (
    played === undefined ||
    won === undefined ||
    drawn === undefined ||
    lost === undefined ||
    goalsFor === undefined ||
    goalsAgainst === undefined ||
    goalDiff === undefined ||
    points === undefined ||
    deductions === undefined ||
    providerRank === undefined ||
    providerRank < 1
  ) {
    return malformed('standings entry has missing or invalid statistics');
  }
  if (played !== won + drawn + lost) {
    return malformed('standings entry games do not add up');
  }
  if (goalDiff !== goalsFor - goalsAgainst) {
    return malformed('standings entry goal difference does not add up');
  }
  if (points !== won * 3 + drawn - deductions) {
    return malformed('standings entry points do not add up');
  }
  return valid({
    team,
    played,
    won,
    drawn,
    lost,
    goalsFor,
    goalsAgainst,
    goalDiff,
    points,
    providerId: team.id,
    providerRank,
  });
}

/**
 * A parsed standings payload. Beside the batch vocabulary it states the
 * INVENTORY: whether every table child the provider sent became a table. That
 * is not `complete`, which is also false for a refused ROW of a table that was
 * read: a partial table is still a table, and a reader may conclude from a
 * complete inventory that a key it does not hold does not exist.
 */
export interface EspnStandingsList extends BoundedList<GroupStandings> {
  readonly inventory: 'complete' | 'incomplete';
}

/**
 * A table's key, from its RAW name: whole, bounded, by an explicit grammar.
 *
 *   `Group A`            → `A`
 *   `Group A1`           → `A1`     (numbered groups: the UEFA Nations League)
 *   `League A, Group B`  → `A-B`    (groups under a league: Concacaf's)
 *
 * The raw name, not the sanitized label: sanitizing removes characters and
 * cuts at a width, so `Group A` + an invisible character, and `Group A` + 150
 * spaces + `1`, both BECAME "Group A" and were read as group A. And the whole
 * name: matched as a substring, "League B, Group A" was group A, and four of
 * Concacaf's nine tables were shown as the whole competition.
 */
function tableKey(name: unknown): string | undefined {
  if (typeof name !== 'string' || name.length > MAX_TABLE_NAME_UNITS) return undefined;
  // No `u` flag on purpose: without it, case-insensitive matching never folds a
  // non-ASCII character into `a-z` (U+017F, U+212A), so only ASCII can match.
  const group = /^group ([a-z][1-9]?)$/i.exec(name);
  if (group?.[1]) return group[1].toUpperCase();
  const nested = /^league ([a-z]), group ([a-z])$/i.exec(name);
  if (nested?.[1] && nested[2]) return `${nested[1]}-${nested[2]}`.toUpperCase();
  return undefined;
}

/** A child that will have its rows read: its key, its label (if it has one), its rows. */
interface TableCandidate {
  key: string;
  label?: string;
  entries: unknown[];
}

/** The answer for a payload that is not read at all. */
function refusedStandings(truncated: boolean): EspnStandingsList {
  return { items: [], total: 0, shown: 0, truncated, complete: false, inventory: 'incomplete' };
}

/**
 * A standings payload → tables.
 *
 * TWO passes. The first reads every child's NAME and shape and does no row
 * work: it decides which children are tables, under which key, and which keys
 * are claimed twice. The second parses rows, for at most `MAX_GROUPS` tables.
 * So everything that can make a table unauthoritative is known before a row is
 * parsed, and the row work is bounded whatever the payload holds.
 *
 * Every child either becomes a table (it may still turn out partial: rows
 * refused) or makes the INVENTORY incomplete; nothing is skipped. A child does
 * not become a table when: it is a named group (or a league's one child) with
 * no usable rows; its name is outside the grammar, with rows or without; its
 * rows are not a list; two children claim its key (it belongs to neither); or
 * it comes after the last slot. A table at the payload's root, beside the
 * children, is not read either, and makes the inventory incomplete.
 *
 * A payload with tables nobody can inspect is refused WHOLE: more children
 * than the bound, or a child with children of its own (a non-empty list, or
 * anything that is not a list). A table in there could claim a key that was
 * accepted, so no table can be shown to be the only one with its key. This is
 * the one exception to "a refused record is local": it is not a record that
 * is refused, it is the claim that the records read are all there is.
 */
export function parseEspnStandings(
  raw: unknown,
  shape: StandingsShape = 'groups',
  /**
   * The keys this competition's tables may have, when the caller declares them
   * (the World Cup's A to L). A child with any other key is not this
   * competition's table: it gets no slot, none of its rows is parsed, and its
   * teams never enter the identity ledger, so it cannot take a row away from
   * an expected table or name a fixture's group.
   */
  expected?: readonly string[],
): EspnStandingsList {
  const rawChildren = (raw as { children?: unknown })?.children;
  if (shape === 'none') {
    // Measured (Oct 2 2026): a competition with no table answers 200 with its
    // name, its `season` (a year) and a list of past `seasons`, and NO
    // `children` key. For a competition written down
    // as having no table, and only for one, that document is an empty answer
    // (anywhere else a missing list is an envelope that cannot be read). It
    // must BE that document, as it was recorded: an object that names the
    // competition and states a season, with no table of its own. A name alone
    // is not enough (an error body can carry one). And if a child or a table
    // ever appears, the competition is not what was written down: nothing is
    // read, and the canary says the shape changed.
    const doc = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
    const isDocument =
      doc !== undefined &&
      typeof doc.name === 'string' &&
      humanLabel(doc.name) !== '' &&
      // "States a season" is the one rule for a season: a year (`sealSeason`).
      sealSeason(doc.season) !== undefined &&
      doc.standings === undefined;
    const empty = rawChildren === undefined || (Array.isArray(rawChildren) && rawChildren.length === 0);
    return isDocument && empty
      ? { items: [], total: 0, shown: 0, truncated: false, complete: true, inventory: 'complete' }
      : refusedStandings(false);
  }
  if (!Array.isArray(rawChildren)) return refusedStandings(false);
  if (rawChildren.length > MAX_TABLE_CHILDREN) return refusedStandings(true);
  const children = rawChildren as unknown[];

  let complete = true;
  let inventoryComplete = true;
  const refuseTable = () => {
    complete = false;
    inventoryComplete = false;
  };
  // A table at the ROOT, beside the children: nothing here reads it, so it is
  // a table that was not read (no measured payload has one). Under the
  // no-table shape above the same key refuses the document.
  if ((raw as { standings?: unknown }).standings !== undefined) refuseTable();
  /** How many children claim each key. A key claimed twice belongs to neither. */
  const claims = new Map<string, number>();
  const candidates: TableCandidate[] = [];

  for (const node of children) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      refuseTable();
      continue;
    }
    const child = node as Record<string, unknown>;
    // A table tree: its tables are not inspected, so nothing here is. An
    // EMPTY list of children is not one: it holds no table, and refusing a
    // whole competition for it would be one odd field blanking every table.
    const nested = child.children;
    if (nested !== undefined && !(Array.isArray(nested) && nested.length === 0)) {
      return refusedStandings(false);
    }
    const standings = child.standings;
    const entries =
      standings && typeof standings === 'object' ? (standings as { entries?: unknown }).entries : undefined;
    const hasRows = Array.isArray(entries) && entries.length > 0;
    const name = typeof child.name === 'string' ? child.name : child.abbreviation;

    if (shape === 'league') {
      // Authorised by the competition, not inferred from the payload: exactly
      // one child, and it is the table. Two children (an Apertura and a
      // Clausura together) are not read as the first of them.
      const label = humanLabel(name, MAX_TABLE_LABEL_COLUMNS);
      if (children.length !== 1 || !label || !hasRows) {
        refuseTable();
        continue;
      }
      claims.set(LEAGUE_TABLE_KEY, 1);
      candidates.push({ key: LEAGUE_TABLE_KEY, label, entries: entries as unknown[] });
      continue;
    }

    const key = tableKey(name);
    if (!key || (expected && !expected.includes(key))) {
      // Nothing is skipped. A child with an empty rows list under a name the
      // grammar does not know used to be waved through as "a knockout stage":
      // a guess no measured payload supports, and exactly the door a name the
      // grammar REJECTS (`Group A` + an invisible character) walks through.
      // A key outside the declared scope is the same: an unread child.
      refuseTable();
      continue;
    }
    claims.set(key, (claims.get(key) ?? 0) + 1);
    // The provider named this group, so it exists; with no rows it was not read.
    if (!hasRows) {
      refuseTable();
      continue;
    }
    // A lettered group keeps its localized title and carries no label.
    const label = /^[A-Z]$/.test(key) ? undefined : humanLabel(name, MAX_TABLE_LABEL_COLUMNS);
    candidates.push({ key, ...(label ? { label } : {}), entries: entries as unknown[] });
  }

  let rowsTruncated = false;
  let tablesTruncated = false;
  let slots = MAX_GROUPS;
  const out: GroupStandings[] = [];
  // ESPN team ids identify a provider entity across the whole payload. Codes
  // remain table-local because distinct teams can share an abbreviation, but
  // one stable provider id cannot legitimately occupy two groups.
  const seenProviderIds = new Set<string>();

  for (const candidate of candidates) {
    // Withdrawn before any of its rows is read: it costs no slot and leaves
    // nothing in the identity ledger above.
    if ((claims.get(candidate.key) ?? 0) > 1) {
      refuseTable();
      continue;
    }
    // A slot is taken BEFORE the rows and kept whatever happens to them:
    // counting accepted tables would let 64 children of malformed rows cost
    // 2,560 row parses and no table.
    if (slots === 0) {
      tablesTruncated = true;
      refuseTable();
      continue;
    }
    slots -= 1;
    const rawEntries = candidate.entries;
    // Detected AT THE SLICE: `ranked` is built from the already-bounded list, so
    // measuring it afterwards can only ever say nothing was dropped — the same
    // count-after-the-fact mistake as `total`.
    // Rows this table LOST, counted at every refusal below: the table is then
    // marked partial so no consumer can read the survivors as the whole group.
    let omitted = 0;
    if (rawEntries.length > MAX_GROUP_ROWS) {
      rowsTruncated = true;
      complete = false;
      omitted += rawEntries.length - MAX_GROUP_ROWS;
    }
    const entries = takeBounded<RawEntry>(rawEntries, MAX_GROUP_ROWS);
    // Identity is table-local. Other competitions can reuse a provider code in
    // different tables, and two distinct teams can share an abbreviation.
    // Within a table, a shared abbreviation is two teams ONLY when both rows
    // carry (distinct) provider ids — Argentina's River Plate and Independiente
    // Rivadavia are both `RIV`. When either row has no id there is nothing to
    // tell them apart by, and the pair reads as one team listed twice.
    const seenCodes = new Map<string, boolean>(); // code -> that row carried a provider id
    const seenRanks = new Set<number>();
    const ranked: Array<{ row: StandingRow; rank: number }> = [];
    for (const e of entries) {
      const r = entryToRow(e);
      if (r.kind !== 'valid') {
        if (r.kind !== 'definitive-none') complete = false;
        // Even an entry that names no team is a row the table is missing —
        // fail closed: it could be a real team behind an unreadable name.
        omitted += 1;
        continue;
      }
      // A team appears once per table. A duplicate is a payload we cannot read
      // as a table, not two rows about two teams.
      const { providerId, providerRank } = r.value;
      const code = r.value.team.code;
      const priorHadId = seenCodes.get(code);
      const codeCollision =
        priorHadId !== undefined && (providerId === undefined || priorHadId === false);
      if (
        codeCollision ||
        seenRanks.has(providerRank) ||
        (providerId !== undefined && seenProviderIds.has(providerId))
      ) {
        complete = false;
        omitted += 1;
        continue;
      }
      seenCodes.set(code, providerId !== undefined);
      seenRanks.add(providerRank);
      if (providerId !== undefined) seenProviderIds.add(providerId);
      // The provider's rank STAYS on the row (audit A01): renderers print it,
      // and on a partial table it is the only honest position.
      const { providerId: _dropId, providerRank: rank, ...row } = r.value;
      ranked.push({ row: { ...row, rank }, rank });
    }
    ranked.sort((a, b) => {
      if (a.rank && b.rank && a.rank !== b.rank) return a.rank - b.rank;
      if (b.row.points !== a.row.points) return b.row.points - a.row.points;
      if (b.row.goalDiff !== a.row.goalDiff) return b.row.goalDiff - a.row.goalDiff;
      return b.row.goalsFor - a.row.goalsFor;
    });
    // Do not turn a group we could not read into an authoritative empty table.
    // Readable sibling groups remain usable; a caller asking for this known
    // group will take the degraded roster fallback instead.
    if (ranked.length === 0) {
      refuseTable();
      continue;
    }
    out.push({
      group: candidate.key,
      ...(candidate.label ? { label: candidate.label } : {}),
      rows: ranked.map((x) => x.row),
      ...(omitted > 0 ? { partial: { omitted } } : {}),
    });
  }
  return {
    items: out,
    total: claims.size,
    shown: out.length,
    // We stopped early if a table's rows were cut or a table had no slot.
    truncated: rowsTruncated || tablesTruncated,
    complete: complete && !rowsTruncated,
    inventory: inventoryComplete ? 'complete' : 'incomplete',
  };
}
