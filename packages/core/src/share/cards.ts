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
 */
import {
  dateNoneRead,
  dateUnreached,
  dayAttribution,
  liveNoneRead,
  matchNoneReadSentence,
  matchWindowSentence,
  nextHorizonSentence,
  nextNoneReadSentence,
  type ReadAccount,
} from '../bodyText';
import type { ShareBracketInput } from '../bracket/format';
import type { BracketResult } from '../bracket/types';
import { t } from '../i18n';
import { EARLIER_RECORD_NOTE, type LiveResult, type MatchByIdResult, type NextFixtureResult, type StandingsResult } from '../live';
import type { MarketSignal } from '../markets/types';
import { type GroupStandings, type TableData, tableData } from '../standings';
import { formatDate } from '../time';
import { competitionLabel, entryOf } from '../supported';
import { isTeam } from '../trust/match';
import type { Match, Team } from '../types';
import {
  servedExtras,
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
   * The competition the card is about (its slug). Its title names it and its
   * run cue selects it (`npx @claudinho/cli --competition premier-league next
   * Arsenal`), the World Cup's too: a pasted card must answer the same thing
   * whatever the recipient follows. A card built with none (a test) keeps the
   * bare title and cue.
   */
  competition?: string;
}

/**
 * A card's run cue: `npx @claudinho/cli --competition <selector> <args>`,
 * where the selector is the competition's alias, or a raw slug as typed, so
 * the cue a card pastes asks what the card answered, whatever the recipient
 * follows (an environment or, later, a saved choice). With no competition it
 * is the bare `npx @claudinho/cli <args>`.
 */
function runCue(competition: string | undefined, args: string): string {
  if (!competition) return `npx @claudinho/cli ${args}`;
  const selector = entryOf(competition)?.alias ?? competition;
  return `npx @claudinho/cli --competition ${cueArg(selector)} ${args}`;
}

/** A card's title, naming the competition it is about: `Live match pulse · Premier League`. */
function titled(title: string, competition: string | undefined): string {
  return competition ? `${title} · ${competitionLabel(competition)}` : title;
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
  /**
   * The sentence a surface that bounds the list states, e.g. "(showing 20 of
   * 31 — list truncated)". It QUALIFIES the body, so it is printed in the
   * card's `note`, after the verdict's sentences and before the body, like a
   * tool's; the title stays bare.
   */
  cap?: string;
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
 * The qualifying sentences of a read, then `also` in the order given (the
 * count of shown rows the read did not serve, see {@link dayAttribution}; the
 * list's cap), as one note for a card. An absent one is skipped.
 */
function noteWith(result: VerdictSource, lang: string | undefined, ...also: Array<string | undefined>): { note?: string } {
  const note = [...verdictQualifiers(result, lang), ...also.filter((s): s is string => !!s)];
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
      title: titled('Live match pulse', ctx.competition),
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
      // The read was not whole: said beside the matches, or beside "none read";
      // then the list's cap, when the surface bounded it.
      ...noteWith(result, ctx.locale, view.cap),
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
      title: titled(`Next up for ${teamName}`, ctx.competition),
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
      title: titled('Match pulse', ctx.competition),
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
      ...noteWith(result, ctx.locale, attribution.unserved),
      installLine: runCue(ctx.competition, `match ${cueArg(id)}`),
      tz: ctx.tz,
      locale: ctx.locale,
    },
    verdict: verdictExtras(result),
    span: result.window ? { window: result.window } : {},
    readFields: servedExtras(result, result.match ? [result.match] : []),
  };
}

/**
 * A sentence whose last word is the card's date label ends with ONE period:
 * a label that ends with an abbreviation dot (fr "17 oct.", pt "17 de out.")
 * is not followed by a second. Where a label ends a sentence on a card; the
 * CLI and MCP print an ISO date there, which has no dot.
 */
function endSentence(sentence: string): string {
  return sentence.replace(/\.\.$/, '.');
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
    /** The list's cap when the surface bounded it (see `ShareCardView.cap`): in the note, not the title. */
    cap?: string;
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
  // The label of a CALENDAR date, which has no zone: midday UTC formatted IN
  // UTC (the locale still applies). Formatted in the viewer's zone, a zone
  // past UTC+12 (Kiritimati, Auckland in summer) named the next day.
  const human = formatDate(`${day.date}T12:00:00.000Z`, { tz: 'UTC', locale: ctx.locale });
  // On a read that was not whole: the card names its provider only when a
  // fixture it shows was served, and counts the rows that were not.
  const attribution = dayAttribution(read, day.matches, ctx.locale);
  return {
    kind: 'today',
    target: day.date,
    input: {
      title: titled(day.explicit ? `Matches · ${human}` : `Today's matches · ${human}`, ctx.competition),
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
        endSentence(
          dateUnreached(read, human, ctx.locale) ??
            dateNoneRead(read, human, ctx.locale) ??
            `No matches scheduled for ${human}.`,
        ),
      // The read was not whole (and which shown rows it did not serve): said
      // beside the fixtures, or beside "none read"; then the list's cap.
      ...noteWith(read, ctx.locale, attribution.unserved, day.cap),
      // An explicit date's cue reproduces THAT day (the recipient's today is another day).
      installLine: runCue(ctx.competition, day.explicit ? `today ${cueArg(day.date)}` : 'today'),
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
  /** The competition the card is about: its first line names it, its run cue selects it (see `ShareCardContext`). */
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
      // The card's first line names the competition; each table keeps its own title.
      ...(competition ? { heading: `${competitionLabel(competition)} · standings` } : {}),
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
  /** The competition the card is about: its first line names it, its run cue selects it (see `ShareCardContext`). */
  competition?: string,
): BracketShareCard {
  const source = result.degraded ? undefined : result.source;
  return {
    ...(stage ? { stage } : {}),
    source,
    degraded: result.degraded,
    input: {
      // The card's first line, in the reader's language: the title, then the
      // competition's name (not localized); the bare title with none.
      title: competition ? `${t(lang, 'bracket.shareTitle')} · ${competitionLabel(competition)}` : t(lang, 'bracket.shareTitle'),
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
