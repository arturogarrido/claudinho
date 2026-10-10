/**
 * `claudinho init-statusline` / `init-cursor-statusline` — wire claudinho into
 * Claude Code or Cursor CLI statuslines. Safe: preserves existing settings,
 * backs up before overwriting, and refuses to clobber unparseable files.
 * `claudinho init plugin` removes what `init claude` wrote, the same way.
 */
import { copyFileSync, existsSync, lstatSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeFileAtomic } from './paths';

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

/** A JSON object we can add keys to: non-null, not an array (audit A13). */
function isSettingsObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function manual(path: string, snippet: string, why: string): InitResult {
  return { action: 'manual', path, message: `${why} ${path}. Add this manually:\n${snippet}` };
}

/**
 * Read the settings file as an object, or say why we will not touch it. Valid
 * JSON whose root is not an object (`[]`, `null`, a string) used to be cast,
 * mutated (a property on an array serializes to nothing) and written back as
 * `written` — a success report with nothing installed (audit A13).
 */
function readSettings(path: string, snippet: string): InitResult | Record<string, unknown> {
  return readSettingsOr(path, (why) => manual(path, snippet, why));
}

/** {@link readSettings} with the caller's own answer to a file it will not touch (`why` names the reason). */
function readSettingsOr(
  path: string,
  refuse: (why: string) => InitResult,
): InitResult | Record<string, unknown> {
  // An existing symlink whose target is gone is not "absent": replacing it
  // with a regular file would silently detach a dotfiles setup (review P3).
  let entry: ReturnType<typeof lstatSync> | undefined;
  try {
    entry = lstatSync(path);
  } catch {
    return {}; // nothing there: a fresh settings file
  }
  if (entry.isSymbolicLink() && !existsSync(path)) {
    return refuse('Settings path is a symlink to a missing file:');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return refuse('Could not parse');
  }
  if (!isSettingsObject(parsed)) return refuse('Not a JSON settings object:');
  return parsed;
}

function isInitResult(v: InitResult | Record<string, unknown>): v is InitResult {
  return (
    typeof v.action === 'string' && typeof v.path === 'string' && typeof v.message === 'string'
  );
}

/** Settings files may carry secrets (env, tokens): a NEW one is created private. */
const SETTINGS_FILE_MODE = 0o600;
/** Settings are the ONE place a symlinked target is written through (a dotfiles link). */
const SETTINGS_WRITE = { mode: SETTINGS_FILE_MODE, followSymlinks: true } as const;

/**
 * The matchers under an event slot, exactly as `claudeHookCommands` and the
 * installer read them: each an object whose optional `hooks` is an array of
 * objects. Anything else threw mid-enumeration instead of reaching the manual
 * path (review P3 on #127).
 */
function validHookMatchers(slot: unknown[]): boolean {
  return slot.every(
    (m) =>
      isSettingsObject(m) &&
      (m.hooks === undefined || (Array.isArray(m.hooks) && m.hooks.every(isSettingsObject))),
  );
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
  // Atomic (tmp + rename): a crash mid-write must never truncate the user's
  // settings; the existing mode is preserved and a new file is private (A09).
  writeFileAtomic(path, JSON.stringify(settings, null, 2) + '\n', SETTINGS_WRITE);
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
  // The containers we mutate must have the shapes we assume (audit A13): a
  // `hooks` that is not an object, or an event slot that is not an array,
  // would be silently overwritten or corrupted.
  if (settings.hooks !== undefined && !isSettingsObject(settings.hooks)) {
    return manual(path, snippet, 'Unexpected "hooks" shape in');
  }
  const eventSlot = (settings.hooks as Record<string, unknown> | undefined)?.[CLAUDE_HOOK_EVENT];
  if (eventSlot !== undefined && (!Array.isArray(eventSlot) || !validHookMatchers(eventSlot))) {
    return manual(path, snippet, `Unexpected "hooks.${CLAUDE_HOOK_EVENT}" shape in`);
  }

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
  writeFileAtomic(path, JSON.stringify(settings, null, 2) + '\n', SETTINGS_WRITE);
  return {
    action: 'written',
    path,
    message: `Live-score hook configured in ${path}. Restart Claude Code; during matches, the score is injected into context on each prompt.`,
  };
}

// ---- The Claude Code plugin ----

/** The line that installs the Claude Code plugin from this repository's marketplace (typed in Claude Code). */
export const PLUGIN_INSTALL_LINE = '/plugin install claudinho --marketplace arturogarrido/claudinho';

/** The Claude Code MCP install one-liner (the `claude` CLI writes the config). */
export const CLAUDE_MCP_ONELINER = 'claude mcp add claudinho -- npx -y @claudinho/mcp';

/** What every `init plugin` message ends with: the two install lines, each on its own line. */
const PLUGIN_NEXT = `Install the plugin (in Claude Code), and the MCP tools (in a shell):\n${PLUGIN_INSTALL_LINE}\n${CLAUDE_MCP_ONELINER}`;

/**
 * A command that runs Claudinho but is not the one `init claude` writes (a
 * wrapper script, `npx -y @claudinho/cli hook`, an edited path): left in
 * place, and named so the user can remove it if the plugin replaces it.
 */
const RUNS_CLAUDINHO = /claudinho/i;

/**
 * Remove what `claudinho init claude` wrote to Claude Code's settings, for the
 * Claude Code plugin (whose band and prompt context replace them): the
 * `statusLine` whose command is EXACTLY `claudinho prompt`, and every
 * `hooks.UserPromptSubmit` command that is exactly `claudinho hook`; a matcher
 * left with no command is dropped, then the event key left with no matcher,
 * then a `hooks` left empty. Everything else stays as it was. A command that
 * runs Claudinho otherwise (a wrapper, an edited command) stays, and the
 * message names it. The same refusals as `init` (a symlink to nothing, a file
 * that is not a settings object, an unexpected `hooks` shape): nothing
 * written. Nothing of ours there (or no file at all): `already`, the file
 * untouched. The message always ends with the plugin's install line and the
 * MCP one-liner. Claude Code's settings only: Cursor's are not touched.
 */
export function initPlugin(opts: { path?: string } = {}): InitResult {
  const path = opts.path ?? claudeSettingsPath();
  const refuse = (why: string): InitResult => ({
    action: 'manual',
    path,
    message: `${why} ${path}. Nothing was changed: remove the "statusLine" whose command is "${DEFAULT_PROMPT_COMMAND}" and the "hooks.${CLAUDE_HOOK_EVENT}" command "${HOOK_COMMAND}" yourself, if they are there.\n${PLUGIN_NEXT}`,
  });
  const parsed = readSettingsOr(path, refuse);
  if (isInitResult(parsed)) return parsed;
  const settings = parsed;
  // The containers we edit must have the shapes we assume, as for `initHook`.
  if (settings.hooks !== undefined && !isSettingsObject(settings.hooks)) {
    return refuse('Unexpected "hooks" shape in');
  }
  const hooks = settings.hooks as Record<string, unknown> | undefined;
  const eventSlot = hooks?.[CLAUDE_HOOK_EVENT];
  if (eventSlot !== undefined && (!Array.isArray(eventSlot) || !validHookMatchers(eventSlot))) {
    return refuse(`Unexpected "hooks.${CLAUDE_HOOK_EVENT}" shape in`);
  }

  const left = new Set<string>();
  const removed: string[] = [];
  const statusLine = settings.statusLine;
  if (isSettingsObject(statusLine) && typeof statusLine.command === 'string') {
    if (statusLine.command === DEFAULT_PROMPT_COMMAND) {
      delete settings.statusLine;
      removed.push('the statusline');
    } else if (RUNS_CLAUDINHO.test(statusLine.command)) {
      left.add(statusLine.command);
    }
  }
  if (hooks && Array.isArray(eventSlot)) {
    let dropped = 0;
    const matchers: ClaudeHookMatcher[] = [];
    for (const matcher of eventSlot as ClaudeHookMatcher[]) {
      const commands = matcher.hooks;
      if (!commands) {
        matchers.push(matcher);
        continue;
      }
      const kept = commands.filter((h) => h.command !== HOOK_COMMAND);
      for (const h of kept) if (typeof h.command === 'string' && RUNS_CLAUDINHO.test(h.command)) left.add(h.command);
      dropped += commands.length - kept.length;
      // A matcher that held only ours goes with it; one that held others keeps them.
      if (kept.length === commands.length) matchers.push(matcher);
      else if (kept.length > 0) matchers.push({ ...matcher, hooks: kept });
    }
    if (dropped > 0) {
      removed.push('the live-score hook');
      if (matchers.length > 0) hooks[CLAUDE_HOOK_EVENT] = matchers;
      else {
        delete hooks[CLAUDE_HOOK_EVENT];
        if (Object.keys(hooks).length === 0) delete settings.hooks;
      }
    }
  }

  const named = left.size
    ? `\nLeft in place (not the commands init claude writes; remove them yourself if the plugin replaces them):\n${[...left].map((c) => `  ${c}`).join('\n')}`
    : '';
  if (removed.length === 0) {
    return {
      action: 'already',
      path,
      message: `Nothing init claude wrote is in ${path}; nothing was changed.${named}\n${PLUGIN_NEXT}`,
    };
  }
  backupOnce(path);
  writeFileAtomic(path, JSON.stringify(settings, null, 2) + '\n', SETTINGS_WRITE);
  return {
    action: 'written',
    path,
    message: `Removed ${removed.join(' and ')} that init claude wrote from ${path}.${named}\n${PLUGIN_NEXT}`,
  };
}
