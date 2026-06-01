import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireLock,
  ageMs,
  cachePath,
  isLockFresh,
  readState,
  releaseLock,
  writeState,
  type CacheState,
} from '../src/cache';

let dir: string;
const ORIG = process.env.XDG_CACHE_HOME;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-cache-'));
  process.env.XDG_CACHE_HOME = dir;
});
afterEach(() => {
  if (ORIG === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = ORIG;
  rmSync(dir, { recursive: true, force: true });
});

const sample: CacheState = {
  updatedAt: '2026-06-11T20:00:00Z',
  live: [],
  degraded: false,
  source: 'espn',
};

describe('cache state', () => {
  it('returns undefined when no cache exists', () => {
    expect(readState()).toBeUndefined();
  });

  it('round-trips an atomic write/read', () => {
    writeState(sample);
    expect(cachePath().startsWith(dir)).toBe(true);
    expect(readState()).toEqual(sample);
  });

  it('returns undefined on corrupt JSON (never throws)', () => {
    writeState(sample);
    // Corrupt the file.
    const fs = require('node:fs') as typeof import('node:fs');
    fs.writeFileSync(cachePath(), '{not json');
    expect(readState()).toBeUndefined();
  });

  it('computes age in ms and Infinity when absent', () => {
    expect(ageMs(undefined)).toBe(Infinity);
    const now = Date.parse('2026-06-11T20:00:30Z');
    expect(ageMs(sample, now)).toBe(30_000);
  });
});

describe('refresh lock', () => {
  it('is exclusive until released', () => {
    expect(acquireLock()).toBe(true);
    expect(isLockFresh()).toBe(true);
    expect(acquireLock()).toBe(false); // already held
    releaseLock();
    expect(isLockFresh()).toBe(false);
    expect(acquireLock()).toBe(true); // free again
    releaseLock();
  });

  it('steals a stale lock based on the written timestamp (regression)', () => {
    // A leftover lock whose *content* timestamp is ancient (e.g. from a crashed
    // refresher) must be stealable even if the file mtime is recent.
    const lock = join(dir, 'claudinho', 'refresh.lock');
    const fs = require('node:fs') as typeof import('node:fs');
    fs.mkdirSync(join(dir, 'claudinho'), { recursive: true });
    fs.writeFileSync(lock, `99999 ${Date.now() - 120_000}`); // 2 min old by content
    expect(isLockFresh()).toBe(false); // recognized as stale despite fresh mtime
    expect(acquireLock()).toBe(true); // stolen, not deadlocked
    releaseLock();
  });

  it('does not steal a genuinely fresh lock held by another process', () => {
    const lock = join(dir, 'claudinho', 'refresh.lock');
    const fs = require('node:fs') as typeof import('node:fs');
    fs.mkdirSync(join(dir, 'claudinho'), { recursive: true });
    fs.writeFileSync(lock, `12345 ${Date.now()}`); // fresh by content
    expect(isLockFresh()).toBe(true);
    expect(acquireLock()).toBe(false); // must NOT steal
  });
});
