/**
 * The no-follow reader where the platform has no `O_NOFOLLOW` (Windows): the
 * entry is looked at BEFORE the open and the opened file is checked AFTER it
 * to be THAT entry (the same device and inode), so a link put in place between
 * the two looks is never followed (0.11 · 2.5b, review). The platform is
 * simulated: `node:fs` is mocked with constants that have no `O_NOFOLLOW`.
 */
import { describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
let lstatIno = 1;
let fstatIno = 1;
vi.mock('node:fs', () => {
  const stat = (ino: number) => ({ isSymbolicLink: () => false, isFile: () => true, size: 2, mtimeMs: 1, dev: 7, ino });
  return {
    constants: { O_RDONLY: 0, O_NONBLOCK: 2048 },
    lstatSync: vi.fn((p: string) => {
      calls.push(`lstat ${p}`);
      return stat(lstatIno);
    }),
    openSync: vi.fn((p: string) => {
      calls.push(`open ${p}`);
      return 3;
    }),
    fstatSync: vi.fn(() => {
      calls.push('fstat');
      return stat(fstatIno);
    }),
    readSync: vi.fn((_fd: number, buf: Buffer) => {
      if (buf.length < 2) return 0;
      buf.write('{}', 0);
      return calls.includes('read') ? 0 : (calls.push('read'), 2);
    }),
    closeSync: vi.fn(() => {
      calls.push('close');
    }),
  };
});

const { lookAtOwnFile } = await import('../src/files');

describe('without O_NOFOLLOW', () => {
  it('the entry looked at and the file opened must be one: a different inode after the open is a link, never read', () => {
    calls.length = 0;
    lstatIno = 1;
    fstatIno = 2;
    const r = lookAtOwnFile('/cfg/config.json', 4096);
    expect(r.kind).toBe('symlink');
    expect(calls[0]).toBe('lstat /cfg/config.json');
    expect(calls).toContain('close');
  });

  it('the same inode reads', () => {
    calls.length = 0;
    lstatIno = 5;
    fstatIno = 5;
    const r = lookAtOwnFile('/cfg/config.json', 4096);
    expect(r.kind).toBe('read');
  });
});
