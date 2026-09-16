import {
  chmodSync,
  existsSync,
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
import { type CacheState, writeState } from '../src/cache';
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

  it.skipIf(!posix)('with followSymlinks (settings): the link survives, the real file changes, its mode holds', () => {
    const real = join(dir, 'dotfiles', 'settings.json');
    mkdirSync(join(dir, 'dotfiles'));
    writeFileSync(real, '{"old":true}');
    chmodSync(real, 0o600);
    const link = join(dir, 'settings.json');
    symlinkSync(real, link);
    writeFileAtomic(link, '{"new":true}', { followSymlinks: true });
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, 'utf8')).toBe('{"new":true}');
    expect(mode(real)).toBe(0o600);
  });

  it.skipIf(!posix)('by default (cache): a symlink is REPLACED, never followed — the target is untouched', () => {
    // Review P2 on #127: unconditional write-through let a planted link at a
    // cache path point a cache write at an unrelated file. Default = the base
    // behaviour: the link itself is replaced by a regular file.
    const real = join(dir, 'unrelated-settings.json');
    writeFileSync(real, '{"secret":"synthetic-only"}');
    const link = join(dir, 'state.json');
    symlinkSync(real, link);
    writeFileAtomic(link, '{"cache":true}');
    expect(readFileSync(real, 'utf8')).toBe('{"secret":"synthetic-only"}');
    expect(lstatSync(link).isSymbolicLink()).toBe(false);
    expect(readFileSync(link, 'utf8')).toBe('{"cache":true}');
  });

  it.skipIf(!posix)('with followSymlinks, a DANGLING link is refused, not replaced', () => {
    const link = join(dir, 'settings.json');
    symlinkSync(join(dir, 'missing.json'), link);
    expect(() => writeFileAtomic(link, '{}', { followSymlinks: true })).toThrow();
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(existsSync(join(dir, 'missing.json'))).toBe(false);
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

  it('init statusline on a symlinked settings file writes THROUGH it (a dotfiles link stays a link)', () => {
    const real = join(dir, 'dotfiles.json');
    writeFileSync(real, JSON.stringify({ theme: 'dark' }));
    chmodSync(real, 0o600);
    symlinkSync(real, path);
    expect(initStatusline({ path }).action).toBe('written');
    expect(lstatSync(path).isSymbolicLink()).toBe(true);
    expect(JSON.parse(readFileSync(real, 'utf8'))).toMatchObject({ theme: 'dark', statusLine: { type: 'command' } });
    expect(mode(real)).toBe(0o600);
  });
});

describe.skipIf(!posix)('cache writers never follow a link out of the cache (the call site)', () => {
  let dir: string;
  const ORIG = process.env.XDG_CACHE_HOME;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'claudinho-cache-link-'));
    process.env.XDG_CACHE_HOME = dir;
  });
  afterEach(() => {
    if (ORIG === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = ORIG;
    rmSync(dir, { recursive: true, force: true });
  });

  it('writeState() through a planted state.json link leaves the link target untouched', () => {
    const real = join(dir, 'unrelated-settings.json');
    writeFileSync(real, '{"secret":"synthetic-only"}');
    mkdirSync(join(dir, 'claudinho'));
    const link = join(dir, 'claudinho', 'state.json');
    symlinkSync(real, link);
    const state: CacheState = {
      updatedAt: '2026-09-15T00:00:00.000Z',
      live: [],
      degraded: false,
      source: 'espn',
      competition: 'fifa.world',
    };
    writeState(state);
    expect(readFileSync(real, 'utf8')).toBe('{"secret":"synthetic-only"}');
    expect(lstatSync(link).isSymbolicLink()).toBe(false);
  });
});
