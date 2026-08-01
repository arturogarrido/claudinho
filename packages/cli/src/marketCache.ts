/**
 * Cold-path market-signal cache — SEPARATE from the statusline cache and NEVER
 * read on the hot path (statusline/hook). A read-through cache around the
 * Polymarket adapter so repeated cold commands (`today`, `match`, `markets`)
 * don't re-hit the data source within a short TTL.
 *
 * It caches BOTH positive signals and negatives ("checked, no market") so that,
 * with auto-derivation, the many fixtures without a Polymarket market aren't
 * re-fetched every call. Negatives expire sooner than positives (a market may
 * appear as kickoff approaches). Best-effort + tolerant: a corrupt/absent file
 * reads as empty, and writes never throw.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasSaneDistribution, sanitizeMarketSignal, type MarketSignal } from '@claudinho/core';
import { cacheDir, writeFileAtomic } from './paths';

const POSITIVE_TTL_MS = 10 * 60_000;
const NEGATIVE_TTL_MS = 3 * 60_000;
/**
 * A cache entry dated into the future is expired, not fresh. Without this a
 * `fetchedAt` of 2099 never aged out, suppressing the provider permanently.
 */
const FUTURE_SKEW_MS = 60_000;

interface CacheEntry {
  fetchedAt: string; // ISO 8601
  signal: MarketSignal | null; // null = checked, no signal (negative cache)
}

interface MarketCacheFile {
  source: string;
  competition: string;
  entries: Record<string, CacheEntry>;
}

function cachePath(): string {
  return join(cacheDir(), 'market-signals.json');
}

/**
 * Parse the cache file as `unknown`, never as the declared shape. It is a JSON
 * file on disk: `entries` may be absent, a non-object, or hold `null` members,
 * and a blind cast makes every later dereference a crash waiting to happen.
 */
function readFile(): { source: unknown; competition: unknown; entries: unknown } | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(cachePath(), 'utf8'));
    if (!parsed || typeof parsed !== 'object') return undefined;
    return parsed as { source: unknown; competition: unknown; entries: unknown };
  } catch {
    return undefined;
  }
}

/**
 * A cache entry we are willing to ACT ON.
 *
 * `signal` must be either an explicit `null` (a negative result: "we checked,
 * there was nothing") or a real object. Anything else — `false`, `{}` with no
 * outcomes, a string, a missing key — is a malformed envelope, and treating it
 * as a negative result would suppress the real provider fetch for the whole
 * negative TTL. Malformed entries are dropped so the next run re-fetches.
 */
function isEntryShaped(e: unknown): e is CacheEntry {
  if (!e || typeof e !== 'object') return false;
  const entry = e as CacheEntry;
  if (typeof entry.fetchedAt !== 'string' || !Number.isFinite(Date.parse(entry.fetchedAt))) {
    return false;
  }
  if (entry.signal === null) return true; // legitimate negative-cache entry
  return !!entry.signal && typeof entry.signal === 'object';
}

/**
 * Is this signal STRUCTURALLY renderable? Only then may it suppress a refetch.
 *
 * Testing three emptiness conditions was not the same question: an all-'other'
 * outcome set, an incoherent distribution, no determinable favorite and
 * `ambiguous: true` all survived sanitizing, were marked `checked`, and then
 * displayed nothing — so the cache suppressed the real provider fetch for the
 * full positive TTL while the user saw no market line at all.
 *
 * Deliberately NOT a freshness test, and not `isReliableMarketSignal`. Staleness
 * is the TTL's job, and `markets` renders a stale signal on purpose, with its
 * caveat. Folding freshness in here regressed both: a provider reading that was
 * already 40 minutes old when written became un-cacheable, so it was re-fetched
 * on *every* command forever and its stale-with-caveat rendering vanished.
 *
 * The fixture-dependent half (`marketSignalRendersFor`) needs a Match and is
 * applied by the caller.
 */
function isUsableSignal(s: MarketSignal): boolean {
  if (s.source === '' || s.asOf === '' || s.outcomes.length === 0) return false;
  if (s.outcomes.some((o) => o.kind === 'other')) return false;
  if (s.ambiguous) return false;
  if (!s.favorite) return false;
  return hasSaneDistribution(s.outcomes);
}

export interface MarketCacheRead {
  /** Fresh positive signals, keyed by matchId. */
  signals: Map<string, MarketSignal>;
  /** Ids with a fresh entry (positive OR negative) — don't re-fetch these. */
  checked: Set<string>;
}

/** Read fresh cache entries for a source+competition (positive + negative). */
export function readMarketCache(
  source: string,
  competition: string,
  now = Date.now(),
): MarketCacheRead {
  const signals = new Map<string, MarketSignal>();
  const checked = new Set<string>();
  const file = readFile();
  if (!file || file.source !== source || file.competition !== competition) {
    return { signals, checked };
  }
  const entries = file.entries;
  if (!entries || typeof entries !== 'object') return { signals, checked };
  for (const [id, raw] of Object.entries(entries as Record<string, unknown>)) {
    // Validate the ENVELOPE before touching it: a JSON `null` (or a string, or a
    // number) is a legal value here, and dereferencing it threw before this
    // guard. A malformed entry is skipped entirely — notably it must NOT reach
    // `checked`, or a junk file would suppress the real fetch for that match.
    if (!isEntryShaped(raw)) continue;
    const entry = raw;
    const t = Date.parse(entry.fetchedAt);
    const ttl = entry.signal ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
    const age = now - t;
    if (age > ttl || age < -FUTURE_SKEW_MS) continue; // expired, or dated forward
    if (entry.signal === null) {
      checked.add(id); // genuine negative result — don't re-fetch this window
      continue;
    }
    // Sanitize on READ: this file is attacker-writable in a way the MarketSignal
    // type isn't, and the formatters interpolate several of these fields straight
    // into output (marketSourceLabel falls through to `source` verbatim for an
    // unrecognized provider). Mirrors the statusline's sanitizeMatchStrings on
    // its own cache read.
    // `now` is threaded so the DERIVED staleness inside the sanitizer agrees
    // with the TTL arithmetic above instead of reading the wall clock.
    const clean = sanitizeMarketSignal(entry.signal, { now: new Date(now) });
    // The BODY must match the key it was filed under, and the provider the file
    // claims. Without this a poisoned file could park one fixture's prices under
    // another fixture's id — the entry is well-formed, just not about this match.
    if (clean.matchId !== id || clean.source !== source) continue;
    // Only a signal that survived sanitizing counts as "checked". Otherwise a
    // crafted (or simply corrupt) positive entry would suppress the real fetch
    // for the full positive TTL while displaying nothing.
    if (!isUsableSignal(clean)) continue;
    checked.add(id);
    signals.set(id, clean);
  }
  return { signals, checked };
}

/**
 * Record the outcome of a fetch attempt: every attempted id gets a positive
 * entry (its signal) or a negative one (null), so we don't immediately re-fetch
 * matches that had no market. Atomic write; best-effort.
 */
export function writeMarketCache(
  source: string,
  competition: string,
  attempted: string[],
  fetched: Map<string, MarketSignal>,
  now = Date.now(),
): void {
  if (attempted.length === 0) return;
  try {
    const existing = readFile();
    const reuse = existing && existing.source === source && existing.competition === competition;
    // Carry forward only entries that are actually well-formed. Reusing the
    // parsed object wholesale would round-trip a poisoned file's junk (null
    // members, wrong-typed envelopes) back to disk on every write.
    const carried: Record<string, CacheEntry> = {};
    if (reuse && existing.entries && typeof existing.entries === 'object') {
      for (const [id, raw] of Object.entries(existing.entries as Record<string, unknown>)) {
        if (!isEntryShaped(raw)) continue;
        // Prune on write. An expired entry is dead weight the read path skips
        // anyway, and carrying every id forward grew the file without bound.
        const age = now - Date.parse(raw.fetchedAt);
        if (age > (raw.signal ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS)) continue;
        if (age < -FUTURE_SKEW_MS) continue;
        // Don't round-trip a positive body that no longer sanitizes to anything
        // usable — it would keep suppressing refetches on every later read.
        if (
          raw.signal !== null &&
          !isUsableSignal(sanitizeMarketSignal(raw.signal, { now: new Date(now) }))
        ) {
          continue;
        }
        carried[id] = raw;
      }
    }
    const base: MarketCacheFile = { source, competition, entries: carried };
    const fetchedAt = new Date(now).toISOString();
    for (const id of attempted) {
      base.entries[id] = { fetchedAt, signal: fetched.get(id) ?? null };
    }
    writeFileAtomic(cachePath(), JSON.stringify(base));
  } catch {
    /* best-effort; never break a command */
  }
}
