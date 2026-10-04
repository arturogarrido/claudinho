/**
 * The no-follow reader without `O_NOFOLLOW` (Windows), beside
 * `files-fallback.test.ts`: the file opened must be the entry looked at by
 * BOTH its device and its inode (one alone can repeat across volumes), and a
 * file found at the open where the look found no entry was not inspected:
 * `symlink` in both cases, its descriptor closed, nothing read.
 */
import { describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
let lstatAt: { dev: number; ino: number } | undefined = { dev: 7, ino: 1 };
let fstatAt = { dev: 7, ino: 1 };
vi.mock('node:fs', () => {
  const stat = (at: { dev: number; ino: number }) => ({ isSymbolicLink: () => false, isFile: () => true, size: 2, mtimeMs: 1, ...at });
  return {
    constants: { O_RDONLY: 0, O_NONBLOCK: 2048 },
    lstatSync: vi.fn(() => {
      if (!lstatAt) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return stat(lstatAt);
    }),
    openSync: vi.fn(() => 3),
    fstatSync: vi.fn(() => stat(fstatAt)),
    readSync: vi.fn((_fd: number, buf: Buffer) => {
      if (calls.includes('read')) return 0;
      calls.push('read');
      buf.write('{}', 0);
      return 2;
    }),
    closeSync: vi.fn(() => {
      calls.push('close');
    }),
  };
});

const { lookAtOwnFile } = await import('../src/files');

describe('without O_NOFOLLOW, the opened file is the entry looked at', () => {
  it('the same inode on another device is another file', () => {
    calls.length = 0;
    lstatAt = { dev: 7, ino: 1 };
    fstatAt = { dev: 8, ino: 1 };
    expect(lookAtOwnFile('/cfg/config.json', 4096).kind).toBe('symlink');
    expect(calls).not.toContain('read');
    expect(calls).toContain('close');
  });

  it('a file at the open where the look found no entry was not inspected', () => {
    calls.length = 0;
    lstatAt = undefined;
    fstatAt = { dev: 7, ino: 1 };
    expect(lookAtOwnFile('/cfg/config.json', 4096).kind).toBe('symlink');
    expect(calls).not.toContain('read');
  });

  it('the same device and inode reads', () => {
    calls.length = 0;
    lstatAt = { dev: 7, ino: 1 };
    fstatAt = { dev: 7, ino: 1 };
    expect(lookAtOwnFile('/cfg/config.json', 4096).kind).toBe('read');
  });
});
