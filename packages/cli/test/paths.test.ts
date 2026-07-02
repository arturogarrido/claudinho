import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cacheDir, writeFileAtomic } from '../src/paths';

describe('writeFileAtomic', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'claudinho-paths-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates parent dirs, writes the content, and leaves no tmp file behind', () => {
    const target = join(dir, 'nested', 'settings.json');
    writeFileAtomic(target, '{"a":1}');
    expect(readFileSync(target, 'utf8')).toBe('{"a":1}');
    expect(readdirSync(join(dir, 'nested'))).toEqual(['settings.json']);
  });

  it('replaces an existing file in place', () => {
    const target = join(dir, 'f.json');
    writeFileAtomic(target, 'one');
    writeFileAtomic(target, 'two');
    expect(readFileSync(target, 'utf8')).toBe('two');
    expect(readdirSync(dir)).toEqual(['f.json']); // no orphaned tmp
  });
});

describe('cacheDir', () => {
  it('honors XDG_CACHE_HOME (the seam every cache test relies on)', () => {
    const orig = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = join(tmpdir(), 'xdg-test');
    try {
      expect(cacheDir()).toBe(join(tmpdir(), 'xdg-test', 'claudinho'));
    } finally {
      if (orig === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = orig;
    }
  });
});
