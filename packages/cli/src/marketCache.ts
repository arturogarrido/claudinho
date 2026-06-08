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
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { MarketSignal } from '@claudinho/core';

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

function cacheDir(): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(base, 'claudinho');
}

function cachePath(): string {
  return join(cacheDir(), 'market-signals.json');
}

function readFile(): MarketCacheFile | undefined {
  try {
    return JSON.parse(readFileSync(cachePath(), 'utf8')) as MarketCacheFile;
  } catch {
    return undefined;
  }
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
  for (const [id, entry] of Object.entries(file.entries ?? {})) {
    const t = Date.parse(entry.fetchedAt);
    if (!Number.isFinite(t)) continue;
    const ttl = entry.signal ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
    if (now - t > ttl) continue; // expired
    checked.add(id);
    if (entry.signal) signals.set(id, entry.signal);
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
    const base: MarketCacheFile =
      existing && existing.source === source && existing.competition === competition
        ? existing
        : { source, competition, entries: {} };
    const fetchedAt = new Date(now).toISOString();
    for (const id of attempted) {
      base.entries[id] = { fetchedAt, signal: fetched.get(id) ?? null };
    }
    mkdirSync(cacheDir(), { recursive: true });
    const tmp = join(cacheDir(), `market-signals.${process.pid}.tmp`);
    writeFileSync(tmp, JSON.stringify(base));
    renameSync(tmp, cachePath()); // atomic on the same filesystem
  } catch {
    /* best-effort; never break a command */
  }
}
