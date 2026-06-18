import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURSOR_MCP_SNIPPET, cmdInitClaude, cmdInitCursor } from '../src/commands';
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

describe('CURSOR_MCP_SNIPPET', () => {
  it('pins the same command as the plugin mcp.json (drift guard)', () => {
    const parsed = JSON.parse(CURSOR_MCP_SNIPPET) as {
      mcpServers: { claudinho: { command: string; args: string[] } };
    };
    expect(parsed.mcpServers.claudinho).toEqual({ command: 'npx', args: ['-y', '@claudinho/mcp'] });
  });
});

// Write-path integration: `init claude` must write BOTH the statusline and the
// hook to settings.json (parity bundle), and stay idempotent. Isolated via $HOME
// so it never touches the real ~/.claude (os.homedir() reads $HOME on POSIX).
describe('cmdInitClaude — write path (isolated HOME)', () => {
  let dir: string;
  const ORIG_HOME = process.env.HOME;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'claudinho-init-'));
    process.env.HOME = dir;
  });
  afterEach(() => {
    if (ORIG_HOME === undefined) delete process.env.HOME;
    else process.env.HOME = ORIG_HOME;
    rmSync(dir, { recursive: true, force: true });
  });

  const settings = () =>
    JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8')) as {
      statusLine?: { command?: string };
      hooks?: { UserPromptSubmit?: { hooks?: { command?: string }[] }[] };
    };

  it('writes statusline + hook in one go and prints the MCP one-liner', () => {
    cmdInitClaude({}, ctx());
    const s = settings();
    expect(s.statusLine?.command).toContain('claudinho prompt');
    expect((s.hooks?.UserPromptSubmit ?? []).length).toBeGreaterThan(0);
    expect(text()).toContain('claude mcp add claudinho -- npx -y @claudinho/mcp');
  });

  it('is idempotent — a second run reports already-configured, no duplicate hook', () => {
    cmdInitClaude({}, ctx());
    writes = [];
    cmdInitClaude({}, ctx());
    expect(text()).toContain('already configured');
    const claudinhoHooks = (settings().hooks?.UserPromptSubmit ?? [])
      .flatMap((m) => m.hooks ?? [])
      .filter((h) => String(h.command).includes('claudinho'));
    expect(claudinhoHooks).toHaveLength(1);
  });
});
