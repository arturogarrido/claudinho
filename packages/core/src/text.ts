/**
 * Display-width helpers for monospace/plain-text alignment.
 *
 * `String.prototype.padEnd` counts UTF-16 units, but emoji flags occupy 2
 * terminal columns regardless of how many units encode them: a regional-
 * indicator flag (🇲🇽) is 4 units, while a tag-sequence flag (England 🏴󠁧󠁢󠁥󠁮󠁧󠁿) is
 * 14 — so unit-counted padding pushed England/Scotland rows ~10 columns out of
 * line. These helpers count grapheme clusters, with pictographic clusters
 * (flags included) as 2 columns, matching how terminals render them.
 */

const segmenter = new Intl.Segmenter();

/** Pictographic (emoji) clusters — incl. both flag encodings — render 2 cols wide. */
const WIDE_CLUSTER = /^(?:\p{Regional_Indicator}|\p{Extended_Pictographic})/u;

/**
 * East Asian Wide/Fullwidth bases, which occupy 2 terminal columns. JS regexes
 * expose no `East_Asian_Width` property (only General_Category, Script and the
 * binary properties), so the ranges are spelled out.
 */
const WIDE_BASE =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏ꥠ-꥿가-힣豈-﫿︐-︙︰-﹯＀-｠￠-￦]/u;

/**
 * Bases that occupy NO column: combining marks (a cluster's accent rides on its
 * base) and format/control characters. Counting these as 1 was how an invisible
 * character inflated a measured width, spreading a standings table.
 */
const ZERO_WIDTH_BASE = /[\p{Mn}\p{Me}\p{Cf}\p{Cc}]/u;

/** Terminal columns occupied by ONE grapheme cluster. */
function clusterWidth(segment: string): number {
  // An emoji cluster is 2 columns whatever it contains — the ZWJ, variation
  // selectors and tag characters inside it are structural, not separate glyphs.
  if (WIDE_CLUSTER.test(segment)) return 2;
  const first = segment.codePointAt(0);
  if (first === undefined) return 0;
  const base = String.fromCodePoint(first);
  if (ZERO_WIDTH_BASE.test(base)) return 0;
  return WIDE_BASE.test(base) ? 2 : 1;
}

/** Terminal display width of a string (grapheme clusters; emoji count as 2). */
export function displayWidth(s: string): number {
  let w = 0;
  for (const { segment } of segmenter.segment(s)) {
    w += clusterWidth(segment);
  }
  return w;
}

/**
 * Truncate to `maxColumns` display columns, appending `marker` when anything
 * was dropped. Never splits a grapheme cluster.
 *
 * `padVisible` deliberately never truncates, so a single over-wide value pushed
 * every other column out of line for the whole table — and on the statusline,
 * whose entire contract is one short line, nothing bounded the result at all.
 */
export function truncateVisible(s: string, maxColumns: number, marker = '…'): string {
  if (displayWidth(s) <= maxColumns) return s;
  const budget = Math.max(0, maxColumns - displayWidth(marker));
  let out = '';
  let w = 0;
  for (const { segment } of segmenter.segment(s)) {
    const cw = clusterWidth(segment);
    if (w + cw > budget) break;
    out += segment;
    w += cw;
  }
  return out + marker;
}

/**
 * Iterate a string by grapheme cluster. Shared with the feed sanitizer, which
 * must reason in clusters rather than code points: a flag or ZWJ emoji is a
 * single indivisible unit whose internal format characters are structural,
 * while a bidi control is always a cluster of its own.
 */
export function* graphemes(s: string): Generator<string> {
  for (const { segment } of segmenter.segment(s)) yield segment;
}

/**
 * Pad with trailing spaces to `width` DISPLAY columns (never truncates — a
 * too-long value overflows its column rather than being cut mid-name).
 */
export function padVisible(s: string, width: number): string {
  const w = displayWidth(s);
  return w >= width ? s : s + ' '.repeat(width - w);
}
