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
 * {@link verdictExtras} into whatever it serializes and prints
 * {@link verdictNotice} where it would have printed "none found". A verdict
 * added here reaches every surface that already calls these two functions;
 * `core/test/verdict.test.ts` fails if a surface goes back to forwarding one by
 * hand.
 */
import { t } from './i18n';

/** Any result that may state a verdict. Results state more than this; these are the verdicts. */
export interface VerdictSource {
  /** The feature does not exist for this competition yet (off the bundled schedule). */
  readonly unsupported?: boolean;
}

/** The structured keys of the verdicts a result states. Empty when it states none. */
export interface VerdictExtras {
  unsupported?: true;
}

/**
 * The verdict keys to spread into `--json` and MCP `data`, in a stable order.
 * Only verdicts the result actually states: a healthy result adds no key.
 */
export function verdictExtras(result: VerdictSource): VerdictExtras {
  const out: VerdictExtras = {};
  if (result.unsupported === true) out.unsupported = true;
  return out;
}

/**
 * The sentence a text surface prints for the verdict a result states, in the
 * reader's language — or undefined when it states none, and the surface says
 * what it would have said anyway ("no fixture found", "couldn't reach the
 * provider").
 */
export function verdictNotice(result: VerdictSource, lang?: string): string | undefined {
  if (result.unsupported === true) return t(lang, 'competition.unsupported');
  return undefined;
}
