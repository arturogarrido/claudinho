import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdInitClaude, cmdInitCursor } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';

// The one-step `init cursor` / `init claude` aliases. We test --print mode: it
// composes the granular installers in print mode (no filesystem writes) and adds
// the MCP config + restart cue. The actual config WRITES are covered by
// install.test.ts (initStatusline/initHook/initCursorStatusline).

function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return { lang: 'en', tz: 'UTC', json: false, color: false, source: 'espn', flavor: 'off', ...over };
}
const ctx = (over: Partial<CliConfig> = {}) => ({ cfg: cfg(over), t: makeT('en') });

const outSpy = vi.spyOn(process.stdout, 'write');
let writes: string[] = [];
beforeEach(() => {
  writes = [];
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
});
afterEach(() => outSpy.mockReset());
const text = () => writes.join('');

describe('cmdInitCursor --print', () => {
  it('emits the Cursor statusline snippet + the MCP paste, no claude/hook bits', () => {
    cmdInitCursor({ print: true }, ctx());
    const o = text();
    expect(o).toContain('"statusLine"');
    expect(o).toContain('claudinho prompt');
    expect(o).toContain('updateIntervalMs'); // Cursor-specific tuning
    expect(o).toContain('~/.cursor/cli-config.json');
    expect(o).toContain('"mcpServers"');
    expect(o).toContain('npx');
    expect(o).toContain('@claudinho/mcp');
    // Cursor has no hook / no `claude mcp add`.
    expect(o).not.toContain('UserPromptSubmit');
    expect(o).not.toContain('claude mcp add');
  });
});

describe('cmdInitClaude --print', () => {
  it('emits statusline + the UserPromptSubmit hook + the MCP add one-liner (parity)', () => {
    cmdInitClaude({ print: true }, ctx());
    const o = text();
    expect(o).toContain('"statusLine"');
    expect(o).toContain('claudinho prompt');
    expect(o).toContain('"UserPromptSubmit"'); // the hook — parity with init cursor's bundle
    expect(o).toContain('claudinho hook');
    expect(o).toContain('claude mcp add claudinho -- npx -y @claudinho/mcp');
    // Claude statusline has no Cursor-only tuning.
    expect(o).not.toContain('updateIntervalMs');
  });
});
