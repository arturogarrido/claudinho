/**
 * Bounded collections — the type that carries its own honesty.
 *
 * Every round of review found a list that was capped without saying so, or that
 * reported a post-cap count as the total, or that said "none found" when it had
 * simply run out of budget. Those are the same bug three ways: the shape of the
 * data did not carry what the reader needed to interpret it. A `BoundedList`
 * cannot be constructed without stating all four facts.
 */

export interface BoundedList<T> {
  /** What survived the cap. */
  readonly items: readonly T[];
  /** How many there were BEFORE capping. */
  readonly total: number;
  /** `items.length` — kept explicit so a serialized payload is self-describing. */
  readonly shown: number;
  /** Did the cap drop anything? */
  readonly truncated: boolean;
  /**
   * Did we finish looking? False when a deadline, error, or partial fetch cut
   * the work short — so a caller can tell "there are none" from "we don't know".
   * An empty list with `complete: false` must NEVER render as "nothing found".
   */
  readonly complete: boolean;
}

/**
 * Bound a list, recording what that cost.
 *
 * SLICE BEFORE MAP is the caller's job — this records the outcome, it does not
 * make an unbounded traversal safe. `takeBounded` is the one that bounds work.
 */
export function bounded<T>(items: readonly T[], max: number, complete = true): BoundedList<T> {
  const kept = items.length > max ? items.slice(0, max) : items;
  return {
    items: kept,
    total: items.length,
    shown: kept.length,
    truncated: items.length > kept.length,
    complete,
  };
}

/** An empty result we could not complete — "we don't know", not "there are none". */
export function incomplete<T>(reason?: string): BoundedList<T> {
  void reason;
  return { items: [], total: 0, shown: 0, truncated: false, complete: false };
}

/**
 * Take at most `max` items from something that may not be an array at all,
 * BEFORE any per-item work happens.
 *
 * This is the work bound. Mapping, sorting or sanitizing first and slicing
 * afterwards is what made a 4,000-row group cost 300ms to return 32, and a
 * 100k-event record cost 5.3s on a 150ms surface.
 */
export function takeBounded<T>(value: unknown, max: number): T[] {
  if (!Array.isArray(value)) return [];
  return value.length > max ? (value.slice(0, max) as T[]) : (value as T[]);
}

/** Map a BoundedList's items while preserving its counts. */
export function mapBounded<T, U>(list: BoundedList<T>, fn: (item: T) => U): BoundedList<U> {
  return { ...list, items: list.items.map(fn) };
}
