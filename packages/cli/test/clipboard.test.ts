import { describe, expect, it } from 'vitest';
import { clipboardTools } from '../src/clipboard';

describe('clipboardTools', () => {
  it('uses pbcopy on macOS', () => {
    expect(clipboardTools('darwin', {}).map((t) => t.cmd)).toEqual(['pbcopy']);
  });

  // Windows looks for a bare command name in the current folder before PATH, so a `clip.exe` planted in the folder
  // where `share --copy` runs would be the one started. The helper is named by its absolute path under the
  // system root instead.
  describe('on Windows, clip.exe by its absolute path under the system root', () => {
    const clip = (env: Record<string, string | undefined>) => clipboardTools('win32', env);

    it('takes the system root from SystemRoot', () => {
      expect(clip({ SystemRoot: 'D:\\WINNT' })).toEqual([{ cmd: 'D:\\WINNT\\System32\\clip.exe', args: [] }]);
    });

    it('reads the variable whatever its case, as Windows does (a plain object is case-sensitive)', () => {
      expect(clip({ SYSTEMROOT: 'E:\\Windows' }).map((t) => t.cmd)).toEqual(['E:\\Windows\\System32\\clip.exe']);
      expect(clip({ systemroot: 'E:\\Windows' }).map((t) => t.cmd)).toEqual(['E:\\Windows\\System32\\clip.exe']);
    });

    it('normalizes a trailing separator', () => {
      expect(clip({ SystemRoot: 'D:\\WINNT\\' }).map((t) => t.cmd)).toEqual(['D:\\WINNT\\System32\\clip.exe']);
    });

    it('falls back to C:\\Windows when the root is absent, empty or not an absolute drive path', () => {
      for (const env of [{}, { SystemRoot: '' }, { SystemRoot: 'Windows' }, { SystemRoot: '.\\Windows' }, { SystemRoot: '\\Windows' }, { SystemRoot: 'C:Windows' }])
        expect(clip(env).map((t) => t.cmd), JSON.stringify(env)).toEqual(['C:\\Windows\\System32\\clip.exe']);
    });

    it('never names the bare command', () => {
      for (const env of [{}, { SystemRoot: 'C:\\Windows' }, { SYSTEMROOT: 'Windows' }])
        for (const t of clip(env)) expect(t.cmd).toMatch(/^[A-Za-z]:\\.*\\System32\\clip\.exe$/);
    });

    it('defaults to the process environment', () => {
      expect(clipboardTools('win32')[0]?.cmd).toMatch(/\\System32\\clip\.exe$/);
    });
  });

  it('tries Wayland then X11 tools on Linux/other', () => {
    expect(clipboardTools('linux', {}).map((t) => t.cmd)).toEqual(['wl-copy', 'xclip', 'xsel']);
  });

  it('passes fixed argv (never a shell string), so the snippet can not inject', () => {
    const xclip = clipboardTools('linux', {}).find((t) => t.cmd === 'xclip');
    expect(xclip?.args).toEqual(['-selection', 'clipboard']);
    expect(clipboardTools('win32', {})[0]?.args).toEqual([]);
  });
});
