import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cursorMetaEnabled,
  looksLikeCursorPayload,
  renderCursorMetaLine,
  renderPromptOutput,
} from '../src/cursorPayload';

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

  it('is off for CLAUDINHO_CURSOR_META=auto with empty payload fields', () => {
    process.env.CLAUDINHO_CURSOR_META = 'auto';
    expect(cursorMetaEnabled({ worktree: {} })).toBe(false);
  });
});

describe('looksLikeCursorPayload', () => {
  it('detects model, context, width, worktree, and vim hints', () => {
    expect(looksLikeCursorPayload({ model: { display_name: 'X' } })).toBe(true);
    expect(looksLikeCursorPayload({ context_window: { used_percentage: 1 } })).toBe(true);
    expect(looksLikeCursorPayload({ render_width_chars: 80 })).toBe(true);
    expect(looksLikeCursorPayload({ worktree: { name: 'wt' } })).toBe(true);
    expect(looksLikeCursorPayload({ vim: { mode: 'NORMAL' } })).toBe(true);
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

  it('includes worktree and vim mode when present', () => {
    const line = renderCursorMetaLine({
      model: { display_name: 'Opus' },
      worktree: { name: 'my-feature' },
      vim: { mode: 'NORMAL' },
    });
    expect(line).toContain('wt my-feature');
    expect(line).toContain('NORMAL');
  });

  it('returns undefined when there is nothing to show', () => {
    expect(renderCursorMetaLine({})).toBeUndefined();
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

  it('prepends a meta line when CLAUDINHO_CURSOR_META is on', () => {
    const out = renderPromptOutput('⚽ 1–0', {
      model: { display_name: 'Opus' },
      context_window: { used_percentage: 10 },
    });
    expect(out.split('\n')).toHaveLength(2);
    expect(out).toContain('Opus');
    expect(out).toContain('⚽ 1–0');
  });

  it('prepends meta under CLAUDINHO_CURSOR_META=auto', () => {
    process.env.CLAUDINHO_CURSOR_META = 'auto';
    const out = renderPromptOutput('⚽ 1–0', {
      model: { display_name: 'Opus' },
    });
    expect(out.split('\n')).toHaveLength(2);
  });

  it('truncates the score line to render_width_chars', () => {
    const long = 'GOAL ' + 'x'.repeat(40);
    const out = renderPromptOutput(long, { render_width_chars: 10 });
    expect(out).toBe('GOAL xxxx…');
    expect(out.length).toBe(10);
  });
});
