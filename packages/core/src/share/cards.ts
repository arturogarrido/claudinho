/**
 * Share cards, assembled once.
 *
 * `claudinho share` and the MCP `get_share_snippet` tool hand out the same
 * artifact, and each used to build it for itself: the title, the note an empty
 * card shows, the run cue, which provider (if any) is attributed. Two copies of
 * that assembly is two places for a verdict to be dropped and for the copy to
 * drift. A surface now gets the card from here and only decides how to
 * serialize it — and, for the MCP server, how many records it may hold: the
 * builders take the caller's list, so a surface that bounds its payload passes
 * the bounded one.
 *
 * Copy stays English (see AGENTS.md: share snippets are English-only in v1,
 * except the localized bracket card); the sentences that ARE localized here
 * are a verdict's, which are the same sentences on every surface. A verdict
 * that replaces the body becomes the card's `emptyNote`; the ones that qualify
 * it become its `note`, printed beside a populated body and an empty one.
 *
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
 */
import type { ShareBracketInput } from '../bracket/format';
import type { BracketResult } from '../bracket/types';
import { t } from '../i18n';
import { EARLIER_RECORD_NOTE, type LiveResult, type MatchByIdResult, type NextFixtureResult, type StandingsResult } from '../live';
import { marketsNoneReadNote } from '../markets/format';
import type { MarketSignal } from '../markets/types';
import { type GroupStandings, type TableData, tableData } from '../standings';
import { formatDate } from '../time';
import { bundleApplies } from '../competition';
import { isTeam } from '../trust/match';
import type { Match, Team } from '../types';
import {
  servedExtras,
  statesPartial,
  type VerdictExtras,
  type VerdictSource,
  verdictExtras,
  verdictNotice,
  verdictQualifiers,
} from '../verdict';
import type { ShareSnippetInput, ShareTableInput } from './format';

/**
 * The qualifying sentences of a result, as one note for a card; nothing when
 * it states none (or states a replacement, which is the empty note instead).
 */
function qualifierNote(result: VerdictSource, lang: string | undefined): { note?: string } {
  const qualifiers = verdictQualifiers(result, lang);
  return qualifiers.length > 0 ? { note: qualifiers.join(' ') } : {};
}

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

/**
 * An argument as a shell would need it in a run cue: a plain token as it is
 * (a nation's code, a match id), anything else quoted (a club's name has
 * spaces, and `O&M` would background the command).
 */
function cueArg(arg: string): string {
  return /^[A-Za-z0-9._-]+$/.test(arg) ? arg : `"${arg.replace(/["\\$`]/g, '')}"`;
}

/** Where and in which language a card's dates are rendered. */
export interface ShareCardContext {
  tz?: string;
  locale?: string;
  /**
   * The competition the card is about. Off the bundled competition the run cue
   * names it (`CLAUDINHO_COMPETITION=eng.1 npx @claudinho/cli next Arsenal`):
   * a recipient without that setting would otherwise be sent to the World Cup.
   */
  competition?: string;
}

/**
 * A card's run cue: `npx @claudinho/cli <args>`, prefixed off the bundled
 * competition with the setting that selects it, so the cue a card pastes
 * asks what the card answered. On the bundle (or when no competition is
 * given) it is what it always was.
 */
function runCue(competition: string | undefined, args: string): string {
  const prefix = competition && !bundleApplies(competition) ? `CLAUDINHO_COMPETITION=${cueArg(competition)} ` : '';
  return `${prefix}npx @claudinho/cli ${args}`;
}

/** Display-ready market signals for a card, and whether every fixture was checked. */
export interface ShareCardMarket {
  signals: Map<string, MarketSignal>;
  complete: boolean;
}

/** What a surface adds when it shows fewer records than exist. */
export interface ShareCardView {
  /** The records the surface will show (default: all of the result's). */
  matches?: readonly Match[];
  /** Appended to the title, e.g. " (showing 20 of 31)". */
  titleSuffix?: string;
}

/** A match card: what to format, what it is, and the verdict it carries. */
export interface MatchShareCard {
  kind: 'today' | 'live' | 'next' | 'match';
  target: string;
  /**
   * A next card's team: the club the query resolved to (its provider id,
   * code and name) when one was, the query (a nation's code on the World Cup)
   * otherwise.
   */
  team?: string | Team;
  /** A next card for a name two or more teams match: them, and no fixture. */
  candidates?: Team[];
  input: ShareSnippetInput;
  /** The structured verdict keys the card's note stands for (see `verdictExtras`). */
  verdict: VerdictExtras;
  /**
   * The span an empty card says was searched, as plain fields for the
   * structured twin (`horizon` for `next`, `window` for a match id); empty
   * when the card states none. Not a verdict.
   */
  span: { horizon?: { days: number }; window?: { from: string; to: string } };
  /**
   * Plain fields of the card's read for its structured twin, spread beside
   * `source`: the card's shown fixtures whose record the window held, beside
   * `partial` only (`servedExtras`); empty otherwise. Not a verdict.
   */
  readFields: { served?: readonly string[] };
}

/**
 * The qualifying sentences of a read, then the count of shown rows it did not
 * serve (see {@link dayAttribution}), as one note for a card.
 */
function noteWith(result: VerdictSource, unserved: string | undefined, lang: string | undefined): { note?: string } {
  const note = [...verdictQualifiers(result, lang), ...(unserved ? [unserved] : [])];
  return note.length > 0 ? { note: note.join(' ') } : {};
}

/** Matches in play right now. No market lines: a live card stays lean. */
export function liveShareCard(
  result: LiveResult,
  ctx: ShareCardContext,
  view: ShareCardView = {},
): MatchShareCard {
  return {
    kind: 'live',
    target: 'live',
    input: {
      title: `Live match pulse${view.titleSuffix ?? ''}`,
      matches: view.matches ?? result.matches,
      source: result.source,
      degraded: result.degraded,
      // Degraded ⇒ the feed is down, not "nothing is on" — say so on a public card.
      // A verdict (between editions) stands instead of either; a read that was
      // not whole says none in play was READ.
      emptyNote:
        verdictNotice(result, ctx.locale) ??
        (result.degraded
          ? "Live scores unavailable right now — couldn't reach the data provider."
          : (liveNoneRead(result, ctx.locale) ?? 'No matches in play right now.')),
      // The read was not whole: said beside the matches, or beside "none read".
      ...qualifierNote(result, ctx.locale),
      installLine: runCue(ctx.competition, 'live'),
      tz: ctx.tz,
      locale: ctx.locale,
    },
    verdict: verdictExtras(result),
    span: {},
    readFields: {},
  };
}

/** A team's next fixture. */
export function nextShareCard(
  result: NextFixtureResult,
  code: string,
  market: ShareCardMarket,
  ctx: ShareCardContext,
): MatchShareCard {
  const { fixture, team } = result;
  // The selected side: the resolved club by identity when the result names
  // one (two clubs can share a code; equal ids decide), by code otherwise (a nation).
  const teamName = fixture
    ? (team ? isTeam(fixture.home, team) : fixture.home.code === code)
      ? fixture.home.name
      : fixture.away.name
    : (team?.name ?? code);
  const ambiguous =
    result.candidates && result.candidates.length > 0
      ? `"${code}" is ambiguous. Did you mean: ${result.candidates.map((c) => `${c.name} (${c.code})`).join(', ')}?`
      : undefined;
  return {
    kind: 'next',
    target: 'next',
    team: team ?? code,
    ...(result.candidates && result.candidates.length > 0 ? { candidates: result.candidates } : {}),
    input: {
      title: `Next up for ${teamName}`,
      matches: fixture ? [fixture] : [],
      marketSignals: market.signals,
      marketComplete: market.complete,
      // The provider is attributed only when the overlay resolved the tie; a
      // static group fixture carries no source.
      source: result.source,
      degraded: result.degraded,
      // Fail closed: an outage must never paste as "no fixture" (= eliminated).
      // A verdict stands first; then the span a whole read searched, or "none
      // read" for one that was not whole; then the candidates of an ambiguous name.
      emptyNote:
        verdictNotice(result, ctx.locale) ??
        nextHorizonSentence(result, code, ctx.locale) ??
        nextNoneReadSentence(result, code, ctx.locale) ??
        ambiguous ??
        (result.degraded
          ? `Couldn't reach the data provider — no upcoming fixture confirmed for ${code}.`
          : `No upcoming fixture found for ${code}.`),
      // The window was not whole: said beside the fixture, or beside "none
      // found" (which is then not "eliminated").
      ...qualifierNote(result, ctx.locale),
      installLine: runCue(ctx.competition, `next ${cueArg(code)}`),
      tz: ctx.tz,
      locale: ctx.locale,
    },
    verdict: verdictExtras(result),
    span: result.horizon ? { horizon: result.horizon } : {},
    readFields: {},
  };
}

/** One match, by id. */
export function matchShareCard(
  result: MatchByIdResult,
  id: string,
  market: ShareCardMarket,
  ctx: ShareCardContext,
): MatchShareCard {
  // The day's rule, over the one record the card shows: on a read that was not
  // whole, a record the window did not hold is the bundle's row.
  const attribution = dayAttribution(result, result.match ? [result.match] : [], ctx.locale);
  return {
    kind: 'match',
    target: id,
    input: {
      title: 'Match pulse',
      matches: result.match ? [result.match] : [],
      marketSignals: market.signals,
      marketComplete: market.complete,
      source: result.source,
      degraded: result.degraded,
      // A record that is the provider's own earlier one (off the bundle) is
      // not the bundled schedule: the not-live sentence says which it is.
      ...(result.earlierRecord ? { degradedNote: EARLIER_RECORD_NOTE } : {}),
      // A verdict stands first; then the span a whole read searched, or "none
      // read" for one that was not whole; an outage never pastes as "no such match".
      emptyNote:
        verdictNotice(result, ctx.locale) ??
        matchWindowSentence(result, id, ctx.locale) ??
        matchNoneReadSentence(result, id, ctx.locale) ??
        (result.degraded
          ? `Couldn't reach the data provider — match ${id} could not be looked up.`
          : `No match found with id ${id}.`),
      // The read was not whole: said beside the record, or beside the empty
      // card, with the record named as the bundle's when the read did not hold it.
      ...noteWith(result, attribution.unserved, ctx.locale),
      installLine: runCue(ctx.competition, `match ${cueArg(id)}`),
      tz: ctx.tz,
      locale: ctx.locale,
    },
    verdict: verdictExtras(result),
    span: result.window ? { window: result.window } : {},
    readFields: servedExtras(result, result.match ? [result.match] : []),
  };
}

/** A day's matches: today's, or an explicitly requested date's. */
export function dateShareCard(
  day: {
    /** The calendar date shown (YYYY-MM-DD). */
    date: string;
    /** True when the caller named the date; false for "today". */
    explicit: boolean;
    /** The day's fixtures the surface will show. */
    matches: readonly Match[];
    degraded: boolean;
    source?: string;
    /** Appended to the title, e.g. " (showing 20 of 31)". */
    titleSuffix?: string;
    /**
     * The dated read itself: the verdicts the card states (between editions,
     * partial), whether it merged the bundled schedule (`skeleton`: the ONE
     * input for what an empty day may say), and what it served (the card's
     * attribution, over the fixtures it shows). A card handed no read is a
     * whole read that merged no schedule.
     */
    read?: ReadAccount;
  },
  market: ShareCardMarket,
  ctx: ShareCardContext,
): MatchShareCard {
  // The read's account, with the outcome the surface states beside it.
  const read: ReadAccount = { ...(day.read ?? {}), degraded: day.degraded };
  // Human date label from a stable midday-UTC instant (avoids tz day flips).
  const human = formatDate(`${day.date}T12:00:00.000Z`, { tz: ctx.tz, locale: ctx.locale });
  // On a read that was not whole: the card names its provider only when a
  // fixture it shows was served, and counts the rows that were not.
  const attribution = dayAttribution(read, day.matches, ctx.locale);
  return {
    kind: 'today',
    target: day.date,
    input: {
      title:
        (day.explicit ? `Matches · ${human}` : `Today's matches · ${human}`) + (day.titleSuffix ?? ''),
      matches: day.matches,
      marketSignals: market.signals,
      marketComplete: market.complete,
      source: attribution.attributed ? day.source : undefined,
      degraded: day.degraded,
      // Fail closed: when the provider is the only source of fixtures and it
      // could not be reached, the card must not paste as an empty day (the
      // same sentence every date surface prints; the formatter adds its own
      // outage line only when there ARE matches). A read that was not whole
      // and merged no schedule says none was READ. Both name the date as the
      // card's title does (its label); the CLI and MCP print the ISO date of
      // their own header.
      emptyNote:
        verdictNotice(read, ctx.locale) ??
        dateUnreached(read, human, ctx.locale) ??
        dateNoneRead(read, human, ctx.locale) ??
        `No matches scheduled for ${human}.`,
      // The read was not whole (and which shown rows it did not serve): said
      // beside the fixtures, or beside "none read".
      ...noteWith(read, attribution.unserved, ctx.locale),
      installLine: runCue(ctx.competition, 'today'),
      tz: ctx.tz,
      locale: ctx.locale,
    },
    verdict: verdictExtras(read),
    span: {},
    readFields: servedExtras(read, day.matches),
  };
}

/** A standings card: facts only, never a market line. */
export interface TableShareCard {
  group?: string;
  input: ShareTableInput;
  /** Null when degraded: a roster served by no provider is attributed to none. */
  source: string | undefined;
  degraded: boolean;
  /** The card's tables in structured form, each with the verdict it carries. */
  tables: TableData[];
  /** The structured verdict keys of the READ (see `verdictExtras`): `incomplete` when tables are missing. */
  verdict: VerdictExtras;
}

export function tableShareCard(
  result: StandingsResult,
  group: string | undefined,
  /** The tables the surface will show (default: all of the result's). */
  tables: readonly GroupStandings[] = result.tables,
  /** The reader's language, for the one localized sentence a card prints: a verdict's. */
  lang?: string,
  /** The competition the card is about: off the bundle the run cue names it (see `ShareCardContext`). */
  competition?: string,
): TableShareCard {
  // Degraded ⇒ no live provider: no attribution. An open-scope outage has no
  // compatible bundled roster, so the empty card names the outage.
  const source = result.degraded ? undefined : result.source;
  // A card's copy is English (it is pasted anywhere). The sentence it prints
  // for a VERDICT is the exception, on every card: the same localized
  // sentence every other surface prints for it.
  const incompleteNote = qualifierNote(result, lang).note;
  return {
    ...(group ? { group } : {}),
    source,
    degraded: result.degraded,
    tables: tables.map(tableData),
    verdict: verdictExtras(result),
    input: {
      tables,
      source,
      installLine: runCue(competition, group ? `table ${group}` : 'table'),
      emptyNote: result.degraded
        ? 'Live standings unavailable.'
        : group
          ? `No group ${group}.`
          : 'No standings available.',
      degraded: result.degraded,
      ...(incompleteNote ? { incompleteNote } : {}),
    },
  };
}

/** A knockout bracket card. Its empty note is localized, like the card itself. */
export interface BracketShareCard {
  stage?: string;
  input: ShareBracketInput;
  source: string | undefined;
  degraded: boolean;
  verdict: VerdictExtras;
}

export function bracketShareCard(
  result: BracketResult,
  stage: string | undefined,
  lang: string | undefined,
  /** The competition the card is about: off the bundle the run cue names it (see `ShareCardContext`). */
  competition?: string,
): BracketShareCard {
  const source = result.degraded ? undefined : result.source;
  return {
    ...(stage ? { stage } : {}),
    source,
    degraded: result.degraded,
    input: {
      view: result.view,
      source,
      installLine: runCue(competition, stage ? `bracket ${stage}` : 'bracket'),
      emptyNote: verdictNotice(result, lang) ?? t(lang, 'bracket.empty'),
      // The knockout window was not whole: said beside the ties that were read.
      ...qualifierNote(result, lang),
    },
    verdict: verdictExtras(result),
  };
}
