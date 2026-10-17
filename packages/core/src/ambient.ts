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
 *   - a value that is no competition, or a failure anywhere: `line` (the
 *     statusline's empty line) and `empty: true` alone, no view;
 *   - a selected competition: an {@link AmbientView}.
 */
import type { CompetitionKey } from './competition';
import type { Lang, MomentWords } from './i18n';
import type { BoundedList } from './trust/bounded';
import type { Match, MatchEvent } from './types';
import type { Pin } from './userConfig';

/**
 * One part of the band's line (`lineParts`): a run of its text, `strong` for a
 * score token the fit kept whole. The parts' texts joined are the line.
 */
export interface AmbientLinePart {
  readonly text: string;
  readonly style?: 'strong';
}

/** The two names the hook's line prints for a record (a nation's roster name on the bundled competition). */
export interface AmbientNames {
  readonly home: string;
  readonly away: string;
}

/**
 * A finished match as the ambient view lists it (`finished`): the sealed
 * record (status `FT`, its final score), as a live one is serialized, with:
 */
export type AmbientFinishedMatch = Match & {
  /**
   * The side of the SAVED pin (`claudinho follow <alias> --team`, by core's
   * `isPinnedSide`), or `null`: never `CLAUDINHO_TEAM`, which only orders.
   */
  readonly pinnedSide: 'home' | 'away' | null;
  /** The names the hook's line prints for it. */
  readonly names: AmbientNames;
  /** The hook's own line for it, `(FT)` in the minute's place. */
  readonly line: string;
};

/**
 * A live match as the ambient view lists it: the sealed record, as the other
 * `--json` twins serialize a `Match` (`status`, the `score` object, `shootout`
 * after a shootout, `Team.id` where the cache holds it, a nation's generated
 * `flag`, no `flag` key on a club), with no `events` key (the ambient reader
 * never seals a timeline), and what it says about the reader's own team, the
 * names and the last goal:
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
  /** Which side is the SAVED pin's (by core's `isPinnedSide`), or `null`: never `CLAUDINHO_TEAM`'s. */
  readonly pinnedSide: 'home' | 'away' | null;
  /** The names the hook's line prints for it (a nation's roster name on the bundled competition). */
  readonly names: AmbientNames;
  /**
   * The hook's own line for this record, as `claudinho hook` prints it (the
   * names, pinned to the World Cup's roster on the bundle, each with its flag
   * where flags are on and the side has one, the scoreline with a shootout's
   * tally, the minute token: `67'`, `half-time`, `live`). A program says it,
   * never composes one.
   */
  readonly line: string;
  /**
   * The goal that made the record's score, PROVEN by the refresher (its
   * scoring events counted per side equal the score: core's
   * `provenLastGoal`), stored on the cached record and re-sealed by the
   * reader with core's `sealEvent` and kept only as a goal, an own goal or a
   * penalty whose `teamCode` is the code of the side its `side` names, a side
   * that has scored (its regulation score at least 1); `null`
   * when nothing is proven or the stored value is anything else.
   */
  readonly lastGoal: MatchEvent | null;
};

/** The ambient view of a selected competition, its keys in this order. */
export interface AmbientView {
  /**
   * The statusline's line, as `claudinho prompt` prints it (the same reader,
   * the same options), fitted to `--columns N` when given: whole matches are
   * kept while they fit and the rest counted in the `+N` (or `+more`) suffix,
   * which is never cut while the width holds it; below the suffix's own width
   * the line is the width's cut, never wider than asked. Its own tokens are in
   * `lang` (the countdown, the syncing phrase, the live segment's half-time
   * and live words); the overflow marker (`+N`, `+more`), the World Cup's
   * sign-off and nothing known (`⚽ —`) are English in every language, so
   * `idle` and `empty` say what they say in every language.
   */
  readonly line: string;
  /**
   * The line as parts, built by the fitter as it places each shown score
   * token: their texts joined are `line` exactly, a score token the fit kept
   * whole is `strong`, one it cut is not. One plain part, the line itself, on
   * the countdown, the syncing line, nothing known and the sign-off, and
   * whenever the parts would not join to the line.
   */
  readonly lineParts: readonly AmbientLinePart[];
  /**
   * The line is the one long-lived line, the edition's sign-off (the World
   * Cup's, once every bundled window has closed): nothing changes until the
   * user follows another competition, so a program reads it slowly. Said of
   * the line before any fit: a program reads the pace from this, never from the
   * text, which `--columns` may have cut.
   */
  readonly idle: boolean;
  /**
   * The line says nothing is known (`⚽ —`): no live match read, no window to
   * sync in, nothing to count down to. A program shows nothing for it. Said
   * of the line before any fit: a program reads the visibility from this,
   * never from the text.
   */
  readonly empty: boolean;
  /** The hook's block, as `claudinho hook` prints it while a match is live; `null` when it prints nothing. */
  readonly context: string | null;
  /**
   * The live matches the statusline reads (a believed snapshot's, inside the
   * display window), the preference's first. `complete` says the scan was
   * whole and `total` is exact only then; an empty list with `complete: false`
   * is "not known". An empty list is "nothing on" ONLY beside `current: true`:
   * with `current: false` (no snapshot, a stale one, a stamp the reader does
   * not believe, a degraded one, one whose read was not whole or that does
   * not say, the syncing window) it says nothing about
   * play, a match may be on (`line` is the authority: it prints
   * `live · syncing…` in the window), and a program must never read
   * `complete && items.length === 0` alone as "nothing on". A degraded
   * snapshot (the last read failed) may still carry a live record: it is
   * listed, best effort, as the line shows it, and is never current.
   */
  readonly live: BoundedList<AmbientMatch>;
  /**
   * The matches the refresher SAW in play that a whole read then returned
   * finished (the snapshot's record of play), each for 10 minutes from the
   * read that first saw it finished, judged by the reader's clock (a stamp in
   * the future is not believed), whatever the snapshot's display window (the
   * refresher stops polling once the last match ends, so the snapshot ages
   * past it while an entry is still inside its own 10 minutes); never one the
   * live list holds. Listed only from a snapshot whose live read was whole
   * (`liveComplete: true`); otherwise `[]`, which then says nothing. At most
   * 64. Absence from it never means a match is over.
   */
  readonly finished: readonly AmbientFinishedMatch[];
  /**
   * The live list is a believed snapshot's inside its display window (its
   * stamp's age, by the reader's own rule, is finite and short of the window),
   * the snapshot is not degraded (a degraded one means the fetch failed, not
   * that the feed said nothing: it is never current, whatever it carries), the
   * snapshot states that the read that filled its live slice was whole (a read
   * that was not, an unreadable record left out beside readable ones, is never
   * current; nor is a snapshot that does not say, written before 0.11.2, until
   * one refresh cycle rewrites it), and the line is not syncing: then, and
   * only then, an empty list means the feed said nothing is in play.
   */
  readonly current: boolean;
  /**
   * The fixture the statusline's countdown names (its resolved pairing; the
   * preference's first), whether or not a match is in play now; `null` when
   * there is none to count down to. A fixture ahead, or a DUE one (still
   * scheduled, its kickoff passed by at most 30 minutes, not held by the
   * snapshot's record of play: the line reads "now"); never one in play.
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
  /**
   * The CLI's resolved language (`--lang`, `CLAUDINHO_LANG`, `LANG`'s language
   * part, each only when it is one of the four, else `en`), the language of
   * `line`, `lineParts` and `words`. `context`, `attribution`, `disclaimer`
   * and each record's `line` stay English in every language.
   */
  readonly lang: Lang;
  /**
   * The plugin's moment words in `lang` (core's `moment.*` keys, `momentWords`):
   * `goalFor` and `win` templates holding `{team}` once, for the plugin to
   * fill with a record's own `names`.
   */
  readonly words: MomentWords;
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
  /**
   * The provider's attribution sentence, in English as every ambient string:
   * core's `live.data` copy with `liveSourceLabel(source)` (`Live data:
   * ESPN`), when the snapshot names a provider (`source` is a string) AND
   * the line is neither the sign-off (`idle`) nor nothing known (`empty`);
   * `null` otherwise: no snapshot, the sign-off (made from the bundled clock),
   * nothing known. `degraded` does not decide: a degraded snapshot still shows
   * a live row an earlier read served, or a countdown to a fixture discovery
   * read; nor does a read that was not whole. A limit: on the bundled
   * competition, a countdown made from the bundled skeleton (before its
   * knockout pairings resolve) would be attributed too; unreachable while that
   * edition is over.
   */
  readonly attribution: string | null;
}
