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

/**
 * Back up the settings file to `<path>.claudinho.bak`, but only if no claudinho
 * backup exists yet. This makes the FIRST claudinho edit's backup authoritative
 * — so the .bak always holds the user's pristine original, even if they later
 * run a second `init-` command (whose write would otherwise capture our own
 * earlier edit and clobber the real backup).
 */
function backupOnce(path: string): void {
  const bak = `${path}.claudinho.bak`;
  if (existsSync(path) && !existsSync(bak)) copyFileSync(path, bak);
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

  backupOnce(path);
  settings.statusLine = sl;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return {
    action: 'written',
    path,
    message: `Statusline configured in ${path}. Restart Claude Code to see it.`,
  };
}

// ---- UserPromptSubmit hook (makes Claude itself score-aware) ----

interface HookCommand {
  type: 'command';
  command: string;
  [k: string]: unknown;
}
interface HookMatcher {
  hooks?: HookCommand[];
  [k: string]: unknown;
}

/** The hook event whose stdout Claude Code injects into model context. */
const HOOK_EVENT = 'UserPromptSubmit';
const HOOK_COMMAND = 'claudinho hook';

/**
 * Wire `claudinho hook` into Claude Code's UserPromptSubmit so the live score
 * is injected into the model's context on each prompt. Merges into the existing
 * hooks array without clobbering other hooks; idempotent; backs up first;
 * refuses to clobber unparseable settings.
 */
export function initHook(opts: InitOpts = {}): InitResult {
  const path = opts.path ?? claudeSettingsPath();
  const command = opts.command ?? HOOK_COMMAND;
  const snippet = JSON.stringify(
    { hooks: { [HOOK_EVENT]: [{ hooks: [{ type: 'command', command }] }] } },
    null,
    2,
  );

  if (opts.print) return { action: 'printed', path, message: snippet };

  let settings: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      settings = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch {
      return {
        action: 'manual',
        path,
        message: `Could not parse ${path}. Add this manually:\n${snippet}`,
      };
    }
  }

  const hooks = (settings.hooks ??= {}) as Record<string, HookMatcher[]>;
  const matchers = (hooks[HOOK_EVENT] ??= []) as HookMatcher[];

  // Idempotent: bail if any existing entry already runs a claudinho hook.
  const already = matchers.some((m) =>
    (m.hooks ?? []).some((h) => typeof h.command === 'string' && h.command.includes('claudinho')),
  );
  if (already) {
    return { action: 'already', path, message: `UserPromptSubmit hook already uses claudinho (${path}).` };
  }

  backupOnce(path);
  matchers.push({ hooks: [{ type: 'command', command }] });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return {
    action: 'written',
    path,
    message: `Live-score hook configured in ${path}. Restart Claude Code; during matches, the score is injected into context on each prompt.`,
  };
}
