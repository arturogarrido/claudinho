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
 *   - it REPLACES the body ({@link verdictNotice}). The one sentence stands
 *     instead of the answer, which does not exist. Five of them, and when a
 *     result states more than one, the first in this order is said:
 *       `unsupported`      the feature is not offered for this competition yet;
 *       `inapplicable`     the competition has no such thing (no bracket);
 *       `unknownTeam`      the competition's whole roster was read and holds
 *                          no team by that name (`query` names it);
 *       `rosterIncomplete` the roster could not be read whole, and the name
 *                          was not one that could be answered without it
 *                          (`query` names it); not an outage;
 *       `betweenEditions`  the read's edition ended before the day asked, and
 *                          nothing in it is scheduled or in play.
 *   - it QUALIFIES the body ({@link verdictQualifiers}: `incomplete`,
 *     `partial`). The answer holds what could be read and is printed; the
 *     sentences go beside it, on a populated body and an empty one alike.
 * When a result states a replacement, its qualifiers are not printed: the one
 * sentence stands for the whole answer. The structured keys
 * ({@link verdictExtras}) carry every verdict stated, whichever it is.
 *
 * NOT verdicts: an answer's own empty sentences ("no fixture for X within the
 * next 14 days", "not found between A and B"). They are the body's text, from
 * the card builders, with their span as a plain field (`horizon`, `window`);
 * they never suppress a qualifier, and a verdict replaces them.
 */
import { t } from './i18n';

/** The edition a read's season says has ended (see `betweenEditions`). */
export interface BetweenEditions {
  /**
   * The provider's calendar day (`YYYY-MM-DD`) of the season's STATED end:
   * the day the rule decides on, printed as it is. An administrative date the
   * provider states for its season, not the day of the last match.
   */
  readonly ended: string;
  /** The season's label (e.g. "2026 Concacaf Champions Cup"); absent when the provider gave none. */
  readonly label?: string;
}

/** Any result that may state a verdict. Results state more than this; these are the verdicts. */
export interface VerdictSource {
  /** The feature does not exist for this competition yet (off the bundled schedule). */
  readonly unsupported?: boolean;
  /**
   * The competition has no such thing at all (a league season with no knockout
   * tie of its own has no bracket). Not "not yet": a capability that does not
   * apply.
   */
  readonly inapplicable?: boolean;
  /**
   * The competition's roster was read WHOLE and holds no team by the name
   * asked for. Never stated from a roster that is not whole (a refused row, a
   * missing table, a row with no id): that is not knowing, not "no such team".
   */
  readonly unknownTeam?: boolean;
  /**
   * The competition's roster was asked for and could not be read whole (a
   * table missing or partial, a row with no id, no answer), and the name could
   * not be answered without it: no club matched, or only by a code or a fuzzy
   * name the unread rest may share. Not "no such team", and not an outage.
   */
  readonly rosterIncomplete?: boolean;
  /**
   * The name a team-scoped verdict names (`unknownTeam`, `rosterIncomplete`):
   * the query as the reader typed it, bounded as a label. Not a verdict.
   */
  readonly query?: string;
  /**
   * The read's edition ended before the day asked and nothing in it is
   * scheduled or in play (see `live.ts`, `betweenEditionsOf`).
   */
  readonly betweenEditions?: BetweenEditions;
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
  inapplicable?: true;
  unknownTeam?: true;
  rosterIncomplete?: true;
  betweenEditions?: { ended: string; label?: string };
  incomplete?: true;
  /** `omitted` present only when the count is known (a positive integer). */
  partial?: { omitted?: number };
}

/**
 * The `betweenEditions` a result states: an object with an `ended` that is a
 * calendar day (`YYYY-MM-DD`, the provider's end day) or a timestamp (whose
 * date is taken), and a label only when it is a non-empty string. The
 * sentence prints its `YYYY-MM-DD` as it is. Anything else states nothing.
 */
function statedEdition(result: VerdictSource): { ended: string; label?: string } | undefined {
  const b = result.betweenEditions;
  if (!b || typeof b !== 'object' || typeof b.ended !== 'string') return undefined;
  if (!/^\d{4}-\d{2}-\d{2}/.test(b.ended) || Number.isNaN(Date.parse(b.ended))) return undefined;
  return typeof b.label === 'string' && b.label !== '' ? { ended: b.ended, label: b.label } : { ended: b.ended };
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
  if (result.inapplicable === true) out.inapplicable = true;
  if (result.unknownTeam === true) out.unknownTeam = true;
  if (result.rosterIncomplete === true) out.rosterIncomplete = true;
  const between = statedEdition(result);
  if (between) out.betweenEditions = between;
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
  if (result.inapplicable === true) return t(lang, 'competition.noBracket');
  if (result.unknownTeam === true) {
    // The name as asked; a result that does not say it still gets a sentence.
    const team = typeof result.query === 'string' ? result.query : '';
    return t(lang, 'team.unknown', { team }).replace(/\s{2,}/g, ' ');
  }
  if (result.rosterIncomplete === true) {
    const team = typeof result.query === 'string' ? result.query : '';
    return t(lang, 'roster.incomplete', { team }).replace(/\s{2,}/g, ' ');
  }
  const between = statedEdition(result);
  if (between) {
    // The label names the edition; without one, the year it ended does.
    return t(lang, 'edition.between', {
      label: between.label || between.ended.slice(0, 4),
      date: between.ended.slice(0, 10),
    });
  }
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
