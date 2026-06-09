/**
 * Best-effort clipboard copy for `claudinho share --copy`.
 *
 * Safety: each candidate is a FIXED executable name + fixed argv — never a shell
 * string and never `shell: true`, so the snippet text (which we pass on stdin,
 * never interpolated into a command) can't inject anything. The copy is purely
 * additive: it never throws and never fails the command. If no tool is present
 * the snippet has already been printed to stdout, so nothing is lost.
 */
import { spawnSync } from 'node:child_process';

interface ClipboardTool {
  cmd: string;
  args: string[];
}

/**
 * The clipboard tools to try, in order, for a platform. macOS/Windows have one
 * canonical tool; Linux/BSD try Wayland (`wl-copy`) then X11 (`xclip`, `xsel`).
 */
export function clipboardTools(platform: NodeJS.Platform): ClipboardTool[] {
  if (platform === 'darwin') return [{ cmd: 'pbcopy', args: [] }];
  if (platform === 'win32') return [{ cmd: 'clip', args: [] }];
  return [
    { cmd: 'wl-copy', args: [] },
    { cmd: 'xclip', args: ['-selection', 'clipboard'] },
    { cmd: 'xsel', args: ['--clipboard', '--input'] },
  ];
}

/** Copy `text` to the OS clipboard. Returns true on success; never throws, never hangs. */
export function copyToClipboard(text: string, platform: NodeJS.Platform = process.platform): boolean {
  for (const { cmd, args } of clipboardTools(platform)) {
    try {
      // `timeout` bounds the call: some X11 tools (xclip/xsel) stay resident to
      // own the selection, which would otherwise block `spawnSync` forever. A
      // timeout sets `res.error` (ETIMEDOUT) → treated as failure → next tool.
      const res = spawnSync(cmd, args, {
        input: text,
        stdio: ['pipe', 'ignore', 'ignore'],
        timeout: 1000,
      });
      if (!res.error && res.status === 0) return true;
    } catch {
      // Tool missing or refused — try the next candidate.
    }
  }
  return false;
}
