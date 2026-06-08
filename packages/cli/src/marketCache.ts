/**
 * Cold-path market-signal cache — SEPARATE from the statusline cache and NEVER
 * read on the hot path (statusline/hook). A read-through cache around the
 * Polymarket adapter so repeated cold commands (`today`, `match`, `markets`)
 * don't re-hit the data source within a short TTL. Best-effort and tolerant: a
 * corrupt/absent file reads as empty, and writes never throw.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { MarketSignal } from '@claudinho/core';

/** Entries older than this are ignored on read (pre-match TTL guidance). */
const TTL_MS = 10 * 60_000;

interface CacheEntry {
  fetchedAt: string; // ISO 8601
  signal: MarketSignal;
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

/** Fresh cached signals for a source+competition, keyed by matchId. */
export function readMarketCache(
  source: string,
  competition: string,
  now = Date.now(),
): Map<string, MarketSignal> {
  const out = new Map<string, MarketSignal>();
  const file = readFile();
  if (!file || file.source !== source || file.competition !== competition) return out;
  for (const [id, entry] of Object.entries(file.entries ?? {})) {
    const t = Date.parse(entry.fetchedAt);
    if (Number.isFinite(t) && now - t <= TTL_MS) out.set(id, entry.signal);
  }
  return out;
}

/** Merge freshly-fetched signals into the cache (atomic write; best-effort). */
export function writeMarketCache(
  source: string,
  competition: string,
  signals: Map<string, MarketSignal>,
  now = Date.now(),
): void {
  if (signals.size === 0) return;
  try {
    const existing = readFile();
    const base: MarketCacheFile =
      existing && existing.source === source && existing.competition === competition
        ? existing
        : { source, competition, entries: {} };
    const fetchedAt = new Date(now).toISOString();
    for (const [id, signal] of signals) base.entries[id] = { fetchedAt, signal };
    mkdirSync(cacheDir(), { recursive: true });
    const tmp = join(cacheDir(), `market-signals.${process.pid}.tmp`);
    writeFileSync(tmp, JSON.stringify(base));
    renameSync(tmp, cachePath()); // atomic on the same filesystem
  } catch {
    /* cache write is best-effort; never break a command */
  }
}
