/**
 * The goal moments, 4a-i: the snapshot grows a record of play (`play.seen`, `play.finished`, each at most 64) and a
 * `lastGoal` per live record. The WHOLE snapshot stays readable: the reader refuses a file over `MAX_STATE_BYTES`
 * (the statusline's hot-path bound), so the writer bounds it. Measured on the packet's worst case (64 finished
 * records with 400-code-point labels, 64 live records with `lastGoal`, 64 seen); and a snapshot that would be over the
 * bound drops `play.finished`'s records first, then each live record's `lastGoal`, then writes. The writer strips
 * `events` from `play.finished` as it does from every other slice.
 *
 * The labels are written in a three-byte character (U+6F22), so the code-point bound is also the byte worst case.
 */
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Match } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CACHE_VERSION, cachePath, MAX_STATE_BYTES, readState, writeState } from '../src/cache';

const NOW = Date.parse('2026-10-10T15:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const WIDE = '漢';
const label = (n = 400) => WIDE.repeat(n);
const team = (i: number, side: string, wide: boolean) => ({ id: `espn:${i}${side === 'home' ? 1 : 2}`, code: side === 'home' ? 'HOM' : 'AWY', name: wide ? label() : `Team ${i} ${side}` });
const record = (i: number, status: 'LIVE' | 'FT', wide: boolean): Match => ({
  id: String(1000 + i),
  stage: 'REGULAR',
  kickoff: iso(NOW - 60 * 60_000),
  venue: wide ? label() : 'Stadium',
  home: team(i, 'home', wide),
  away: team(i, 'away', wide),
  status,
  ...(status === 'LIVE' ? { minute: 60 } : {}),
  score: { home: 1, away: 2 },
  updatedAt: iso(NOW),
});
const goal = (player: string) => ({ type: 'GOAL', minute: 59, side: 'away', teamCode: 'AWY', player });
const lives = (n: number, wide: boolean, player: string | undefined) =>
  Array.from({ length: n }, (_, i) => ({ ...record(i, 'LIVE', wide), ...(player === undefined ? {} : { lastGoal: goal(player) }) }));
const seen = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(5000 + i), at: iso(NOW - 60_000) }));
const finished = (n: number, wide: boolean) => Array.from({ length: n }, (_, i) => ({ match: record(100 + i, 'FT', wide), at: iso(NOW - 60_000) }));
const base = (live: unknown[], extra: object = {}) => ({
  updatedAt: iso(NOW),
  live,
  liveComplete: true,
  degraded: false,
  source: 'espn',
  competition: 'eng.1',
  ...extra,
});
/** The serialized size of a snapshot as the writer stamps it. */
const bytesOf = (s: object) => Buffer.byteLength(JSON.stringify({ ...s, version: CACHE_VERSION }), 'utf8');
/** One display fixture whose venue pads the snapshot (without `play`) to exactly `target` bytes. */
const padTo = (s: object, target: number) => {
  const stub = { ...record(9000, 'FT', false), venue: '' };
  const without = bytesOf({ ...s, fixtures: [stub] });
  return { ...s, fixtures: [{ ...stub, venue: 'v'.repeat(target - without) }] };
};

let dir: string;
const ORIG = process.env.XDG_CACHE_HOME;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-cache-bound-'));
  process.env.XDG_CACHE_HOME = dir;
});
afterEach(() => {
  if (ORIG === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = ORIG;
  rmSync(dir, { recursive: true, force: true });
});
const file = () => cachePath('espn', 'eng.1');
const fileBytes = () => statSync(file()).size;

describe('the snapshot with play and lastGoal stays under the reader\'s bound', () => {
  it('the worst case (64 finished with 400-code-point labels, 64 live with lastGoal, 64 seen) is written whole and read back', () => {
    const state = base(lives(64, true, label()), { play: { seen: seen(64), finished: finished(64, true) } });
    expect(writeState(state as never, NOW)).toBe(true);
    expect(fileBytes()).toBeLessThan(MAX_STATE_BYTES);
    const read = readState('espn', 'eng.1') as unknown as { live: Array<Record<string, unknown>>; play?: { seen: unknown[]; finished: unknown[] } };
    expect(read, 'the reader accepts it').toBeDefined();
    expect(read.play?.finished).toHaveLength(64);
    expect(read.play?.seen).toHaveLength(64);
    expect(read.live).toHaveLength(64);
    for (const m of read.live) expect(m.lastGoal).toEqual(goal(label()));
  });

  it('over the bound: play.finished is emptied first, and the rest (seen, every lastGoal) is kept when that suffices', () => {
    // Without play the snapshot is 50 kB under the bound; 64 wide finished records (about 150 kB) put it over.
    const unpadded = base(lives(64, false, 'Bukayo Saka'));
    const padded = padTo(unpadded, MAX_STATE_BYTES - 50_000);
    const state = { ...padded, play: { seen: seen(64), finished: finished(64, true) } };
    expect(bytesOf(state), 'the fixture is over the bound as given').toBeGreaterThan(MAX_STATE_BYTES);
    expect(writeState(state as never, NOW)).toBe(true);
    expect(fileBytes()).toBeLessThanOrEqual(MAX_STATE_BYTES);
    const read = readState('espn', 'eng.1') as unknown as { live: Array<Record<string, unknown>>; play?: { seen: unknown[]; finished: unknown[] } };
    expect(read, 'the file still reads').toBeDefined();
    expect(read.play?.finished).toEqual([]);
    expect(read.play?.seen).toHaveLength(64);
    for (const m of read.live) expect(m.lastGoal).toEqual(goal('Bukayo Saka'));
  });

  it('over the bound without play.finished: each live record\'s lastGoal is dropped next, and the file still reads', () => {
    // Without play and lastGoal the snapshot is 50 kB under; 64 wide lastGoal objects (about 80 kB) put it over alone.
    const unpadded = base(lives(64, false, undefined));
    const padded = padTo(unpadded, MAX_STATE_BYTES - 50_000);
    const withGoals = { ...padded, live: lives(64, false, label()) };
    const state = { ...withGoals, play: { seen: seen(64), finished: finished(64, true) } };
    expect(bytesOf({ ...withGoals, play: { seen: seen(64), finished: [] } }), 'over even with play.finished emptied').toBeGreaterThan(MAX_STATE_BYTES);
    expect(writeState(state as never, NOW)).toBe(true);
    expect(fileBytes()).toBeLessThanOrEqual(MAX_STATE_BYTES);
    const read = readState('espn', 'eng.1') as unknown as { live: Array<Record<string, unknown>>; play?: { finished: unknown[] } };
    expect(read, 'the file still reads').toBeDefined();
    expect(read.play?.finished).toEqual([]);
    expect(read.live).toHaveLength(64);
    for (const m of read.live) expect(m.lastGoal ?? null).toBeNull();
  });

  it('the writer strips `events` from play.finished, as from every other slice', () => {
    const events = [{ type: 'GOAL', minute: 59, side: 'away', teamCode: 'AWY', player: 'Bukayo Saka' }];
    const ft = { ...record(1, 'FT', false), events };
    expect(writeState(base([], { play: { seen: [], finished: [{ match: ft, at: iso(NOW - 60_000) }] } }) as never, NOW)).toBe(true);
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as { play: { finished: Array<{ match: Record<string, unknown> }> } };
    expect(raw.play.finished.map((e) => e.match.id)).toEqual(['1001']);
    expect('events' in (raw.play.finished[0]?.match ?? {})).toBe(false);
  });
});
