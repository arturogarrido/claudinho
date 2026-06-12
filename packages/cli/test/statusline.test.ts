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
  return { updatedAt, live, degraded: false, source: 'espn', competition: 'fifa.world' };
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

  it('shows ALL live matches inline (no team filter), joined by " · "', () => {
    const s = state([
      m('1', ['MEX', '🇲🇽'], ['RSA', '🇿🇦'], { minute: 30, score: { home: 0, away: 0 } }),
      m('2', ['BRA', '🇧🇷'], ['MAR', '🇲🇦'], { minute: 70, score: { home: 2, away: 1 } }),
    ]);
    expect(renderPrompt(s, { now: NOW })).toBe("⚽ 🇲🇽 0–0 🇿🇦 30' · 🇧🇷 2–1 🇲🇦 70'");
  });

  it('caps inline matches at `max` and collapses the rest into +N', () => {
    const s = state([
      m('1', ['MEX', '🇲🇽'], ['RSA', '🇿🇦'], { minute: 30, score: { home: 0, away: 0 } }),
      m('2', ['BRA', '🇧🇷'], ['MAR', '🇲🇦'], { minute: 70, score: { home: 2, away: 1 } }),
      m('3', ['FRA', '🇫🇷'], ['CIV', '🇨🇮'], { minute: 55, score: { home: 1, away: 1 } }),
    ]);
    expect(renderPrompt(s, { now: NOW, max: 2 })).toBe(
      "⚽ 🇲🇽 0–0 🇿🇦 30' · 🇧🇷 2–1 🇲🇦 70' +1",
    );
    expect(renderPrompt(s, { now: NOW, max: 1 })).toBe("⚽ 🇲🇽 0–0 🇿🇦 30' +2");
  });

  it('ignores live scores from a stale cache', () => {
    const s = state(
      [m('1', ['MEX', '🇲🇽'], ['RSA', '🇿🇦'], { minute: 67, score: { home: 1, away: 0 } })],
      '2026-06-11T19:50:00Z', // 10 min old vs NOW -> stale
    );
    // Falls through to next-fixture countdown rather than a stale score.
    expect(renderPrompt(s, { now: NOW })).not.toContain('67');
  });

  it('degrades to the countdown on a corrupt cache (regression: blank line)', () => {
    // A corrupt cache where `live` isn't an array must NOT blank the statusline.
    const cases: unknown[] = ['not-an-array', 42, { a: 1 }, null];
    for (const bad of cases) {
      const s = { updatedAt: NOW.toISOString(), live: bad, degraded: false, source: 'espn' };
      const out = renderPrompt(s as never, { now: NOW });
      expect(out.length).toBeGreaterThan(0); // never empty
      expect(out).toContain('in '); // fell back to a countdown
    }
  });

  it('skips malformed live entries (missing teams) instead of throwing', () => {
    const s = {
      updatedAt: NOW.toISOString(),
      live: [{ status: 'LIVE' }, { status: 'LIVE', home: {}, away: {} }],
      degraded: false,
      source: 'espn',
    };
    const out = renderPrompt(s as never, { now: NOW });
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain('in '); // no valid live entry -> countdown
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

describe('renderPrompt — live window, cold/stale cache → "syncing"', () => {
  // NOW sits inside the real opener\'s live window (KO 2026-06-11T19:00Z).
  it('says "live · syncing" instead of a countdown when the cache is missing', () => {
    const line = renderPrompt(undefined, { now: NOW });
    expect(line).toContain('live · syncing');
    expect(line).not.toContain(' in ');
  });

  it('says "syncing" when the cache is STALE during the window', () => {
    const s = state([], '2026-06-11T19:30:00Z'); // 30 min old → stale
    expect(renderPrompt(s, { now: NOW })).toContain('live · syncing');
  });

  it('trusts a FRESH empty cache (feed says nothing live) → countdown', () => {
    const s = state([]); // fresh timestamp, no live matches
    expect(renderPrompt(s, { now: NOW })).toContain(' in ');
  });

  it('does NOT trust a fresh DEGRADED snapshot — syncing, not countdown', () => {
    // The refresher writes { live: [], degraded: true } with a fresh timestamp
    // when the fetch fails; that means "fetch failed", not "feed said empty".
    const s = { ...state([]), degraded: true };
    expect(renderPrompt(s, { now: NOW })).toContain('live · syncing');
  });

  it('applies the team filter: syncing only for a team in a window', () => {
    expect(renderPrompt(undefined, { now: NOW, team: 'MEX' })).toContain('live · syncing');
    expect(renderPrompt(undefined, { now: NOW, team: 'BRA' })).toContain(' in ');
  });
});
