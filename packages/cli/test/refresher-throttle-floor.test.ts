/**
 * 0.11 PR 2.6b — a throttle is a throttle however short its wait, in EVERY
 * lane of a cycle.
 *
 * "Was this cycle throttled?" used to be asked as "is the adapter's cooldown
 * still running?". With `Retry-After: 0` it never is: the published backoff
 * had no floor, and on the bundled competition the knockout lane, which runs
 * after the live lane in the same cycle, asked the provider again a moment
 * after it had said stop (the adapter refuses without a request only while its
 * own cooldown runs).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readState, writeState } from '../src/cache';
import { refreshWanted, runRefresh } from '../src/refresh';

const SOURCE = 'espn';
const WC = 'fifa.world';
const MIN = 60_000;
// Inside the live window of a Round-of-32 tie (kickoff 17:00Z), with another
// one still to come: the knockout phase, and no resolved fixtures cached yet.
const KO_LIVE = Date.parse('2026-06-29T17:30:00.000Z');

let dir: string;
let asked: string[] = [];
const ORIG = process.env.XDG_CACHE_HOME;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-throttle-floor-'));
  process.env.XDG_CACHE_HOME = dir;
  asked = [];
  vi.stubGlobal('fetch', async (input: unknown) => {
    asked.push(new URL(String(input)).searchParams.get('dates') ?? '');
    return new Response('{}', { status: 429, headers: { 'retry-after': '0' } });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIG === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = ORIG;
  rmSync(dir, { recursive: true, force: true });
});

describe('on the bundled competition, a throttle in the live lane stops the knockout lane', () => {
  it('`Retry-After: 0` on the live read: the knockout span is not asked in the same cycle, and the floor is published', async () => {
    writeState({ updatedAt: new Date(KO_LIVE - MIN).toISOString(), live: [], degraded: false, source: SOURCE, competition: WC });
    await runRefresh({ source: SOURCE, competition: WC, now: new Date(KO_LIVE), jitterMs: 0 });
    // The live read is three day requests; the knockout span would be two month requests.
    expect(asked.filter((d) => d.length === 8)).toHaveLength(3);
    expect(asked.filter((d) => d.length === 6)).toEqual([]);
    const s = readState(SOURCE, WC);
    expect(Date.parse(s?.backoffUntil ?? '')).toBeGreaterThanOrEqual(KO_LIVE + 5 * MIN);
    // The knockout lane was not attempted, so it says nothing about having been.
    expect(s?.fixturesAttemptedAt).toBeUndefined();
  });
});

describe('a source nobody can ask, before its snapshot exists', () => {
  it('the trigger may start the refresher once: that is what writes the snapshot that quiets it', () => {
    expect(refreshWanted(KO_LIVE, undefined, 'mex.1', 'bogus')).toBe(true);
  });
});
