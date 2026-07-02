/**
 * Shared filesystem helpers for the CLI: the single home for the claudinho
 * cache directory (previously duplicated across cache/marketCache/starNudge)
 * and an atomic write for files a reader may observe mid-write (cache
 * snapshots, ~/.claude settings). tmp + rename on the same filesystem — a
 * crash can abandon a .tmp but never leave a truncated target.
 */
import { closeSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * `$XDG_CACHE_HOME/claudinho`, falling back to `~/.cache/claudinho`.
 *
 * Windows deliberately gets the same `~/.cache` fallback (not %LOCALAPPDATA%):
 * switching would relocate existing installs' caches mid-tournament. Revisit
 * once the Windows CI leg is established (with a read-old-location fallback).
 */
export function cacheDir(): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(base, 'claudinho');
}

/** Atomically write `data` to `path` (utf8), creating parent dirs as needed. */
export function writeFileAtomic(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, data);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path); // atomic on the same filesystem
}
