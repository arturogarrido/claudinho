/**
 * 0.11 · 2.2 + 2.4 — the cache format becomes 5 (a club carries no flag; the
 * stage has four new values and a carried label), and a THROTTLE survives
 * the bump.
 *
 * A snapshot of another version is rejected whole, in both directions, so no
 * reader drops the records it does not know how to read. But a snapshot's
 * `backoffUntil` is not match data: it is a deadline the provider set, and a
 * refresher that discards it asks the provider that said stop. So: the deadline
 * of the snapshot FILE is read whatever its version (scope and stamp checked,
 * the believed-deadline rule unchanged), and a writer about to replace a
 * snapshot of another version first makes its believed deadline visible in the
 * note, where a reader of any version finds it.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  backoffInEffect,
  CACHE_VERSION,
  cachePath,
  readBackoffNote,
  readCurrentState,
  writeState,
  type CacheState,
} from '../src/cache';
import { runRefresh } from '../src/refresh';

const SOURCE = 'espn';
const PL = 'eng.1';
const NOW = Date.parse('2026-10-04T12:00:00.000Z');
const MIN = 60_000;
let dir: string;
const ORIG = process.env.XDG_CACHE_HOME;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-cache-v5-'));
  process.env.XDG_CACHE_HOME = dir;
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIG === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = ORIG;
  rmSync(dir, { recursive: true, force: true });
});

/** A snapshot of the format before this one (the one an older CLI still writes). */
const older = (over: Partial<CacheState> & { version?: number } = {}) => ({
  version: CACHE_VERSION - 1,
  updatedAt: new Date(NOW - MIN).toISOString(),
  live: [],
  degraded: false,
  source: SOURCE,
  competition: PL,
  ...over,
});
const writeRaw = (state: Record<string, unknown>) => {
  mkdirSync(dirname(cachePath(SOURCE, PL)), { recursive: true });
  writeFileSync(cachePath(SOURCE, PL), JSON.stringify(state));
};

describe('the format is 5', () => {
  it('a club has no flag and a stage can be REGULAR, LEAGUE, PO or OTHER: a snapshot written before says nothing a reader of this format should believe', () => {
    expect(CACHE_VERSION).toBe(5);
    writeRaw(older());
    expect(readCurrentState(SOURCE, PL)).toBeUndefined();
  });
});

describe('a throttle survives the version bump', () => {
  it("the deadline of an older format's snapshot is in effect for this reader (scope and stamp checked)", () => {
    const until = new Date(NOW + 8 * MIN).toISOString();
    writeRaw(older({ backoffUntil: until }));
    expect(readCurrentState(SOURCE, PL)).toBeUndefined();
    expect(backoffInEffect(readCurrentState(SOURCE, PL), SOURCE, PL, NOW)).toBe(Date.parse(until));
  });

  it('a deadline nobody believes is not: past, too far ahead, malformed, or another scope\'s', () => {
    for (const bad of [new Date(NOW - MIN).toISOString(), new Date(NOW + 45 * MIN).toISOString(), 'soon', 7]) {
      writeRaw(older({ backoffUntil: bad as never }));
      expect(backoffInEffect(readCurrentState(SOURCE, PL), SOURCE, PL, NOW), String(bad)).toBeUndefined();
    }
    writeRaw(older({ backoffUntil: new Date(NOW + 8 * MIN).toISOString(), competition: 'esp.1' }));
    expect(backoffInEffect(readCurrentState(SOURCE, PL), SOURCE, PL, NOW)).toBeUndefined();
  });

  it("the refresher makes no request while an older format's snapshot holds a throttle", async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (input: unknown) => {
      asked.push(String(input));
      return new Response('{"events":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    writeRaw(older({ backoffUntil: new Date(NOW + 8 * MIN).toISOString() }));
    await runRefresh({ source: SOURCE, competition: PL, now: new Date(NOW), jitterMs: 0 });
    expect(asked).toEqual([]);
    // Whatever it published, the throttle is still in effect for the next reader.
    expect(backoffInEffect(readCurrentState(SOURCE, PL), SOURCE, PL, NOW)).toBe(NOW + 8 * MIN);
  });

  it('a writer replacing a snapshot of another version first makes its believed deadline visible in the note', () => {
    const until = NOW + 8 * MIN;
    writeRaw(older({ backoffUntil: new Date(until).toISOString() }));
    expect(readBackoffNote(SOURCE, PL, NOW)).toBeUndefined();
    writeState({ updatedAt: new Date(NOW).toISOString(), live: [], degraded: false, source: SOURCE, competition: PL });
    expect(JSON.parse(readFileSync(cachePath(SOURCE, PL), 'utf8')).version).toBe(CACHE_VERSION);
    // A reader of the old format, which rejects the new snapshot, finds the throttle in the note.
    expect(readBackoffNote(SOURCE, PL, NOW)).toBe(until);
    expect(backoffInEffect(readCurrentState(SOURCE, PL), SOURCE, PL, NOW)).toBe(until);
  });

  it('a replaced snapshot with no believed deadline leaves no note', () => {
    writeRaw(older({ backoffUntil: new Date(NOW - MIN).toISOString() }));
    writeState({ updatedAt: new Date(NOW).toISOString(), live: [], degraded: false, source: SOURCE, competition: PL });
    expect(readBackoffNote(SOURCE, PL, NOW)).toBeUndefined();
    writeRaw(older());
    writeState({ updatedAt: new Date(NOW).toISOString(), live: [], degraded: false, source: SOURCE, competition: PL });
    expect(readBackoffNote(SOURCE, PL, NOW)).toBeUndefined();
  });

  it('a snapshot of this version is not re-noted by its own writer (the note is for the other format\'s reader)', () => {
    const until = NOW + 8 * MIN;
    writeState({ updatedAt: new Date(NOW).toISOString(), live: [], degraded: false, source: SOURCE, competition: PL, backoffUntil: new Date(until).toISOString() });
    writeState({ updatedAt: new Date(NOW + MIN).toISOString(), live: [], degraded: false, source: SOURCE, competition: PL, backoffUntil: new Date(until).toISOString() });
    expect(readBackoffNote(SOURCE, PL, NOW)).toBeUndefined();
    expect(backoffInEffect(readCurrentState(SOURCE, PL), SOURCE, PL, NOW)).toBe(until);
  });
});
