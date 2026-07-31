/**
 * Feed-string sanitizer — the chokepoint between untrusted provider data and
 * every output surface (terminal, statusline, share cards, and the Claude Code
 * hook, whose stdout lands in the model's context). Strips control characters
 * (C0 incl. ESC, DEL, C1) so a compromised feed can't inject ANSI escapes or
 * multi-line text, and caps length so one field can't flood a surface.
 *
 * Applied at the ESPN adapter boundary (toTeam / mapEspnEvent) and mirrored on
 * the statusline's cache reads (defense against a poisoned cache file).
 */
import type { MarketOutcome, MarketSignal } from './markets/types';
import type { Match, Team } from './types';

/** Default per-field cap — generous for any real team/venue name. */
export const FEED_TEXT_MAX = 100;

/**
 * Strip C0/C1 control characters (including ESC) and cap at `max` code points.
 * Whitespace controls (tab/newline/CR) become a single space so words a hostile
 * feed split across lines don't fuse together. Total: never throws.
 */
export function sanitizeFeedText(value: string, max = FEED_TEXT_MAX): string {
  let out = '';
  let count = 0;
  for (const ch of String(value)) {
    const cp = ch.codePointAt(0) ?? 0;
    const isWhitespaceControl = cp === 0x09 || cp === 0x0a || cp === 0x0d;
    if ((cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) && !isWhitespaceControl) continue;
    if (count >= max) break;
    out += isWhitespaceControl ? ' ' : ch;
    count++;
  }
  return out;
}

/** Sanitized copy of a team's display strings. Tolerates malformed input. */
function sanitizeTeam(t: Team | undefined): Team {
  return {
    ...(t ?? {}),
    code: sanitizeFeedText(t?.code ?? ''),
    name: sanitizeFeedText(t?.name ?? ''),
    flag: sanitizeFeedText(t?.flag ?? ''),
  };
}

/** A finite NUMBER, else undefined — a poisoned cache can hold strings here. */
function finiteOrUndefined(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * A valid numeric score pair, else undefined. Renderers interpolate these into
 * template strings (`scoreline`, the statusline minute), so a string smuggled
 * into a numeric slot ("1\nFAKE") would otherwise print verbatim.
 */
function sanitizeScorePair(v: { home?: unknown; away?: unknown } | undefined) {
  const home = finiteOrUndefined(v?.home);
  const away = finiteOrUndefined(v?.away);
  return home !== undefined && away !== undefined ? { home, away } : undefined;
}

/**
 * Sanitized, display-safe copy of a Match. Used on cache reads (the
 * statusline/hook render straight from the cache file), so it must be total:
 * a malformed entry yields empty strings, never a throw. Beyond the string
 * fields, the RENDERED numeric fields (score, shootout, minute) are dropped
 * unless they are real finite numbers — poisoned values degrade to "vs" /
 * "LIVE", never to injected text. Shootout never survives without its score
 * (the adapter-level invariant, re-enforced here).
 */
export function sanitizeMatchStrings(m: Match): Match {
  const score = sanitizeScorePair(m.score);
  return {
    ...m,
    venue: sanitizeFeedText(m.venue ?? ''),
    city: m.city == null ? m.city : sanitizeFeedText(m.city),
    country: m.country == null ? m.country : sanitizeFeedText(m.country),
    home: sanitizeTeam(m.home),
    away: sanitizeTeam(m.away),
    score,
    shootout: score ? sanitizeScorePair(m.shootout) : undefined,
    minute: finiteOrUndefined(m.minute),
  };
}

/** Outcome kinds we will render; anything else is a poisoned/unknown entry. */
const OUTCOME_KINDS = new Set(['home', 'draw', 'away', 'other']);

/** A probability we are willing to render: a real number within [0,1]. */
function saneProbability(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
}

function sanitizeOutcome(o: MarketOutcome): MarketOutcome | undefined {
  if (!o || typeof o !== 'object') return undefined;
  if (!OUTCOME_KINDS.has(o.kind) || !saneProbability(o.probability)) return undefined;
  return {
    ...o,
    label: sanitizeFeedText(o.label ?? ''),
    teamCode: o.teamCode == null ? o.teamCode : sanitizeFeedText(o.teamCode),
  };
}

/**
 * Sanitized, display-safe copy of a MarketSignal — the market sibling of
 * {@link sanitizeMatchStrings}, applied when signals are restored from the local
 * market cache (`marketCache.ts`).
 *
 * Why it exists: the cache is a JSON file on disk, so its contents are
 * attacker-writable in a way the `MarketSignal` type does not capture. The
 * formatters interpolate several of these fields directly — `marketSourceLabel`
 * falls through to `source` verbatim for an unrecognized provider — so a crafted
 * entry could otherwise inject ANSI escapes or extra lines into the terminal, a
 * share card, or the hook's context.
 *
 * Like the match sanitizer this validates by RUNTIME TYPE, not just the
 * string-typed fields: a non-finite or out-of-range probability, an unknown
 * outcome kind, a non-finite liquidity/volume, or an unparseable timestamp drops
 * that piece rather than rendering it. The reliability booleans are coerced so a
 * truthy-but-not-boolean value can't slip a stale/ambiguous market past a gate.
 * Total: never throws.
 */
export function sanitizeMarketSignal(s: MarketSignal): MarketSignal {
  const outcomes = Array.isArray(s.outcomes)
    ? s.outcomes.map(sanitizeOutcome).filter((o): o is MarketOutcome => !!o)
    : [];
  const favorite =
    s.favorite && OUTCOME_KINDS.has(s.favorite.kind) && saneProbability(s.favorite.probability)
      ? {
          ...s.favorite,
          teamCode:
            s.favorite.teamCode == null
              ? s.favorite.teamCode
              : sanitizeFeedText(s.favorite.teamCode),
        }
      : undefined;
  return {
    ...s,
    matchId: sanitizeFeedText(s.matchId ?? ''),
    source: sanitizeFeedText(s.source ?? ''),
    sourceMarketId:
      s.sourceMarketId == null ? s.sourceMarketId : sanitizeFeedText(s.sourceMarketId),
    asOf: Number.isFinite(Date.parse(s.asOf)) ? s.asOf : '',
    fetchedAt: Number.isFinite(Date.parse(s.fetchedAt)) ? s.fetchedAt : '',
    outcomes,
    favorite,
    liquidity: finiteOrUndefined(s.liquidity),
    volume24h: finiteOrUndefined(s.volume24h),
    stale: !!s.stale,
    ambiguous: !!s.ambiguous,
  };
}
