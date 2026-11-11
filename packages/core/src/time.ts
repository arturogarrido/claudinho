/**
 * Timezone-aware kickoff formatting and countdowns.
 * Pure Intl; no dependencies. Safe in Node and Workers.
 */
import { t } from './i18n';
import { isValidDate, isValidTimeZone } from './validate';

function envTz(): string | undefined {
  if (typeof process !== 'undefined' && process.env && process.env.CLAUDINHO_TZ) {
    return process.env.CLAUDINHO_TZ;
  }
  return undefined;
}

/** The runtime's system timezone, or undefined if it can't be resolved. */
function systemTz(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the effective timezone: explicit arg > CLAUDINHO_TZ env > system.
 *
 * Crucially, an *invalid* candidate is skipped rather than returned, so a bad
 * `--tz`/CLAUDINHO_TZ can never reach an Intl call and throw. The worst case is
 * a silent fall back to the system zone (or undefined → runtime default).
 * Callers that want to *tell* the user it was invalid should check
 * `isValidTimeZone` themselves (the CLI does).
 */
export function resolveTz(explicit?: string): string | undefined {
  if (explicit && isValidTimeZone(explicit)) return explicit;
  const fromEnv = envTz();
  if (fromEnv && isValidTimeZone(fromEnv)) return fromEnv;
  return systemTz();
}

export interface FormatOpts {
  tz?: string;
  locale?: string;
  /** Include month and day (for multi-week schedules like the knockout bracket). */
  date?: boolean;
}

/**
 * A locale tag `Intl` will accept. A structurally-invalid tag (e.g. "%%%")
 * makes `Intl.DateTimeFormat` throw `RangeError`, so guard it and fall back to
 * English — a bad `locale` (incl. the MCP `lang` arg) must never crash
 * formatting.
 */
function safeLocale(locale?: string): string {
  if (!locale) return 'en';
  try {
    Intl.getCanonicalLocales(locale);
    return locale;
  } catch {
    return 'en';
  }
}

/**
 * A `Date` only when the input actually parses.
 *
 * `Intl.DateTimeFormat.format()` throws `RangeError: Invalid time value` on an
 * Invalid Date, and every one of these helpers is called with a feed-supplied
 * `kickoff`. One unparseable value therefore aborted the entire command rather
 * than degrading one fixture. The adapter now refuses such a value at the
 * boundary; this is the second line, so no renderer can be crashed by a date.
 */
function parsedDate(iso: string): Date | undefined {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t) : undefined;
}

/** Shown in place of a time we cannot compute. Never a guessed one. */
const UNKNOWN_TIME = '—';

/** Format a kickoff like "Thu 19:00", or "Sat, Jul 4, 17:00" when `date` is set. */
export function formatKickoff(iso: string, opts: FormatOpts = {}): string {
  const when = parsedDate(iso);
  if (!when) return UNKNOWN_TIME;
  const tz = resolveTz(opts.tz);
  const locale = safeLocale(opts.locale);
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    ...(opts.date ? { month: 'short', day: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: tz,
  }).format(when);
}

/** A short calendar date like "Jun 11" in the target timezone/locale. */
export function formatDate(iso: string, opts: FormatOpts = {}): string {
  const when = parsedDate(iso);
  if (!when) return UNKNOWN_TIME;
  const tz = resolveTz(opts.tz);
  const locale = safeLocale(opts.locale);
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: tz,
  }).format(when);
}

/** Time of day like "19:00" (24-hour) in the target timezone/locale. */
export function formatTime(iso: string, opts: FormatOpts = {}): string {
  const when = parsedDate(iso);
  if (!when) return UNKNOWN_TIME;
  const tz = resolveTz(opts.tz);
  const locale = safeLocale(opts.locale);
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: tz,
  }).format(when);
}

/** What {@link countdown} says of a kickoff that has passed (the statusline prints it as it is: English, by its rule). */
export const COUNTDOWN_NOW = 'now';

/**
 * Compact human countdown until kickoff: "3d4h", "2h10m", "45m", or {@link COUNTDOWN_NOW}, from `from`: the clock of
 * the request or render that says it, which every caller hands in (no default: the wall clock is never read here).
 */
export function countdown(iso: string, from: Date): string {
  const when = parsedDate(iso);
  // NaN arithmetic previously fell through every comparison and printed "NaNm".
  if (!when) return UNKNOWN_TIME;
  const ms = when.getTime() - from.getTime();
  if (ms <= 0) return COUNTDOWN_NOW;
  const totalMin = Math.floor(ms / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}d${hours}h`;
  if (hours > 0) return `${hours}h${mins}m`;
  return `${mins}m`;
}

/**
 * The countdown as the reader's phrase, ONE rule for every localized line that
 * says it (CLI `next`, the MCP match line): "in 3d4h" (`next.in`), or, for a
 * kickoff that has passed (a stale record, the bundle's skeleton during an
 * outage), the language's own word for now (`countdown.now`), never the
 * English word inside a translated "in". Relative to the REQUEST's clock
 * (`from`), the one every other read of the request takes and every caller
 * passes: the wall clock is never read here.
 */
export function countdownPhrase(lang: string | undefined, iso: string, from: Date): string {
  const left = countdown(iso, from);
  return left === COUNTDOWN_NOW ? t(lang, 'countdown.now') : t(lang, 'next.in', { countdown: left });
}

/**
 * The calendar date (YYYY-MM-DD) of a kickoff in the target timezone, or ''
 * when the input can't be parsed — an unfileable fixture matches no date rather
 * than throwing out of whatever was grouping by day.
 */
export function localDate(iso: string, tz?: string): string {
  const when = parsedDate(iso);
  if (!when) return '';
  const zone = resolveTz(tz);
  // en-CA renders ISO-like YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: zone,
  }).format(when);
}

/**
 * Shift a date by whole **UTC** days, returning `YYYY-MM-DD`. Accepts a full ISO
 * timestamp or a bare date (only the date part is read). Used to build ±1-day
 * fetch windows (live.ts) and adjacent-day market slugs (markets/polymarket.ts).
 */
export function shiftUtcDate(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days))
    .toISOString()
    .slice(0, 10);
}

/** The weekday words a day argument takes, by `Date#getUTCDay` index (Sunday 0): the short and the full English name. */
const WEEKDAYS: ReadonlyArray<readonly [string, string]> = [
  ['sun', 'sunday'],
  ['mon', 'monday'],
  ['tue', 'tuesday'],
  ['wed', 'wednesday'],
  ['thu', 'thursday'],
  ['fri', 'friday'],
  ['sat', 'saturday'],
];

/** The largest `+N` a day argument takes. */
export const MAX_DAY_OFFSET = 99;

/**
 * Every word a day argument reads (besides an ISO date and `+N`), lowercase: what
 * a command's other targets (a team, `live`, `next`) must never be, or a word
 * would mean two things.
 */
export const DAY_WORDS: readonly string[] = ['today', 'tomorrow', 'yesterday', ...WEEKDAYS.flat()];

/**
 * What a day argument says, before any clock is read: a calendar date, a count
 * of days from today, or the next such weekday (today included).
 */
export type DayArg = { readonly iso: string } | { readonly offset: number } | { readonly weekday: number };

/**
 * The ONE grammar of a day argument (`today [date]`, `share <date>`, `markets
 * <date>`): `YYYY-MM-DD` (a real date), `today`, `tomorrow`, `yesterday`, a
 * weekday (`sat`, `saturday`), or `+N` (N from 0 to {@link MAX_DAY_OFFSET}).
 * The words are English in every language, matched whatever their case, one
 * trailing dot allowed. No clock is read: what the day IS needs the request's
 * clock and the viewer's zone ({@link resolveDayArg}). Anything else is
 * undefined (`-1` included: past days are `yesterday` or a date).
 */
export function parseDayArg(input: string): DayArg | undefined {
  if (isValidDate(input)) return { iso: input };
  const plus = /^\+(\d{1,2})$/.exec(input);
  if (plus) return { offset: Number(plus[1]) };
  const word = input.toLowerCase().replace(/\.$/, '');
  if (word === 'today') return { offset: 0 };
  if (word === 'tomorrow') return { offset: 1 };
  if (word === 'yesterday') return { offset: -1 };
  const weekday = WEEKDAYS.findIndex((names) => names.includes(word));
  return weekday >= 0 ? { weekday } : undefined;
}

/**
 * The calendar day (`YYYY-MM-DD`) a day argument names, counted from today in
 * the viewer's zone at the REQUEST's clock (`now` and `tz`, both required: the
 * wall clock is never read here). The count is calendar arithmetic on that
 * date, so a daylight-saving change never moves a day (24 hours after 00:30 on
 * a 25-hour day is still the same day; tomorrow is not).
 */
export function resolveDayArg(arg: DayArg, now: Date, tz: string | undefined): string {
  if ('iso' in arg) return arg.iso;
  const today = localDate(now.toISOString(), tz);
  if ('offset' in arg) return shiftUtcDate(today, arg.offset);
  const current = new Date(`${today}T12:00:00Z`).getUTCDay();
  return shiftUtcDate(today, (arg.weekday - current + 7) % 7);
}

/** The short weekday of a calendar day (`YYYY-MM-DD`) in the reader's language: "Sat", "sáb", "sáb.", "sam.". */
export function weekdayShort(dateISO: string, locale?: string): string {
  const when = parsedDate(`${dateISO.slice(0, 10)}T12:00:00Z`);
  if (!when) return UNKNOWN_TIME;
  return new Intl.DateTimeFormat(safeLocale(locale), { weekday: 'short', timeZone: 'UTC' }).format(when);
}

/** Calendar days from today to a kickoff's day, both in the viewer's zone at the request's clock. */
export function calendarDaysUntil(iso: string, now: Date, tz: string | undefined): number | undefined {
  const day = localDate(iso, tz);
  if (!day) return undefined;
  const today = localDate(now.toISOString(), tz);
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** From this many calendar days away, ahead or back, a kickoff shows its date: at 7, its weekday alone would also name today. */
export const FAR_KICKOFF_DAYS = 7;

/**
 * A kickoff as one view of ONE match says it: its weekday and time ("Sat
 * 09:30") within six calendar days, ahead or back, and its weekday, date and
 * time ("Sat, Nov 21, 09:30") from {@link FAR_KICKOFF_DAYS} on in either
 * direction (a match played three weeks ago is as ambiguous by its weekday as
 * one three weeks ahead), the days counted in the viewer's zone from the
 * request's clock (`now`, required). A dated list does not ask it: its header
 * names the day.
 */
export function kickoffLabel(iso: string, opts: { tz?: string; locale?: string; now: Date }): string {
  const days = calendarDaysUntil(iso, opts.now, opts.tz);
  const far = days !== undefined && Math.abs(days) >= FAR_KICKOFF_DAYS;
  return formatKickoff(iso, { tz: opts.tz, locale: opts.locale, date: far });
}
