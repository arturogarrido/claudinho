/**
 * Cursor CLI statusline stdin payload — optional meta line below the score.
 * The hot path always drains stdin (even when meta is off) so the pipe never
 * blocks. Meta rendering is gated on CLAUDINHO_CURSOR_META.
 *
 * The payload is INPUT from another process, so it gets the same treatment a
 * feed does (audit A08): bytes are bounded before they are stored, the envelope
 * is validated field by field instead of cast, every label goes through the
 * shared human-label role (no controls, no format characters, no emoji, bounded
 * columns), and the combined meta line is bounded. Only product-owned ANSI
 * reaches stdout.
 */
import { humanLabel } from '@claudinho/core';
import { readFileSync } from 'node:fs';

export interface CursorStatusLinePayload {
  model?: { display_name?: string; param_summary?: string };
  context_window?: { used_percentage?: number | null };
  worktree?: { name?: string };
  vim?: { mode?: string };
  render_width_chars?: number;
}

/**
 * Bytes of stdin read before the rest is dropped. A real Claude Code / Cursor
 * payload is five small fields (well under 4 KiB); this is a work bound, not a
 * compatibility threshold — re-check it against a captured real payload if a
 * host ever grows one.
 */
export const MAX_CURSOR_PAYLOAD_BYTES = 64 * 1024;

/** Display columns one label may take; four of them plus fixed tokens stay under ~200. */
export const MAX_CURSOR_LABEL_COLUMNS = 40;

/** A label from the payload, or undefined when nothing displayable survives. */
function label(v: unknown): string | undefined {
  const s = humanLabel(v, MAX_CURSOR_LABEL_COLUMNS);
  return s === '' ? undefined : s;
}

function finite(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function record(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

/**
 * Validate a parsed JSON value into a payload. Unknown keys are dropped, every
 * kept field is type-checked, and every string is a bounded human label.
 * Returns undefined for anything that is not a JSON object.
 */
export function validateCursorPayload(parsed: unknown): CursorStatusLinePayload | undefined {
  const p = record(parsed);
  if (!p) return undefined;
  const out: CursorStatusLinePayload = {};

  const model = record(p.model);
  if (model) {
    const display_name = label(model.display_name);
    const param_summary = label(model.param_summary);
    if (display_name || param_summary) {
      out.model = {
        ...(display_name ? { display_name } : {}),
        ...(param_summary ? { param_summary } : {}),
      };
    }
  }

  const cw = record(p.context_window);
  if (cw) {
    if (cw.used_percentage === null) out.context_window = { used_percentage: null };
    else {
      const pct = finite(cw.used_percentage);
      if (pct !== undefined) out.context_window = { used_percentage: pct };
    }
  }

  const wt = record(p.worktree);
  const name = wt ? label(wt.name) : undefined;
  if (name) out.worktree = { name };

  const vim = record(p.vim);
  const mode = vim ? label(vim.mode) : undefined;
  if (mode) out.vim = { mode };

  const width = finite(p.render_width_chars);
  if (width !== undefined && width > 0) out.render_width_chars = Math.floor(width);

  return out;
}

/** Parse a Cursor statusline JSON string. Never throws. */
export function parseCursorPayload(raw: string): CursorStatusLinePayload | undefined {
  try {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    return validateCursorPayload(JSON.parse(trimmed));
  } catch {
    return undefined;
  }
}

/**
 * Read and parse the Cursor statusline JSON from stdin. Never throws.
 *
 * CAUTION: `readFileSync(0)` blocks until EOF — an open pipe with no writer
 * hangs it FOREVER (it froze the first windows-latest CI leg for 62 minutes,
 * PR #77). The shipped binary therefore drains stdin via
 * {@link readCursorPayloadBounded} and passes the payload into cmdPrompt; this
 * sync variant remains only as the in-process fallback (tests mock it).
 */
export function readCursorPayload(): CursorStatusLinePayload | undefined {
  try {
    if (process.stdin.isTTY) return undefined;
    return parseCursorPayload(readFileSync(0, 'utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Read the statusline stdin payload with a BOUNDED wait and a BOUNDED size.
 * Claude Code and Cursor write their JSON and close stdin immediately, so the
 * normal path resolves on 'end' within milliseconds; the timeout fires only for
 * a writerless open pipe (tmux misconfig, harnesses), where the statusline
 * proceeds without a payload (the meta line is simply absent) instead of
 * hanging forever. Past {@link MAX_CURSOR_PAYLOAD_BYTES} the read stops and the
 * payload is dropped — the score line never depends on it.
 */
export function readCursorPayloadBounded(
  timeoutMs = 100,
  stdin: NodeJS.ReadStream = process.stdin,
  maxBytes = MAX_CURSOR_PAYLOAD_BYTES,
): Promise<CursorStatusLinePayload | undefined> {
  if (stdin.isTTY) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let overflow = false;
    const done = () => {
      clearTimeout(timer);
      stdin.off('data', onData);
      stdin.off('end', done);
      stdin.off('error', done);
      stdin.pause();
      // Parse whatever arrived — parseCursorPayload never throws; a timed-out
      // writerless pipe yields '' → undefined; an oversized payload is dropped
      // whole rather than parsed in part.
      resolve(overflow ? undefined : parseCursorPayload(Buffer.concat(chunks).toString('utf8')));
    };
    const onData = (c: Buffer) => {
      // Bound BEFORE storing: the ceiling is on bytes accepted, not on bytes
      // rendered after the fact.
      total += c.length;
      if (total > maxBytes) {
        overflow = true;
        done();
        return;
      }
      chunks.push(c);
    };
    const timer = setTimeout(done, timeoutMs);
    timer.unref?.();
    stdin.on('data', onData);
    stdin.once('end', done);
    stdin.once('error', done);
    stdin.resume();
  });
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

/**
 * One dim meta line: model, context %, worktree, vim mode.
 *
 * Labels are run through the human-label role HERE as well as at parse time:
 * this is where bytes reach stdout, and a caller may hand the renderer an
 * object that never went through {@link parseCursorPayload}.
 */
export function renderCursorMetaLine(payload: CursorStatusLinePayload): string | undefined {
  const parts: string[] = [];
  const model = label(payload.model?.display_name);
  if (model) {
    const summary = label(payload.model?.param_summary);
    parts.push(summary ? `${model} ${summary}` : model);
  }
  const pct = payload.context_window?.used_percentage;
  if (typeof pct === 'number' && Number.isFinite(pct)) {
    parts.push(`ctx ${Math.floor(pct)}%`);
  }
  const wt = label(payload.worktree?.name);
  if (wt) parts.push(`wt ${wt}`);
  const vim = label(payload.vim?.mode);
  if (vim) parts.push(vim);
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
