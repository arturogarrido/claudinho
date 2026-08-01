/**
 * Timezone-aware kickoff formatting and countdowns.
 * Pure Intl; no dependencies. Safe in Node and Workers.
 */
import { isValidTimeZone } from './validate';

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

/** Compact human countdown until kickoff: "3d4h", "2h10m", "45m", or "now". */
export function countdown(iso: string, from: Date = new Date()): string {
  const when = parsedDate(iso);
  // NaN arithmetic previously fell through every comparison and printed "NaNm".
  if (!when) return UNKNOWN_TIME;
  const ms = when.getTime() - from.getTime();
  if (ms <= 0) return 'now';
  const totalMin = Math.floor(ms / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}d${hours}h`;
  if (hours > 0) return `${hours}h${mins}m`;
  return `${mins}m`;
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
