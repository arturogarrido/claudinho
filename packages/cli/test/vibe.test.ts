import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdVibe } from '../src/commands';
import { makeT } from '../src/i18n';
import type { CliConfig } from '../src/config';

function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return { lang: 'en', tz: undefined, json: false, color: false, source: 'espn', ...over };
}
const ctx = (over: Partial<CliConfig> = {}) => ({ cfg: cfg(over), t: makeT('en') });

// Capture everything written to stdout so we can inspect the rendered output.
const outSpy = vi.spyOn(process.stdout, 'write');
let writes: string[] = [];
beforeEach(() => {
  writes = [];
  outSpy.mockImplementation((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  outSpy.mockReset();
});

const TAG = '#VibingLaVidaLoca';

describe('cmdVibe', () => {
  it('--json emits a { vibe, tag } object with the exact hashtag', () => {
    cmdVibe(ctx({ json: true }));
    const parsed = JSON.parse(writes.join(''));
    expect(parsed.tag).toBe(TAG);
    expect(typeof parsed.vibe).toBe('string');
    expect(parsed.vibe.length).toBeGreaterThan(0);
    // JSON mode must stay machine-clean: no ANSI, no emoji decoration.
    expect(writes.join('')).not.toContain('⚽');
  });

  it('text output carries the tag and the ⚽ marker', () => {
    cmdVibe(ctx({ json: false }));
    const text = writes.join('');
    expect(text).toContain(TAG);
    expect(text).toContain('⚽');
  });

  it('is offline and deterministic in shape across many runs', () => {
    for (let i = 0; i < 50; i++) {
      writes = [];
      cmdVibe(ctx({ json: true }));
      const parsed = JSON.parse(writes.join(''));
      expect(parsed.tag).toBe(TAG);
      expect(parsed.vibe).toBeTruthy();
    }
  });
});
