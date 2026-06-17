import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initCursorStatusline, initHook, initStatusline, isSameCommand } from '../src/install';

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-install-'));
  path = join(dir, 'settings.json');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('isSameCommand', () => {
  it('matches only exact command strings', () => {
    expect(isSameCommand('claudinho prompt', 'claudinho prompt')).toBe(true);
    expect(isSameCommand('node /x/claudinho prompt', 'claudinho prompt')).toBe(false);
    expect(isSameCommand(undefined, 'claudinho prompt')).toBe(false);
  });
});

describe('initStatusline', () => {
  it('prints the snippet without writing when print=true', () => {
    const res = initStatusline({ print: true, path });
    expect(res.action).toBe('printed');
    expect(res.message).toContain('"statusLine"');
    expect(res.message).toContain('claudinho prompt');
    expect(existsSync(path)).toBe(false);
  });

  it('writes a fresh settings file', () => {
    const res = initStatusline({ path });
    expect(res.action).toBe('written');
    const written = JSON.parse(readFileSync(path, 'utf8'));
    expect(written.statusLine).toEqual({ type: 'command', command: 'claudinho prompt' });
  });

  it('preserves existing settings keys', () => {
    writeFileSync(path, JSON.stringify({ theme: 'dark', model: 'opus' }));
    initStatusline({ path });
    const written = JSON.parse(readFileSync(path, 'utf8'));
    expect(written.theme).toBe('dark');
    expect(written.model).toBe('opus');
    expect(written.statusLine.command).toBe('claudinho prompt');
  });

  it('is idempotent (already configured)', () => {
    initStatusline({ path });
    const res = initStatusline({ path });
    expect(res.action).toBe('already');
  });

  it('is idempotent with a custom --command path', () => {
    const custom = 'node /path/to/claudinho/packages/cli/dist/index.js prompt';
    initCursorStatusline({ path, command: custom });
    const res = initCursorStatusline({ path, command: custom });
    expect(res.action).toBe('already');
    const written = JSON.parse(readFileSync(path, 'utf8'));
    expect(written.statusLine.command).toBe(custom);
  });

  it('backs up before overwriting a different statusline', () => {
    writeFileSync(path, JSON.stringify({ statusLine: { type: 'command', command: 'other-tool' } }));
    const res = initStatusline({ path });
    expect(res.action).toBe('written');
    expect(existsSync(`${path}.claudinho.bak`)).toBe(true);
    const bak = JSON.parse(readFileSync(`${path}.claudinho.bak`, 'utf8'));
    expect(bak.statusLine.command).toBe('other-tool');
  });

  it('refuses to clobber unparseable JSON', () => {
    writeFileSync(path, '{ broken');
    const res = initStatusline({ path });
    expect(res.action).toBe('manual');
    expect(readFileSync(path, 'utf8')).toBe('{ broken');
  });
});

describe('initHook', () => {
  it('prints the snippet without writing when print=true', () => {
    const res = initHook({ print: true, path });
    expect(res.action).toBe('printed');
    expect(res.message).toContain('UserPromptSubmit');
    expect(res.message).toContain('claudinho hook');
    expect(existsSync(path)).toBe(false);
  });

  it('writes a fresh UserPromptSubmit hook', () => {
    const res = initHook({ path });
    expect(res.action).toBe('written');
    const w = JSON.parse(readFileSync(path, 'utf8'));
    expect(w.hooks.UserPromptSubmit[0].hooks[0]).toEqual({ type: 'command', command: 'claudinho hook' });
  });

  it('preserves existing settings and other hook events', () => {
    writeFileSync(
      path,
      JSON.stringify({ theme: 'dark', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'other' }] }] } }),
    );
    initHook({ path });
    const w = JSON.parse(readFileSync(path, 'utf8'));
    expect(w.theme).toBe('dark');
    expect(w.hooks.Stop[0].hooks[0].command).toBe('other');
    expect(w.hooks.UserPromptSubmit[0].hooks[0].command).toBe('claudinho hook');
  });

  it('merges alongside a pre-existing non-claudinho UserPromptSubmit hook', () => {
    writeFileSync(
      path,
      JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'lint' }] }] } }),
    );
    initHook({ path });
    const w = JSON.parse(readFileSync(path, 'utf8'));
    const cmds = w.hooks.UserPromptSubmit.flatMap((m: { hooks: { command: string }[] }) =>
      m.hooks.map((h) => h.command),
    );
    expect(cmds).toContain('lint');
    expect(cmds).toContain('claudinho hook');
  });

  it('is idempotent (already configured)', () => {
    initHook({ path });
    const res = initHook({ path });
    expect(res.action).toBe('already');
    const w = JSON.parse(readFileSync(path, 'utf8'));
    expect(w.hooks.UserPromptSubmit).toHaveLength(1);
  });

  it('is idempotent with a custom --command path', () => {
    const custom = 'node /path/to/claudinho/packages/cli/dist/index.js hook';
    initHook({ path, command: custom });
    const res = initHook({ path, command: custom });
    expect(res.action).toBe('already');
    const w = JSON.parse(readFileSync(path, 'utf8'));
    expect(w.hooks.UserPromptSubmit).toHaveLength(1);
    expect(w.hooks.UserPromptSubmit[0].hooks[0].command).toBe(custom);
  });

  it('refuses to clobber unparseable JSON', () => {
    writeFileSync(path, '{ broken');
    const res = initHook({ path });
    expect(res.action).toBe('manual');
    expect(readFileSync(path, 'utf8')).toBe('{ broken');
  });
});

describe('backup is the pristine original across multiple init- commands', () => {
  it('keeps the FIRST backup after init-statusline THEN init-hook', () => {
    const original = { theme: 'dark', model: 'opus' };
    writeFileSync(path, JSON.stringify(original));

    initStatusline({ path });
    initHook({ path });

    const bak = JSON.parse(readFileSync(`${path}.claudinho.bak`, 'utf8'));
    expect(bak).toEqual(original);

    const live = JSON.parse(readFileSync(path, 'utf8'));
    expect(live.statusLine.command).toBe('claudinho prompt');
    expect(live.hooks.UserPromptSubmit[0].hooks[0].command).toBe('claudinho hook');
    expect(live.theme).toBe('dark');
  });

  it('keeps the FIRST backup regardless of init- order (hook then statusline)', () => {
    const original = { permissions: { allow: ['x'] } };
    writeFileSync(path, JSON.stringify(original));
    initHook({ path });
    initStatusline({ path });
    const bak = JSON.parse(readFileSync(`${path}.claudinho.bak`, 'utf8'));
    expect(bak).toEqual(original);
  });
});

describe('initCursorStatusline', () => {
  it('prints Cursor tuning fields when print=true', () => {
    const res = initCursorStatusline({ print: true, path });
    expect(res.action).toBe('printed');
    expect(res.message).toContain('"updateIntervalMs": 1000');
    expect(res.message).toContain('"timeoutMs": 1500');
    expect(res.message).toContain('claudinho prompt');
  });

  it('writes Cursor statusline config with tuning defaults', () => {
    const res = initCursorStatusline({ path });
    expect(res.action).toBe('written');
    const written = JSON.parse(readFileSync(path, 'utf8'));
    expect(written.statusLine).toEqual({
      type: 'command',
      command: 'claudinho prompt',
      padding: 0,
      updateIntervalMs: 1000,
      timeoutMs: 1500,
    });
  });

  it('preserves existing cli-config keys', () => {
    writeFileSync(path, JSON.stringify({ model: { modelId: 'composer' }, hints: true }));
    initCursorStatusline({ path });
    const written = JSON.parse(readFileSync(path, 'utf8'));
    expect(written.model.modelId).toBe('composer');
    expect(written.hints).toBe(true);
  });

  it('is idempotent (already configured)', () => {
    initCursorStatusline({ path });
    const res = initCursorStatusline({ path });
    expect(res.action).toBe('already');
  });

  it('backs up before overwriting a different statusline', () => {
    writeFileSync(path, JSON.stringify({ statusLine: { type: 'command', command: 'other-tool' } }));
    const res = initCursorStatusline({ path });
    expect(res.action).toBe('written');
    expect(existsSync(`${path}.claudinho.bak`)).toBe(true);
    const bak = JSON.parse(readFileSync(`${path}.claudinho.bak`, 'utf8'));
    expect(bak.statusLine.command).toBe('other-tool');
  });

  it('honors a custom --command path', () => {
    const custom = 'node /path/to/claudinho prompt';
    initCursorStatusline({ path, command: custom });
    const written = JSON.parse(readFileSync(path, 'utf8'));
    expect(written.statusLine.command).toBe(custom);
  });
});
