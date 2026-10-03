/**
 * Metadata that belongs to ONE fetch result.
 *
 * A provider says things about a response that are not fixtures: which season
 * (or, for a window across a season turn, which seasons) it answered for and,
 * from 0.11's bundle decoupling on, whether every record in it could be read
 * and how many could not. Those facts decide what a caller may claim, so they
 * must belong to the particular result they describe.
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
  /**
   * The season the provider reported for this response, when it stated one.
   * For a window, the one its stating parts agree on; absent when none stated
   * one, or when a window asked across seasons held two (see `seasons`).
   */
  readonly season?: SeasonInfo;
  /**
   * Every distinct season the response(s) stated, by year, in the order the
   * parts were asked: zero or one for a single response, and for a window
   * asked strictly (two are refused there); two for a window asked across a
   * season turn. Empty is "none stated", which a reader must tell from "two".
   * Absent when the adapter does not say.
   */
  readonly seasons?: readonly SeasonInfo[];
  /**
   * Whether the result accounts for every record the provider sent. False when
   * a record was left out: refused as unreadable, contradicting a sibling under
   * the same id, or beyond the bound. A record the provider itself marks as not
   * a fixture is not "left out". Absent when the adapter does not say.
   */
  readonly complete?: boolean;
  /**
   * How many provider records made the result not whole: refused as
   * unreadable, a second record under an id already accepted (within a
   * response or across the parts of a window), or beyond the bound. A record
   * the provider marks as not a fixture is not counted. 0 exactly when
   * `complete` is true. Absent when the count is not known: a response that
   * filled the request's limit lost a tail nobody can count.
   */
  readonly omitted?: number;
  /**
   * The id of every fixture the response(s) held and the parser read, when the
   * result can hold FEWER: a window narrowed from month responses sets aside
   * what falls outside it, and the copy of a fixture held twice. A caller that
   * keeps a previous answer asks "was this fixture read?" of this list, never
   * of the result: a fixture the provider moved out of the window was read,
   * and its old copy must not be put back. Absent when the result holds
   * everything that was read.
   */
  readonly mentioned?: readonly string[];
  /**
   * Standings only: whether every table child the provider sent became a
   * table. A different fact from `complete`, which is also false for a refused
   * ROW of a table that was read. False means a table may be missing from the
   * result, so a key it does not hold is not known to be absent.
   */
  readonly inventoryComplete?: boolean;
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
