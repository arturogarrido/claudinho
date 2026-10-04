/**
 * The one bounded, non-blocking read for every small file Claudinho keeps on
 * the user's disk: the CLI's cache files (the snapshot, the throttle note, the
 * attempt record, the refresh lock, the market cache, the run counter) and the
 * user's config file, which the CLI and the MCP server both read
 * (`userConfig.ts`). It lives in core so both packages read the same file the
 * same way; the CLI re-exports it from `paths.ts` for its own callers.
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, type Stats } from 'node:fs';

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
 * What a RENAME onto `path` would do, from one look at the entry (`lstat`,
 * never following a link) and, for a regular file only, one open; nothing is
 * read. Four answers:
 * - `absent`: no entry (a rename creates a fresh file);
 * - `file`: a regular file this process can OPEN for reading, whatever its
 *   size or content (a replacement keeps its mode, so stays readable);
 * - `replaceable`: an entry a rename replaces with a fresh file: a symbolic
 *   link to anything (the link itself is replaced, its target never followed;
 *   a link to nothing included), a pipe, a socket, a device;
 * - `unhealable`: a directory (a rename cannot replace it), a regular file
 *   this process cannot open (a replacement keeps its mode, so stays
 *   unreadable), or an entry nobody can look at (the `lstat` failed other than
 *   for no entry: the directory above it cannot be searched).
 *
 * The bounded reader cannot answer this: `lookAtSmallFile` says `unreadable`
 * for a file it cannot open, for a regular file larger than its bound, and for
 * a link to nothing alike. The open is the bounded reader's (read-only,
 * non-blocking where the platform has it), on one descriptor, closed before
 * returning. For the CLI's refresher, which asks whether a publish (an atomic
 * write: a temporary file renamed over the path) can heal a snapshot it could
 * not use. Never throws, never waits.
 */
export type FileEntry = 'absent' | 'file' | 'replaceable' | 'unhealable';

export function lookAtEntry(path: string): FileEntry {
  let entry: Stats;
  try {
    entry = lstatSync(path);
  } catch (e) {
    return (e as NodeJS.ErrnoException | undefined)?.code === 'ENOENT' ? 'absent' : 'unhealable';
  }
  if (entry.isSymbolicLink()) return 'replaceable';
  if (entry.isDirectory()) return 'unhealable';
  if (!entry.isFile()) return 'replaceable';
  let fd: number | undefined;
  try {
    fd = openSync(path, READ_FLAGS);
    return 'file';
  } catch {
    return 'unhealable';
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

/**
 * {@link lookAtSmallFile} for a file that must be the user's OWN regular file
 * (the config file): a symbolic link at the path is `symlink`, never followed.
 * Where the platform has `O_NOFOLLOW` (POSIX) the open itself refuses a link
 * (`ELOOP`, or `EMLINK` on some BSDs), and one look at the entry tells a link
 * from a path that loops elsewhere. Windows has no such flag: there the entry
 * is looked at (`lstat`: a link is `symlink`) BEFORE the open, and the file
 * the open gave must be THAT entry: the same device and inode by `fstat` as by
 * the `lstat`. A link (or any other file) put in place between the two looks
 * is then not what was inspected, and is answered `symlink`, its descriptor
 * closed and nothing read; so is a file found at the open where the look found
 * no entry. The two looks are kept apart by the check, not closed into one.
 */
export function lookAtOwnFile(path: string, maxBytes: number): OwnFile {
  return look(path, maxBytes, true);
}

function look(path: string, maxBytes: number, noFollow: boolean): OwnFile {
  let fd: number | undefined;
  try {
    // Without O_NOFOLLOW: the entry as looked at, for the opened file to be
    // compared with (`null`: the look found no entry).
    let looked: Stats | null | undefined;
    if (noFollow && NO_FOLLOW === undefined) {
      try {
        looked = lstatSync(path);
      } catch {
        looked = null;
      }
      if (looked?.isSymbolicLink()) return SYMLINK;
    }
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
    // The file opened is not the entry looked at: the entry changed between.
    if (looked !== undefined && (looked === null || looked.dev !== info.dev || looked.ino !== info.ino)) return SYMLINK;
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
