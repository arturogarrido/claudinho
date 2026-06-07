import { describe, expect, it } from 'vitest';
import { renderHook } from '../src/hook';
import type { CacheState } from '../src/cache';
import type { Match } from '@claudinho/core';

const NOW = new Date('2026-06-11T20:00:00Z');

function m(home: [string, string], away: [string, string], over: Partial<Match> = {}): Match {
  return {
    id: `${home[0]}-${away[0]}`,
    stage: 'GROUP',
    group: 'A',
    kickoff: '2026-06-11T19:00Z',
    venue: 'X',
    home: { code: home[0], name: home[0], flag: home[1] },
    away: { code: away[0], name: away[0], flag: away[1] },
    status: 'LIVE',
    updatedAt: NOW.toISOString(),
    ...over,
  };
}

function state(live: Match[], updatedAt = '2026-06-11T19:59:50Z'): CacheState {
  return { updatedAt, live, degraded: false, source: 'espn', competition: 'fifa.world' };
}

describe('renderHook', () => {
  it('is SILENT when nothing is live (no cache)', () => {
    expect(renderHook(undefined, { now: NOW })).toBe('');
  });

  it('is silent when the cache has no live matches', () => {
    const s = state([m(['MEX', '🇲🇽'], ['RSA', '🇿🇦'], { status: 'FT', score: { home: 2, away: 0 } })]);
    expect(renderHook(s, { now: NOW })).toBe('');
  });

  it('emits labelled live context with score and minute', () => {
    const s = state([m(['MEX', '🇲🇽'], ['RSA', '🇿🇦'], { minute: 67, score: { home: 1, away: 0 } })]);
    const out = renderHook(s, { now: NOW });
    expect(out).toContain('[Claudinho — live football scores right now]');
    expect(out).toContain('🇲🇽 MEX 1–0 RSA 🇿🇦');
    expect(out).toContain("(67')");
  });

  it('renders half-time as a word, not a minute', () => {
    const s = state([m(['MEX', '🇲🇽'], ['RSA', '🇿🇦'], { status: 'HT', score: { home: 0, away: 0 } })]);
    expect(renderHook(s, { now: NOW })).toContain('(half-time)');
  });

  it('lists the configured team first', () => {
    const s = state([
      m(['MEX', '🇲🇽'], ['RSA', '🇿🇦'], { minute: 10, score: { home: 0, away: 0 } }),
      m(['BRA', '🇧🇷'], ['MAR', '🇲🇦'], { minute: 80, score: { home: 3, away: 1 } }),
    ]);
    const out = renderHook(s, { now: NOW, team: 'BRA' });
    const lines = out.split('\n');
    // Header is line 0; first match line should be Brazil.
    expect(lines[1]).toContain('🇧🇷');
  });

  it('ignores a stale cache (does not surface old scores)', () => {
    const s = state(
      [m(['MEX', '🇲🇽'], ['RSA', '🇿🇦'], { minute: 67, score: { home: 1, away: 0 } })],
      '2026-06-11T19:50:00Z', // 10 min old vs NOW
    );
    expect(renderHook(s, { now: NOW })).toBe('');
  });

  it('never throws on a corrupt cache (returns empty)', () => {
    const bad = { updatedAt: NOW.toISOString(), live: 'not-an-array', degraded: false, source: 'espn' };
    expect(renderHook(bad as never, { now: NOW })).toBe('');
  });
});
