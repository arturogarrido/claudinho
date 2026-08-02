/**
 * The single place a `MarketSignal` is sealed — live or from the cache file.
 *
 * Same PATH story as trust/match.ts: a signal reaches a renderer either straight
 * from the provider or read back from `~/.cache/claudinho`, and the two had
 * separate rules. The cache path is the one an attacker can actually write to
 * without touching the network, and it is also the one that renders on a
 * latency-bound surface, so it is the path that most needs the strict reading.
 *
 * Two fields are DERIVED here rather than read, and that is the whole point:
 *
 *   `favorite` — recomputed from the sealed outcomes. Trusted independently, a
 *     crafted entry rendered "slightly favor South Africa" beside "Mexico 60%":
 *     internally inconsistent output that still passed every reliability gate.
 *   `stale`    — recomputed against the clock. A file claiming `stale: false` on
 *     a six-year-old reading otherwise rendered with no caveat, because the
 *     display gate has no staleness term of its own.
 *
 * `stale` and `ambiguous` are accepted only as real booleans and otherwise fail
 * CLOSED, so a malformed value cannot coerce its way into looking trustworthy.
 */
import { KNOWN_MARKET_SOURCES } from '../markets/format';
import { deriveFavorite, isStaleSignal } from '../markets/normalize';
import type { MarketOutcome, MarketSignal } from '../markets/types';
import { takeBounded } from './bounded';
import { type ParseResult, ambiguous, malformed, valid } from './result';
import { canonicalTimestamp, humanLabel, member, opaqueId, probability, quantity } from './roles';

/** Legs read from one signal. A 1X2 market has three. */
export const MAX_OUTCOMES = 128;
/** A match id, in the grammar the ESPN boundary emits. */
const MATCH_ID = /^[0-9]{1,20}$/;
/** A source market id we are willing to echo into an agent's context. */
const MARKET_ID = /^(?:[0-9]{1,32}|fifwc-[a-z]{2,3}-[a-z]{2,3}-\d{4}-\d{2}-\d{2})$/;

const OUTCOME_KINDS = new Set(['home', 'draw', 'away', 'other']);
const TEAM_CODE_COLUMNS = 8;

function sealOutcome(raw: unknown): MarketOutcome | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const kind = member<MarketOutcome['kind']>(o.kind, OUTCOME_KINDS);
  const p = probability(o.probability);
  if (!kind || p === undefined) return undefined;
  // Declared field order — this is serialized into `--json` and MCP output.
  const out = { kind } as MarketOutcome;
  // A PRESENT-but-wrong-typed teamCode REJECTS the outcome rather than being
  // dropped. `mapsCleanly` only compares the code when one is present, so
  // dropping the field SKIPPED the fixture-identity check — making a wrong-TYPED
  // code strictly more successful than a wrong-VALUED one.
  if (o.teamCode !== undefined) {
    if (typeof o.teamCode !== 'string') return undefined;
    out.teamCode = humanLabel(o.teamCode, TEAM_CODE_COLUMNS);
  }
  out.label = humanLabel(o.label);
  out.probability = p;
  // A RESULT leg must name its team. Only draw/other legitimately has no code,
  // and without one the leg cannot be bound to a fixture — which is how a signal
  // with the codes stripped and the labels swapped stayed internally consistent
  // while `--json` printed the away team under the home leg.
  if ((out.kind === 'home' || out.kind === 'away') && !out.teamCode) return undefined;
  return out;
}

/**
 * A second `home` leg is a CONTRADICTION, not extra data.
 *
 * Silently keeping the first was the last live/cache asymmetry: the live
 * provider refuses a payload whose legs collapse (`pickMarket` demands exactly
 * one), while the cache path deduped quietly and returned a confident
 * `ambiguous: false` signal built from whichever leg happened to come first.
 * Which one is right is not a question the payload answers, so it is not a
 * question this function answers either.
 */
function hasDuplicateKind(outcomes: readonly MarketOutcome[]): boolean {
  const seen = new Set<string>();
  for (const o of outcomes) {
    if (o.kind === 'other') continue;
    if (seen.has(o.kind)) return true;
    seen.add(o.kind);
  }
  return false;
}

/**
 * Validate a market signal, or say why not.
 *
 * `matchId` drops the whole signal: it is the key everything else is bound to,
 * and a signal that cannot name its fixture cannot be checked against one.
 */
export function sealMarketSignal(
  raw: unknown,
  options: { now?: Date; maxAgeMs?: number } = {},
): ParseResult<MarketSignal> {
  if (!raw || typeof raw !== 'object') return malformed('signal is not an object');
  const s = raw as Record<string, unknown>;

  const matchId = opaqueId(s.matchId, MATCH_ID);
  if (!matchId) return malformed('signal names no fixture');

  // SLICE BEFORE MAP, as everywhere: 100k legs cost ~600ms before being
  // discarded anyway.
  const outcomes = takeBounded<unknown>(s.outcomes, MAX_OUTCOMES)
    .map(sealOutcome)
    .filter((o): o is MarketOutcome => !!o);
  if (hasDuplicateKind(outcomes)) {
    return ambiguous('two outcomes claim the same result');
  }

  const sourceMarketId = opaqueId(s.sourceMarketId, MARKET_ID);
  const liquidity = quantity(s.liquidity);
  const volume24h = quantity(s.volume24h);

  // Declared field order — see trust/match.ts: key order IS output here.
  const out = {
    matchId,
    // Allow-listed, not merely stripped: this lands in the provider-attribution
    // slot, where `marketSourceLabel` falls through to the raw string for an
    // unrecognized provider — attacker prose where the reader expects
    // "Polymarket".
    source: member<string>(s.source, new Set(KNOWN_MARKET_SOURCES)) ?? '',
  } as MarketSignal;
  if (sourceMarketId) out.sourceMarketId = sourceMarketId;
  out.asOf = canonicalTimestamp(s.asOf) ?? '';
  out.fetchedAt = canonicalTimestamp(s.fetchedAt) ?? '';
  out.outcomes = outcomes;
  // Fail closed: only an explicit `false` reads as "not stale/ambiguous".
  const isAmbiguous = s.ambiguous !== false;
  // Recomputed, never read — keeps the headline consistent with the numbers.
  // Suppressed entirely when the signal does not map cleanly onto its fixture:
  // a confident favourite on an unmappable signal is the confidently-wrong
  // display this project refuses, and it is what the live builder already does.
  const favorite = isAmbiguous ? undefined : deriveFavorite(outcomes);
  if (favorite) out.favorite = favorite;
  if (liquidity !== undefined) out.liquidity = liquidity;
  if (volume24h !== undefined) out.volume24h = volume24h;
  out.stale = s.stale !== false;
  // A signal we cannot ATTRIBUTE is not a signal we may show. `source` is
  // allow-listed, so an unknown provider becomes '' — and an empty attribution
  // slot beside real-looking percentages is precisely the confidently-wrong
  // display the Hard Constraints forbid ("attribute data providers"). It read
  // as RELIABLE before this, because no display gate had a source term.
  out.ambiguous = isAmbiguous || out.source === '';
  // Derived against the clock, for the same reason `favorite` is derived from
  // the outcomes. An unusable `asOf` parses to NaN and reads as stale.
  out.stale = out.stale || isStaleSignal(out, { now: options.now, maxAgeMs: options.maxAgeMs });
  return valid(out);
}

/** A signal read back from our own cache file — same seal as the live one. */
export function parseCachedMarketSignal(
  raw: unknown,
  options: { now?: Date; maxAgeMs?: number } = {},
): ParseResult<MarketSignal> {
  return sealMarketSignal(raw, options);
}
