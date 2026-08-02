/**
 * A bounded hot path must not hide a real live match.
 *
 * Sealing is grapheme-level over ~8 fields, so it cannot run on every record of
 * an unbounded cache file. The previous bound took the first 64 records passing
 * a CHEAP shape test and sealed those — so 64 records that merely LOOK live and
 * seal to nothing consumed the whole budget, and a real match behind them
 * vanished: the statusline showed a countdown while a match was being played.
 *
 * Bound the CANDIDATES examined, not the RESULTS collected.
 */
import { describe, expect, it } from 'vitest';
import { renderHook } from '../src/hook';
import { liveMatchesFromCache, renderPrompt } from '../src/statusline';

const NOW = new Date('2026-06-20T20:00:00Z');
/** Passes the cheap shape test (LIVE + two codes) but cannot be sealed. */
const junk = { status: 'LIVE', home: { code: 'AAA' }, away: { code: 'BBB' } };
const real = {
  id: '700123', stage: 'GROUP', kickoff: '2026-06-20T19:00:00Z', venue: 'V',
  home: { code: 'MEX', name: 'Mexico' }, away: { code: 'RSA', name: 'South Africa' },
  score: { home: 1, away: 0 }, minute: 55, status: 'LIVE',
  updatedAt: '2026-06-20T19:59:00Z',
};
const cache = (live: unknown[]) =>
  ({ version: 2, updatedAt: '2026-06-20T19:59:30Z', live, degraded: false,
     source: 'espn', competition: 'fifa.world' }) as never;

describe('junk cannot crowd out a live score', () => {
  it('finds the real match behind 64 unsealable records', () => {
    const state = cache([...Array.from({ length: 64 }, () => ({ ...junk })), real]);
    expect(liveMatchesFromCache(state, NOW.getTime())).toHaveLength(1);
    expect(renderPrompt(state, { now: NOW })).toContain('1–0');
    expect(renderHook(state, { now: NOW })).toContain('Mexico');
  });

  it('and behind 400 of them', () => {
    const state = cache([...Array.from({ length: 400 }, () => ({ ...junk })), real]);
    expect(liveMatchesFromCache(state, NOW.getTime())).toHaveLength(1);
  });

  it('while the work stays bounded on a million records', () => {
    // The reason the cap exists. Flat, not linear: 1M records cost the same as
    // 1k, because the examine budget stops the scan either way.
    const many = Array.from({ length: 1_000_000 }, (_, i) => ({ ...real, id: String(700000 + i) }));
    const state = cache(many);
    renderPrompt(state, { now: NOW }); // warm
    const t = performance.now();
    renderPrompt(state, { now: NOW });
    // Generous absolute ceiling only as a smoke check; the real assertion is
    // that the result count is capped, which is deterministic.
    expect(liveMatchesFromCache(state, NOW.getTime()).length).toBeLessThanOrEqual(64);
    expect(performance.now() - t).toBeLessThan(2_000);
  }, 120_000);
});
