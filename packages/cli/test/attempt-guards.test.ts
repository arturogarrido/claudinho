/**
 * The attempt record (0.11, the cleanup PR, ledger row D8): three guards the
 * coder's revert pass found no test for, beside `attempt-record.test.ts` and
 * `attempt-pacing.test.ts`.
 *
 * - A reset record (`count: 0`) is due at once, even when its stamp is inside
 *   the tolerated skew ahead of the reader's clock.
 * - The unknown-source lane reads the scope-aware snapshot (`readCurrentState`):
 *   a file at that scope's path that names ANOTHER scope is no snapshot for it,
 *   so the idle publish is admitted and made (the hot path asks the same reader
 *   and would otherwise start a refresher on every tick).
 * - The settlement writes nothing once ownership is lost: a successor that
 *   took the lock and published a readable snapshot during the cycle does not
 *   get this cycle's reset written over the record.
 * - With the snapshot file ABSENT the gate does not fail closed (a publish
 *   heals it), but a believed record that is not due still stops the cycle:
 *   an absent snapshot with a working record stays paced (round 1, rule 8).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ spawn: vi.fn(() => ({ unref: vi.fn() })) }));

import {
  attemptDue,
  attemptRecordPath,
  CACHE_VERSION,
  type CacheState,
  cachePath,
  readAttemptRecord,
  readCurrentState,
  readState,
  writeState,
} from '../src/cache';
import { refreshWanted, runRefresh } from '../src/refresh';

const SOURCE = 'espn';
const WC = 'fifa.world';
const MIN = 60_000;
/** Inside the opener's live window (Jun 11, 2026, kickoff 19:00Z). */
const LIVE = Date.parse('2026-06-11T19:30:00Z');
/** A quiet morning in the group stage: no live window, no knockout phase. */
const QUIET = Date.parse('2026-06-12T09:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let dir: string;
let asked: string[] = [];
let onFetch: () => void = () => {};
const ORIG = process.env.XDG_CACHE_HOME;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-attempt-guards-'));
  process.env.XDG_CACHE_HOME = dir;
  asked = [];
  onFetch = () => {};
  vi.stubGlobal('fetch', async (input: unknown) => {
    asked.push(new URL(String(input)).searchParams.get('dates') ?? '');
    onFetch();
    return json({ leagues: [{ season: { year: 2026, displayName: '2026 World Cup' } }], events: [] });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIG === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = ORIG;
  rmSync(dir, { recursive: true, force: true });
});

const snapshot = (at: number, over: Partial<CacheState> = {}): CacheState => ({
  updatedAt: iso(at - 1000),
  live: [],
  degraded: false,
  source: SOURCE,
  competition: WC,
  ...over,
});

describe('a reset record is due at once', () => {
  it('count 0 is due even with a stamp inside the tolerated skew ahead of the reader', () => {
    expect(attemptDue({ at: LIVE + 30_000, count: 0 }, LIVE)).toBe(true);
    expect(attemptDue({ at: LIVE + 60_000, count: 0 }, LIVE)).toBe(true);
    // A raised count with the same stamp waits its delay from that stamp.
    expect(attemptDue({ at: LIVE + 30_000, count: 1 }, LIVE)).toBe(false);
  });
});

describe('the unknown-source lane reads the scope-aware snapshot', () => {
  it('a file at its path naming another scope is no snapshot: the idle publish is admitted, made, and settled', async () => {
    mkdirSync(join(dir, 'claudinho'), { recursive: true });
    // A well-formed snapshot of THIS format, at the unknown scope's path, but naming another scope.
    writeFileSync(
      cachePath('nope', WC),
      JSON.stringify({ version: CACHE_VERSION, ...snapshot(QUIET), source: SOURCE }),
    );
    expect(readState('nope', WC)).toBeDefined();
    expect(readCurrentState('nope', WC)).toBeUndefined();
    await runRefresh({ source: 'nope', competition: WC, now: new Date(QUIET), jitterMs: 0 });
    expect(asked).toHaveLength(0);
    expect(readCurrentState('nope', WC)?.source).toBe('nope');
    expect(readAttemptRecord('nope', WC, QUIET)).toEqual({ at: QUIET, count: 0 });
    // The next tick finds its snapshot: nothing to start for a source nobody can ask.
    expect(refreshWanted(QUIET + 5000, readCurrentState('nope', WC), WC, 'nope')).toBe(false);
  });
});

describe('the settlement writes nothing once ownership is lost', () => {
  it('a successor took the lock and published a readable snapshot mid-cycle: the admission record stands', async () => {
    mkdirSync(join(dir, 'claudinho'), { recursive: true });
    writeFileSync(cachePath(SOURCE, WC), '{ not json');
    onFetch = () => {
      // The successor: another owner's token in the lock, and its readable snapshot.
      writeFileSync(join(dir, 'claudinho', 'refresh.lock'), `99999 ${LIVE + 1000} deadbeefcafe`);
      writeState(snapshot(LIVE + 1000, { updatedAt: iso(LIVE + 1000) }));
    };
    await runRefresh({ source: SOURCE, competition: WC, now: new Date(LIVE), jitterMs: 0 });
    expect(asked.length).toBeGreaterThan(0);
    // The successor's snapshot stands (this cycle's publish was refused) and reads back usable…
    expect(readCurrentState(SOURCE, WC)?.updatedAt).toBe(iso(LIVE + 1000));
    // …yet this cycle, no longer the owner, did not reset the record: its admission stands.
    expect(JSON.parse(readFileSync(attemptRecordPath(SOURCE, WC), 'utf8'))).toEqual({ at: iso(LIVE), count: 1 });
    // And the successor's lock was not released by the cycle that lost it.
    expect(readFileSync(join(dir, 'claudinho', 'refresh.lock'), 'utf8')).toContain('deadbeefcafe');
    expect(readAttemptRecord(SOURCE, WC, LIVE + MIN)).toEqual({ at: LIVE, count: 1 });
  });
});

describe('an absent snapshot with a believed record that is not due stays paced (the refresher side)', () => {
  const notDue = (at: number) => {
    mkdirSync(join(dir, 'claudinho'), { recursive: true });
    writeFileSync(attemptRecordPath(SOURCE, WC), JSON.stringify({ at: iso(at - 10_000), count: 1 }));
    return readFileSync(attemptRecordPath(SOURCE, WC), 'utf8');
  };

  it('inside a live window: nothing asked, nothing published, the record untouched', async () => {
    const before = notDue(LIVE);
    await runRefresh({ source: SOURCE, competition: WC, now: new Date(LIVE), jitterMs: 0 });
    expect(asked).toHaveLength(0);
    expect(existsSync(cachePath(SOURCE, WC))).toBe(false);
    expect(readFileSync(attemptRecordPath(SOURCE, WC), 'utf8')).toBe(before);
    // Once due, the cycle proceeds and its publish heals the scope.
    await runRefresh({ source: SOURCE, competition: WC, now: new Date(LIVE + MIN), jitterMs: 0 });
    expect(asked).toHaveLength(3);
    expect(readCurrentState(SOURCE, WC)).toBeDefined();
  });

  it('outside every window (the idle writer): nothing published, the record untouched', async () => {
    const before = notDue(QUIET);
    await runRefresh({ source: SOURCE, competition: WC, now: new Date(QUIET), jitterMs: 0 });
    expect(asked).toHaveLength(0);
    expect(existsSync(cachePath(SOURCE, WC))).toBe(false);
    expect(readFileSync(attemptRecordPath(SOURCE, WC), 'utf8')).toBe(before);
  });
});
