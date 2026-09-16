/**
 * Shared filesystem helpers for the CLI: the single home for the claudinho
 * cache directory (previously duplicated across cache/marketCache/starNudge)
 * and an atomic write for files a reader may observe mid-write (cache
 * snapshots, ~/.claude settings). tmp + rename on the same filesystem — a
 * crash can abandon a .tmp but never leave a truncated target.
 */
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  fchmodSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
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

export interface AtomicWriteOptions {
  /**
   * Mode for a file that does not exist yet (subject to the umask). An existing
   * file always keeps its own mode. Settings writers pass 0o600; cache writers
   * take the default.
   */
  mode?: number;
}

/**
 * Atomically write `data` to `path` (utf8), creating parent dirs as needed.
 *
 * tmp + rename protects readers from a torn file; it does NOT by itself protect
 * the file's confidentiality, so (audit A09): the existing file's mode is
 * preserved (a 0600 settings file stays 0600 — the default temp mode made it
 * 0644 under umask 022), a new file takes `opts.mode`, the temp is exclusive
 * and unpredictable, a symlinked target is written THROUGH so a dotfiles link
 * stays a link, and a failed write removes its temp.
 */
export function writeFileAtomic(path: string, data: string, opts: AtomicWriteOptions = {}): void {
  mkdirSync(dirname(path), { recursive: true });
  let target = path;
  let existingMode: number | undefined;
  try {
    const link = lstatSync(path);
    target = link.isSymbolicLink() ? realpathSync(path) : path;
    existingMode = statSync(target).mode & 0o777;
  } catch {
    // Nothing there yet (or a dangling link): a new file at `path`.
  }
  const tmp = `${target}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  const fd = openSync(tmp, 'wx', existingMode ?? opts.mode ?? 0o666);
  try {
    // The open mode is masked by the umask; the existing file's exact bits are
    // restored on the descriptor so preservation does not depend on the umask.
    if (existingMode !== undefined) fchmodSync(fd, existingMode);
    writeSync(fd, data);
  } catch (e) {
    closeSync(fd);
    rmSync(tmp, { force: true });
    throw e;
  }
  closeSync(fd);
  try {
    renameSync(tmp, target); // atomic on the same filesystem
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}
