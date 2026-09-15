import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initHook, initStatusline } from '../src/install';
import { writeFileAtomic } from '../src/paths';

/**
 * Audit A09 (P2): the atomic tmp + rename write created the temp with the
 * default mode and never preserved the original's, so a 0600 settings file
 * came back 0644 under umask 022 (repro on a modeled POSIX fs). Now the
 * existing mode is preserved, a new settings file is created private, the
 * temp is exclusive and unpredictable, a symlinked target is written THROUGH
 * (a dotfiles link stays a link), and a failed write leaves no temp behind.
 * Mode assertions are POSIX-only; Windows has no such bits.
 */
const mode = (p: string) => statSync(p).mode & 0o777;
const posix = process.platform !== 'win32';

describe('writeFileAtomic', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'claudinho-atomic-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it.skipIf(!posix)('preserves a private (0600) mode across the replace', () => {
    const target = join(dir, 'settings.json');
    writeFileSync(target, '{}');
    chmodSync(target, 0o600);
    writeFileAtomic(target, '{"a":1}');
    expect(mode(target)).toBe(0o600);
    expect(readFileSync(target, 'utf8')).toBe('{"a":1}');
  });

  it.skipIf(!posix)('preserves a wider (0644) mode too — it preserves, it does not force', () => {
    const target = join(dir, 'state.json');
    writeFileSync(target, '{}');
    chmodSync(target, 0o644);
    writeFileAtomic(target, '{"a":2}');
    expect(mode(target)).toBe(0o644);
  });

  it.skipIf(!posix)('creates a NEW file with the requested mode', () => {
    const target = join(dir, 'fresh.json');
    writeFileAtomic(target, '{}', { mode: 0o600 });
    expect(mode(target)).toBe(0o600);
  });

  it.skipIf(!posix)('writes THROUGH a symlink: the link survives, the real file changes, its mode holds', () => {
    const real = join(dir, 'dotfiles', 'settings.json');
    mkdirSync(join(dir, 'dotfiles'));
    writeFileSync(real, '{"old":true}');
    chmodSync(real, 0o600);
    const link = join(dir, 'settings.json');
    symlinkSync(real, link);
    writeFileAtomic(link, '{"new":true}');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, 'utf8')).toBe('{"new":true}');
    expect(mode(real)).toBe(0o600);
  });

  it('leaves no temp file behind when the replace fails', () => {
    const target = join(dir, 'a-directory');
    mkdirSync(target);
    expect(() => writeFileAtomic(target, 'x')).toThrow();
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});

describe.skipIf(!posix)('installers keep settings private (the call sites)', () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'claudinho-install-mode-'));
    path = join(dir, 'settings.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('init statusline on a 0600 settings file keeps it 0600', () => {
    writeFileSync(path, JSON.stringify({ env: { PRIVATE_VALUE: 'synthetic-only' } }));
    chmodSync(path, 0o600);
    expect(initStatusline({ path }).action).toBe('written');
    expect(mode(path)).toBe(0o600);
  });

  it('init hook on a 0600 settings file keeps it 0600', () => {
    writeFileSync(path, JSON.stringify({ env: { PRIVATE_VALUE: 'synthetic-only' } }));
    chmodSync(path, 0o600);
    expect(initHook({ path }).action).toBe('written');
    expect(mode(path)).toBe(0o600);
  });

  it('a settings file created from scratch is private', () => {
    expect(initStatusline({ path }).action).toBe('written');
    expect(mode(path)).toBe(0o600);
  });
});
