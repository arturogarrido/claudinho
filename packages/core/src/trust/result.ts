/**
 * The vocabulary for "we could not use this".
 *
 * `undefined` was doing five jobs at once — absent, malformed, ambiguous, timed
 * out, and definitively none — and the caller could not tell them apart. That
 * ambiguity is what let a schema failure get negative-cached as the FACT "this
 * fixture has no market", and what made `checked` mean two different things on
 * two paths. Every rejection now says which kind it is.
 */

/** A value we produced, or the reason we did not. */
export type ParseResult<T> =
  | { readonly kind: 'valid'; readonly value: T }
  /** We read the payload fine, and the answer is genuinely "nothing here". Cacheable. */
  | { readonly kind: 'definitive-none'; readonly reason: string }
  /** We could not read the payload. A fact about US, not about the fixture. NOT cacheable. */
  | { readonly kind: 'malformed'; readonly reason: string }
  /** The payload admits more than one reading. Never guess between them. NOT cacheable. */
  | { readonly kind: 'ambiguous'; readonly reason: string };

export const valid = <T>(value: T): ParseResult<T> => ({ kind: 'valid', value });
export const definitiveNone = <T>(reason: string): ParseResult<T> => ({
  kind: 'definitive-none',
  reason,
});
export const malformed = <T>(reason: string): ParseResult<T> => ({ kind: 'malformed', reason });
export const ambiguous = <T>(reason: string): ParseResult<T> => ({ kind: 'ambiguous', reason });

/** The value, or undefined — for callers that genuinely do not care why. */
export function valueOf<T>(r: ParseResult<T>): T | undefined {
  return r.kind === 'valid' ? r.value : undefined;
}

/**
 * May this rejection be remembered as a result?
 *
 * Only a definitive none. Caching "malformed" or "ambiguous" suppresses the
 * retry that would recover, and reports our own confusion as the provider's
 * answer.
 */
export function isCacheable<T>(r: ParseResult<T>): boolean {
  return r.kind === 'valid' || r.kind === 'definitive-none';
}
