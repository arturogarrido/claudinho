/**
 * The one bounded, non-blocking read for every small file Claudinho keeps on
 * the user's disk: the CLI's cache files (the snapshot, the throttle note, the
 * attempt record, the refresh lock, the market cache, the run counter) and the
 * user's config file, which the CLI and the MCP server both read
 * (`userConfig.ts`). It lives in core so both packages read the same file the
 * same way; the CLI re-exports it from `paths.ts` for its own callers.
 */
import { randomBytes } from 'node:crypto';
import { closeSync, constants, fchmodSync, fstatSync, lstatSync, openSync, readSync, rmSync, type Stats } from 'node:fs';

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

/** What a rename onto a path would do (see {@link lookAtEntry}). */
export type FileEntry = 'absent' | 'file' | 'replaceable' | 'unhealable';

/** The owner-read bit of a mode (`S_IRUSR`): the one read bit a replacement that is this process's own answers to. */
const OWNER_READ = 0o400;

/**
 * Whether a file made where an atomic write makes its replacement of `path`
 * (the same directory), with these mode bits, reads back: what the writer does
 * short of the rename, MEASURED. A probe `<path>.<pid>.<random hex>.probe` is
 * created exclusively at `mode`, given exactly those bits on its descriptor
 * (as the writer does), closed, opened read-only (non-blocking, nothing read),
 * closed, and removed. The probe gets whatever the directory gives a new file
 * (an inherited access-control entry, allow or deny), which is exactly what
 * the replacement gets: that is why it is measured there, not predicted from
 * the bits. True exactly when the read open succeeded; false on any failure (a
 * create that fails: the directory refuses a new file, so a publish's rename
 * would fail too; a read open that fails: the replacement would not read
 * back). Once this call created the probe it removes it, whatever the answer,
 * where the directory lets it be removed (a create that failed made nothing; a
 * name that existed is not this call's). A crash between its create and its
 * removal, or an entry that denies its deletion (an inherited deny-delete
 * entry: the removal fails, and is ignored), leaves it behind, at most one
 * file per look, as the atomic writer's temporary file can be left; nothing
 * reads or removes it (every file kept beside it is read by its exact name,
 * and its name ends in `.probe`, like no file anyone keeps). Never throws,
 * never waits (a regular file of this process's own, opened non-blocking).
 */
function replacementReadsBack(path: string, mode: number): boolean {
  const probe = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.probe`;
  let created = false;
  try {
    const fd = openSync(probe, 'wx', mode);
    created = true;
    try {
      fchmodSync(fd, mode);
    } finally {
      closeSync(fd);
    }
    const read = openSync(probe, READ_FLAGS);
    try {
      closeSync(read);
    } catch {
      /* it opened: that is the answer */
    }
    return true;
  } catch {
    return false;
  } finally {
    if (created) {
      try {
        rmSync(probe, { force: true });
      } catch {
        /* nothing more to do with it */
      }
    }
  }
}

/**
 * What a RENAME onto `path` would do, from one look at the entry (`lstat`,
 * never following a link), one open for a regular file whose owner-read bit is
 * set, and one probe where that bit is clear; nothing is read. The replacement
 * (an atomic write: a temporary file made in the same directory and renamed
 * over the path) is this process's own file and keeps the mode bits of
 * whatever it replaces but a link, and nothing else of the entry (no
 * access-control entry of its own, no other owner); what the DIRECTORY gives a
 * new file (an inherited access-control entry) it gets too. So the owner-read
 * bit decides nothing on its own where it is clear: there the look MEASURES
 * whether a file made beside the path with those bits reads back, before any
 * open of the entry (a probe, made with those bits, opened, and removed:
 * nothing is left behind but where a crash interrupts it or the directory
 * denies its deletion, at most one file per look). Where it is set the replacement is taken to read
 * back (steps 5 and 6; a directory whose inherited entries deny a new file a
 * read is not measured there). In this order:
 * 1. the `lstat` fails: no entry → `absent` (a rename creates a fresh file);
 *    anything else → `unhealable` (nobody can look at it: the directory above
 *    cannot be searched);
 * 2. a symbolic link to anything → `replaceable` (the rename replaces the link
 *    itself and keeps nothing of it; its target is never followed, a link to
 *    nothing included);
 * 3. a directory → `unhealable` (a rename cannot replace it);
 * 4. the owner-read bit clear (mode 000, 200, 044), whatever the kind (a
 *    regular file refused, or one that opens through its other bits or an
 *    access-control entry of its own; a pipe, a socket, a device): the
 *    replacement keeps the bits and none of what let this process read the
 *    entry, so whether it reads back is measured (`replacementReadsBack`): a
 *    probe made there with those bits reads back (the directory's inherited
 *    permissions let a new file be read) → `replaceable`; else → `unhealable`;
 * 5. a regular file → opened (read-only, non-blocking where the platform has
 *    it, on one descriptor, closed before returning, nothing read): it opens →
 *    `file`, whatever its size or content; refused → `replaceable` (an
 *    access-control list, another owner's 0600, a lock: the replacement is
 *    ours with the owner-read bit set, so it reads back);
 * 6. anything else with the bit set (a pipe, a socket, a device) →
 *    `replaceable` (the rename replaces the entry with a regular file of ours
 *    with those bits, which reads back).
 *
 * On Windows every mode reports the owner-read bit, so step 4 never runs there
 * (no probe is made) and a file that cannot be opened is `replaceable`; if the
 * rename itself then fails, the atomic write throws, and the publish that
 * called it is one that did not happen, as before. The look cannot see a flag
 * the system keeps beside the mode (an immutable or append-only flag: Node's
 * `lstat` reports none); under one the rename is refused whatever it answers,
 * with the same outcome.
 *
 * The bounded reader cannot answer this: `lookAtSmallFile` says `unreadable`
 * for a file it cannot open, for a regular file larger than its bound, and for
 * a link to nothing alike. For the CLI's refresher, which asks whether a
 * publish can heal a snapshot it could not use. Never throws, never waits.
 */
export function lookAtEntry(path: string): FileEntry {
  let entry: Stats;
  try {
    entry = lstatSync(path);
  } catch (e) {
    return (e as NodeJS.ErrnoException | undefined)?.code === 'ENOENT' ? 'absent' : 'unhealable';
  }
  if (entry.isSymbolicLink()) return 'replaceable';
  if (entry.isDirectory()) return 'unhealable';
  // Before any open of the entry: the replacement keeps these bits, whatever let
  // this process read the entry, and gets what the directory gives a new file.
  if ((entry.mode & OWNER_READ) === 0) return replacementReadsBack(path, entry.mode & 0o777) ? 'replaceable' : 'unhealable';
  if (!entry.isFile()) return 'replaceable';
  let fd: number | undefined;
  try {
    fd = openSync(path, READ_FLAGS);
    return 'file';
  } catch {
    // Refused, with the owner-read bit set: the replacement is this process's
    // own and keeps that bit, so it reads back.
    return 'replaceable';
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
