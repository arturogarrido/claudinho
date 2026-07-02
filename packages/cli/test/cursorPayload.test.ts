import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cursorMetaEnabled,
  looksLikeCursorPayload,
  parseCursorPayload,
  readCursorPayloadBounded,
  renderCursorMetaLine,
  renderPromptOutput,
} from '../src/cursorPayload';

describe('readCursorPayloadBounded — the statusline must never hang on stdin', () => {
  const asStdin = (s: PassThrough) => s as unknown as NodeJS.ReadStream;

  it('resolves (no payload) within the bound on a writerless open pipe — the PR #77 hang class', async () => {
    const stdin = new PassThrough();
    const t0 = Date.now();
    const payload = await readCursorPayloadBounded(50, asStdin(stdin));
    expect(payload).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(2000); // resolved by the timer, not EOF
  });

  it('parses a payload written-then-closed (the real Claude Code / Cursor shape)', async () => {
    const stdin = new PassThrough();
    const promise = readCursorPayloadBounded(5000, asStdin(stdin));
    stdin.end(JSON.stringify({ model: { display_name: 'Composer 2.5' } }));
    expect((await promise)?.model?.display_name).toBe('Composer 2.5');
  });

  it('short-circuits on a TTY (interactive shells get no drain at all)', async () => {
    const stdin = { isTTY: true } as unknown as NodeJS.ReadStream;
    expect(await readCursorPayloadBounded(50, stdin)).toBeUndefined();
  });
});

describe('parseCursorPayload', () => {
  it('parses valid JSON and returns undefined for empty or invalid input', () => {
    expect(parseCursorPayload('{"model":{"display_name":"Opus"}}')?.model?.display_name).toBe(
      'Opus',
    );
    expect(parseCursorPayload('')).toBeUndefined();
    expect(parseCursorPayload('{ bad')).toBeUndefined();
  });
});

describe('cursorMetaEnabled', () => {
  const prev = process.env.CLAUDINHO_CURSOR_META;
  afterEach(() => {
    if (prev === undefined) delete process.env.CLAUDINHO_CURSOR_META;
    else process.env.CLAUDINHO_CURSOR_META = prev;
  });

  const payload = {
    model: { display_name: 'Composer 2.5' },
    context_window: { used_percentage: 10 },
  };

  it('is off by default (no env, even with a payload)', () => {
    delete process.env.CLAUDINHO_CURSOR_META;
    expect(cursorMetaEnabled(payload)).toBe(false);
  });

  it('is on for CLAUDINHO_CURSOR_META=1', () => {
    process.env.CLAUDINHO_CURSOR_META = '1';
    expect(cursorMetaEnabled(payload)).toBe(true);
  });

  it('is on for CLAUDINHO_CURSOR_META=auto when payload looks like Cursor', () => {
    process.env.CLAUDINHO_CURSOR_META = 'auto';
    expect(cursorMetaEnabled(payload)).toBe(true);
    expect(cursorMetaEnabled({})).toBe(false);
  });
});

describe('looksLikeCursorPayload', () => {
  it('detects model, context, width, worktree, and vim hints', () => {
    expect(looksLikeCursorPayload({ model: { display_name: 'X' } })).toBe(true);
    expect(looksLikeCursorPayload({ context_window: { used_percentage: 1 } })).toBe(true);
    expect(looksLikeCursorPayload({ render_width_chars: 80 })).toBe(true);
    expect(looksLikeCursorPayload({})).toBe(false);
  });
});

describe('renderCursorMetaLine', () => {
  it('renders model and context percentage', () => {
    const line = renderCursorMetaLine({
      model: { display_name: 'Composer 2.5', param_summary: '(Fast)' },
      context_window: { used_percentage: 34.5 },
    });
    expect(line).toContain('Composer 2.5 (Fast)');
    expect(line).toContain('ctx 34%');
    expect(line?.startsWith('\x1b[90m')).toBe(true);
  });
});

describe('renderPromptOutput', () => {
  const prev = process.env.CLAUDINHO_CURSOR_META;
  beforeEach(() => {
    process.env.CLAUDINHO_CURSOR_META = '1';
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.CLAUDINHO_CURSOR_META;
    else process.env.CLAUDINHO_CURSOR_META = prev;
  });

  it('returns only the score line when meta is disabled', () => {
    process.env.CLAUDINHO_CURSOR_META = '0';
    const out = renderPromptOutput('⚽ 1–0', {
      model: { display_name: 'Opus' },
    });
    expect(out).toBe('⚽ 1–0');
  });

  it('puts the score line first, meta second', () => {
    const out = renderPromptOutput('⚽ 1–0', {
      model: { display_name: 'Opus' },
      context_window: { used_percentage: 10 },
    });
    const lines = out.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('⚽ 1–0');
    expect(lines[1]).toContain('Opus');
  });

  it('does not truncate emoji score lines (Cursor clips its own pane)', () => {
    const score = '⚽ 🇲🇽 1–0 🇿🇦 67\'';
    const out = renderPromptOutput(score, { render_width_chars: 6 });
    expect(out).toBe(score);
  });
});
