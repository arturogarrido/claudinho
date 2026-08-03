/**
 * Choosing one of several, and reporting on a batch.
 *
 * Two shapes, both replacing a boolean that was carrying more meaning than a
 * boolean can hold.
 *
 * `Selection` replaces "the selector returned undefined". Finding no market for
 * a team and finding TWO markets for that team both produced `undefined`, and
 * the caller — having no way to tell them apart — recorded the second as the
 * definitive fact "this fixture has no market" and negative-cached it for the
 * whole TTL. An ambiguity is the one thing we must never resolve by guessing,
 * and it was the case being guessed at.
 *
 * `BatchResolution` replaces `checked: Set<string>`. That set was maintained
 * alongside the results rather than derived from them, so "did we reach a
 * verdict?" and "what was the verdict?" could disagree — and did, on two paths.
 * Here the verdict IS the record, and cacheability is read off it.
 */
import { type ParseResult, isCacheable } from './result';

/** Exactly one, none, or more than one — never "one of the several". */
export type Selection<T> =
  | { readonly kind: 'one'; readonly value: T }
  | { readonly kind: 'none' }
  | { readonly kind: 'ambiguous'; readonly count: number };

export const NONE: Selection<never> = { kind: 'none' };

/**
 * The single candidate, or an honest account of why there isn't one.
 *
 * Deliberately NOT `candidates[0]`: which of two legs claiming the same team is
 * the real one is not a question the payload answers, so it is not a question
 * this function answers either.
 */
export function selectOne<T>(candidates: readonly T[]): Selection<T> {
  if (candidates.length === 1) return { kind: 'one', value: candidates[0] as T };
  if (candidates.length === 0) return NONE;
  return { kind: 'ambiguous', count: candidates.length };
}

/**
 * Every input's verdict, plus whether every input GOT one.
 *
 * `complete: false` means the batch was cut short (deadline, provider error) —
 * the missing entries are unasked questions, not negative answers.
 */
export interface BatchResolution<T> {
  readonly results: ReadonlyMap<string, ParseResult<T>>;
  readonly complete: boolean;
}

/** The values that resolved, keyed as they went in. */
export function resolvedValues<T>(batch: BatchResolution<T>): Map<string, T> {
  const out = new Map<string, T>();
  for (const [key, r] of batch.results) if (r.kind === 'valid') out.set(key, r.value);
  return out;
}

/**
 * The keys whose verdict may be remembered — see {@link isCacheable}.
 *
 * This is the old `checked` set, now DERIVED from each verdict instead of
 * tracked beside it. A malformed or unresolved key is absent, so a shape we
 * could not read and a deadline that expired are both retried next time rather
 * than cached as the fact that this fixture has no market.
 */
export function cacheableKeys<T>(batch: BatchResolution<T>): Set<string> {
  const out = new Set<string>();
  for (const [key, r] of batch.results) if (isCacheable(r)) out.add(key);
  return out;
}

/** An empty batch that reached nobody — what a total provider failure returns. */
export function emptyBatch<T>(): BatchResolution<T> {
  return { results: new Map(), complete: false };
}
