import { describe, expect, it } from 'vitest';
import { clipboardTools } from '../src/clipboard';

describe('clipboardTools', () => {
  it('uses pbcopy on macOS', () => {
    expect(clipboardTools('darwin').map((t) => t.cmd)).toEqual(['pbcopy']);
  });

  it('uses clip on Windows', () => {
    expect(clipboardTools('win32').map((t) => t.cmd)).toEqual(['clip']);
  });

  it('tries Wayland then X11 tools on Linux/other', () => {
    expect(clipboardTools('linux').map((t) => t.cmd)).toEqual(['wl-copy', 'xclip', 'xsel']);
  });

  it('passes fixed argv (never a shell string), so the snippet can not inject', () => {
    const xclip = clipboardTools('linux').find((t) => t.cmd === 'xclip');
    expect(xclip?.args).toEqual(['-selection', 'clipboard']);
  });
});
