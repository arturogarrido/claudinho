/**
 * Verdicts — what a result says about ITSELF that changes what a reader may
 * conclude from it.
 *
 * "Not available for this competition" is not "no fixture found". A result
 * carries such a verdict as a field (`unsupported`), and every surface has to
 * turn it into two things: a sentence in its text and a key in its structured
 * output. For a long time each surface did both by hand, at every emit site,
 * and the structured half was forgotten three times: `share table --json` lost
 * `partial`, `markets --json` lost `unsupported`, and the MCP tools returned
 * `data` for an unsupported competition identical to an empty World Cup answer.
 *
 * So there is ONE place a verdict becomes output. A surface spreads
 * {@link verdictExtras} into whatever it serializes, and prints the sentences
 * from here. A verdict added here reaches every surface that already calls
 * these functions; `core/test/verdict.test.ts` fails if a surface goes back to
 * forwarding one by hand.
 *
 * A verdict does one of two things to the body it is about, and the module
 * says which, because a surface that treated every sentence the same either
 * hid a readable answer or lost the sentence beside a populated one:
 *   - it REPLACES the body ({@link verdictNotice}: `unsupported`). The one
 *     sentence stands instead of the answer, which does not exist.
 *   - it QUALIFIES the body ({@link verdictQualifiers}: `incomplete`,
 *     `partial`). The answer holds what could be read and is printed; the
 *     sentences go beside it, on a populated body and an empty one alike.
 * When a result states a replacement, its qualifiers are not printed: the one
 * sentence stands for the whole answer. The structured keys
 * ({@link verdictExtras}) carry every verdict stated, whichever it is.
 */
import { t } from './i18n';

/** Any result that may state a verdict. Results state more than this; these are the verdicts. */
export interface VerdictSource {
  /** The feature does not exist for this competition yet (off the bundled schedule). */
  readonly unsupported?: boolean;
  /**
   * The result holds what could be read and is not the whole answer: the
   * provider sent a table that did not become one (an all-tables standings
   * read). Unlike `unsupported`, the result is not empty: the sentence goes
   * BESIDE what is shown, not instead of it.
   */
  readonly incomplete?: boolean;
  /**
   * The read behind the result said it was not whole: the provider sent
   * records the result does not hold (unreadable, a second copy of one
   * fixture, beyond a bound). `omitted` is how many, when that is known. The
   * result holds what was read, and the sentence goes beside it. Stated only
   * when the adapter SAID its answer was not whole; an adapter that says
   * nothing about its answer states no verdict.
   */
  readonly partial?: { readonly omitted?: number };
}

/** The structured keys of the verdicts a result states. Empty when it states none. */
export interface VerdictExtras {
  unsupported?: true;
  incomplete?: true;
  /** `omitted` present only when the count is known (a positive integer). */
  partial?: { omitted?: number };
}

/** Whether a result states `partial` (an object; anything else states nothing). */
function statesPartial(result: VerdictSource): result is VerdictSource & { readonly partial: { readonly omitted?: number } } {
  return typeof result.partial === 'object' && result.partial !== null;
}

/**
 * The count a `partial` verdict states, believed only as a finite positive
 * integer. Anything else (0, negative, fractional, NaN, infinite, not a
 * number) is "not known": the verdict stands without a count.
 */
function omittedCount(partial: { readonly omitted?: unknown }): number | undefined {
  const n = partial.omitted;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * The `partial` verdict a read's own account states (see `FetchMeta`), for a
 * result to carry: stated when the adapter SAID the answer was not whole
 * (`complete: false`), with the count only when it is believed; nothing when
 * the adapter said the answer was whole, or said nothing. The one place a
 * read's account becomes this verdict, so the count rule is not copied.
 */
export function partialOfRead(
  meta: { readonly complete?: boolean; readonly omitted?: number } | undefined,
): { partial?: { omitted?: number } } {
  if (meta?.complete !== false) return {};
  const omitted = omittedCount(meta);
  return { partial: omitted !== undefined ? { omitted } : {} };
}

/**
 * The verdict keys to spread into `--json` and MCP `data`, in a stable order.
 * Only verdicts the result actually states: a healthy result adds no key.
 */
export function verdictExtras(result: VerdictSource): VerdictExtras {
  const out: VerdictExtras = {};
  if (result.unsupported === true) out.unsupported = true;
  if (result.incomplete === true) out.incomplete = true;
  if (statesPartial(result)) {
    const omitted = omittedCount(result.partial);
    out.partial = omitted !== undefined ? { omitted } : {};
  }
  return out;
}

/**
 * The sentence that REPLACES the body, in the reader's language — or
 * undefined when the result states none, and the surface prints its body (or
 * says what it would have said anyway: "no fixture found", "couldn't reach the
 * provider"). A qualifying verdict is never returned here: see
 * {@link verdictQualifiers}.
 */
export function verdictNotice(result: VerdictSource, lang?: string): string | undefined {
  if (result.unsupported === true) return t(lang, 'competition.unsupported');
  return undefined;
}

/**
 * The sentences that QUALIFY the body, printed beside it, in a fixed order
 * (`incomplete`, then `partial`), in the reader's language. Empty when the
 * result states none, and when it states a replacement (which stands alone).
 *
 * Any result object may be handed over, also one whose type declares none of
 * the verdict fields (a degraded result: it simply states none); the fields it
 * does declare are still checked against `VerdictSource`.
 */
export function verdictQualifiers(result: VerdictSource & object, lang?: string): string[] {
  if (verdictNotice(result, lang) !== undefined) return [];
  const out: string[] = [];
  if (result.incomplete === true) out.push(t(lang, 'standings.incomplete'));
  if (statesPartial(result)) {
    const n = omittedCount(result.partial);
    out.push(
      n === undefined
        ? t(lang, 'read.partial')
        : t(lang, n === 1 ? 'read.partial.one' : 'read.partial.other', { n: String(n) }),
    );
  }
  return out;
}
