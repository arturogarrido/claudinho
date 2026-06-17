/**
 * `claudinho init-statusline` / `init-cursor-statusline` — wire claudinho into
 * Claude Code or Cursor CLI statuslines. Safe: preserves existing settings,
 * backs up before overwriting, and refuses to clobber unparseable files.
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

export type StatuslineTarget = 'claude' | 'cursor';

export interface StatusLineConfig {
  type: 'command';
  command: string;
  padding?: number;
  updateIntervalMs?: number;
  timeoutMs?: number;
}

export interface InitResult {
  action: 'written' | 'already' | 'printed' | 'manual';
  path: string;
  message: string;
}

export function claudeSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}

export function cursorCliConfigPath(): string {
  return join(homedir(), '.cursor', 'cli-config.json');
}

/** True when the configured command matches the one being installed (exact). */
export function isSameCommand(configured: string | undefined, requested: string): boolean {
  return configured === requested;
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

const DEFAULT_PROMPT_COMMAND = 'claudinho prompt';
const HOOK_COMMAND = 'claudinho hook';

/** Cursor-specific tuning: scores don't need 300ms polling; stay under timeout. */
const CURSOR_STATUSLINE_DEFAULTS = {
  padding: 0,
  updateIntervalMs: 1000,
  timeoutMs: 1500,
} as const;

function configPathFor(target: StatuslineTarget, override?: string): string {
  if (override) return override;
  return target === 'cursor' ? cursorCliConfigPath() : claudeSettingsPath();
}

function defaultStatusLineConfig(
  target: StatuslineTarget,
  command: string,
): StatusLineConfig {
  const base: StatusLineConfig = { type: 'command', command };
  if (target === 'cursor') return { ...base, ...CURSOR_STATUSLINE_DEFAULTS };
  return base;
}

function restartMessage(target: StatuslineTarget): string {
  return target === 'cursor'
    ? 'Restart Cursor CLI (or start a new session) to see it.'
    : 'Restart Claude Code to see it.';
}

function readSettings(path: string, snippet: string): InitResult | Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return {
      action: 'manual',
      path,
      message: `Could not parse ${path}. Add this manually:\n${snippet}`,
    };
  }
}

function isInitResult(v: InitResult | Record<string, unknown>): v is InitResult {
  return 'action' in v && typeof v.action === 'string';
}

/**
 * Wire `claudinho prompt` into a Claude Code or Cursor CLI statusline.
 * Idempotent; backs up first; refuses to clobber unparseable files.
 */
export function initStatuslineFor(
  target: StatuslineTarget,
  opts: InitOpts = {},
): InitResult {
  const path = configPathFor(target, opts.path);
  const command = opts.command ?? DEFAULT_PROMPT_COMMAND;
  const sl = defaultStatusLineConfig(target, command);
  const snippet = JSON.stringify({ statusLine: sl }, null, 2);

  if (opts.print) {
    return { action: 'printed', path, message: snippet };
  }

  const parsed = readSettings(path, snippet);
  if (isInitResult(parsed)) return parsed;
  const settings = parsed;

  const existing = settings.statusLine as StatusLineConfig | undefined;
  if (isSameCommand(existing?.command, command)) {
    const label = target === 'cursor' ? 'Cursor CLI statusline' : 'Statusline';
    return { action: 'already', path, message: `${label} already configured (${path}).` };
  }

  backupOnce(path);
  settings.statusLine = sl;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  const surface = target === 'cursor' ? 'Cursor CLI statusline' : 'Statusline';
  return {
    action: 'written',
    path,
    message: `${surface} configured in ${path}. ${restartMessage(target)}`,
  };
}

/** Wire claudinho into Claude Code's statusline (~/.claude/settings.json). */
export function initStatusline(opts: InitOpts = {}): InitResult {
  return initStatuslineFor('claude', opts);
}

/** Wire claudinho into Cursor CLI's statusline (~/.cursor/cli-config.json). */
export function initCursorStatusline(opts: InitOpts = {}): InitResult {
  return initStatuslineFor('cursor', opts);
}

// ---- Claude Code UserPromptSubmit hook ----

interface ClaudeHookCommand {
  type: 'command';
  command: string;
  [k: string]: unknown;
}
interface ClaudeHookMatcher {
  hooks?: ClaudeHookCommand[];
  [k: string]: unknown;
}

const CLAUDE_HOOK_EVENT = 'UserPromptSubmit';

function claudeHookCommands(settings: Record<string, unknown>): string[] {
  const hooks = settings.hooks as Record<string, ClaudeHookMatcher[]> | undefined;
  const matchers = hooks?.[CLAUDE_HOOK_EVENT] ?? [];
  return matchers.flatMap((m) =>
    (m.hooks ?? [])
      .map((h) => h.command)
      .filter((c): c is string => typeof c === 'string'),
  );
}

/**
 * Wire `claudinho hook` into Claude Code's UserPromptSubmit so the live score
 * is injected into the model's context on each prompt.
 */
export function initHook(opts: InitOpts = {}): InitResult {
  const path = opts.path ?? claudeSettingsPath();
  const command = opts.command ?? HOOK_COMMAND;
  const snippet = JSON.stringify(
    { hooks: { [CLAUDE_HOOK_EVENT]: [{ hooks: [{ type: 'command', command }] }] } },
    null,
    2,
  );

  if (opts.print) return { action: 'printed', path, message: snippet };

  const parsed = readSettings(path, snippet);
  if (isInitResult(parsed)) return parsed;
  const settings = parsed;

  if (claudeHookCommands(settings).some((c) => isSameCommand(c, command))) {
    return {
      action: 'already',
      path,
      message: `UserPromptSubmit hook already configured (${path}).`,
    };
  }

  backupOnce(path);
  settings.hooks ??= {};
  const hooks = settings.hooks as Record<string, ClaudeHookMatcher[]>;
  hooks[CLAUDE_HOOK_EVENT] ??= [];
  hooks[CLAUDE_HOOK_EVENT].push({ hooks: [{ type: 'command', command }] });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return {
    action: 'written',
    path,
    message: `Live-score hook configured in ${path}. Restart Claude Code; during matches, the score is injected into context on each prompt.`,
  };
}
