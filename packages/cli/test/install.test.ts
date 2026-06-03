import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initHook, initStatusline } from '../src/install';

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-install-'));
  path = join(dir, 'settings.json');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
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
    expect(readFileSync(path, 'utf8')).toBe('{ broken'); // untouched
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
    expect(w.hooks.Stop[0].hooks[0].command).toBe('other'); // untouched
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
    expect(w.hooks.UserPromptSubmit).toHaveLength(1); // not duplicated
  });

  it('refuses to clobber unparseable JSON', () => {
    writeFileSync(path, '{ broken');
    const res = initHook({ path });
    expect(res.action).toBe('manual');
    expect(readFileSync(path, 'utf8')).toBe('{ broken');
  });
});
