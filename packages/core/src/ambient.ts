/**
 * The ambient view: what `claudinho ambient --json` prints, ONE JSON object on
 * one line, for a program that shows the statusline and the hook itself (the
 * Claude Code plugin's band, its toasts and its prompt context). A type and
 * its documentation only: the CLI builds it from its local cache (the
 * statusline's reader, in `packages/cli`), and core reads no cache and no
 * environment for it.
 *
 * Three shapes reach a reader, and the command always exits 0:
 *   - nothing chosen (no `--competition`, no `CLAUDINHO_COMPETITION`, no saved
 *     choice): the selection's structured twin, `competition: null` beside the
 *     verdict that says nothing is chosen, and `line` (the statusline's
 *     first-run line); no cache is read and no refresher started;
 *   - a value that is no competition, or a failure anywhere: `line` alone, the
 *     statusline's empty line;
 *   - a selected competition: an {@link AmbientView}.
 */
import type { CompetitionKey } from './competition';
import type { BoundedList } from './trust/bounded';
import type { Match } from './types';
import type { Pin } from './userConfig';

/**
 * A live match as the ambient view lists it: the sealed record, as the other
 * `--json` twins serialize a `Match` (`status`, the `score` object, `shootout`
 * after a shootout, `Team.id` where the cache holds it, a nation's generated
 * `flag`, no `flag` key on a club), with no `events` key (the ambient reader
 * never seals a timeline), and two booleans about the reader's own team:
 */
export type AmbientMatch = Match & {
  /**
   * A side of it is the ambient PREFERENCE's (`pick`): `CLAUDINHO_TEAM`'s
   * code, else the saved pin. The picked matches come first in the list.
   */
  readonly picked: boolean;
  /**
   * A side of it is the SAVED pin's (`claudinho follow <alias> --team`), by
   * the pin's id when it has one (a club), by its code when it has none (the
   * World Cup's nations); whatever `CLAUDINHO_TEAM` prefers.
   */
  readonly pinned: boolean;
};

/** The ambient view of a selected competition, its keys in this order. */
export interface AmbientView {
  /**
   * The statusline's line, as `claudinho prompt` prints it (the same reader,
   * the same options), fitted to `--columns N` when given: whole matches are
   * kept while they fit and the rest counted in the `+N` (or `+more`) suffix,
   * which is never cut.
   */
  readonly line: string;
  /** The hook's block, as `claudinho hook` prints it while a match is live; `null` when it prints nothing. */
  readonly context: string | null;
  /**
   * The live matches the statusline reads (a believed snapshot's, inside the
   * display window), the preference's first. `complete` says the scan was
   * whole and `total` is exact only then; an empty list with `complete: false`
   * is "not known". An empty list is "nothing on" ONLY beside `current: true`:
   * with `current: false` (no snapshot, a stale one, a stamp the reader does
   * not believe, a degraded one, the syncing window) it says nothing about
   * play, a match may be on (`line` is the authority: it prints
   * `live · syncing…` in the window), and a program must never read
   * `complete && items.length === 0` alone as "nothing on". A degraded
   * snapshot (the last read failed) may still carry a live record: it is
   * listed, best effort, as the line shows it, and is never current.
   */
  readonly live: BoundedList<AmbientMatch>;
  /**
   * The live list is a believed snapshot's inside its display window (its
   * stamp's age, by the reader's own rule, is finite and short of the window),
   * the snapshot is not degraded (a degraded one means the fetch failed, not
   * that the feed said nothing: it is never current, whatever it carries), and
   * the line is not syncing: then, and only then, an empty list means the
   * feed said nothing is in play.
   */
  readonly current: boolean;
  /**
   * The fixture the statusline's countdown names (its resolved pairing; the
   * preference's first), whether or not a match is in play now; `null` when
   * there is none to count down to. A fixture ahead, never one in play.
   */
  readonly next: Match | null;
  /**
   * The ambient preference as the CLI holds it: `{ code }` from
   * `CLAUDINHO_TEAM`, the saved pin (`{ id?, code, name }`) when that is
   * unset, or `null`.
   */
  readonly pick: { readonly code: string } | Pin | null;
  /**
   * Present (and `true`) when `CLAUDINHO_TEAM` is set to a value the hot path
   * cannot read offline (off the World Cup, anything but a three-letter code;
   * on it, a name its roster does not hold): `pick` is then `null`, never the
   * pin (the environment is the override).
   */
  readonly pickUnreadable?: true;
  /** The selection, as every `--json` answer carries it (core `selectionExtras`). */
  readonly competition: CompetitionKey;
  /** The snapshot says its last refresh failed (`false` with no snapshot). */
  readonly degraded: boolean;
  /** The provider the snapshot was read from, whatever its stamp; `null` with no snapshot. */
  readonly source: string | null;
  /**
   * When the snapshot was written (ISO 8601, re-emitted canonically), or
   * `null` with no snapshot or a stamp the reader does not believe (further in
   * the future than its clock-skew allowance: its live scores are not shown).
   */
  readonly updatedAt: string | null;
  /**
   * When the snapshot's live scores stop being shown (`updatedAt` plus the
   * statusline's display window), or `null` whenever `updatedAt` is.
   */
  readonly staleAfter: string | null;
  /** The non-affiliation sentence, core's `DISCLAIMER`. */
  readonly disclaimer: string;
}
