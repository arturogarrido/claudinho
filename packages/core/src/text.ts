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

/** Terminal display width of a string (grapheme clusters; emoji count as 2). */
export function displayWidth(s: string): number {
  let w = 0;
  for (const { segment } of segmenter.segment(s)) {
    w += WIDE_CLUSTER.test(segment) ? 2 : 1;
  }
  return w;
}

/**
 * Pad with trailing spaces to `width` DISPLAY columns (never truncates — a
 * too-long value overflows its column rather than being cut mid-name).
 */
export function padVisible(s: string, width: number): string {
  const w = displayWidth(s);
  return w >= width ? s : s + ' '.repeat(width - w);
}
