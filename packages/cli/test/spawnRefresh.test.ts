import { describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { spawnRefresh } from '../src/refresh';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

describe('spawnRefresh', () => {
  it('spawns detached, silenced, and windowsHide (no console flash on Windows)', () => {
    spawnRefresh('espn', 'eng.1');
    expect(spawn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = vi.mocked(spawn).mock.calls[0]! as unknown as [
      string,
      string[],
      { detached: boolean; stdio: string; windowsHide: boolean; env: Record<string, string> },
    ];
    expect(cmd).toBe(process.execPath);
    expect(args).toContain('_refresh');
    expect(opts).toMatchObject({ detached: true, stdio: 'ignore', windowsHide: true });
    // The child resolves its competition from ITS environment: it is handed the
    // one this process already resolved, and the rest of the environment intact.
    expect(opts.env.CLAUDINHO_COMPETITION).toBe('eng.1');
    expect(opts.env.PATH).toBe(process.env.PATH);
  });
});
