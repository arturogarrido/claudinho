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
export type HookTarget = 'claude' | 'cursor';

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

export function cursorHooksPath(): string {
  return join(homedir(), '.cursor', 'hooks.json');
}

/** True when a config command already runs claudinho prompt or hook. */
export function isClaudinhoCommand(command: string): boolean {
  return /\bclaudinho\s+(prompt|hook)\b/.test(command);
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

function hookPathFor(target: HookTarget, override?: string): string {
  if (override) return override;
  return target === 'cursor' ? cursorHooksPath() : claudeSettingsPath();
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
  if (existing?.command && isClaudinhoCommand(existing.command)) {
    const label = target === 'cursor' ? 'Cursor CLI statusline' : 'Statusline';
    return { action: 'already', path, message: `${label} already uses claudinho (${path}).` };
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

// ---- Hooks (Claude UserPromptSubmit / Cursor beforeSubmitPrompt) ----

interface ClaudeHookCommand {
  type: 'command';
  command: string;
  [k: string]: unknown;
}
interface ClaudeHookMatcher {
  hooks?: ClaudeHookCommand[];
  [k: string]: unknown;
}

interface CursorHookEntry {
  command: string;
  [k: string]: unknown;
}

const CLAUDE_HOOK_EVENT = 'UserPromptSubmit';
const CURSOR_HOOK_EVENT = 'beforeSubmitPrompt';
const CURSOR_HOOKS_VERSION = 1;

function hookSnippet(target: HookTarget, command: string): string {
  if (target === 'claude') {
    return JSON.stringify(
      { hooks: { [CLAUDE_HOOK_EVENT]: [{ hooks: [{ type: 'command', command }] }] } },
      null,
      2,
    );
  }
  return JSON.stringify(
    { version: CURSOR_HOOKS_VERSION, hooks: { [CURSOR_HOOK_EVENT]: [{ command }] } },
    null,
    2,
  );
}

function hookAlreadyConfigured(settings: Record<string, unknown>, target: HookTarget): boolean {
  const hooks = settings.hooks as Record<string, unknown> | undefined;
  if (!hooks) return false;
  if (target === 'claude') {
    const matchers = (hooks[CLAUDE_HOOK_EVENT] ?? []) as ClaudeHookMatcher[];
    return matchers.some((m) =>
      (m.hooks ?? []).some(
        (h) => typeof h.command === 'string' && isClaudinhoCommand(h.command),
      ),
    );
  }
  const entries = (hooks[CURSOR_HOOK_EVENT] ?? []) as CursorHookEntry[];
  return entries.some((e) => typeof e.command === 'string' && isClaudinhoCommand(e.command));
}

function installHook(settings: Record<string, unknown>, target: HookTarget, command: string): void {
  settings.hooks ??= {};
  const hooks = settings.hooks as Record<string, unknown>;
  if (target === 'claude') {
    hooks[CLAUDE_HOOK_EVENT] ??= [];
    (hooks[CLAUDE_HOOK_EVENT] as ClaudeHookMatcher[]).push({
      hooks: [{ type: 'command', command }],
    });
    return;
  }
  settings.version ??= CURSOR_HOOKS_VERSION;
  hooks[CURSOR_HOOK_EVENT] ??= [];
  (hooks[CURSOR_HOOK_EVENT] as CursorHookEntry[]).push({ command });
}

function hookWrittenMessage(target: HookTarget, path: string): string {
  if (target === 'cursor') {
    return `Live-score hook configured in ${path}. Restart Cursor CLI; during matches, claudinho hook runs on each prompt (context injection depends on Cursor hook support).`;
  }
  return `Live-score hook configured in ${path}. Restart Claude Code; during matches, the score is injected into context on each prompt.`;
}

function hookAlreadyMessage(target: HookTarget, path: string): string {
  const event = target === 'cursor' ? 'beforeSubmitPrompt' : 'UserPromptSubmit';
  return `${event} hook already uses claudinho (${path}).`;
}

/**
 * Wire `claudinho hook` into Claude Code or Cursor CLI hooks.
 * Idempotent; backs up first; refuses to clobber unparseable files.
 */
export function initHookFor(target: HookTarget, opts: InitOpts = {}): InitResult {
  const path = hookPathFor(target, opts.path);
  const command = opts.command ?? HOOK_COMMAND;
  const snippet = hookSnippet(target, command);

  if (opts.print) return { action: 'printed', path, message: snippet };

  const parsed = readSettings(path, snippet);
  if (isInitResult(parsed)) return parsed;
  const settings = parsed;

  if (hookAlreadyConfigured(settings, target)) {
    return { action: 'already', path, message: hookAlreadyMessage(target, path) };
  }

  backupOnce(path);
  installHook(settings, target, command);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return { action: 'written', path, message: hookWrittenMessage(target, path) };
}

/** Wire claudinho into Claude Code's UserPromptSubmit hook. */
export function initHook(opts: InitOpts = {}): InitResult {
  return initHookFor('claude', opts);
}

/** Wire claudinho into Cursor's beforeSubmitPrompt hook. */
export function initCursorHook(opts: InitOpts = {}): InitResult {
  return initHookFor('cursor', opts);
}
