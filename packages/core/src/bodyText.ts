/**
 * The empty bodies off the bundled competition say what was searched: `next`
 * ("no fixture for X within the next 14 days") and `match <id>` ("not found
 * between A and B") after a whole read, and "none read" after one that was not
 * whole ("no fixture for X was read in this span", beside the partial
 * sentence). They are the BODY's own text, not verdicts, and they are built
 * here ({@link nextHorizonSentence}, {@link matchWindowSentence},
 * {@link nextNoneReadSentence}, {@link matchNoneReadSentence}) for every
 * surface: the CLI and the MCP tools print the same sentence, from this one
 * place, and a card carries its span as a plain field (`span`).
 *
 * The same holds for the live and dated reads (0.11 2.1d): an empty body after
 * a read that was not whole says nothing was READ ({@link liveNoneRead},
 * {@link dateNoneRead}, {@link marketsNoneRead}), and a day's attribution on
 * such a read is decided over the fixtures a surface displays
 * ({@link dayAttribution}: the "Live data" line, and the sentence counting
 * the bundled rows the read did not serve).
 *
 * And an empty `today` or `live` off the bundle that a whole read answered
 * points ahead (core `ahead.ts` decides; the sentences are here):
 * {@link nextDayLines} (the next match day, its count, the command that shows
 * it) and {@link nextKickoffLines} (the next kickoff ahead and its countdown),
 * or the horizon when nothing is on in the span read; the command is
 * {@link todayCommand}. The answer's own text, never a verdict.
 */
import type { DayPointer, KickoffPointer } from './ahead';
import { t } from './i18n';
import type { MatchByIdResult, NextFixtureResult } from './live';
import { marketsNoneReadNote } from './markets/format';
import { countdownPhrase, formatTime, localDate, weekdayShort } from './time';
import type { Match } from './types';
import { statesPartial, type VerdictSource } from './verdict';

/**
 * The sentence for a `next` whose WHOLE read of the span held no fixture for
 * the club (`horizon` stated), in the reader's language; undefined otherwise.
 * It names the resolved club, else the query as asked, else `fallback`.
 */
export function nextHorizonSentence(
  result: NextFixtureResult,
  fallback: string,
  lang: string | undefined,
): string | undefined {
  if (!result.horizon) return undefined;
  return t(lang, 'next.horizon', {
    team: result.team?.name ?? result.query ?? fallback,
    days: String(result.horizon.days),
  });
}

/**
 * The sentence for a `match <id>` that a WHOLE read of the span did not hold
 * (`window` stated), in the reader's language; undefined otherwise. Not "no
 * such match": the id was not in the provider days searched.
 */
export function matchWindowSentence(result: MatchByIdResult, id: string, lang: string | undefined): string | undefined {
  if (!result.window) return undefined;
  return t(lang, 'match.notFoundBetween', { from: result.window.from, to: result.window.to, id });
}

/**
 * The sentence for an EMPTY `next` off the bundled competition whose read was
 * not whole (`partial` stated, no fixture, not degraded): no fixture for the
 * club was READ in the span, which is not "none exists". Undefined otherwise.
 * (On the bundle the partial empty card keeps its own sentence.)
 */
export function nextNoneReadSentence(
  result: NextFixtureResult,
  fallback: string,
  lang: string | undefined,
): string | undefined {
  if (result.fixture || result.degraded || !result.partial || result.query === undefined) return undefined;
  return t(lang, 'next.noneRead', { team: result.team?.name ?? result.query ?? fallback });
}

/**
 * The sentence for an EMPTY `match <id>` whose read was not whole (`partial`
 * stated, no record, not degraded): no match with that id was READ in the
 * span, which is not "no such match". Undefined otherwise.
 */
export function matchNoneReadSentence(result: MatchByIdResult, id: string, lang: string | undefined): string | undefined {
  if (result.match || result.degraded || !result.partial) return undefined;
  return t(lang, 'match.noneRead', { id });
}

/**
 * "No match in play was read", in the reader's language: an EMPTY live body
 * after a read that was not whole, which is not "nothing is in play". (When
 * it applies: {@link liveNoneRead}.)
 */
export function liveNoneReadSentence(lang?: string): string {
  return t(lang, 'live.noneRead');
}

/**
 * "No fixture was read for {date}", in the reader's language: an EMPTY day
 * after a read that was not whole and merged no bundled schedule, which is not
 * "no matches scheduled". `date` is printed as given: the card passes its
 * human label, the CLI and MCP the date they print. (When it applies:
 * {@link dateNoneRead}.)
 */
export function dateNoneReadSentence(date: string, lang?: string): string {
  return t(lang, 'today.noneRead', { date });
}

/**
 * "Couldn't reach the data provider — no fixtures confirmed for {date}", in
 * the reader's language: the EMPTY day of a read that FAILED and merged no
 * bundled schedule (off the bundle), where nothing but the provider knows the
 * fixtures, so an outage must not read as "no matches scheduled". `date` is
 * printed as given: the card passes its human label, the CLI and MCP the date
 * they print. (When it applies: {@link dateUnreached}.)
 */
export function dateUnreachedSentence(date: string, lang?: string): string {
  return t(lang, 'today.unreached', { date });
}

/**
 * The command that shows a day: `claudinho today`, then the date when it is
 * not today's, then the flags that chose what this answer was for (the
 * competition when the flag chose it, the zone when the flag gave it), so
 * running it answers for the same competition, in the same zone.
 */
export function todayCommand(opts: { date?: string; competition?: string; tz?: string }): string {
  return [
    'claudinho today',
    ...(opts.date ? [opts.date] : []),
    ...(opts.competition ? ['--competition', opts.competition] : []),
    ...(opts.tz ? ['--tz', opts.tz] : []),
  ].join(' ');
}

/** A calendar day as the pointer sentences say it: the reader's short weekday, then the date. */
function pointerDay(date: string, lang: string | undefined): string {
  return `${weekdayShort(date, lang)} ${date}`;
}

/**
 * An empty day's pointer (core `dayPointer`) as sentences, in the reader's
 * language: the next match day with its count ("Next match day: Sat
 * 2026-11-21, 4 matches.") or without one, then, when a command is given (the
 * CLI; a tool's text sends no one to a shell), the line that shows it; or the
 * horizon ("Nothing scheduled in the next 14 days."). The answer's own text,
 * never a verdict.
 */
export function nextDayLines(p: DayPointer, opts: { lang?: string; command?: string }): string[] {
  const { lang, command } = opts;
  if (!('nextDay' in p)) return [t(lang, 'ahead.horizon', { days: String(p.horizon.days) })];
  const { date, count } = p.nextDay;
  const day = pointerDay(date, lang);
  const first =
    count === undefined
      ? t(lang, 'ahead.nextDay.date', { day })
      : t(lang, count === 1 ? 'ahead.nextDay.one' : 'ahead.nextDay.other', { day, n: String(count) });
  if (command === undefined) return [first];
  const see = count === undefined ? 'ahead.see.day' : count === 1 ? 'ahead.see.one' : 'ahead.see.other';
  return [first, t(lang, see, { command })];
}

/**
 * An empty live list's pointer (core `livePointer`) as sentences: the next
 * kickoff AHEAD in the viewer's zone (`tz`), its 24-hour time and the
 * countdown at the request's clock (`now`, required) ("Next kickoff: Sat
 * 2026-11-21 04:30, in 10d6h."), then the line that shows that day when a
 * command is given; or the horizon. Never a match now.
 */
export function nextKickoffLines(
  p: KickoffPointer,
  opts: { lang?: string; tz: string | undefined; now: Date; command?: string },
): string[] {
  const { lang, tz, now, command } = opts;
  if (!('nextKickoff' in p)) return [t(lang, 'ahead.horizon', { days: String(p.horizon.days) })];
  const kickoff = p.nextKickoff;
  const when = `${pointerDay(localDate(kickoff, tz), lang)} ${formatTime(kickoff, { tz })}`;
  const first = t(lang, 'ahead.nextKickoff', { when, in: countdownPhrase(lang, kickoff, now) });
  return command === undefined ? [first] : [first, t(lang, 'ahead.see.day', { command })];
}

/**
 * The sentence beside a day's partial verdict that counts the displayed
 * fixtures the read did not serve: they are the bundled schedule's rows, and
 * their live state is unconfirmed. Singular and plural, in the reader's
 * language. (When it applies: {@link dayAttribution}.)
 */
export function unservedSentence(n: number, lang?: string): string {
  return t(lang, n === 1 ? 'today.unserved.one' : 'today.unserved.other', { n: String(n) });
}

/**
 * "No market signal among the fixtures read for {date}": an EMPTY dated
 * market answer whose fixture read was not whole, which is not "none for the
 * date". Market copy from the approved bank (`marketsNoneReadNote`), English
 * on every locale. (When it applies: {@link marketsNoneRead}.)
 */
export function marketsNoneReadSentence(date: string): string {
  return marketsNoneReadNote(date);
}

/**
 * What a live or dated read says about itself, as the empty bodies and the
 * day's attribution read it: its verdicts, whether it failed, whether it
 * merged the bundled schedule, and what the provider's window held.
 */
export type ReadAccount = VerdictSource & {
  readonly degraded?: boolean;
  readonly skeleton?: true;
  readonly served?: readonly string[];
};

/**
 * The empty body of a live read that was not whole (`partial` stated, not
 * degraded): {@link liveNoneReadSentence}. Undefined otherwise: a whole read
 * with nothing in play says so in the surface's own words.
 */
export function liveNoneRead(result: ReadAccount, lang?: string): string | undefined {
  return !result.degraded && statesPartial(result) ? liveNoneReadSentence(lang) : undefined;
}

/**
 * The empty body of a dated read that was not whole and merged NO bundled
 * schedule (off the bundle, or the bundle's slug answering for another
 * edition): {@link dateNoneReadSentence}. Undefined otherwise: where the
 * skeleton was merged the day's list is the bundle's, whole, and its empty
 * body is the bundle's answer.
 */
export function dateNoneRead(result: ReadAccount, date: string, lang?: string): string | undefined {
  return !result.degraded && statesPartial(result) && result.skeleton !== true
    ? dateNoneReadSentence(date, lang)
    : undefined;
}

/**
 * The empty body of a dated read that FAILED and merged no bundled schedule:
 * {@link dateUnreachedSentence}. Undefined otherwise: a failed read on the
 * bundle shows the bundle's day (the schedule is known without the provider),
 * and a read that answered says what it read.
 */
export function dateUnreached(result: ReadAccount, date: string, lang?: string): string | undefined {
  return result.degraded === true && result.skeleton !== true ? dateUnreachedSentence(date, lang) : undefined;
}

/**
 * The empty body of a dated MARKET answer whose fixture read was not whole:
 * {@link marketsNoneReadSentence} (market copy, English). Undefined otherwise.
 * Separate from the market requests' own completeness (`complete`), which
 * says something else.
 */
export function marketsNoneRead(result: ReadAccount, date: string): string | undefined {
  return !result.degraded && statesPartial(result) ? marketsNoneReadSentence(date) : undefined;
}

/** What a day's surface says about the provider, for the fixtures it displays. */
export interface DayAttribution {
  /** Whether the "Live data" line is printed (the structured `source` keeps the provider either way). */
  attributed: boolean;
  /** The sentence counting the displayed fixtures the read did not serve, when there are any. */
  unserved?: string;
}

/**
 * The day's attribution, ONE rule for the CLI, the MCP tool and the date card,
 * computed over the fixtures the surface finally DISPLAYS (after the date
 * filter and any bound). A whole read, a degraded one, and a read that does not
 * say what it served change nothing: the line is printed as it always was. On
 * a read that was not whole:
 *   - when some displayed fixtures are not among the ids the window held
 *     (`served`), they are the bundled schedule's rows, whose live state is
 *     unconfirmed: the sentence says how many;
 *   - when NONE of the displayed fixtures was served, the "Live data" line is
 *     not printed: a provider is never named for a day it served nothing of.
 *     (An empty day attributes no fixture, and keeps the line.)
 */
export function dayAttribution(read: ReadAccount, shown: readonly Match[], lang?: string): DayAttribution {
  if (!statesPartial(read) || !Array.isArray(read.served)) return { attributed: true };
  const served = new Set(read.served);
  const unserved = shown.filter((m) => !served.has(m.id)).length;
  return {
    attributed: shown.length === 0 || unserved < shown.length,
    ...(unserved > 0 ? { unserved: unservedSentence(unserved, lang) } : {}),
  };
}
