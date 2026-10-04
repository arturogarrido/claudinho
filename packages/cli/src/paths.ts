/**
 * Shared filesystem helpers for the CLI: the single home for the claudinho
 * cache directory (previously duplicated across cache/marketCache/starNudge),
 * and an atomic write for files a reader may observe mid-write (cache
 * snapshots, ~/.claude settings, the user's config file) — tmp + rename on the
 * same filesystem, so a crash can abandon a .tmp but never leave a truncated
 * target. The one bounded, non-blocking read for every file the CLI keeps (the
 * snapshot, the throttle note, the attempt record, the refresh lock, the market
 * cache, the run counter, the config file) is core's (`files.ts`), re-exported
 * here for the CLI's own callers: the MCP server reads the config file through
 * it too.
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
import { dirname } from 'node:path';
import { cacheDirFor } from '@claudinho/core';

export { lookAtSmallFile, readSmallFile, type SmallFile } from '@claudinho/core';

/**
 * `$XDG_CACHE_HOME/claudinho`, else on Windows `%LOCALAPPDATA%\claudinho`,
 * else `~/.cache/claudinho` (core `cacheDirFor`, the same rule as the config
 * file's path). A Windows install that used `~/.cache` moves once: it is a
 * cache (one cold refresh refills it), and the throttle note lives beside the
 * snapshot, so it moves with it.
 */
export function cacheDir(): string {
  return cacheDirFor(process.env, process.platform, homedir());
}

export interface AtomicWriteOptions {
  /**
   * Mode for a file that does not exist yet (subject to the umask). An existing
   * file keeps its own mode, unless `enforceMode` is set. Settings writers pass
   * 0o600; cache writers take the default.
   */
  mode?: number;
  /**
   * Make `mode` the file's EXACT mode on every successful write: set on the
   * temporary file's descriptor before its bytes are written (so the umask
   * cannot widen it, and the bytes are never readable under a wider mode),
   * and the existing file's mode is NOT restored over it (an existing 0644
   * file becomes 0600). For the user's config file. Off by default: the
   * editors' settings keep their mode-preserving write.
   */
  enforceMode?: boolean;
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
 * 0644 under umask 022), a new file takes `opts.mode` (and with
 * `opts.enforceMode`, every file does, an existing one included), the temp is exclusive
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
  const enforced = opts.enforceMode === true && opts.mode !== undefined ? opts.mode : undefined;
  const tmp = `${target}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  const fd = openSync(tmp, 'wx', enforced ?? existingMode ?? opts.mode ?? 0o666);
  try {
    // The open mode is masked by the umask; the exact bits are set on the
    // descriptor, BEFORE the bytes: the enforced mode when there is one (the
    // existing file's is then not restored), else the existing file's, so
    // preservation does not depend on the umask.
    if (enforced !== undefined) fchmodSync(fd, enforced);
    else if (existingMode !== undefined) fchmodSync(fd, existingMode);
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
