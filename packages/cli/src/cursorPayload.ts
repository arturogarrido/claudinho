/**
 * Cursor CLI statusline stdin payload — optional meta line below the score.
 * The hot path always drains stdin (even when meta is off) so the pipe never
 * blocks. Meta rendering is gated on CLAUDINHO_CURSOR_META.
 */
import { readFileSync } from 'node:fs';

export interface CursorStatusLinePayload {
  model?: { display_name?: string; param_summary?: string };
  context_window?: { used_percentage?: number | null };
  worktree?: { name?: string };
  vim?: { mode?: string };
  render_width_chars?: number;
}

/** Parse a Cursor statusline JSON string. Never throws. */
export function parseCursorPayload(raw: string): CursorStatusLinePayload | undefined {
  try {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    return JSON.parse(trimmed) as CursorStatusLinePayload;
  } catch {
    return undefined;
  }
}

/** Read and parse the Cursor statusline JSON from stdin. Never throws. */
export function readCursorPayload(): CursorStatusLinePayload | undefined {
  try {
    if (process.stdin.isTTY) return undefined;
    return parseCursorPayload(readFileSync(0, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Heuristic: stdin JSON looks like a Cursor StatusLinePayload. */
export function looksLikeCursorPayload(payload: CursorStatusLinePayload): boolean {
  return !!(
    payload.model?.display_name ||
    payload.context_window != null ||
    payload.render_width_chars != null ||
    payload.worktree?.name ||
    payload.vim?.mode
  );
}

/**
 * True when a session meta line should render below scores.
 * - `1` / `true` / `yes` — always on when a payload is present
 * - `auto` — on when stdin looks like Cursor's payload
 * - unset / `0` — off (tmux, Starship, manual runs)
 */
export function cursorMetaEnabled(payload?: CursorStatusLinePayload): boolean {
  const v = (process.env.CLAUDINHO_CURSOR_META ?? '').toLowerCase();
  if (v === '0' || v === 'false' || v === 'no') return false;
  if (v === '1' || v === 'true' || v === 'yes') return !!payload;
  if (v === 'auto') return !!payload && looksLikeCursorPayload(payload);
  return false;
}

/** One dim meta line: model, context %, worktree, vim mode. */
export function renderCursorMetaLine(payload: CursorStatusLinePayload): string | undefined {
  const parts: string[] = [];
  const model = payload.model?.display_name;
  if (model) {
    let label = model;
    if (payload.model?.param_summary) label += ` ${payload.model.param_summary}`;
    parts.push(label);
  }
  const pct = payload.context_window?.used_percentage;
  if (typeof pct === 'number' && Number.isFinite(pct)) {
    parts.push(`ctx ${Math.floor(pct)}%`);
  }
  if (payload.worktree?.name) parts.push(`wt ${payload.worktree.name}`);
  if (payload.vim?.mode) parts.push(payload.vim.mode);
  if (parts.length === 0) return undefined;
  return `\x1b[90m${parts.join('  ')}\x1b[0m`;
}

/**
 * Combine the score line with an optional Cursor meta line (score first so a
 * single-line render still shows the match). Width truncation is intentionally
 * omitted — Cursor clips its own pane and naive slice() corrupts emoji flags.
 */
export function renderPromptOutput(
  scoreLine: string,
  payload: CursorStatusLinePayload | undefined,
): string {
  const meta =
    payload && cursorMetaEnabled(payload) ? renderCursorMetaLine(payload) : undefined;
  if (meta) return `${scoreLine}\n${meta}`;
  return scoreLine;
}
