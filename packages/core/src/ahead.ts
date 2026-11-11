/**
 * The next match day: what an EMPTY `today` or `live` off the bundled
 * competition points at, built once for every surface.
 *
 * An empty day in a league's break says "No matches scheduled for this date"
 * and stops, and the reader has to guess which day to ask next. The schedule
 * ahead (`getScheduleAhead`: discovery's span, yesterday to 14 provider days
 * ahead) knows. From it, read WHOLE, this module says:
 *
 *   - for a day: the next LOCAL day (in the viewer's zone) after the day shown
 *     holding a fixture that is on (not postponed, cancelled or finished), with
 *     its count when the whole of that day lies inside the span read
 *     ({@link dayPointer});
 *   - for `live`: the next kickoff AHEAD of the request's clock, never a match
 *     now ({@link livePointer});
 *   - when nothing that is on falls in the span: the horizon (`{ days: 14 }`).
 *
 * It is the answer's own text and plain fields (`nextDay`, `nextKickoff`,
 * `horizon`: {@link pointerExtras}), never a verdict: asked only of an empty
 * body that no verdict replaces, after a read that was whole and healthy, off
 * the bundle ({@link pointerWanted}, the ONE gate, asked before any extra
 * read), and never under a cooldown ({@link readAhead} makes no request then).
 * A day it cannot vouch for (one that starts before the span read, one that
 * ends after it for the count) is not named, or named without a count.
 */
import type { ProviderAdapter } from './adapters/types';
import { bundleApplies } from './competition';
import { getScheduleAhead, scheduleSpan } from './live';
import type { ReadAccount } from './share/cards';
import { SCHEDULE_AHEAD_DAYS } from './span';
import { localDate, shiftUtcDate } from './time';
import { type ScheduleEntry, scheduleEntryOf } from './trust/schedule';
import { statesPartial, verdictNotice } from './verdict';

/**
 * The schedule ahead as the pointers read it: the entries (id, kickoff, on)
 * and the span read, as INSTANTS: `from` is the start of the provider's first
 * day, `to` the start of the provider's day after the last. Only an entry with
 * `from <= kickoff < to` is held.
 */
export interface AheadRead {
  readonly entries: readonly ScheduleEntry[];
  readonly from: string;
  readonly to: string;
}

/** The horizon: nothing that is on falls in the span read, this many provider days ahead. */
export interface AheadHorizon {
  readonly horizon: { readonly days: number };
}

/** An empty day's pointer: the next local day with a fixture that is on, or the horizon. */
export type DayPointer = { readonly nextDay: { readonly date: string; readonly count?: number } } | AheadHorizon;

/** An empty live list's pointer: the next kickoff ahead (a canonical instant), or the horizon. */
export type KickoffPointer = { readonly nextKickoff: string } | AheadHorizon;

/** Either pointer. */
export type AheadPointer = DayPointer | KickoffPointer;

/** The plain fields a pointer is carried as in a structured answer. */
export interface PointerExtras {
  nextDay?: { date: string; count?: number };
  nextKickoff?: string;
  horizon?: { days: number };
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * The first instant (to the minute) whose day, by `dayOf`, is `day` or later:
 * when that day starts. There is no inverse of a zone's calendar, so it is
 * searched, bounded: a binary search over the 48 hours around the day's UTC
 * midnight (every zone's midnight lies within them), about a dozen steps.
 */
function startOfDay(day: string, dayOf: (instant: Date) => string): number {
  const midnight = Date.parse(`${day}T00:00:00Z`);
  let lo = midnight - DAY_MS;
  let hi = midnight + DAY_MS;
  if (dayOf(new Date(lo)) >= day) return lo;
  if (dayOf(new Date(hi)) < day) return hi;
  // Invariant: dayOf(lo) < day <= dayOf(hi).
  while (hi - lo > MINUTE_MS) {
    const mid = lo + Math.floor((hi - lo) / 2 / MINUTE_MS) * MINUTE_MS;
    if (mid <= lo) break;
    if (dayOf(new Date(mid)) >= day) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** The provider's calendar day of an instant (its own, else the UTC day). */
function providerDay(adapter: ProviderAdapter): (instant: Date) => string {
  return (instant) => adapter.bucketDay?.(instant) || instant.toISOString().slice(0, 10);
}

/**
 * The schedule ahead from entries already sealed (a fresh read's, or the
 * index of a stored slice): the span is discovery's for the moment `at` the
 * entries were read (`scheduleSpan`), so a stored slice keeps the span it was
 * read over. Entries outside that span are not held.
 */
export function aheadFromEntries(entries: readonly ScheduleEntry[], adapter: ProviderAdapter, at: Date): AheadRead {
  const { start, end } = scheduleSpan(adapter, at);
  const dayOf = providerDay(adapter);
  const from = startOfDay(start, dayOf);
  const to = startOfDay(shiftUtcDate(end, 1), dayOf);
  const held = entries
    .filter((e) => {
      const k = Date.parse(e.kickoff);
      return Number.isFinite(k) && from <= k && k < to;
    })
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  return { entries: held, from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

/**
 * The schedule ahead, read WHOLE, or nothing. No request at all while the
 * adapter's cooldown is in effect at the request's clock; nothing when the read
 * failed (a throttle included) or was not whole (a fixture it did not read may
 * be the next one).
 */
export async function readAhead(adapter: ProviderAdapter, now: Date): Promise<AheadRead | undefined> {
  const cooldown = adapter.cooldownUntil;
  if (typeof cooldown === 'number' && cooldown > now.getTime()) return undefined;
  const read = await getScheduleAhead(adapter, now);
  if (read.degraded !== false || read.complete !== true) return undefined;
  const entries = read.fixtures.map(scheduleEntryOf).filter((e): e is ScheduleEntry => e !== undefined);
  return aheadFromEntries(entries, adapter, now);
}

/**
 * THE gate, asked before any extra read: a pointer is wanted only for an
 * empty body, after a read that did not fail, was whole, and states no verdict
 * that replaces the body (nothing chosen, not offered, between editions...),
 * off the bundled competition (whose empty day is the bundle's answer).
 */
export function pointerWanted(result: ReadAccount, competition: string, bodyEmpty: boolean): boolean {
  return (
    bodyEmpty &&
    result.degraded !== true &&
    verdictNotice(result) === undefined &&
    !statesPartial(result) &&
    !bundleApplies(competition)
  );
}

/**
 * Whether {@link dayPointer} could name anything for `shownDay` at all, asked
 * BESIDE {@link pointerWanted} and before the read, so a day the span cannot
 * reach costs no request: true only when the day after `shownDay` (in `tz`)
 * starts inside the span the read would cover at the request's clock (from
 * the start of its first provider day to the start of the day after its
 * last). A day before the span is one nothing can vouch for; a day after it
 * has nothing after it to name, and is not today (the horizon's day). The span
 * is the one {@link readAhead} reads and the one a slice written on the same
 * provider day was read over, so the answer is the same as reading and asking.
 */
export function nextDayReachable(adapter: ProviderAdapter, shownDay: string, tz: string | undefined, now: Date): boolean {
  const { start, end } = scheduleSpan(adapter, now);
  const dayOf = providerDay(adapter);
  const from = startOfDay(start, dayOf);
  const to = startOfDay(shiftUtcDate(end, 1), dayOf);
  const after = startOfDay(shiftUtcDate(shownDay, 1), (instant) => localDate(instant.toISOString(), tz));
  return from <= after && after < to;
}

/**
 * The next local day after `shownDay` (in `tz`, the viewer's effective zone,
 * `resolveTz`'s answer, a required parameter) holding a
 * fixture that is on; its count only when that whole day lies inside the span
 * read. Named only when the day after `shownDay` starts at or after the span's
 * start (else the days between were not read: nothing to vouch for). None
 * found: the horizon, for today only (`shownDay === today`); undefined for
 * another day. The request's clock is a required parameter, as for every
 * now-relative rendering; an entry is filed by its kickoff alone, so the day
 * named does not move with it (`today` is that clock's day in `tz`).
 */
export function dayPointer(
  ahead: AheadRead,
  shownDay: string,
  today: string,
  tz: string | undefined,
  _now: Date,
): DayPointer | undefined {
  const dayOf = (instant: Date) => localDate(instant.toISOString(), tz);
  const from = Date.parse(ahead.from);
  const to = Date.parse(ahead.to);
  const after = shiftUtcDate(shownDay, 1);
  if (startOfDay(after, dayOf) < from) return undefined;
  let date: string | undefined;
  for (const e of ahead.entries) {
    if (!e.on) continue;
    const day = localDate(e.kickoff, tz);
    if (day >= after && (date === undefined || day < date)) date = day;
  }
  if (date === undefined) return shownDay === today ? { horizon: { days: SCHEDULE_AHEAD_DAYS } } : undefined;
  const found = date;
  const ends = startOfDay(shiftUtcDate(found, 1), dayOf);
  if (ends > to) return { nextDay: { date: found } };
  const count = ahead.entries.filter((e) => e.on && localDate(e.kickoff, tz) === found).length;
  return { nextDay: { date: found, count } };
}

/** The earliest fixture that is on with a kickoff strictly after `now` (the request's clock); else the horizon. Never a match now. */
export function livePointer(ahead: AheadRead, now: Date): KickoffPointer {
  const at = now.getTime();
  const to = Date.parse(ahead.to);
  let next: ScheduleEntry | undefined;
  for (const e of ahead.entries) {
    const k = Date.parse(e.kickoff);
    if (!e.on || !(k > at) || !(k < to)) continue;
    if (next === undefined || k < Date.parse(next.kickoff)) next = e;
  }
  return next ? { nextKickoff: next.kickoff } : { horizon: { days: SCHEDULE_AHEAD_DAYS } };
}

/** THE mapping of a pointer to the plain fields of a structured answer (CLI `--json`, MCP `data`); nothing without one. */
export function pointerExtras(p: AheadPointer | undefined): PointerExtras {
  if (p === undefined) return {};
  if ('nextDay' in p) {
    const { date, count } = p.nextDay;
    return { nextDay: count !== undefined ? { date, count } : { date } };
  }
  if ('nextKickoff' in p) return { nextKickoff: p.nextKickoff };
  return { horizon: { days: p.horizon.days } };
}
