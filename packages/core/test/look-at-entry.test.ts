/**
 * `lookAtEntry` (0.11, the cleanup PR, ledger row D8, rounds 2 and 3): what a
 * RENAME onto a path would do. The CLI's refresher asks it of a snapshot it
 * could not use, to know whether a publish (an atomic write: a temporary file
 * renamed over the path) can heal it. Only a directory (the rename fails) and
 * a regular file whose own mode denies its owner a read (refused, with the
 * owner-read bit clear: the replacement is ours and keeps the bits) are
 * `unhealable`; a link to anything, a pipe, and a regular file refused with
 * the owner-read bit set (an access-control list, another owner's 0600: the
 * replacement is ours, readable) are `replaceable`; a regular file that opens
 * is `file`, whatever its size or content. The bounded reader's kinds cannot
 * answer it: `lookAtSmallFile` says `unreadable` alike for a file it cannot
 * open, one over its bound, and a link to nothing. Nothing is read, and the
 * look never waits (a pipe with no writer included).
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { lookAtEntry, lookAtSmallFile } from '../src';

const POSIX = process.platform !== 'win32';
const unprivileged = POSIX && (typeof process.getuid !== 'function' || process.getuid() !== 0);
const tmp = mkdtempSync(join(tmpdir(), 'claudinho-entry-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('lookAtEntry: what a rename onto the path would do', () => {
  it('no entry: absent (also under a missing directory)', () => {
    expect(lookAtEntry(join(tmp, 'nope'))).toBe('absent');
    expect(lookAtEntry(join(tmp, 'no-dir', 'nope'))).toBe('absent');
  });

  it('a regular file that opens, whatever its size or content: file (where the bounded reader says unreadable)', () => {
    const bad = join(tmp, 'bad.json');
    writeFileSync(bad, '{ not json');
    expect(lookAtEntry(bad)).toBe('file');
    const big = join(tmp, 'big.json');
    writeFileSync(big, 'x'.repeat(64 * 1024));
    expect(lookAtEntry(big)).toBe('file');
    expect(lookAtSmallFile(big, 1024).kind).toBe('unreadable');
    const empty = join(tmp, 'empty.json');
    writeFileSync(empty, '');
    expect(lookAtEntry(empty)).toBe('file');
  });

  it('a directory: unhealable (the rename cannot replace it)', () => {
    const d = join(tmp, 'a-dir');
    mkdirSync(d);
    expect(lookAtEntry(d)).toBe('unhealable');
  });

  it.skipIf(!unprivileged)('a regular file refused with its owner-read bit clear (mode 000, mode 200): unhealable (the replacement is ours and keeps the bits)', () => {
    for (const mode of [0o000, 0o200]) {
      const p = join(tmp, `locked-${mode.toString(8)}.json`);
      writeFileSync(p, '{}');
      chmodSync(p, mode);
      try {
        expect(lookAtEntry(p), mode.toString(8)).toBe('unhealable');
      } finally {
        chmodSync(p, 0o644);
      }
    }
  });

  it.skipIf(process.platform !== 'darwin' || !unprivileged)('a regular file refused by a deny-read access-control list, its owner-read bit set: replaceable (the replacement is ours, readable)', () => {
    const p = join(tmp, 'acl-denied.json');
    writeFileSync(p, '{}');
    try {
      execFileSync('chmod', ['+a', `${userInfo().username} deny read`, p]);
    } catch {
      return; // no access-control lists here: nothing to test
    }
    expect(lstatSync(p).mode & 0o400).toBe(0o400);
    expect(lookAtSmallFile(p, 1024).kind).toBe('unreadable'); // the list refuses the open
    expect(lookAtEntry(p)).toBe('replaceable');
  });

  it.skipIf(!POSIX)('a symbolic link to anything: replaceable, never followed (a link to nothing, to a file, to a directory, to a locked file)', () => {
    const dangling = join(tmp, 'dangling.json');
    symlinkSync(join(tmp, 'no-such-target'), dangling);
    expect(lookAtEntry(dangling)).toBe('replaceable');
    expect(lookAtSmallFile(dangling, 1024).kind).toBe('unreadable');
    const target = join(tmp, 'target.json');
    writeFileSync(target, '{}');
    const toFile = join(tmp, 'link-to-file.json');
    symlinkSync(target, toFile);
    expect(lookAtEntry(toFile)).toBe('replaceable');
    const dirTarget = join(tmp, 'dir-target');
    mkdirSync(dirTarget);
    const toDir = join(tmp, 'link-to-dir.json');
    symlinkSync(dirTarget, toDir);
    expect(lookAtEntry(toDir)).toBe('replaceable');
    if (unprivileged) {
      const locked = join(tmp, 'locked-target.json');
      writeFileSync(locked, '{}');
      chmodSync(locked, 0o000);
      const toLocked = join(tmp, 'link-to-locked.json');
      symlinkSync(locked, toLocked);
      try {
        expect(lookAtEntry(toLocked)).toBe('replaceable');
      } finally {
        chmodSync(locked, 0o644);
      }
    }
  });

  it.skipIf(!POSIX)('a pipe with no writer: replaceable, and the look does not wait', () => {
    const fifo = join(tmp, 'pipe.json');
    execFileSync('mkfifo', [fifo]);
    expect(lookAtEntry(fifo)).toBe('replaceable');
  });

  it.skipIf(!unprivileged)('an entry nobody can look at (the directory above cannot be searched): unhealable', () => {
    const d = join(tmp, 'unsearchable');
    mkdirSync(d);
    writeFileSync(join(d, 'state.json'), '{}');
    chmodSync(d, 0o000);
    try {
      expect(lookAtEntry(join(d, 'state.json'))).toBe('unhealable');
    } finally {
      chmodSync(d, 0o755);
    }
  });
});
