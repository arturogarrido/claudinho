/**
 * Shared filesystem helpers for the CLI: the single home for the claudinho
 * cache directory (previously duplicated across cache/marketCache/starNudge),
 * an atomic write for files a reader may observe mid-write (cache snapshots,
 * ~/.claude settings) — tmp + rename on the same filesystem, so a crash can
 * abandon a .tmp but never leave a truncated target — and a bounded read for a
 * small file the hot path reads.
 */
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
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

/**
 * Open flags for a bounded read: read-only, and NON-BLOCKING where the platform
 * has the flag. Opening a pipe that has no writer blocks for ever without it;
 * Windows has no `O_NONBLOCK` (and no pipe can sit in a directory there).
 */
const READ_FLAGS = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0);

/**
 * The contents of a small regular file, read through ONE descriptor and never
 * more than `maxBytes + 1` bytes of it; `undefined` when there is no such file
 * (absent, not a regular file, larger than `maxBytes`, grown since it was
 * checked, unreadable). Never throws, never waits.
 *
 * A check by path followed by a read by path is two looks at what may be two
 * files: between them the path can become a pipe (the read then blocks the
 * statusline for ever) or a file far larger than the check allowed (read
 * whole). Here the check and the read are of the same open file, and the read
 * stops one byte past the size the check saw (at most the bound): a file that
 * grew in place after it was checked is being written by someone who does not
 * replace it atomically, and is not read further.
 */
export function readSmallFile(path: string, maxBytes: number): Buffer | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(path, READ_FLAGS);
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > maxBytes) return undefined;
    const buf = Buffer.alloc(info.size + 1);
    let total = 0;
    while (total < buf.length) {
      const n = readSync(fd, buf, total, buf.length - total, null);
      if (n === 0) break;
      total += n;
    }
    return total > info.size ? undefined : buf.subarray(0, total);
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* nothing more to do with it */
      }
    }
  }
}

export interface AtomicWriteOptions {
  /**
   * Mode for a file that does not exist yet (subject to the umask). An existing
   * file always keeps its own mode. Settings writers pass 0o600; cache writers
   * take the default.
   */
  mode?: number;
  /**
   * Write THROUGH a symlinked target: the real file changes and the link stays.
   * For a user's settings file, where a dotfiles link is deliberate. OFF by
   * default: a cache file that turns out to be a link is REPLACED, never
   * followed, so a planted link in the cache directory cannot point a cache
   * write at a file outside it (review P2 on #127). In follow mode a dangling
   * link is refused (thrown), never silently replaced.
   */
  followSymlinks?: boolean;
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
  let entry: ReturnType<typeof lstatSync> | undefined;
  try {
    entry = lstatSync(path);
  } catch {
    entry = undefined; // nothing there yet: a new file at `path`
  }
  if (entry?.isSymbolicLink()) {
    if (opts.followSymlinks) {
      // realpathSync throws (ENOENT) for a dangling link: an existing link whose
      // target is gone is not "absent" — refuse rather than replace it.
      target = realpathSync(path);
      existingMode = statSync(target).mode & 0o777;
    }
    // Not following: the rename replaces the link itself; nothing to preserve.
  } else if (entry) {
    existingMode = entry.mode & 0o777;
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
