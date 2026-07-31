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
import { sanitizeMarketSignal, type MarketSignal } from '@claudinho/core';
import { cacheDir, writeFileAtomic } from './paths';

const POSITIVE_TTL_MS = 10 * 60_000;
const NEGATIVE_TTL_MS = 3 * 60_000;

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
 * A sanitized signal is only USABLE if it still carries a renderable market.
 * Sanitizing fails closed (dropping bad outcomes, rejecting duplicate kinds), so
 * an entry can survive parsing yet end up empty — that is a malformed positive,
 * not a negative result, and must not suppress the refetch either.
 */
function isUsableSignal(s: MarketSignal): boolean {
  return s.outcomes.length > 0 && s.source !== '' && s.asOf !== '';
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
    if (now - t > ttl) continue; // expired
    if (entry.signal === null) {
      checked.add(id); // genuine negative result — don't re-fetch this window
      continue;
    }
    // Sanitize on READ: this file is attacker-writable in a way the MarketSignal
    // type isn't, and the formatters interpolate several of these fields straight
    // into output (marketSourceLabel falls through to `source` verbatim for an
    // unrecognized provider). Mirrors the statusline's sanitizeMatchStrings on
    // its own cache read.
    const clean = sanitizeMarketSignal(entry.signal);
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
        // Don't round-trip a positive body that no longer sanitizes to anything
        // usable — it would keep suppressing refetches on every later read.
        if (raw.signal !== null && !isUsableSignal(sanitizeMarketSignal(raw.signal))) continue;
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
