/**
 * The goal moments, 4a-i: the refresher's record of play (`advancePlay`, `packages/cli/src/play.ts`), the evidence a
 * full-time toast is said from. Full time is a match the refresher SAW in play that a whole read then returns
 * finished; absence never means full time. The record survives a failed, degraded or partial read; a finished entry
 * keeps the time it was first seen finished; a cap that truncated the finished list never decides that a match is gone.
 */
import type { Match } from '@claudinho/core';
import { describe, expect, it } from 'vitest';
import { advancePlay, FINISHED_TTL_MS, MAX_PLAY, type PlayRead, type PlayState, SEEN_TTL_MS } from '../src/play';

const T0 = new Date('2026-10-14T19:00:00Z');
const at = (ms: number) => new Date(T0.getTime() + ms);
const LAS = { code: 'LAS', name: 'LASK Linz', id: 'espn:2789' };
const LIV = { code: 'LIV', name: 'Liverpool', id: 'espn:364' };
const rec = (id: string, status: Match['status'], score: [number, number] = [0, 1]): Match => ({
  id,
  stage: 'LEAGUE',
  kickoff: '2026-10-14T16:45:00.000Z',
  venue: 'Raiffeisen Arena',
  home: LAS,
  away: LIV,
  status,
  score: { home: score[0], away: score[1] },
  updatedAt: T0.toISOString(),
});
const whole = (matches: Match[], finished: Match[] = [], truncated = false): PlayRead => ({ whole: true, matches, finished, finishedTruncated: truncated });
const notWhole = (matches: Match[] = [], finished: Match[] = []): PlayRead => ({ whole: false, matches, finished, finishedTruncated: false });
const EMPTY: PlayState = { seen: [], finished: [] };
const ids = (s: PlayState) => ({ seen: s.seen.map((e) => e.id), finished: s.finished.map((e) => e.match.id) });

describe('advancePlay on a whole read', () => {
  it('a match in play is seen, with the time of this read', () => {
    const s = advancePlay(EMPTY, whole([rec('1', 'LIVE')]), T0);
    expect(s.seen).toEqual([{ id: '1', at: T0.toISOString() }]);
    expect(s.finished).toEqual([]);
  });

  it('a seen match the read returns finished moves to finished, with this read\'s record and time', () => {
    const seen = advancePlay(EMPTY, whole([rec('1', 'LIVE')]), T0);
    const s = advancePlay(seen, whole([], [rec('1', 'FT', [3, 6])]), at(60_000));
    expect(ids(s)).toEqual({ seen: [], finished: ['1'] });
    expect(s.finished[0]?.at).toBe(at(60_000).toISOString());
    expect(s.finished[0]?.match.score).toEqual({ home: 3, away: 6 });
  });

  it('a finished match the refresher never saw in play is NOT full time (no prior evidence)', () => {
    const s = advancePlay(EMPTY, whole([], [rec('9', 'FT')]), T0);
    expect(ids(s)).toEqual({ seen: [], finished: [] });
  });

  it('an already finished match read finished again keeps its first time and takes the newer record', () => {
    let s = advancePlay(EMPTY, whole([rec('1', 'LIVE')]), T0);
    s = advancePlay(s, whole([], [rec('1', 'FT', [2, 1])]), at(60_000));
    s = advancePlay(s, whole([], [rec('1', 'FT', [1, 1])]), at(120_000));
    expect(s.finished[0]?.at).toBe(at(60_000).toISOString());
    expect(s.finished[0]?.match.score).toEqual({ home: 1, away: 1 });
  });

  it('a finished match a whole read has in play again goes back to seen', () => {
    let s = advancePlay(EMPTY, whole([rec('1', 'LIVE')]), T0);
    s = advancePlay(s, whole([], [rec('1', 'FT')]), at(60_000));
    s = advancePlay(s, whole([rec('1', 'LIVE')]), at(120_000));
    expect(ids(s)).toEqual({ seen: ['1'], finished: [] });
  });

  it('a seen match a whole, untruncated read holds neither in play nor finished is dropped, with nothing said', () => {
    const seen = advancePlay(EMPTY, whole([rec('1', 'LIVE')]), T0);
    expect(ids(advancePlay(seen, whole([]), at(60_000)))).toEqual({ seen: [], finished: [] });
  });

  it('a truncated finished list never decides absence: the seen match stays seen', () => {
    const seen = advancePlay(EMPTY, whole([rec('1', 'LIVE')]), T0);
    expect(ids(advancePlay(seen, whole([], [rec('2', 'FT')], true), at(60_000)))).toEqual({ seen: ['1'], finished: [] });
  });
});

describe('advancePlay on a read that is not whole (failed, degraded, partial)', () => {
  it('keeps the record as it was: a failed read between in play and full time loses nothing', () => {
    let s = advancePlay(EMPTY, whole([rec('1', 'LIVE')]), T0);
    s = advancePlay(s, notWhole(), at(15_000));
    expect(ids(s)).toEqual({ seen: ['1'], finished: [] });
    s = advancePlay(s, whole([], [rec('1', 'FT', [3, 6])]), at(30_000));
    expect(ids(s)).toEqual({ seen: [], finished: ['1'] });
  });

  it('decides nothing from what a partial read holds, in play or finished', () => {
    const s = advancePlay(EMPTY, notWhole([rec('1', 'LIVE')], [rec('2', 'FT')]), T0);
    expect(ids(s)).toEqual({ seen: [], finished: [] });
  });
});

describe('advancePlay expiry and bounds', () => {
  it('a finished entry lasts 10 minutes from its first time, on any read', () => {
    let s = advancePlay(EMPTY, whole([rec('1', 'LIVE')]), T0);
    s = advancePlay(s, whole([], [rec('1', 'FT')]), at(60_000));
    expect(FINISHED_TTL_MS).toBe(10 * 60_000);
    expect(ids(advancePlay(s, notWhole(), at(60_000 + FINISHED_TTL_MS - 1)))).toEqual({ seen: [], finished: ['1'] });
    expect(ids(advancePlay(s, notWhole(), at(60_000 + FINISHED_TTL_MS + 1)))).toEqual({ seen: [], finished: [] });
  });

  it('a seen entry lasts 6 hours from its last observation in play, a deadline of its own', () => {
    const s = advancePlay(EMPTY, whole([rec('1', 'LIVE')]), T0);
    expect(SEEN_TTL_MS).toBe(6 * 60 * 60_000);
    expect(ids(advancePlay(s, notWhole(), at(SEEN_TTL_MS - 1)))).toEqual({ seen: ['1'], finished: [] });
    expect(ids(advancePlay(s, notWhole(), at(SEEN_TTL_MS + 1)))).toEqual({ seen: [], finished: [] });
  });

  it('an entry stamped in the future is not believed', () => {
    const forged: PlayState = { seen: [{ id: '1', at: at(3_600_000).toISOString() }], finished: [{ match: rec('2', 'FT'), at: at(3_600_000).toISOString() }] };
    expect(ids(advancePlay(forged, notWhole(), T0))).toEqual({ seen: [], finished: [] });
  });

  it('each list holds at most 64 entries, the newest kept', () => {
    expect(MAX_PLAY).toBe(64);
    const many = Array.from({ length: 70 }, (_, i) => rec(`m${i}`, 'LIVE'));
    const s = advancePlay(EMPTY, whole(many), T0);
    expect(s.seen).toHaveLength(64);
  });

  it('a malformed previous state is no state (never throws)', () => {
    for (const bad of [undefined, null, 'x', { seen: 'x' }, { seen: [{ id: 3 }], finished: [{ match: null }] }]) {
      expect(() => advancePlay(bad as never, whole([rec('1', 'LIVE')]), T0)).not.toThrow();
      expect(ids(advancePlay(bad as never, whole([rec('1', 'LIVE')]), T0)).seen).toEqual(['1']);
    }
  });
});
