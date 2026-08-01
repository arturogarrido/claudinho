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
  /**
   * The payload admits more than one reading. Never guess between them.
   *
   * CACHEABLE, unlike the two below. This is a fact about a payload we read
   * successfully — two legs claiming the same team, an incoherent 1X2 — and it
   * is STABLE: fetching again returns the same bytes and the same ambiguity.
   * Treating it as non-cacheable meant re-fetching on every single command,
   * forever, and under the default-on enrichment deadline those doomed fixtures
   * consumed the whole budget and starved the resolvable ones behind them.
   * A negative TTL is a bounded delay if the provider later fixes their data;
   * a permanent refetch loop is not bounded by anything.
   */
  | { readonly kind: 'ambiguous'; readonly reason: string }
  /**
   * We never reached a verdict — the deadline expired, the budget ran out.
   * A fact about the CLOCK, not about the fixture. NOT cacheable.
   *
   * This kind exists because the alternative was folding a timeout into
   * `malformed`, which is the same conflation this type was written to end.
   */
  | { readonly kind: 'unresolved'; readonly reason: string };

export const valid = <T>(value: T): ParseResult<T> => ({ kind: 'valid', value });
export const definitiveNone = <T>(reason: string): ParseResult<T> => ({
  kind: 'definitive-none',
  reason,
});
export const malformed = <T>(reason: string): ParseResult<T> => ({ kind: 'malformed', reason });
export const ambiguous = <T>(reason: string): ParseResult<T> => ({ kind: 'ambiguous', reason });
export const unresolved = <T>(reason: string): ParseResult<T> => ({ kind: 'unresolved', reason });

/** The value, or undefined — for callers that genuinely do not care why. */
export function parsedValue<T>(r: ParseResult<T>): T | undefined {
  return r.kind === 'valid' ? r.value : undefined;
}

/**
 * May this rejection be remembered for the length of a TTL?
 *
 * The line is whether we READ the payload, not whether we liked it. A
 * definitive none and an ambiguity are both conclusions drawn from bytes we
 * understood, and both are stable across a refetch — so remembering them is
 * correct, and re-asking immediately just burns the request.
 *
 * `malformed` and `unresolved` are facts about US: a shape we could not read
 * (which may be a provider mid-deploy) and a clock that ran out. Remembering
 * either would suppress the retry that recovers.
 */
export function isCacheable<T>(r: ParseResult<T>): boolean {
  return r.kind === 'valid' || r.kind === 'definitive-none' || r.kind === 'ambiguous';
}
