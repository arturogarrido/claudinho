/**
 * The single place a `Match` is sealed — whichever path it arrived by.
 *
 * This closes the PATH asymmetry. A fixture reaches a renderer two ways: live
 * from the ESPN adapter, or read back from the local cache file that the
 * statusline and hook render on every prompt. Those two paths had SEPARATE
 * rules, so every fix landed on one of them:
 *
 *   - the live path DERIVED each team's flag from the nation; the cache path
 *     accepted whatever string sat in `flag`, which is why the emoji exemption
 *     existed at all and why TAG, variation selectors and ZWJ each produced a P1
 *   - the live path required `status !== 'SCHEDULED'` before keeping a score;
 *     the cache path kept any numeric pair, so an edited cache file could show
 *     a scoreline on a fixture that has not kicked off
 *   - the live path set `winnerCode` to one of the two competitors by
 *     construction; the cache path passed any string through, and `winnerCode`
 *     is what advances a team through the bracket
 *
 * Both paths now end HERE, so a rule cannot be added to one and forgotten on the
 * other. `parseEspnEvent` assembles candidate parts from the feed and seals
 * them; `parseCachedMatch` seals the record it read. The parity property in
 * trust-parity.test.ts asserts the two agree, and idempotence — sealing an
 * already-sealed Match returns it unchanged — is what makes the round trip safe.
 */
import type { Match, MatchEvent, Stage, Status, Team } from '../types';
import { type BoundedList, takeBounded } from './bounded';
import { type ParseResult, definitiveNone, malformed, valid } from './result';
import {
  ESPN_ID,
  canonicalTimestamp,
  count,
  humanLabel,
  member,
  opaqueId,
  productFlag,
} from './roles';

/** Ceilings well above any real football value, but finite. */
export const MAX_GOALS = 99;
export const MAX_MINUTE = 200;
/** Events kept from ONE match. A real match has a few dozen. */
export const MAX_MATCH_EVENTS = 128;
/** A team's 3-letter code; the cap is display columns, not bytes. */
export const TEAM_CODE_COLUMNS = 8;

const STAGES = new Set<string>(['GROUP', 'R32', 'R16', 'QF', 'SF', '3P', 'F', 'FRIENDLY']);
const STATUSES = new Set<string>(['SCHEDULED', 'LIVE', 'HT', 'FT', 'POSTPONED', 'CANCELLED']);
const EVENT_TYPES = new Set(['GOAL', 'OWN_GOAL', 'PEN', 'YELLOW', 'RED', 'SUB']);

/** Loosely-typed candidate fields — whatever the feed or the cache file held. */
export interface MatchParts {
  id?: unknown;
  stage?: unknown;
  group?: unknown;
  kickoff?: unknown;
  venue?: unknown;
  city?: unknown;
  country?: unknown;
  home?: unknown;
  away?: unknown;
  score?: unknown;
  shootout?: unknown;
  minute?: unknown;
  status?: unknown;
  winnerCode?: unknown;
  updatedAt?: unknown;
  events?: unknown;
}

/**
 * A team, with its flag GENERATED from the nation rather than accepted.
 *
 * There is no path by which a provider or a cache file chooses which glyph is
 * rendered, so there is no exemption for an attacker to aim at.
 */
/**
 * A team's short code: uppercased, THEN bounded.
 *
 * Two bugs lived in the one-liner this replaces.
 *
 * Order: `humanLabel(x, 8).toUpperCase()` bounded the input and then grew it —
 * `'ß'.repeat(8)` uppercases to sixteen `S`, twice the cap the call declared.
 * Case-mapping is not length-preserving, so it has to happen first.
 *
 * Fallback: `name.slice(0, 3)` slices UTF-16 UNITS, so a name beginning with
 * astral characters was cut through the middle of a surrogate pair — emitting a
 * LONE SURROGATE, which is exactly the \p{Cs} class the label role exists to
 * refuse. Slicing by code point cannot split one.
 */
export function teamCode(raw: unknown, fallbackName: string): string {
  const upper = typeof raw === 'string' ? raw.toUpperCase() : raw;
  const stated = humanLabel(upper, TEAM_CODE_COLUMNS);
  if (stated) return stated;
  return humanLabel([...fallbackName].slice(0, 3).join('').toUpperCase(), TEAM_CODE_COLUMNS);
}

export function sealTeam(raw: unknown): Team | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const t = raw as Record<string, unknown>;
  const name = humanLabel(t.name);
  if (!name) return undefined;
  const code = teamCode(t.code, name);
  return { code, name, flag: productFlag(name) };
}

function sealScorePair(raw: unknown): { home: number; away: number } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const v = raw as { home?: unknown; away?: unknown };
  const home = count(v.home, MAX_GOALS);
  const away = count(v.away, MAX_GOALS);
  return home !== undefined && away !== undefined ? { home, away } : undefined;
}

function sealEvent(raw: unknown): MatchEvent | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const e = raw as Record<string, unknown>;
  const type = member<MatchEvent['type']>(e.type, EVENT_TYPES);
  if (!type) return undefined;
  const minute = count(e.minute, MAX_MINUTE);
  if (minute === undefined) return undefined;
  const out: MatchEvent = { type, minute, teamCode: humanLabel(e.teamCode, TEAM_CODE_COLUMNS) };
  const player = humanLabel(e.player);
  if (player) out.player = player;
  return out;
}

/**
 * Validate candidate parts into a Match, or say why not.
 *
 * `id`, `kickoff`, `stage` and `status` DROP the whole fixture rather than
 * falling back to a default. Each decides what the reader is told — status picks
 * between "FT" and a live scoreline, kickoff decides which calendar day the
 * fixture is filed under — so substituting a plausible value would invent the
 * very fact the bad field destroyed.
 */
export interface SealOptions {
  /**
   * Seal in-match events too. Default true.
   *
   * The statusline and hook render a scoreline, not a timeline — they never
   * read `events` — and sealing them is the DOMINANT cost on a 150ms path: a
   * poisoned cache of 64 live matches carrying 128 events each measured
   * 11.9 s, because each event's `player` is a label and a label is segmented
   * grapheme by grapheme. Bounding the COUNT was not enough when the surface
   * needs ZERO. Cheapest work is work not done.
   */
  readonly events?: boolean;
}

export function sealMatch(parts: MatchParts, opts: SealOptions = {}): ParseResult<Match> {
  if (!parts || typeof parts !== 'object') return malformed('match is not an object');

  const id = opaqueId(parts.id, ESPN_ID);
  if (!id) return malformed('match id is absent or not an identifier');
  const kickoff = canonicalTimestamp(parts.kickoff);
  if (!kickoff) return malformed('match kickoff is absent or not one instant');
  const stage = member<Stage>(parts.stage, STAGES);
  if (!stage) return malformed('match stage is not a known stage');
  const status = member<Status>(parts.status, STATUSES);
  if (!status) return malformed('match status is not a known status');

  const home = sealTeam(parts.home);
  const away = sealTeam(parts.away);
  if (!home || !away) return malformed('match does not name both teams');

  const group = humanLabel(parts.group) || undefined;
  const city = humanLabel(parts.city) || undefined;
  const country = humanLabel(parts.country) || undefined;

  // A SCHEDULED fixture has not been played, so it has no result. The live path
  // enforced this by construction and the cache path did not, which let an
  // edited cache file put a scoreline on a fixture that has not kicked off.
  const score = status === 'SCHEDULED' ? undefined : sealScorePair(parts.score);
  // A shootout is a KNOCKOUT tie-break on a FINISHED, LEVEL match. Gated on all
  // three, because each ungated one is a state that cannot exist: penalties in a
  // group game, penalties mid-match, penalties on a 2-0. It also never survives
  // without the regulation score it decorates.
  const finished = status === 'FT';
  const knockout = stage !== 'GROUP' && stage !== 'FRIENDLY';
  const shootout =
    score && finished && knockout && score.home === score.away
      ? sealScorePair(parts.shootout)
      : undefined;

  // `winnerCode` is the field the bracket ADVANCES a team on, so it gets the
  // strictest reading in this file, and it gets it HERE so the live feed and the
  // cache file are held to one rule. (I first wrote this check in the ESPN
  // parser, which left the cache path accepting `0-2` with the loser named — the
  // exact path asymmetry this module exists to make impossible.)
  //
  // A claim is kept only when the RESULT agrees with it:
  //   - no score at all        -> nothing to agree with; advance nobody
  //   - decisive regulation    -> the score decides, penalties cannot override it
  //   - level + penalties      -> penalties decide, and must themselves be decisive
  //   - level, no penalties    -> a KNOCKOUT tie that finished level was settled
  //     somehow, and the flag is the only record of it, so it is not
  //     contradicted; a level GROUP game has no winner at all, so it is.
  const claimedWinner = teamCode(parts.winnerCode, '');
  const claimedSide =
    claimedWinner === home.code ? 'home' : claimedWinner === away.code ? 'away' : undefined;
  let winnerCode: string | undefined;
  // Only a FINISHED match has a winner. A LIVE 2-0 carrying a `winnerCode`
  // advanced a team out of a match still being played.
  if (claimedSide && score && finished) {
    const level = score.home === score.away;
    const decider = level ? shootout : score;
    if (decider && decider.home !== decider.away) {
      if ((decider.home > decider.away ? 'home' : 'away') === claimedSide) winnerCode = claimedWinner;
    } else if (level && !shootout && knockout) {
      winnerCode = claimedWinner;
    }
  }

  // SLICE BEFORE MAP: the record count is bounded by the caller, the events
  // inside ONE record were not, and a single match carrying 100k of them cost
  // seconds on a surface with a 150ms budget.
  const events =
    opts.events === false
      ? []
      : takeBounded<unknown>(parts.events, MAX_MATCH_EVENTS)
          .map(sealEvent)
          .filter((e): e is MatchEvent => !!e);

  // Assigned in the order `Match` DECLARES its fields, skipping the absent ones.
  // Key order is not cosmetic here: this object is serialized straight into
  // `--json` and MCP structuredContent. Built by assignment rather than a
  // literal-plus-`delete` because deleting a key deoptimizes the object, and
  // this runs per fixture on a 150ms-budget path.
  const out = { id, stage } as Match;
  if (group) out.group = group;
  out.kickoff = kickoff;
  out.venue = humanLabel(parts.venue);
  if (city) out.city = city;
  if (country) out.country = country;
  out.home = home;
  out.away = away;
  if (score) out.score = score;
  if (shootout) out.shootout = shootout;
  const minute = count(parts.minute, MAX_MINUTE);
  if (minute !== undefined) out.minute = minute;
  out.status = status;
  if (events.length) out.events = events;
  if (winnerCode) out.winnerCode = winnerCode;
  out.updatedAt = canonicalTimestamp(parts.updatedAt) ?? '';
  return valid(out);
}

/**
 * A Match read back from our own cache file.
 *
 * The cache is a local file the statusline renders on every prompt, so it is
 * untrusted input in exactly the way a feed response is — with the extra twist
 * that it holds values we ourselves wrote, which is what made it tempting to
 * trust. It goes through the same seal.
 */
export function parseCachedMatch(raw: unknown, opts: SealOptions = {}): ParseResult<Match> {
  if (!raw || typeof raw !== 'object') return definitiveNone('cache entry is not an object');
  return sealMatch(raw as MatchParts, opts);
}

/** Cached fixtures, bounded BEFORE the per-record work. */
export function parseCachedMatches(
  raw: unknown,
  max: number,
  opts: SealOptions = {},
): BoundedList<Match> {
  // The TRUE input size, read before slicing — `takeBounded` discards it, and a
  // count taken after the slice can only ever report "nothing was dropped".
  const total = Array.isArray(raw) ? raw.length : 0;
  const considered = takeBounded<unknown>(raw, max);
  const items = considered
    .map((m) => parseCachedMatch(m, opts))
    .flatMap((r) => (r.kind === 'valid' ? [r.value] : []));
  return {
    items,
    total,
    shown: items.length,
    truncated: total > considered.length,
    // Some record in the window was unreadable, or the window did not cover the
    // file — either way we are not reporting on all of it.
    complete: items.length === total,
  };
}
