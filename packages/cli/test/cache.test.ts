import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  claimLock,
  ageMs,
  CACHE_VERSION,
  cachePath,
  isLockFresh,
  MAX_STATE_BYTES,
  readCurrentState,
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
  competition: 'fifa.world',
};

describe('cache state', () => {
  it('returns undefined when no cache exists', () => {
    expect(readState('espn', 'fifa.world')).toBeUndefined();
  });

  it('round-trips an atomic write/read (version-stamped)', () => {
    writeState(sample);
    expect(cachePath('espn', 'fifa.world').startsWith(dir)).toBe(true);
    expect(readState('espn', 'fifa.world')).toEqual({ ...sample, version: CACHE_VERSION });
  });

  it('treats a version-mismatched (old-binary) snapshot as absent', () => {
    writeState(sample);
    const fs = require('node:fs') as typeof import('node:fs');
    // Simulate a pre-versioning (v1) file and a future-version file.
    fs.writeFileSync(cachePath('espn', 'fifa.world'), JSON.stringify(sample));
    expect(readState('espn', 'fifa.world')).toBeUndefined();
    fs.writeFileSync(cachePath('espn', 'fifa.world'), JSON.stringify({ ...sample, version: CACHE_VERSION + 1 }));
    expect(readState('espn', 'fifa.world')).toBeUndefined();
  });

  it('keeps a separate cache file per non-default competition (no thrash)', () => {
    writeState(sample); // default scope → legacy state.json
    const friendly: CacheState = { ...sample, competition: 'fifa.friendly' };
    writeState(friendly);
    // Both snapshots coexist — writing one scope no longer clobbers the other.
    expect(readCurrentState('espn', 'fifa.world')).toEqual({ ...sample, version: CACHE_VERSION });
    expect(readCurrentState('espn', 'fifa.friendly')).toEqual({
      ...friendly,
      version: CACHE_VERSION,
    });
    expect(cachePath('espn', 'fifa.friendly')).not.toBe(cachePath('espn', 'fifa.world'));
    // The env-sourced competition can only shape a FLAT filename inside the
    // cache dir — path separators are stripped, so no traversal is possible.
    const evil = cachePath('espn', '../../evil');
    expect(join(evil, '..')).toBe(join(cachePath('espn', 'fifa.world'), '..')); // same parent dir
  });

  it('readCurrentState only returns a snapshot for the matching source + competition', () => {
    writeState(sample); // source 'espn', competition 'fifa.world'
    expect(readCurrentState('espn', 'fifa.world')).toEqual({ ...sample, version: CACHE_VERSION });
    // A friendly snapshot must never bleed into a World-Cup view.
    expect(readCurrentState('espn', 'fifa.friendly')).toBeUndefined();
    expect(readCurrentState('other', 'fifa.world')).toBeUndefined();
  });

  it('readCurrentState returns undefined when no cache exists', () => {
    expect(readCurrentState('espn', 'fifa.world')).toBeUndefined();
  });

  it('returns undefined on corrupt JSON (never throws)', () => {
    writeState(sample);
    // Corrupt the file.
    const fs = require('node:fs') as typeof import('node:fs');
    fs.writeFileSync(cachePath('espn', 'fifa.world'), '{not json');
    expect(readState('espn', 'fifa.world')).toBeUndefined();
  });

  it('rejects a malformed envelope before any renderer sees nested records', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    writeState(sample);
    const valid = { ...sample, version: CACHE_VERSION };
    for (const malformed of [
      { ...valid, updatedAt: '2026-02-30T20:00:00Z' },
      { ...valid, live: 'not-an-array' },
      { ...valid, degraded: 'false' },
      { ...valid, source: '../espn' },
      { ...valid, competition: '' },
      { ...valid, fixtures: {} },
      { ...valid, schedule: 'x' },
      { ...valid, schedule: [] },
      { ...valid, schedule: null },
    ]) {
      fs.writeFileSync(cachePath('espn', 'fifa.world'), JSON.stringify(malformed));
      expect(readState('espn', 'fifa.world'), JSON.stringify(malformed)).toBeUndefined();
    }
  });

  it('rejects oversized files and record floods', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    writeState(sample);
    fs.writeFileSync(cachePath('espn', 'fifa.world'), JSON.stringify({ padding: 'x'.repeat(MAX_STATE_BYTES) }));
    expect(readState('espn', 'fifa.world')).toBeUndefined();

    fs.writeFileSync(
      cachePath('espn', 'fifa.world'),
      JSON.stringify({ ...sample, version: CACHE_VERSION, live: Array(1_025).fill(null) }),
    );
    expect(readState('espn', 'fifa.world')).toBeUndefined();
  });

  it('computes age in ms and Infinity when absent', () => {
    expect(ageMs(undefined)).toBe(Infinity);
    const now = Date.parse('2026-06-11T20:00:30Z');
    expect(ageMs(sample, now)).toBe(30_000);
  });
});

describe('refresh lock', () => {
  it('is exclusive until released (the token API is the only one: D3)', () => {
    const a = claimLock();
    expect(a).toBeDefined();
    expect(isLockFresh()).toBe(true);
    expect(claimLock()).toBeUndefined(); // already held
    releaseLock(a);
    expect(isLockFresh()).toBe(false);
    const b = claimLock();
    expect(b).toBeDefined(); // free again
    releaseLock(b);
  });

  it('steals a stale lock based on the written timestamp (regression)', () => {
    // A leftover lock whose *content* timestamp is ancient (e.g. from a crashed
    // refresher) must be stealable even if the file mtime is recent.
    const lock = join(dir, 'claudinho', 'refresh.lock');
    const fs = require('node:fs') as typeof import('node:fs');
    fs.mkdirSync(join(dir, 'claudinho'), { recursive: true });
    fs.writeFileSync(lock, `99999 ${Date.now() - 120_000}`); // 2 min old by content
    expect(isLockFresh()).toBe(false); // recognized as stale despite fresh mtime
    const token = claimLock();
    expect(token).toBeDefined(); // stolen, not deadlocked
    releaseLock(token);
  });

  it('does not steal a genuinely fresh lock held by another process', () => {
    const lock = join(dir, 'claudinho', 'refresh.lock');
    const fs = require('node:fs') as typeof import('node:fs');
    fs.mkdirSync(join(dir, 'claudinho'), { recursive: true });
    fs.writeFileSync(lock, `12345 ${Date.now()}`); // fresh by content
    expect(isLockFresh()).toBe(true);
    expect(claimLock()).toBeUndefined(); // must NOT steal
  });
});
