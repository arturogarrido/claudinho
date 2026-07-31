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
import { deriveFavorite } from './markets/normalize';
import type { MarketOutcome, MarketSignal } from './markets/types';
import type { Match, MatchEvent, Team } from './types';

/** Default per-field cap — generous for any real team/venue name. */
export const FEED_TEXT_MAX = 100;

/**
 * Strip C0/C1 control characters (including ESC) and cap at `max` code points.
 * Whitespace controls (tab/newline/CR) become a single space so words a hostile
 * feed split across lines don't fuse together. Total: never throws.
 */
export function sanitizeFeedText(value: string, max = FEED_TEXT_MAX): string {
  // `String(value)` is NOT total: JSON can hold `{"toString": null}`, and
  // coercing that throws "Cannot convert object to primitive value". Since every
  // caller here is handling deserialized, attacker-influenced data, anything that
  // is not already a string is treated as absent rather than coerced.
  if (typeof value !== 'string') return '';
  let out = '';
  let count = 0;
  for (const ch of value) {
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
  // Allowlisted, NOT spread: a cache file can carry arbitrary extra keys, and a
  // spread would round-trip them into `--json` / MCP structured content.
  return {
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

/** Event types we will render; anything else is a poisoned/unknown entry. */
const EVENT_TYPES = new Set(['GOAL', 'OWN_GOAL', 'PEN', 'YELLOW', 'RED', 'SUB']);

/**
 * Sanitized match event, or undefined when malformed.
 *
 * `cmdMatch` interpolates EVERY field of these into one template literal
 * (`${e.minute}'  ${e.type}  ${e.teamCode} — ${e.player}`), so this needs the
 * same by-runtime-type treatment as the score fields: `minute` is declared a
 * number but a cache file can hold a string there.
 */
function sanitizeEvent(e: MatchEvent): MatchEvent | undefined {
  if (!e || typeof e !== 'object') return undefined;
  if (!EVENT_TYPES.has(e.type)) return undefined;
  const minute = finiteOrUndefined(e.minute);
  if (minute === undefined) return undefined;
  const out: MatchEvent = {
    type: e.type,
    minute,
    teamCode: sanitizeFeedText(e.teamCode ?? ''),
  };
  if (typeof e.player === 'string') out.player = sanitizeFeedText(e.player);
  return out;
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
  const score = sanitizeScorePair(m?.score);
  // Allowlisted like sanitizeMarketSignal — a spread let arbitrary keys from a
  // poisoned cache file (`instruction: "..."`) survive into `--json` and MCP
  // structured content, i.e. an agent's context. Only known fields are rebuilt.
  const out: Match = {
    id: sanitizeFeedText(m?.id ?? ''),
    stage: m?.stage,
    kickoff: typeof m?.kickoff === 'string' ? m.kickoff : '',
    venue: sanitizeFeedText(m?.venue ?? ''),
    home: sanitizeTeam(m?.home),
    away: sanitizeTeam(m?.away),
    status: m?.status,
    updatedAt: canonicalTimestamp(m?.updatedAt),
  };
  if (m?.group != null) out.group = sanitizeFeedText(m.group);
  if (m?.city != null) out.city = sanitizeFeedText(m.city);
  if (m?.country != null) out.country = sanitizeFeedText(m.country);
  if (score) out.score = score;
  // Shootout never survives without its score (the adapter-level invariant).
  const shootout = score ? sanitizeScorePair(m?.shootout) : undefined;
  if (shootout) out.shootout = shootout;
  const minute = finiteOrUndefined(m?.minute);
  if (minute !== undefined) out.minute = minute;
  if (m?.winnerCode != null) out.winnerCode = sanitizeFeedText(m.winnerCode);
  if (Array.isArray(m?.events)) {
    const events = m.events.map(sanitizeEvent).filter((e): e is MatchEvent => !!e);
    if (events.length) out.events = events;
  }
  return out;
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
  // Built explicitly, NOT spread: a spread would carry arbitrary extra keys from
  // the JSON straight into `--json` and MCP structured content.
  const out: MarketOutcome = {
    kind: o.kind,
    label: sanitizeFeedText(o.label),
    probability: o.probability,
  };
  if (typeof o.teamCode === 'string') out.teamCode = sanitizeFeedText(o.teamCode);
  return out;
}

/**
 * A timestamp we are willing to echo, RE-EMITTED in canonical ISO form.
 *
 * Validating-and-passing-through is not enough: `Date.parse` accepts plenty of
 * strings that carry a payload (an RFC 2822 date may hold an arbitrarily long
 * `(comment)`), and those were reaching MCP/JSON verbatim. Re-emitting from the
 * parsed epoch means only a canonical `YYYY-MM-DDTHH:mm:ss.sssZ` can ever leave
 * this function, whatever the input looked like.
 */
export function canonicalTimestamp(v: unknown): string {
  if (typeof v !== 'string') return '';
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : '';
}

/**
 * Drop the whole outcome set if any 1X2 kind repeats.
 *
 * A duplicate is never legitimate — the market is one home/draw/away line — and
 * it is invisible in the rendered list while still counting toward the derived
 * favorite. A crafted file rendered "slightly favor Mexico" above
 * "Mexico 10% · Draw 15% · South Africa 20%", the hidden second `home` entry
 * supplying the missing 55%. Rejecting (rather than de-duplicating) is the
 * fail-closed choice: we cannot know which copy was meant.
 */
function dedupeKinds(outcomes: MarketOutcome[]): MarketOutcome[] {
  const seen = new Set<string>();
  for (const o of outcomes) {
    if (o.kind === 'other') continue; // 'other' legitimately repeats
    if (seen.has(o.kind)) return [];
    seen.add(o.kind);
  }
  return outcomes;
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
 * Three properties this has to hold, each learned from a real defect:
 *
 * 1. **Allowlist, don't spread.** The result is built field by field. A spread
 *    (`{...s}`) preserves arbitrary extra keys from the JSON — an injected
 *    `instruction: "ignore previous instructions"` would ride through into
 *    `--json` and MCP structured content, i.e. into an agent's context.
 * 2. **Validate by RUNTIME TYPE, not the declared one.** A non-finite or
 *    out-of-range probability, an unknown outcome kind, a non-string timestamp
 *    (a parseable array or number is still the wrong type), or a non-finite
 *    liquidity/volume drops that piece instead of being echoed.
 * 3. **Derive what can be derived; never trust it.** `favorite` is RECOMPUTED
 *    from the sanitized outcomes via {@link deriveFavorite} rather than taken
 *    from the file. Trusting it independently let a crafted entry render
 *    "slightly favor South Africa" beside "Mexico 60%" — internally inconsistent
 *    output that still passed every reliability gate, which is exactly the
 *    confidently-wrong display this project refuses.
 *
 * `stale`/`ambiguous` are accepted only as real booleans and otherwise fail
 * CLOSED (unknown ⇒ stale/ambiguous ⇒ gated out), so a malformed value can't
 * coerce its way into looking trustworthy. Total: never throws.
 */
export function sanitizeMarketSignal(s: MarketSignal): MarketSignal {
  const outcomes = dedupeKinds(
    Array.isArray(s?.outcomes)
      ? s.outcomes.map(sanitizeOutcome).filter((o): o is MarketOutcome => !!o)
      : [],
  );
  const out: MarketSignal = {
    matchId: sanitizeFeedText(s?.matchId),
    source: sanitizeFeedText(s?.source),
    asOf: canonicalTimestamp(s?.asOf),
    fetchedAt: canonicalTimestamp(s?.fetchedAt),
    outcomes,
    // Recomputed, not trusted — keeps the headline consistent with the numbers.
    favorite: deriveFavorite(outcomes),
    // Fail closed: only an explicit `false` is treated as "not stale/ambiguous".
    stale: s?.stale !== false,
    ambiguous: s?.ambiguous !== false,
  };
  if (typeof s?.sourceMarketId === 'string') {
    out.sourceMarketId = sanitizeFeedText(s.sourceMarketId);
  }
  const liquidity = finiteOrUndefined(s?.liquidity);
  if (liquidity !== undefined) out.liquidity = liquidity;
  const volume24h = finiteOrUndefined(s?.volume24h);
  if (volume24h !== undefined) out.volume24h = volume24h;
  return out;
}
