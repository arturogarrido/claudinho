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
import type { ShareBracketInput } from '../bracket/format';
import type { BracketResult } from '../bracket/types';
import { t } from '../i18n';
import type { LiveResult, MatchByIdResult, NextFixtureResult, StandingsResult } from '../live';
import type { MarketSignal } from '../markets/types';
import { type GroupStandings, type TableData, tableData } from '../standings';
import { formatDate } from '../time';
import type { Match } from '../types';
import { type VerdictExtras, type VerdictSource, verdictExtras, verdictNotice, verdictQualifiers } from '../verdict';
import type { ShareSnippetInput, ShareTableInput } from './format';

/**
 * The qualifying sentences of a result, as one note for a card; nothing when
 * it states none (or states a replacement, which is the empty note instead).
 */
function qualifierNote(result: VerdictSource, lang: string | undefined): { note?: string } {
  const qualifiers = verdictQualifiers(result, lang);
  return qualifiers.length > 0 ? { note: qualifiers.join(' ') } : {};
}

/** Where and in which language a card's dates are rendered. */
export interface ShareCardContext {
  tz?: string;
  locale?: string;
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
  team?: string;
  input: ShareSnippetInput;
  /** The structured verdict keys the card's note stands for (see `verdictExtras`). */
  verdict: VerdictExtras;
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
      emptyNote: result.degraded
        ? "Live scores unavailable right now — couldn't reach the data provider."
        : 'No matches in play right now.',
      installLine: 'npx @claudinho/cli live',
      tz: ctx.tz,
      locale: ctx.locale,
    },
    verdict: {},
  };
}

/** A team's next fixture. */
export function nextShareCard(
  result: NextFixtureResult,
  code: string,
  market: ShareCardMarket,
  ctx: ShareCardContext,
): MatchShareCard {
  const { fixture } = result;
  const teamName = fixture
    ? fixture.home.code === code
      ? fixture.home.name
      : fixture.away.name
    : code;
  return {
    kind: 'next',
    target: 'next',
    team: code,
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
      emptyNote:
        verdictNotice(result, ctx.locale) ??
        (result.degraded
          ? `Couldn't reach the data provider — no upcoming fixture confirmed for ${code}.`
          : `No upcoming fixture found for ${code}.`),
      // The window was not whole: said beside the fixture, or beside "none
      // found" (which is then not "eliminated").
      ...qualifierNote(result, ctx.locale),
      installLine: `npx @claudinho/cli next ${code}`,
      tz: ctx.tz,
      locale: ctx.locale,
    },
    verdict: verdictExtras(result),
  };
}

/** One match, by id. */
export function matchShareCard(
  result: MatchByIdResult,
  id: string,
  market: ShareCardMarket,
  ctx: ShareCardContext,
): MatchShareCard {
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
      emptyNote: verdictNotice(result, ctx.locale) ?? `No match found with id ${id}.`,
      installLine: `npx @claudinho/cli match ${id}`,
      tz: ctx.tz,
      locale: ctx.locale,
    },
    verdict: verdictExtras(result),
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
    /**
     * Whether the day's fixture list is known WITHOUT the provider: true where
     * the bundled schedule covers the competition, false where the provider is
     * the only source. Decides what an empty, degraded day may say.
     */
    scheduleKnown: boolean;
    /** Appended to the title, e.g. " (showing 20 of 31)". */
    titleSuffix?: string;
  },
  market: ShareCardMarket,
  ctx: ShareCardContext,
): MatchShareCard {
  // Human date label from a stable midday-UTC instant (avoids tz day flips).
  const human = formatDate(`${day.date}T12:00:00.000Z`, { tz: ctx.tz, locale: ctx.locale });
  return {
    kind: 'today',
    target: day.date,
    input: {
      title:
        (day.explicit ? `Matches · ${human}` : `Today's matches · ${human}`) + (day.titleSuffix ?? ''),
      matches: day.matches,
      marketSignals: market.signals,
      marketComplete: market.complete,
      source: day.source,
      degraded: day.degraded,
      // Fail closed: when the provider is the only source of fixtures and it
      // could not be reached, the card must not paste as an empty day. (The
      // formatter adds its own outage line only when there ARE matches.)
      emptyNote:
        day.degraded && !day.scheduleKnown
          ? `Couldn't reach the data provider — no fixtures confirmed for ${human}.`
          : `No matches scheduled for ${human}.`,
      installLine: 'npx @claudinho/cli today',
      tz: ctx.tz,
      locale: ctx.locale,
    },
    verdict: {},
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
      installLine: group ? `npx @claudinho/cli table ${group}` : 'npx @claudinho/cli table',
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
): BracketShareCard {
  const source = result.degraded ? undefined : result.source;
  return {
    ...(stage ? { stage } : {}),
    source,
    degraded: result.degraded,
    input: {
      view: result.view,
      source,
      installLine: stage ? `npx @claudinho/cli bracket ${stage}` : 'npx @claudinho/cli bracket',
      emptyNote: verdictNotice(result, lang) ?? t(lang, 'bracket.empty'),
      // The knockout window was not whole: said beside the ties that were read.
      ...qualifierNote(result, lang),
    },
    verdict: verdictExtras(result),
  };
}
