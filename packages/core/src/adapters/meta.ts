/**
 * Metadata that belongs to ONE fetch result.
 *
 * A provider says things about a response that are not fixtures: which season
 * it answered for and, from 0.11's bundle decoupling on, whether every record
 * in it could be read. Those facts decide what a caller may claim, so they must
 * belong to the particular result they describe.
 *
 * They are NOT kept on the adapter. A field there is shared by every call in
 * flight — `lastError` is, and documents itself as "best-effort under
 * concurrency" for exactly that reason: with two overlapping calls, the second
 * to finish overwrites what the first was told. Here the metadata is keyed on
 * the returned array itself, so it cannot outlive, precede or cross to another
 * result, and `ProviderAdapter` keeps its plain-array contract.
 */
import type { SeasonInfo } from '../types';

export interface FetchMeta {
  /** The season the provider reported for this response, when it stated one. */
  readonly season?: SeasonInfo;
}

const META = new WeakMap<object, FetchMeta>();

/** Attach metadata to a fetch result and return that same result. */
export function attachFetchMeta<T extends object>(result: T, meta: FetchMeta | undefined): T {
  if (meta) META.set(result, meta);
  return result;
}

/** The metadata of a fetch result, if the provider that produced it stated any. */
export function fetchMeta(result: object | undefined): FetchMeta | undefined {
  return result ? META.get(result) : undefined;
}
