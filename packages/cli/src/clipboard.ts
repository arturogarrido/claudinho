/**
 * Best-effort clipboard copy for `claudinho share --copy`.
 *
 * Safety: each candidate is a FIXED executable + fixed argv — never a shell
 * string and never `shell: true`, so the snippet text (which we pass on stdin,
 * never interpolated into a command) can't inject anything. The copy is purely
 * additive: it never throws and never fails the command. If no tool is present
 * the snippet has already been printed to stdout, so nothing is lost.
 *
 * On Windows, a bare command name is looked up in the current folder before
 * PATH, so a `clip.exe` planted in the folder where `share --copy` runs would be
 * the one started. The helper is named by its absolute path under the system
 * root instead (`SystemRoot`, read whatever its case, as Windows does). Whoever
 * sets `SystemRoot` already runs code as the user.
 */
import { spawnSync } from 'node:child_process';
import { win32 } from 'node:path';

interface ClipboardTool {
  cmd: string;
  args: string[];
}

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

/** The system root a fallback names when the environment gives none usable. */
const DEFAULT_SYSTEM_ROOT = 'C:\\Windows';

/**
 * The environment's `SystemRoot`, found case-insensitively (the exact key first,
 * else the first key whose lower case is `systemroot`), used only when it is an
 * absolute drive path; otherwise `C:\Windows`.
 */
function systemRoot(env: Env): string {
  let value = Object.hasOwn(env, 'SystemRoot') ? env.SystemRoot : undefined;
  if (value === undefined) {
    const key = Object.keys(env).find((k) => k.toLowerCase() === 'systemroot');
    value = key === undefined ? undefined : env[key];
  }
  return typeof value === 'string' && /^[A-Za-z]:\\/.test(value) ? value : DEFAULT_SYSTEM_ROOT;
}

/**
 * The clipboard tools to try, in order, for a platform. macOS/Windows have one
 * canonical tool; Linux/BSD try Wayland (`wl-copy`) then X11 (`xclip`, `xsel`).
 */
export function clipboardTools(platform: NodeJS.Platform, env: Env = process.env): ClipboardTool[] {
  if (platform === 'darwin') return [{ cmd: 'pbcopy', args: [] }];
  if (platform === 'win32') return [{ cmd: win32.join(systemRoot(env), 'System32', 'clip.exe'), args: [] }];
  return [
    { cmd: 'wl-copy', args: [] },
    { cmd: 'xclip', args: ['-selection', 'clipboard'] },
    { cmd: 'xsel', args: ['--clipboard', '--input'] },
  ];
}

/** Copy `text` to the OS clipboard. Returns true on success; never throws, never hangs. */
export function copyToClipboard(text: string, platform: NodeJS.Platform = process.platform): boolean {
  for (const { cmd, args } of clipboardTools(platform, process.env)) {
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
