/**
 * `claudinho init-statusline` — wire the Claude Code statusline to
 * `claudinho prompt` by patching ~/.claude/settings.json. Safe: preserves
 * existing settings, backs up before overwriting a different statusline, and
 * refuses to clobber unparseable files (prints the snippet instead).
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface StatusLineConfig {
  type: 'command';
  command: string;
}

export interface InitResult {
  action: 'written' | 'already' | 'printed' | 'manual';
  path: string;
  message: string;
}

export function claudeSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}

export interface InitOpts {
  print?: boolean;
  command?: string;
  /** Override the settings path (tests). */
  path?: string;
}

export function initStatusline(opts: InitOpts = {}): InitResult {
  const path = opts.path ?? claudeSettingsPath();
  const sl: StatusLineConfig = { type: 'command', command: opts.command ?? 'claudinho prompt' };
  const snippet = JSON.stringify({ statusLine: sl }, null, 2);

  if (opts.print) {
    return { action: 'printed', path, message: snippet };
  }

  let settings: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      settings = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch {
      return {
        action: 'manual',
        path,
        message:
          `Could not parse ${path}. Add this manually:\n${snippet}`,
      };
    }
  }

  const existing = settings.statusLine as StatusLineConfig | undefined;
  if (existing?.command?.includes('claudinho')) {
    return { action: 'already', path, message: `Statusline already uses claudinho (${path}).` };
  }

  if (existsSync(path)) copyFileSync(path, `${path}.claudinho.bak`);
  settings.statusLine = sl;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return {
    action: 'written',
    path,
    message: `Statusline configured in ${path}. Restart Claude Code to see it.`,
  };
}
