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
import { isLive, matchLocation, scoreline } from '../normalize';
import type { StandingRow } from '../standings';
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
  matches: Match[];
  /**
   * Reliable, display-ready market signals keyed by match id (sidecar — never
   * embedded in Match). Callers gate these; the formatter only renders.
   */
  marketSignals?: Map<string, MarketSignal>;
  /** Live-data provider name (e.g. "espn") for attribution; omit when static/degraded. */
  source?: string;
  /**
   * Body line shown when `matches` is empty (e.g. "No upcoming fixture found for
   * ZZZ."), so an unknown/empty target yields a clear card instead of a void.
   */
  emptyNote?: string;
  /** Exact run cue to advertise, e.g. "npx @claudinho/cli next MEX". */
  installLine?: string;
  /**
   * True when the live fetch failed and these are static fixtures (no live
   * scores). A pasted card must say so — otherwise a "no matches" / scheduled
   * card reads as authoritative when the feed is actually down. When set with
   * matches present, a not-live notice is appended; for the empty case the
   * caller picks a feed-down `emptyNote`.
   */
  degraded?: boolean;
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
  const home = `${m.home.flag} ${m.home.code}`;
  const away = `${m.away.code} ${m.away.flag}`;
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
  const head = `${m.home.flag} ${m.home.name} ${mid(m)} ${m.away.name} ${m.away.flag}`;
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

  // Degraded with matches present ⇒ these are static fixtures, no live scores.
  // (For the empty case the caller picks a feed-down emptyNote.) Never let a
  // pasted card imply live data when the feed was unreachable.
  if (input.degraded && input.matches.length > 0) {
    blocks.push('(Live data unavailable — showing the bundled schedule, not live scores.)');
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

/** One standings line: "1. 🇲🇽 MEX  3 pts · 1-0-0 · +2" (rank · record W-D-L · GD). */
function tableRow(r: StandingRow, rank: number): string {
  return `${rank}. ${r.team.flag} ${r.team.code}  ${r.points} pts · ${r.won}-${r.drawn}-${r.lost} · ${gd(r.goalDiff)}`;
}

export interface ShareTableInput {
  /** Group tables to render (1..n); each in standings order. */
  tables: { group: string; rows: StandingRow[] }[];
  /** Live-data provider name for attribution; omit when degraded/static. */
  source?: string;
  /** Exact run cue, e.g. "npx @claudinho/cli table A". */
  installLine?: string;
  /** Body line when there are no tables (e.g. "No group Z."). */
  emptyNote?: string;
  /**
   * True when the rows are a static roster (no live results), not an
   * authoritative table. A shared card is pasted into public/social, so this
   * MUST be surfaced — otherwise a roster-at-zero reads as a real "nobody has
   * played yet" table. The card then carries an explicit not-live notice.
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

  const blocks: string[] = [];
  if (input.tables.length === 0) {
    blocks.push(input.emptyNote ?? 'No standings available.');
  } else {
    for (const { group, rows } of input.tables) {
      blocks.push(
        [`Group ${group} · standings`, '', ...rows.map((r, i) => tableRow(r, i + 1))].join('\n'),
      );
    }
    // Never let a static roster paste as if it were live results.
    if (input.degraded) {
      blocks.push('(Live standings unavailable — group roster, not live results.)');
    }
  }
  blocks.push(
    shareFooter({ source: input.source, installLine: input.installLine, includeHashtag, includeInstall }),
  );
  return blocks.join('\n\n');
}
