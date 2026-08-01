/**
 * Text ROLES — the replacement for one universal `sanitizeFeedText`.
 *
 * A single "clean this string" function had to serve prose, identifiers,
 * timestamps and flags at once, so its rules were the union of four different
 * requirements and its exemptions were the union of four different escape
 * hatches. That is why every round found another sibling: a rule tightened for
 * one role loosened something for another.
 *
 * Each role below states what it accepts, positively. Nothing is "stripped and
 * hoped"; a value either satisfies its role or it is refused.
 *
 * The single most important consequence is at the bottom: **a flag is never
 * accepted from a provider or a cache — it is generated from the bundled team
 * map.** Three separate P1s (TAG sequences, variation selectors, ZWJ chains)
 * existed only because the sanitizer had to preserve provider-supplied emoji.
 * Once emoji are product-owned, `humanLabel` can refuse every invisible code
 * point outright and the whole class stops existing.
 */
import { nationToFlag } from '../flags';
import { displayWidth, graphemes } from '../text';

/**
 * Code points a human-readable label may never contain.
 *
 * `Default_Ignorable_Code_Point` is the property that matters, and it is the one
 * I should have reached for in round two: it covers ZWJ, ZWSP, SHY, every
 * variation selector, the whole TAG block, Mongolian free variation selectors,
 * and the bidi controls — every invisible channel found across ten rounds — in
 * one predicate rather than an enumeration I kept having to extend.
 *
 * The rest: `Cc`/`Cf` (controls and format), `Zl`/`Zp` (line/paragraph
 * separators), `Cs` (lone surrogates, which break re-serialization), `Co`
 * (private use, which renders font-dependently) and `Cn` (unassigned — a code
 * point this Unicode version cannot vouch for).
 */
const FORBIDDEN_IN_LABEL =
  /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Co}\p{Cn}]|\p{Default_Ignorable_Code_Point}/u;

/**
 * Emoji are refused in labels — not sanitized, refused.
 *
 * Every flag this product renders comes from {@link productFlag}, so a
 * pictograph arriving in a provider's team name or a cache file's label is
 * never something we need. Refusing them removes the exemption that the TAG,
 * variation-selector and ZWJ payload channels all rode through.
 */
// A keycap is a plain character (a digit, `#` or `*`) wearing U+20E3, so it is
// neither Extended_Pictographic nor a Regional_Indicator — it slipped through as
// a 2-column glyph. It is visible and bounded, so it was never a covert channel,
// but "a label admits no emoji" has to be true as stated. Named explicitly
// rather than widening to \p{Emoji}, which matches the bare digits in "2026".
// Verified absent from 36,538 real feed strings.
const EMOJI_IN_LABEL = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u{20E3}/u;

/** Input bytes read before any per-character work. A work bound, not a display one. */
const MAX_LABEL_INPUT_UNITS = 4096;

/** Display columns a label may occupy. Generous for any real team or venue name. */
export const MAX_LABEL_COLUMNS = 100;

/**
 * Prose meant for a human: a team name, a venue, a city, a market outcome label.
 *
 * NFC-normalized so the same name has one representation, bounded on input
 * length (work), display columns (layout) and code points (bytes), and free of
 * anything invisible. Whitespace controls fold to a space so words a hostile
 * feed split across lines cannot fuse.
 *
 * Total: never throws, whatever the input.
 */
export function humanLabel(value: unknown, maxColumns = MAX_LABEL_COLUMNS): string {
  if (typeof value !== 'string' || value === '') return '';
  // Bound the INPUT before touching it: the loop below only exits early when a
  // character is KEPT, so an all-rejected field was otherwise scanned in full.
  const capped =
    value.length > MAX_LABEL_INPUT_UNITS ? value.slice(0, MAX_LABEL_INPUT_UNITS) : value;
  let normalized: string;
  try {
    normalized = capped.normalize('NFC');
  } catch {
    return ''; // a lone surrogate can make normalize throw
  }

  // Code points allowed OUT, derived from the column budget. Columns alone do
  // not bound a label: a zero-width cluster adds 0, so `width` never grows and
  // the loop never breaks. Separators that are themselves dropped (U+200B,
  // U+00AD — format characters whose GCB is Control) split a run of combining
  // marks into small clusters that each pass the per-cluster check, and then
  // re-merge onto one base once the separators are removed. Measured: 2,801
  // code points emitted at ONE display column, and 2,048 on a field declaring a
  // cap of 8 columns.
  //
  // Four per column is far above anything real — the longest name we ship is 22
  // characters at 22 columns — and far below a payload.
  const maxCodePoints = Math.max(16, maxColumns * 4);

  let out = '';
  let width = 0;
  let points = 0;
  for (const cluster of graphemes(normalized)) {
    // A real character is a handful of code points. Anything longer is a
    // payload wearing one glyph, whatever it is built from.
    if ([...cluster].length > 8) continue;
    if (EMOJI_IN_LABEL.test(cluster)) continue;
    let piece = '';
    for (const ch of cluster) {
      const cp = ch.codePointAt(0) ?? 0;
      if (cp === 0x09 || cp === 0x0a || cp === 0x0d) {
        piece += ' ';
        continue;
      }
      if (FORBIDDEN_IN_LABEL.test(ch)) continue;
      piece += ch;
    }
    if (!piece) continue;
    const w = displayWidth(piece);
    const cps = [...piece].length;
    if (width + w > maxColumns || points + cps > maxCodePoints) break;
    out += piece;
    width += w;
    points += cps;
  }
  return out.trim();
}

/**
 * An opaque provider identifier, checked against an exact grammar.
 *
 * Identifiers are not prose and must never be treated as prose: they are not
 * rendered, so a payload hidden in one never *looks* wrong, while landing
 * verbatim in `--json` and MCP `structuredContent`. Stripping control
 * characters leaves printable prose untouched, which is the entire attack.
 */
export function opaqueId(value: unknown, grammar: RegExp): string | undefined {
  return typeof value === 'string' && grammar.test(value) ? value : undefined;
}

/** Real ESPN event ids and every bundled fixture id: 6-9 digits, measured. */
export const ESPN_ID = /^[0-9]{1,20}$/;
/** Real Gamma event and market ids: numeric strings, measured across 36,243 markets. */
export const GAMMA_ID = /^[0-9]{1,32}$/;
/** The event slug this code derives for itself. */
export const DERIVED_SLUG = /^fifwc-[a-z]{2,3}-[a-z]{2,3}-\d{4}-\d{2}-\d{2}$/;

/** ISO-8601 with an EXPLICIT offset — an offsetless instant means four things in four zones. */
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}(?::?\d{2})?)$/;
/** Exactly what {@link canonicalTimestamp} may emit. */
const ISO_CANONICAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Is the calendar date real? `Date.parse` ROLLS OVER instead of failing. */
function calendarValid(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * An instant, RE-EMITTED in one canonical form.
 *
 * Validating and passing through is not enough — `Date.parse` accepts strings
 * carrying an arbitrary RFC-2822 `(comment)`, and it silently rolls February 30
 * into March 2, which files a fixture on the wrong day. Both ends are checked
 * against a grammar and the calendar is checked for real.
 */
export function canonicalTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || !ISO_INSTANT.test(value)) return undefined;
  if (!calendarValid(value)) return undefined;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return undefined;
  const out = new Date(t).toISOString();
  return ISO_CANONICAL.test(out) ? out : undefined;
}

/**
 * A flag, GENERATED from the bundled map — never accepted from anywhere.
 *
 * This is the load-bearing line of the whole module. Because a flag is produced
 * here rather than passed through, no untrusted input ever needs to carry an
 * emoji, so {@link humanLabel} can refuse every invisible code point without
 * exception. The three P1s that each rode the old emoji exemption (TAG
 * sequences, variation selectors, ZWJ chains) are not defended against — they
 * have nowhere to enter.
 */
export function productFlag(nameOrCode: string | undefined): string {
  return nationToFlag(nameOrCode);
}

/** A whole number in `0..max` — a score, a minute, a goal tally. */
export function count(value: unknown, max: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max
    ? value
    : undefined;
}

/** A finite, non-negative quantity — liquidity, volume. */
export function quantity(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** A probability we will render: a real number in [0,1]. */
export function probability(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : undefined;
}

/** A member of a closed set, or nothing. Enums are never inferred. */
export function member<T extends string>(value: unknown, allowed: ReadonlySet<string>): T | undefined {
  return typeof value === 'string' && allowed.has(value) ? (value as T) : undefined;
}

/** A real boolean. `"false"` is a truthy string, and it decided who won a match. */
export function flag(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}
