/**
 * Shareable terminal snippets — pure, deterministic text artifacts meant to be
 * copy-pasted into chats, social posts, READMEs, and issue comments.
 *
 * The formatter is a *composition* over the existing model (Match + the
 * approved market copy bank); it introduces no new data and performs no I/O and
 * no clock reads. It is deterministic given explicit `tz`/`locale` — the lone
 * env touch is timezone *resolution* (`resolveTz`, only when `tz` is omitted),
 * so every surface renders identical copy and snapshot tests stay stable.
 *
 * Legal posture (a snippet is the most public surface Claudinho has — it is
 * literally built to travel beyond the user's terminal):
 *  - The non-affiliation disclaimer is NON-optional in every style; only the
 *    hashtag and the install cue are toggleable.
 *  - Market lines reuse the approved copy bank verbatim (`marketBlock` /
 *    `marketLine`) and are NEVER hand-composed here, so the "informational only"
 *    caveat and Polymarket attribution are always carried.
 *  - Output is plain text only — no ANSI color, which would corrupt a paste.
 *  - English-only copy in v1 (consistent with the market bank); `tz`/`locale`
 *    still localize the kickoff date/time.
 */
import { liveSourceLabel } from '../live';
import { marketBlock, marketLine } from '../markets/format';
import type { MarketSignal } from '../markets/types';
import { isLive, matchLocation, scoreline, stageLabel } from '../normalize';
import { type StandingRow, tableTitle } from '../standings';
import { withFlag } from '../text';
import { formatDate, formatTime } from '../time';
import type { Match } from '../types';

/** The two v1 snippet shapes. `social` is the rich card; `compact` is one terse line per match. */
export type ShareStyle = 'compact' | 'social';

/** The project social tag — a distribution unit, default-on but removable. */
export const SHARE_HASHTAG = '#VibingLaVidaLoca';

/**
 * The non-affiliation line. Non-optional in every snippet: a shared artifact is
 * decontextualized, so the legal disclaimer must travel with every paste.
 */
export const SHARE_DISCLAIMER = 'Independent fan project · not affiliated with FIFA or Anthropic.';

export interface ShareSnippetOptions {
  /** Snippet shape; defaults to `social`. */
  style?: ShareStyle;
  /** Include the reliable market block/line when a signal is present (default true). */
  includeMarkets?: boolean;
  /** Include the #VibingLaVidaLoca tag (default true). */
  includeHashtag?: boolean;
  /** Include the "Try it: …" install/run cue (default true). */
  includeInstallLine?: boolean;
}

export interface ShareSnippetInput {
  /** Pre-resolved, English title line, e.g. "Next up for Mexico". */
  title: string;
  /** Matches to render (0..n). An empty set still yields a valid titled card. */
  /** Read-only: callers pass a bounded view, which must not be mutated. */
  matches: readonly Match[];
  /**
   * Reliable, display-ready market signals keyed by match id (sidecar — never
   * embedded in Match). Callers gate these; the formatter only renders.
   */
  marketSignals?: Map<string, MarketSignal>;
  /** False when market enrichment stopped before every relevant match was checked. */
  marketComplete?: boolean;
  /** Live-data provider name (e.g. "espn") for attribution; omit when static/degraded. */
  source?: string;
  /**
   * Body line shown when `matches` is empty (e.g. "No upcoming fixture found for
   * ZZZ."), so an unknown/empty target yields a clear card instead of a void.
   */
  emptyNote?: string;
  /**
   * A sentence that QUALIFIES the card (a verdict's, e.g. "Fixture data may
   * be incomplete."): printed whenever it is set, right after the title and
   * BEFORE the body, on a populated card and an empty one alike. A card is
   * pasted where nobody can ask, so what it holds must not look like all
   * there was. (A verdict that REPLACES the body is the `emptyNote`.)
   */
  note?: string;
  /** Exact run cue to advertise, e.g. "npx @claudinho/cli next MEX". */
  installLine?: string;
  /**
   * True when the live fetch failed and these are static fixtures (no live
   * scores). A pasted card must say so — otherwise a "no matches" / scheduled
   * card reads as authoritative when the feed is actually down. When set with
   * matches present, a not-live notice is printed before the matches (after
   * the `note`); for the empty case the caller picks a feed-down `emptyNote`.
   */
  degraded?: boolean;
  /**
   * The not-live sentence a degraded card with records prints, when its
   * builder knows better than the default (which says the records are the
   * bundled schedule's): off the bundled competition a match card's record is
   * the provider's own earlier one.
   */
  degradedNote?: string;
  /** Timezone for kickoff date/time (date/time only — copy stays English). */
  tz?: string;
  /** Locale for kickoff date/time. */
  locale?: string;
}

/** Home·away middle token: a live/final scoreline, else "vs". */
function mid(m: Match): string {
  return isLive(m.status) || m.status === 'FT' ? scoreline(m) : 'vs';
}

/** Short English status suffix for a card line (minute when live, else status word). */
function statusTail(m: Match): string {
  switch (m.status) {
    case 'LIVE':
      return m.minute ? `${m.minute}'` : 'LIVE';
    case 'HT':
      return 'HT';
    case 'FT':
      return 'FT';
    case 'POSTPONED':
      return 'postponed';
    case 'CANCELLED':
      return 'cancelled';
    default:
      return '';
  }
}

/**
 * One terse line for `compact` style: "🇲🇽 MEX vs RSA 🇿🇦 · 19:00". A list shares
 * the title's date, so rows stay time-only; a lone scheduled match (e.g.
 * `share next`) carries the date too, so the snippet is self-contained.
 */
function compactLine(m: Match, input: ShareSnippetInput, single: boolean): string {
  // Nothing in a flag's place: a club (no flag) is its code alone.
  const home = withFlag(m.home.code, m.home.flag, 'home');
  const away = withFlag(m.away.code, m.away.flag, 'away');
  const opts = { tz: input.tz, locale: input.locale };
  let tail: string;
  if (m.status === 'SCHEDULED') {
    const time = formatTime(m.kickoff, opts);
    tail = single ? `${formatDate(m.kickoff, opts)} ${time}` : time;
  } else {
    tail = statusTail(m);
  }
  return `${home} ${mid(m)} ${away}${tail ? ` · ${tail}` : ''}`;
}

/** The multi-line `social` card for one match (no market lines — caller adds those). */
function socialCard(m: Match, input: ShareSnippetInput): string[] {
  const lines: string[] = [];
  const head = `${withFlag(m.home.name, m.home.flag, 'home')} ${mid(m)} ${withFlag(m.away.name, m.away.flag, 'away')}`;
  if (m.status === 'SCHEDULED') {
    lines.push(head);
    const date = formatDate(m.kickoff, { tz: input.tz, locale: input.locale });
    const time = formatTime(m.kickoff, { tz: input.tz, locale: input.locale });
    // Only label the zone when explicitly provided — keeps the formatter pure
    // (no system-tz read) and avoids printing a zone the caller didn't choose.
    const zone = input.tz ? ` ${input.tz}` : '';
    lines.push(`${date} · ${time}${zone}`);
  } else {
    const tail = statusTail(m);
    lines.push(tail ? `${head} · ${tail}` : head);
  }
  const loc = matchLocation(m);
  if (loc) lines.push(loc);
  // The stage line, when there is a stage to state: an OTHER with no words
  // pushes no line at all (never an empty one).
  const stage = m.stage !== 'GROUP' ? stageLabel(m) : '';
  if (stage) lines.push(stage);
  return lines;
}

/**
 * Render a shareable snippet. Pure and deterministic: identical input yields
 * identical output. Blocks (title, each match, footer) are separated by a blank
 * line; lines within a block by a single newline.
 */
export function formatShareSnippet(
  input: ShareSnippetInput,
  options: ShareSnippetOptions = {},
): string {
  const style: ShareStyle = options.style ?? 'social';
  const includeMarkets = options.includeMarkets !== false;
  const includeHashtag = options.includeHashtag !== false;
  const includeInstall = options.includeInstallLine !== false;
  const signals = input.marketSignals ?? new Map<string, MarketSignal>();
  const single = input.matches.length === 1;

  const blocks: string[] = [input.title];
  // Before the body: what qualifies the card is read before what it qualifies,
  // and a card pasted into a tool's text is cut from the end, so nothing but
  // the footer follows the body. The verdict's note first, then the card's own
  // notes, in this order.
  if (input.note) blocks.push(input.note);
  // Degraded with matches present ⇒ these are static fixtures, no live scores.
  // (For the empty case the caller picks a feed-down emptyNote.) Never let a
  // pasted card imply live data when the feed was unreachable.
  if (input.degraded && input.matches.length > 0) {
    blocks.push(input.degradedNote ?? '(Live data unavailable — showing the bundled schedule, not live scores.)');
  }
  if (includeMarkets && input.marketComplete === false) {
    blocks.push('(Market data unavailable or incomplete — not all fixtures were checked.)');
  }

  if (input.matches.length === 0) {
    // No matches → a clear empty-state line (when provided) instead of a void.
    if (input.emptyNote) blocks.push(input.emptyNote);
  } else if (style === 'compact') {
    blocks.push(input.matches.map((m) => compactLine(m, input, single)).join('\n'));
  } else {
    for (const m of input.matches) {
      const card = socialCard(m, input);
      const sig = includeMarkets ? signals.get(m.id) : undefined;
      if (sig) {
        // Single-match cards get the narrative 3-line block; lists get the
        // compact one-liner so a multi-match snippet stays shareable.
        if (single) card.push('', ...marketBlock(sig, m));
        else card.push(marketLine(sig, m));
      }
      blocks.push(card.join('\n'));
    }
  }

  blocks.push(
    shareFooter({
      source: input.source,
      installLine: input.installLine,
      includeHashtag,
      includeInstall,
    }),
  );

  return blocks.join('\n\n');
}

/**
 * The shared footer block: optional attribution, the (always-present) disclaimer
 * with an optional hashtag, and an optional run cue. One definition so the legal
 * disclaimer can never be accidentally dropped from a new snippet type.
 */
function shareFooter(opts: {
  source?: string;
  installLine?: string;
  includeHashtag: boolean;
  includeInstall: boolean;
}): string {
  const footer: string[] = [];
  if (opts.source) footer.push(`Live data: ${liveSourceLabel(opts.source)}`);
  footer.push(
    [opts.includeHashtag ? SHARE_HASHTAG : '', SHARE_DISCLAIMER].filter(Boolean).join(' · '),
  );
  if (opts.includeInstall && opts.installLine) footer.push(`Try it: ${opts.installLine}`);
  return footer.join('\n');
}

/** Signed goal difference, e.g. +2 / 0 / -3. */
function gd(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

/**
 * One standings line: "1. 🇲🇽 MEX  3 pts · 1-0-0 · +2" (rank · record W-D-L ·
 * GD); a club's row is its code alone, "1. ARS  3 pts · …".
 */
function tableRow(r: StandingRow, rank: number): string {
  return `${rank}. ${withFlag(r.team.code, r.team.flag, 'home')}  ${r.points} pts · ${r.won}-${r.drawn}-${r.lost} · ${gd(r.goalDiff)}`;
}

export interface ShareTableInput {
  /**
   * The card's first line, naming the competition (`Premier League ·
   * standings`), before the tables (each keeps its own title); absent on a
   * card built with no competition.
   */
  heading?: string;
  /** Group tables to render (1..n); each in standings order. */
  tables: readonly {
    group: string;
    /** The provider's name for the table; absent for a lettered group. */
    label?: string;
    rows: readonly StandingRow[];
    /** Rows the provider served that could not be read (see GroupStandings). */
    partial?: { omitted: number };
  }[];
  /** Live-data provider name for attribution; omit when degraded/static. */
  source?: string;
  /** Exact run cue, e.g. "npx @claudinho/cli table A". */
  installLine?: string;
  /** Body line when there are no tables (e.g. "No group Z."). */
  emptyNote?: string;
  /**
   * Stated before the tables when they are not the whole competition (a table
   * the provider sent could not be read). A card is pasted where nobody can
   * ask: the tables that were read must not look like all of them.
   */
  incompleteNote?: string;
  /**
   * True when no authoritative table was available. Non-empty rows are a
   * static roster, not live results; an empty open-scope outage is described by
   * `emptyNote`. A shared card is pasted into public/social, so degraded state
   * MUST be surfaced rather than reading as an authoritative table.
   */
  degraded?: boolean;
}

/**
 * Render a shareable group-standings card. Pure, plain-text, deterministic. Like
 * {@link formatShareSnippet} but for tables: facts + emoji flags only, no market
 * lines (standings carry no market read), disclaimer non-optional, hashtag and
 * run cue toggleable via {@link ShareSnippetOptions}.
 */
export function formatShareTable(input: ShareTableInput, options: ShareSnippetOptions = {}): string {
  const includeHashtag = options.includeHashtag !== false;
  const includeInstall = options.includeInstallLine !== false;

  // The competition first: a pasted card says what it is about before anything else.
  const blocks: string[] = input.heading ? [input.heading] : [];
  if (input.tables.length === 0) {
    blocks.push(
      input.emptyNote ??
        (input.degraded ? 'Live standings unavailable.' : 'No standings available.'),
    );
  } else {
    // Before the tables: a card pasted into a tool's text is cut from the end,
    // so nothing but the footer follows the body. The verdict's sentence first
    // (tables are missing), then the card's own note. (The two never meet: a
    // roster is the fallback of a read that served no table.)
    if (input.incompleteNote) blocks.push(`(${input.incompleteNote})`);
    // Never let a static roster paste as if it were live results.
    if (input.degraded) {
      blocks.push('(Live standings unavailable — group roster, not live results.)');
    }
    for (const { group, label, rows, partial } of input.tables) {
      // The provider's rank, never the array position: on a partial table the
      // survivors are not 1..n (audit A01). A computed table has no rank and
      // prints its order.
      const lines = [`${tableTitle({ group, label })} · standings`, ''];
      // A table that is not whole says so before its rows, for the same reason.
      if (partial) {
        const n = partial.omitted;
        lines.push(`(partial table — ${n} row${n === 1 ? '' : 's'} unreadable; positions are the provider's ranks)`, '');
      }
      lines.push(...rows.map((r, i) => tableRow(r, r.rank ?? i + 1)));
      blocks.push(lines.join('\n'));
    }
  }
  blocks.push(
    shareFooter({ source: input.source, installLine: input.installLine, includeHashtag, includeInstall }),
  );
  return blocks.join('\n\n');
}
