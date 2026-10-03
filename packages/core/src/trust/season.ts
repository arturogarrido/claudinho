/**
 * The season a provider reported for one response — sealed here, whether it
 * arrived in a feed payload or was read back from our own cache file.
 *
 * A season is METADATA of a result. It is never part of what a request selects
 * (a request selects a competition), and nothing may assume one before a
 * provider has said it: the statusline, which reads only the cache, cannot know
 * that a newer season exists and must not claim to.
 */
import type { SeasonInfo } from '../types';
import { malformed, type ParseResult, valid } from './result';
import { canonicalTimestamp, humanLabel } from './roles';

/** Football seasons we will believe: no payload makes it year 20260. */
const MIN_YEAR = 1900;
const MAX_YEAR = 2200;

function seasonYear(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_YEAR && value <= MAX_YEAR
    ? value
    : undefined;
}

/**
 * THE constructor of a `SeasonInfo`. The year is the fact; without a readable
 * one there is no season to report. Label and dates are optional decorations:
 * an unreadable one is dropped, never substituted.
 */
export function sealSeason(raw: unknown): SeasonInfo | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const s = raw as Record<string, unknown>;
  const year = seasonYear(s.year);
  if (year === undefined) return undefined;
  const out: SeasonInfo = { year, label: humanLabel(s.label) };
  const startDate = canonicalTimestamp(s.startDate);
  if (startDate) out.startDate = startDate;
  const endDate = canonicalTimestamp(s.endDate);
  if (endDate) out.endDate = endDate;
  return out;
}

/**
 * The ONE season several responses state together (the parts of a window, the
 * months of a discovery), once the caller's year rule has said they state one:
 * the first stated season, with each of its dates kept only when EVERY stating
 * response stated that same date. A date one response disputes or leaves out
 * is not the season's: "between editions" reads the end date, and must not
 * believe a date only some of the answers gave. Undefined when nothing was
 * stated, or when two years were (the year rule belongs to the caller; this
 * never picks one).
 */
export function agreedSeason(stated: readonly SeasonInfo[]): SeasonInfo | undefined {
  const first = stated[0];
  if (!first || stated.some((s) => s.year !== first.year)) return undefined;
  const out: SeasonInfo = { year: first.year, label: first.label };
  if (first.startDate !== undefined && stated.every((s) => s.startDate === first.startDate)) {
    out.startDate = first.startDate;
  }
  if (first.endDate !== undefined && stated.every((s) => s.endDate === first.endDate)) {
    out.endDate = first.endDate;
  }
  return out;
}

/** The season an ESPN scoreboard payload reports for itself (`leagues[0].season`). */
export function parseEspnSeason(payload: unknown): ParseResult<SeasonInfo> {
  const leagues = (payload as { leagues?: unknown } | undefined)?.leagues;
  if (!Array.isArray(leagues) || leagues.length === 0) {
    return malformed('payload states no league');
  }
  const raw = (leagues[0] as { season?: unknown } | undefined)?.season;
  if (!raw || typeof raw !== 'object') return malformed('league states no season');
  const s = raw as Record<string, unknown>;
  const season = sealSeason({
    year: s.year,
    label: s.displayName ?? (s.type as { name?: unknown } | undefined)?.name,
    startDate: s.startDate,
    endDate: s.endDate,
  });
  return season ? valid(season) : malformed('season year is absent or not a year');
}
