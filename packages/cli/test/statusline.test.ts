import { describe, expect, it } from 'vitest';
import { inLiveWindow, renderPrompt } from '../src/statusline';
import type { CacheState } from '../src/cache';
import type { Match } from '@claudinho/core';

function m(
  id: string,
  home: [string, string],
  away: [string, string],
  over: Partial<Match> = {},
): Match {
  return {
    id,
    stage: 'GROUP',
    group: 'A',
    kickoff: '2026-06-11T19:00Z',
    venue: 'X',
    home: { code: home[0], name: home[0], flag: home[1] },
    away: { code: away[0], name: away[0], flag: away[1] },
    status: 'LIVE',
    updatedAt: '2026-06-11T20:00:00Z',
    ...over,
  };
}

const NOW = new Date('2026-06-11T20:00:00Z'); // opener is live (KO 19:00Z)

function state(live: Match[], updatedAt = '2026-06-11T19:59:50Z'): CacheState {
  return { updatedAt, live, degraded: false, source: 'espn' };
}

describe('renderPrompt — live', () => {
  it('renders a live match with flags, score, minute', () => {
    const s = state([m('1', ['MEX', '🇲🇽'], ['RSA', '🇿🇦'], { minute: 67, score: { home: 1, away: 0 } })]);
    expect(renderPrompt(s, { now: NOW })).toBe("⚽ 🇲🇽 1–0 🇿🇦 67'");
  });

  it('shows HT instead of a minute at halftime', () => {
    const s = state([m('1', ['MEX', '🇲🇽'], ['RSA', '🇿🇦'], { status: 'HT', score: { home: 0, away: 0 } })]);
    expect(renderPrompt(s, { now: NOW })).toBe('⚽ 🇲🇽 0–0 🇿🇦 HT');
  });

  it('includes team codes when not compact', () => {
    const s = state([m('1', ['MEX', '🇲🇽'], ['RSA', '🇿🇦'], { minute: 67, score: { home: 1, away: 0 } })]);
    expect(renderPrompt(s, { now: NOW, compact: false })).toBe("⚽ 🇲🇽 MEX 1–0 RSA 🇿🇦 67'");
  });

  it('prioritizes the configured team among several live matches', () => {
    const s = state([
      m('1', ['MEX', '🇲🇽'], ['RSA', '🇿🇦'], { minute: 30, score: { home: 0, away: 0 } }),
      m('2', ['BRA', '🇧🇷'], ['MAR', '🇲🇦'], { minute: 70, score: { home: 2, away: 1 } }),
    ]);
    expect(renderPrompt(s, { now: NOW, team: 'BRA' })).toBe("⚽ 🇧🇷 2–1 🇲🇦 70'");
  });

  it('appends +N for other concurrent matches when no team is set', () => {
    const s = state([
      m('1', ['MEX', '🇲🇽'], ['RSA', '🇿🇦'], { minute: 30, score: { home: 0, away: 0 } }),
      m('2', ['BRA', '🇧🇷'], ['MAR', '🇲🇦'], { minute: 70, score: { home: 2, away: 1 } }),
    ]);
    expect(renderPrompt(s, { now: NOW })).toBe("⚽ 🇲🇽 0–0 🇿🇦 30' +1");
  });

  it('ignores live scores from a stale cache', () => {
    const s = state(
      [m('1', ['MEX', '🇲🇽'], ['RSA', '🇿🇦'], { minute: 67, score: { home: 1, away: 0 } })],
      '2026-06-11T19:50:00Z', // 10 min old vs NOW -> stale
    );
    // Falls through to next-fixture countdown rather than a stale score.
    expect(renderPrompt(s, { now: NOW })).not.toContain('67');
  });
});

describe('renderPrompt — next fixture (static, no cache)', () => {
  const PRE = new Date('2026-06-01T00:00:00Z');

  it('shows the soonest upcoming fixture overall', () => {
    const line = renderPrompt(undefined, { now: PRE });
    expect(line.startsWith('🇲🇽 vs 🇿🇦 in ')).toBe(true); // Mexico v South Africa opener
  });

  it('shows a specific team next fixture when configured', () => {
    const line = renderPrompt(undefined, { now: PRE, team: 'BRA' });
    expect(line.startsWith('🇧🇷 vs 🇲🇦 in ')).toBe(true); // Brazil v Morocco
  });
});

describe('inLiveWindow', () => {
  it('is true during a match window and false well before', () => {
    expect(inLiveWindow(new Date('2026-06-11T20:00:00Z').getTime())).toBe(true);
    expect(inLiveWindow(new Date('2026-06-01T00:00:00Z').getTime())).toBe(false);
  });
});
