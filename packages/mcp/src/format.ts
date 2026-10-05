/**
 * Plain-text formatting for MCP responses. Unlike the CLI, there's no ANSI
 * color — output is optimized for an LLM to read. Tools also return structured
 * JSON alongside the text so agents can consume the raw data.
 */
import {
  DISCLAIMER as CORE_DISCLAIMER,
  countdownPhrase,
  FAN_PROJECT,
  formatKickoff,
  joinSegments,
  matchFlair,
  matchFlairs,
  matchLocation,
  padVisible,
  scoreline,
  stageLabelI18n,
  t,
  tableTitle,
  withFlag,
  type Flair,
  type FlairOpts,
  type FlavorLevel,
  type Match,
  type RallyPin,
  type StandingRow,
  type TeamKind,
} from '@claudinho/core';
import { type BoundedList, bounded } from '@claudinho/core';

/**
 * The catalog key (core's `t`) of a status the line names in words: the MCP
 * text says "half-time" where the CLI's column says "HT". A scheduled match
 * says its kickoff, one in play `status.live` and its minute.
 */
const STATUS_KEY: Readonly<Record<Exclude<Match['status'], 'SCHEDULED' | 'LIVE'>, string>> = {
  HT: 'status.halfTime',
  FT: 'status.fullTime',
  POSTPONED: 'status.postponed',
  CANCELLED: 'status.cancelled',
};

export interface FmtOpts {
  tz?: string;
  locale?: string;
  flavor?: FlavorLevel;
  /**
   * The competition's team kind (core `teamKind` of the adapter's
   * competition): a team's rally cry takes the flair slot only in a
   * competition of the cry's kind. Absent (a static list), no side carries one.
   */
  teamKind?: TeamKind;
  /**
   * The request's pinned team (the saved choice's, when it applies to the
   * request's competition): it decides between two sides that both carry a
   * cry, as on the CLI. The pin alone: `CLAUDINHO_TEAM` is the team-taking
   * tools' query, not the cry's tiebreak.
   */
  pin?: RallyPin;
}

/** The flair options of these format options (core's flair rules take them). */
function flairOptsOf(opts: FmtOpts): FlairOpts {
  return { level: opts.flavor, locale: opts.locale, kind: opts.teamKind, pin: opts.pin };
}

/**
 * One match as a line of text. `flair` is the row's flair slot when a list
 * chose it ({@link matchRows}: core `matchFlairs`, the cries and no phrase
 * twice in one list); without it the line's own (core `matchFlair`): a team's
 * rally cry first (the pinned side's when both carry one, else the home
 * side's), else the moment's phrase.
 */
export function matchLine(m: Match, opts: FmtOpts = {}, flair: Flair = matchFlair(m, flairOptsOf(opts))): string {
  // A flag beside a nation's name; a club's name alone (nothing in its place).
  const head = `${withFlag(m.home.name, m.home.flag, 'home')} ${scoreline(m)} ${withFlag(m.away.name, m.away.flag, 'away')}`;
  // The stage, the status tokens and the countdown's phrase in the request's
  // language (core's catalog; English when none is given).
  const lang = opts.locale;
  const stage = stageLabelI18n(lang, m);
  let tail: string;
  if (m.status === 'SCHEDULED') {
    tail = `${formatKickoff(m.kickoff, opts)} (${countdownPhrase(lang, m.kickoff)})`;
  } else if (m.status === 'LIVE') {
    tail = m.minute ? `${t(lang, 'status.live')} ${m.minute}'` : t(lang, 'status.live');
  } else {
    tail = t(lang, STATUS_KEY[m.status]);
  }
  // The status, the stage and the location, joined with the empty ones
  // dropped: an OTHER with no words, or a record with no venue, leaves no
  // dangling separator.
  const base = `${head} — ${joinSegments([tail, stage, matchLocation(m)])}`;
  return (flair.text ? `${base} — ${flair.text}` : base).trimEnd();
}

/**
 * Records rendered into one text block. This block is model context, and the
 * per-field sanitizer bounds a single NAME without bounding how many records
 * arrive — repetition defeated it. Comfortably above any real matchday (the
 * 48-team format peaks at 12).
 */
export const MAX_LIST_MATCHES = 40;

/**
 * Cap a record array bound for `structuredContent`, which is model context just
 * as much as the text block is. Callers keep reporting the TRUE total in
 * `count`, so the payload stays honest about what was omitted.
 */
export function capRecords<T>(rows: T[], max = MAX_LIST_MATCHES): T[] {
  return rows.length > max ? rows.slice(0, max) : rows;
}

/**
 * The capped rows AND the counts describing them, as one value.
 *
 * Handlers used to call `capRecords` two or three times in the same response
 * and hand-write `count: rows.length` beside it, so the payload's own account
 * of itself was assembled from four independent expressions that could — and
 * did — disagree. A `BoundedList` carries `total`, `shown` and `truncated`
 * together, so nothing downstream recomputes them.
 */
export function boundedRecords<T>(rows: T[], max = MAX_LIST_MATCHES): BoundedList<T> {
  return bounded(rows, max);
}

/**
 * The sentence to state when `capRecords` dropped something, "(showing N of
 * M — list truncated)": a sentence that QUALIFIES the body, so every caller
 * says it before the body (`get_standings`, the dated `get_market_signal`, the
 * live and date cards' note), never after it or in a title.
 *
 * A cap that drops records silently reads as a complete list, which is the same
 * failure as losing the statusline's "+N" marker: the reader cannot tell. Returns
 * '' when nothing was dropped.
 *
 * English, like the other notes a tool states beside its list (the market
 * notice): by rule. The list's title, its rows' tokens, its empty-state
 * sentence and its outage line are core's catalog ({@link headingLine},
 * {@link matchLine}).
 */
export function truncationNote(list: BoundedList<unknown>): string {
  return list.truncated ? `(showing ${list.shown} of ${list.total} — list truncated)` : '';
}

/**
 * A title line that introduces the lines below it ("Live now:", "Matches on
 * 2026-10-10:", "Next up for Arsenal:"), in the request's language: core's
 * catalog, the colon included (French sets it off with a space).
 */
export function headingLine(lang: string | undefined, title: string): string {
  return t(lang, 'heading', { title });
}

/**
 * The rows of a list of matches (at most `MAX_LIST_MATCHES`), or an
 * empty-state message. Says nothing about the rows it did not show: a text a
 * cut can reach states that BEFORE the rows ({@link listTruncation}), and
 * {@link matchList} states it after them.
 */
export function matchRows(matches: Match[], empty: string, opts: FmtOpts = {}): string {
  if (matches.length === 0) return empty;
  const shown = matches.slice(0, MAX_LIST_MATCHES);
  // The flairs chosen once over the rows shown, in order (core `matchFlairs`:
  // the cries, and no phrase twice).
  const flairs = matchFlairs(shown, flairOptsOf(opts));
  return shown.map((m, i) => `• ${matchLine(m, opts, flairs[i])}`).join('\n');
}

/**
 * The sentence a list of matches states when it shows fewer than it holds
 * ("(list truncated — N more not shown)"); undefined when it shows them all.
 * Truncation is STATED. Silently dropping matches would read as a complete
 * list of the day's fixtures, which is a worse failure than a long one.
 */
export function listTruncation(matches: readonly Match[]): string | undefined {
  const overflow = matches.length - MAX_LIST_MATCHES;
  return overflow > 0 ? `(list truncated — ${overflow} more not shown)` : undefined;
}

/**
 * A list of matches as a text block (or an empty-state message), its
 * truncation line after the rows: for a text no cut reaches (the
 * `fixtures://` resource). A tool's text says the truncation first:
 * {@link matchRows} after {@link listTruncation}.
 */
export function matchList(matches: Match[], empty: string, opts: FmtOpts = {}): string {
  const rows = matchRows(matches, empty, opts);
  const truncated = listTruncation(matches);
  return truncated ? `${rows}\n• ${truncated}` : rows;
}

/** A group table as a monospace-friendly text block. */
export function standingsTable(table: { group: string; label?: string }, rows: StandingRow[]): string {
  // `Group A` for a lettered group; any other table is its label and the key
  // that selects it: `League A, Group B (A-B)`.
  const header = tableTitle(table);
  // One template for the column header AND the data rows so they can't drift.
  // Display-width padding (a tag-sequence flag like England's is 14 UTF-16
  // units but 2 columns), and no truncation — never cut a nation mid-name.
  const line = (team: string, p: string, w: string, d: string, l: string, gd: string, pts: string) =>
    `${padVisible(team, 24)} ${p.padStart(2)} ${w.padStart(2)} ${d.padStart(2)} ${l.padStart(2)} ${gd.padStart(3)} ${pts.padStart(3)}`;
  const cols = line('Team', 'P', 'W', 'D', 'L', 'GD', 'Pts');
  const lines = rows.map((r) =>
    line(
      withFlag(r.team.name, r.team.flag, 'home'),
      String(r.played),
      String(r.won),
      String(r.drawn),
      String(r.lost),
      r.goalDiff > 0 ? `+${r.goalDiff}` : String(r.goalDiff),
      String(r.points),
    ),
  );
  return [header, cols, ...lines].join('\n');
}

/** The persistent legal disclaimer appended to responses: core's one sentence, after the fan line. */
export const DISCLAIMER = `Claudinho is an ${FAN_PROJECT.toLowerCase()}. ${CORE_DISCLAIMER}`;

/**
 * Keep only the signals whose match survived `capRecords`. A signal keyed to a
 * match that is no longer in the payload is dead weight in model context, and
 * capping `matches` without capping these left the larger of the two uncapped.
 */
export function capSignals<T>(
  signals: Record<string, T>,
  kept: readonly { id: string }[],
): Record<string, T> {
  const ids = new Set(kept.map((m) => m.id));
  const out: Record<string, T> = {};
  for (const [id, v] of Object.entries(signals)) {
    if (ids.has(id)) out[id] = v;
  }
  return out;
}
