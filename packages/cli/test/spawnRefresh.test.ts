import { describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { spawnRefresh } from '../src/refresh';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

describe('spawnRefresh', () => {
  it('spawns detached, silenced, and windowsHide (no console flash on Windows)', () => {
    spawnRefresh('espn');
    expect(spawn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = vi.mocked(spawn).mock.calls[0]! as unknown as [
      string,
      string[],
      { detached: boolean; stdio: string; windowsHide: boolean },
    ];
    expect(cmd).toBe(process.execPath);
    expect(args).toContain('_refresh');
    expect(opts).toMatchObject({ detached: true, stdio: 'ignore', windowsHide: true });
  });
});
