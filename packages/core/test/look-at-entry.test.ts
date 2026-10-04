/**
 * `lookAtEntry` (0.11, the cleanup PR, ledger row D8, round 2): whether a path
 * holds nothing, a regular file this process can OPEN, or something that
 * cannot be opened as one. The CLI's refresher asks it of a snapshot it could
 * not use, to know whether a publish can heal it. The bounded reader's kinds
 * cannot answer it: `lookAtSmallFile` says `unreadable` both for a file it
 * cannot open and for one larger than its bound. Nothing is read, and the open
 * never waits (a pipe with no writer included).
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { lookAtEntry, lookAtSmallFile } from '../src';

const POSIX = process.platform !== 'win32';
const unprivileged = POSIX && (typeof process.getuid !== 'function' || process.getuid() !== 0);
const tmp = mkdtempSync(join(tmpdir(), 'claudinho-entry-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('lookAtEntry', () => {
  it('no entry: absent', () => {
    expect(lookAtEntry(join(tmp, 'nope'))).toBe('absent');
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

  it('a directory: unopenable', () => {
    const d = join(tmp, 'a-dir');
    mkdirSync(d);
    expect(lookAtEntry(d)).toBe('unopenable');
  });

  it.skipIf(!unprivileged)('a file with no read permission: unopenable', () => {
    const p = join(tmp, 'locked.json');
    writeFileSync(p, '{}');
    chmodSync(p, 0o000);
    try {
      expect(lookAtEntry(p)).toBe('unopenable');
    } finally {
      chmodSync(p, 0o644);
    }
  });

  it.skipIf(!POSIX)('a link to nothing: unopenable, not absent; a link to a file that opens: file', () => {
    const dangling = join(tmp, 'dangling.json');
    symlinkSync(join(tmp, 'no-such-target'), dangling);
    expect(lookAtEntry(dangling)).toBe('unopenable');
    const target = join(tmp, 'target.json');
    writeFileSync(target, '{}');
    const link = join(tmp, 'link.json');
    symlinkSync(target, link);
    expect(lookAtEntry(link)).toBe('file');
  });

  it.skipIf(!POSIX)('a pipe with no writer: unopenable, and the look does not wait', () => {
    const fifo = join(tmp, 'pipe.json');
    execFileSync('mkfifo', [fifo]);
    expect(lookAtEntry(fifo)).toBe('unopenable');
  });
});
