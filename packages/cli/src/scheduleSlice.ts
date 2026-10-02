/**
 * The SCHEDULE slice of the refresher's cache, as rules (0.11, 2.6b).
 *
 * Off the bundled competition nothing told the refresher when a match could be
 * in play, so it polled around the clock. This slice does:
 *
 *   - an INDEX of the fixtures ahead, from a discovery read about once an hour
 *     (`getScheduleAhead` in core);
 *   - a CONTINUATION (`inPlayUntil`) for a match that was seen in play: it
 *     keeps the gate open past the fixture's window until the provider says
 *     the match is over, or six hours after kickoff;
 *   - a PROBE after a discovery that failed: one live read that asks "is
 *     something in play that the schedule would have told me about?".
 *
 * Everything here is a pure function of a slice and a time. What is read back
 * from the file is believed only within bounds (`scheduleView`): the file is
 * input, and none of it may open the gate for ever, silence discovery, or make
 * the hot path do unbounded work.
 */
import {
  byKickoff,
  isLive,
  LIVE_WINDOW_MS,
  MAX_SCHEDULE_INDEX,
  type Match,
  parseCachedScheduleIndex,
  SCHEDULE_AHEAD_DAYS,
  type ScheduleAheadResult,
  type ScheduleEntry,
  scheduleEntryOf,
  sealSeason,
  type SeasonInfo,
} from '@claudinho/core';
import { type ScheduleSlice, stampAgeMs, validStamp } from './cache';

/** Full records kept for display (the countdown, the syncing line). The gate never depends on them. */
export const SCHEDULE_DISPLAY_MAX = 64;
/** A fixture is RELEVANT from six hours before now: the match in play is exactly what must not be lost. */
export const RELEVANT_BACK_MS = 6 * 60 * 60_000;
/** A match seen in play keeps the gate open until its kickoff plus this, at most. */
export const IN_PLAY_HOLD_MS = 6 * 60 * 60_000;
/** After a discovery that succeeded: the next one. */
export const DISCOVERY_TTL_MS = 60 * 60_000;
/** After the n-th consecutive failure: this × 2^(n−1), at most `DISCOVERY_TTL_MS`. */
export const DISCOVERY_RETRY_MS = 5 * 60_000;
/** `failures` above this says nothing more: the wait is already at its cap. */
const MAX_FAILURES = 32;
/**
 * How far ahead of now an index entry can be and still be believed. Discovery
 * reads to the end of the provider's day `SCHEDULE_AHEAD_DAYS` after today:
 * at most fifteen days from now (an hour more when the clocks change). One
 * day more is the margin. An entry further out was not written by discovery,
 * and a well-formed one would hold the gate open later than anything read.
 */
export const SCHEDULE_HORIZON_MS = (SCHEDULE_AHEAD_DAYS + 2) * 24 * 60 * 60_000;

/** Whether an entry's kickoff is within the span discovery reads (an earlier one is not this rule's business). */
function withinHorizon(entry: ScheduleEntry, now: number): boolean {
  return Date.parse(entry.kickoff) <= now + SCHEDULE_HORIZON_MS;
}

/** A schedule slice as it is believed at a time. */
export interface ScheduleView {
  /** Every fixture the schedule knows, in kickoff order; `undefined` when there is no schedule. */
  index: ScheduleEntry[] | undefined;
  /** Age of the latest discovery ATTEMPT (Infinity: never, or a stamp that cannot be trusted). */
  attemptAgeMs: number;
  /** That attempt's stamp, re-emitted in one form; absent when it cannot be trusted. */
  attemptedAt: string | undefined;
  /** The stamp of the last discovery that succeeded, on the same terms. */
  updatedAt: string | undefined;
  /** The answer that produced the index said it was whole (`true` in the file, nothing else). */
  complete: boolean;
  /** Consecutive failed discoveries. */
  failures: number;
  /** Epoch ms until which a match seen in play keeps the gate open; only while believed. */
  inPlayUntil: number | undefined;
  /** A discovery failed and no live read has asked since. */
  probe: boolean;
  /** The season of the response that produced the slice. */
  season: SeasonInfo | undefined;
}

const NO_SCHEDULE: ScheduleView = {
  index: undefined,
  attemptAgeMs: Number.POSITIVE_INFINITY,
  attemptedAt: undefined,
  updatedAt: undefined,
  complete: false,
  failures: 0,
  inPlayUntil: undefined,
  probe: false,
  season: undefined,
};

/** A stamp from the file, re-emitted in one form; nothing if `stampAgeMs` would not trust it. */
function trustedStamp(value: unknown, now: number): string | undefined {
  return typeof value === 'string' && Number.isFinite(stampAgeMs(value, now))
    ? new Date(Date.parse(value)).toISOString()
    : undefined;
}

/**
 * Read a stored slice (its display records are not read here: they are sealed
 * by the one reader of cached fixtures, where they are shown). Each field is
 * believed on its own terms, so one bad field never takes the others with it:
 *   - the index is whole or absent (`parseCachedScheduleIndex`), and an entry
 *     further ahead than discovery reads (`SCHEDULE_HORIZON_MS`) is not
 *     believed;
 *   - the stamps go through `stampAgeMs` (one in the future is "never": a bad
 *     `attemptedAt` makes discovery due, not silent for years), and they are
 *     read even when the index is not believed, so a poisoned index is paced
 *     like any other state, never retried on every cycle;
 *   - `inPlayUntil` counts only while it is ahead and at most
 *     `IN_PLAY_HOLD_MS` ahead;
 *   - `failures` is a small whole number or zero; `probe` is `true` or false.
 */
export function scheduleView(raw: unknown, now: number): ScheduleView {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...NO_SCHEDULE };
  const s = raw as Record<string, unknown>;
  // A stamp as this product writes one (the cache's own rule), or nothing.
  const until = validStamp(s.inPlayUntil) ? Date.parse(s.inPlayUntil) : undefined;
  const failures =
    typeof s.failures === 'number' && Number.isInteger(s.failures) && s.failures >= 0
      ? Math.min(s.failures, MAX_FAILURES)
      : 0;
  return {
    index: parseCachedScheduleIndex(s.index)?.filter((entry) => withinHorizon(entry, now)),
    attemptAgeMs: stampAgeMs(typeof s.attemptedAt === 'string' ? s.attemptedAt : undefined, now),
    attemptedAt: trustedStamp(s.attemptedAt, now),
    updatedAt: trustedStamp(s.updatedAt, now),
    complete: s.complete === true,
    failures,
    inPlayUntil: until !== undefined && now < until && until - now <= IN_PLAY_HOLD_MS ? until : undefined,
    probe: s.probe === true,
    season: sealSeason(s.season),
  };
}

/**
 * Whether a discovery is due. Anchored on the latest ATTEMPT in every case, so
 * no answer can make discovery due again at once: 60 minutes after a success,
 * 5 minutes × 2^(n−1) (at most 60) after the n-th consecutive failure, and now
 * when none was ever attempted (an age of Infinity is past every wait).
 */
export function discoveryDue(view: ScheduleView): boolean {
  const wait =
    view.failures > 0
      ? Math.min(DISCOVERY_RETRY_MS * 2 ** (view.failures - 1), DISCOVERY_TTL_MS)
      : DISCOVERY_TTL_MS;
  return view.attemptAgeMs >= wait;
}

/** A fixture's live window: from its kickoff for `LIVE_WINDOW_MS`, whatever its stage (off the bundle a stage cannot be trusted to mean "no extra time"; the continuation covers the overrun). */
function inWindow(entry: ScheduleEntry, now: number): boolean {
  const kickoff = Date.parse(entry.kickoff);
  return entry.on && kickoff <= now && now < kickoff + LIVE_WINDOW_MS;
}

/**
 * The live gate off the bundle: open only when a match can be in play. A
 * fixture that is on is inside its window, or a match seen in play has not
 * been seen to end, or (for the refresher and its triggers, `probe: true`) a
 * failed discovery is owed one live read. A probe is a question, not a reason
 * to SAY a match is on: the statusline asks with `probe: false`.
 */
export function scheduleGateOpen(view: ScheduleView, now: number, opts: { probe: boolean }): boolean {
  if (opts.probe && view.probe) return true;
  if (view.inPlayUntil !== undefined && now < view.inPlayUntil) return true;
  return (view.index ?? []).some((entry) => inWindow(entry, now));
}

/**
 * The continuation after a read: the later of what it was (while still ahead)
 * and, for each match the read holds IN PLAY, that match's kickoff plus
 * `IN_PLAY_HOLD_MS`. An observation never lowers it; a match the provider
 * leaves in play for ever stops counting six hours after its kickoff; and no
 * kickoff can put it more than six hours from now.
 */
export function raiseInPlay(was: number | undefined, read: readonly Match[], now: number): number | undefined {
  let until = was !== undefined && was > now ? was : undefined;
  for (const m of read) {
    if (!isLive(m.status)) continue;
    const kickoff = Date.parse(m.kickoff);
    if (!Number.isFinite(kickoff)) continue;
    const deadline = Math.min(kickoff + IN_PLAY_HOLD_MS, now + IN_PLAY_HOLD_MS);
    if (deadline > now && (until === undefined || deadline > until)) until = deadline;
  }
  return until;
}

/** What a slice holds that an answer is compared with. */
export interface StoredSchedule {
  index: readonly ScheduleEntry[] | undefined;
  fixtures: readonly Match[];
  season: SeasonInfo | undefined;
}

/** What a discovery answer makes of the slice. */
export interface DiscoveredSchedule {
  index: ScheduleEntry[];
  fixtures: Match[];
  season?: SeasonInfo;
  complete: boolean;
}

/**
 * What a discovery answer does to the slice, or `undefined` when the discovery
 * FAILED (the slice stands as it was, and the failure cadence applies): a
 * degraded answer, or an index that would exceed its bound.
 *
 * "At stake" means the slice holds at least one relevant record.
 *
 *   answer                                    nothing at stake   something at stake
 *   complete                                  stored             replaces the slice
 *   incomplete, same season                   stored             a union by id (below)
 *   incomplete, a season unknown either side  stored             a union by id (below)
 *   incomplete, KNOWN to be another season    stored             replaces the slice
 *
 * An unknown season is an ordinary state here, not a provider that forgot to
 * state one: for the sixteen days a span touches two seasons, every answer
 * states none. So only an answer KNOWN to be another season may delete what it
 * did not read. The stored season is the answer's, or none. (The bundled
 * path's knockout slice keeps its own rule: there a season unknown on either
 * side leaves the slice as it was.)
 *
 * The union: a relevant record the slice held and the answer did not READ
 * stays (unless it is further ahead than discovery reads: such an entry was
 * never written by discovery); everything read is taken from the answer.
 * "Read" is asked of the answer's own account (`mentioned`, taken before a
 * month is narrowed to the span): a fixture read as postponed gets
 * `on: false`, and one moved beyond the span is gone, not put back at its old
 * kickoff.
 *
 * A result with more relevant fixtures than the index holds is a failed
 * discovery too: the index is whole or it does not exist.
 */
export function applyDiscovery(
  prev: StoredSchedule,
  answer: ScheduleAheadResult,
  now: number,
): DiscoveredSchedule | undefined {
  if (answer.degraded) return undefined;
  const relevant = (kickoff: string) => Date.parse(kickoff) >= now - RELEVANT_BACK_MS;
  const read = answer.fixtures.filter((m) => relevant(m.kickoff));
  const readEntries = read.flatMap((m) => {
    const entry = scheduleEntryOf(m);
    return entry ? [entry] : [];
  });
  // A union never carries an entry beyond the span discovery reads.
  const atStake = (prev.index ?? []).filter((entry) => relevant(entry.kickoff) && withinHorizon(entry, now));
  const complete = answer.complete === true;

  let kept: ScheduleEntry[] = [];
  // Only an answer KNOWN to be another season replaces what it did not read.
  const anotherSeason = !!answer.season && !!prev.season && answer.season.year !== prev.season.year;
  if (!complete && !anotherSeason) {
    const mentioned = new Set(answer.mentioned ?? answer.fixtures.map((m) => m.id));
    kept = atStake.filter((entry) => !mentioned.has(entry.id));
  }
  const index = [...readEntries, ...kept].sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  if (index.length > MAX_SCHEDULE_INDEX) return undefined;

  // Full records for display: the answer's, and the ones carried for what was kept.
  const keptIds = new Set(kept.map((entry) => entry.id));
  const fixtures = [...read, ...prev.fixtures.filter((m) => keptIds.has(m.id))]
    .sort(byKickoff)
    .slice(0, SCHEDULE_DISPLAY_MAX);
  return { index, fixtures, ...(answer.season ? { season: answer.season } : {}), complete };
}

/** The slice type, re-exported for the callers of these rules. */
export type { ScheduleSlice };
