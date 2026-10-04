/**
 * The one bounded, non-blocking read for every small file Claudinho keeps on
 * the user's disk: the CLI's cache files (the snapshot, the throttle note, the
 * refresh lock, the market cache, the run counter) and the user's config file,
 * which the CLI and the MCP server both read (`userConfig.ts`). It lives in
 * core so both packages read the same file the same way; the CLI re-exports it
 * from `paths.ts` for its own callers.
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';

/**
 * Open flags for a bounded read: read-only, and NON-BLOCKING where the platform
 * has the flag. Opening a pipe that has no writer blocks for ever without it;
 * Windows has no `O_NONBLOCK` (and no pipe can sit in a directory there).
 */
const READ_FLAGS = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0);

/**
 * The same, refusing to open THROUGH a symbolic link at the last component,
 * where the platform has `O_NOFOLLOW` (POSIX). Windows has none: there a
 * no-follow read looks at the entry first (see {@link lookAtOwnFile}).
 */
const NO_FOLLOW = constants.O_NOFOLLOW;

/**
 * What one look at a small file found. Four answers, because the refresh lock
 * must tell them apart (the other kept files only want `read` or nothing):
 * - `read`: a regular file within the bound, its bytes and its mtime, both
 *   from the one open file;
 * - `absent`: no directory entry at the path. The lock's claimer must not
 *   remove what is not there (a lock created a moment later is someone's);
 * - `unreadable`: something is there that cannot be read as such a file (a
 *   pipe, a device, a directory, a link to nothing, too large, no permission).
 *   The lock's claimer takes it over: nobody can judge it;
 * - `grown`: a regular file within the bound that grew while it was read: its
 *   writer is writing it in place NOW (a lock's owner writes its token just
 *   after creating it). No bytes, because nobody may parse a file caught
 *   mid-write; its mtime, so a lock being written is judged by its date.
 */
export type SmallFile =
  | { kind: 'read'; bytes: Buffer; mtimeMs: number }
  | { kind: 'absent' }
  | { kind: 'unreadable' }
  | { kind: 'grown'; mtimeMs: number };

/** What a NO-FOLLOW look found: the four answers, or a symbolic link at the path (never followed). */
export type OwnFile = SmallFile | { kind: 'symlink' };

const ABSENT: SmallFile = { kind: 'absent' };
const UNREADABLE: SmallFile = { kind: 'unreadable' };
const SYMLINK: OwnFile = { kind: 'symlink' };

/** Whether the entry at `path` is itself a symbolic link (not followed). Never throws. */
function isSymbolicLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Read a small regular file through ONE descriptor, never more than
 * `maxBytes + 1` bytes of it, and say which of the four `SmallFile` answers it
 * is. Never throws, never waits. The ONE implementation for every file kept on
 * disk; `readSmallFile` is its bytes-or-nothing form, and {@link lookAtOwnFile}
 * its no-follow form.
 *
 * A check by path followed by a read by path is two looks at what may be two
 * files: between them the path can become a pipe (the read then blocks the
 * statusline for ever) or a file far larger than the check allowed (read
 * whole). Here the check and the read are of the same open file, and the read
 * stops one byte past the size the check saw (at most the bound): a file that
 * grew in place after it was checked is `grown`, and is not read further.
 *
 * `absent` means NO ENTRY. An open that follows a link to nothing also fails
 * with ENOENT, so that failure is followed by one look at the entry itself
 * (`lstat`, not followed): a link is there, so `unreadable`. Anything else that
 * look finds (nothing, or a file created between the two looks) stays
 * `absent`: answering `unreadable` for a file that appeared in between would
 * have the lock's claimer remove a fresh lock (the vanished-lock tests in
 * `cache-file-races.test.ts` pin it).
 */
export function lookAtSmallFile(path: string, maxBytes: number): SmallFile {
  return look(path, maxBytes, false) as SmallFile;
}

/**
 * The contents of a small regular file (see `lookAtSmallFile`), or `undefined`
 * for every other answer (absent, unreadable, grown while it was read: a file
 * caught mid-write is not parsed). Never throws, never waits.
 */
export function readSmallFile(path: string, maxBytes: number): Buffer | undefined {
  const file = lookAtSmallFile(path, maxBytes);
  return file.kind === 'read' ? file.bytes : undefined;
}

/**
 * {@link lookAtSmallFile} for a file that must be the user's OWN regular file
 * (the config file): a symbolic link at the path is `symlink`, never followed.
 * Where the platform has `O_NOFOLLOW` (POSIX) the open itself refuses a link
 * (`ELOOP`, or `EMLINK` on some BSDs), and one look at the entry tells a link
 * from a path that loops elsewhere. Windows has no such flag: there the entry
 * is looked at (`lstat`) BEFORE the open, and the open's `fstat` must be a
 * regular file. That is two looks, and a link swapped in between them is
 * followed: the race is stated, not closed (a user who can replace their own
 * config file between two system calls can write it too).
 */
export function lookAtOwnFile(path: string, maxBytes: number): OwnFile {
  return look(path, maxBytes, true);
}

function look(path: string, maxBytes: number, noFollow: boolean): OwnFile {
  let fd: number | undefined;
  try {
    if (noFollow && NO_FOLLOW === undefined && isSymbolicLink(path)) return SYMLINK;
    try {
      fd = openSync(path, READ_FLAGS | (noFollow ? (NO_FOLLOW ?? 0) : 0));
    } catch (e) {
      const code = (e as NodeJS.ErrnoException | undefined)?.code;
      if (noFollow && (code === 'ELOOP' || code === 'EMLINK')) return isSymbolicLink(path) ? SYMLINK : UNREADABLE;
      if (code !== 'ENOENT') return UNREADABLE;
      if (!isSymbolicLink(path)) return ABSENT;
      return noFollow ? SYMLINK : UNREADABLE;
    }
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > maxBytes) return UNREADABLE;
    const buf = Buffer.alloc(info.size + 1);
    let total = 0;
    while (total < buf.length) {
      const n = readSync(fd, buf, total, buf.length - total, null);
      if (n === 0) break;
      total += n;
    }
    if (total > info.size) return { kind: 'grown', mtimeMs: info.mtimeMs };
    return { kind: 'read', bytes: buf.subarray(0, total), mtimeMs: info.mtimeMs };
  } catch {
    return UNREADABLE;
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
