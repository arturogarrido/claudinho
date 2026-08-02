/**
 * Round 15, CLI side.
 *
 * The theme repeats: each of these is the SIBLING of something already fixed in
 * this PR. The live-match list was fixed to bound candidates rather than
 * results; the cached-fixture list in the same function kept the old shape. The
 * MCP markets branch was taught to distinguish an outage from a quiet day; the
 * CLI branch beside it was not. Fixing the instance reported and not the class
 * is the single most repeated mistake in this changeset.
 */
import { describe, expect, it } from 'vitest';
import { renderPrompt } from '../src/statusline';

const NOW = new Date('2026-06-29T20:00:00Z');

/** A resolved knockout tie in the cache — what the statusline must find. */
const resolvedTie = {
  id: '760415',
  stage: 'R32',
  kickoff: '2026-06-29T23:00:00.000Z',
  venue: 'Estadio Azteca',
  home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
  away: { code: 'ECU', name: 'Ecuador', flag: '🇪🇨' },
  status: 'SCHEDULED',
  updatedAt: '2026-06-29T19:59:00Z',
};

/** Passes `isMatchShaped` (id/kickoff strings, both codes) but cannot be sealed. */
const junkFixture = (i: number) => ({
  id: `x${i}`, // not an ESPN id — refused at the seal
  kickoff: '2026-06-29T23:00:00.000Z',
  home: { code: 'AAA' },
  away: { code: 'BBB' },
});

const cache = (fixtures: unknown[]) =>
  ({
    version: 2,
    updatedAt: '2026-06-29T19:59:30Z',
    live: [],
    fixtures,
    degraded: false,
    source: 'espn',
    competition: 'fifa.world',
  }) as never;

describe('cached knockout fixtures: junk cannot crowd out a real pairing', () => {
  it('finds the resolved tie behind 64 unsealable shapes', () => {
    // The exact sibling of the live-list bug fixed a round earlier: this path
    // sliced the first 64 records passing a CHEAP shape test and sealed only
    // those, so 64 junk records hid a confirmed tie and the statusline fell
    // back to "⚽ —" with the answer sitting in the cache.
    const line = renderPrompt(
      cache([...Array.from({ length: 64 }, (_, i) => junkFixture(i)), resolvedTie]),
      { now: NOW },
    );
    expect(line).toContain('🇲🇽');
    expect(line).toContain('🇪🇨');
  });

  it('and still bounds the work when the cache is enormous', () => {
    const many = [...Array.from({ length: 200_000 }, (_, i) => junkFixture(i)), resolvedTie];
    const started = Date.now();
    const line = renderPrompt(cache(many), { now: NOW });
    // Deterministic assertion, not a stopwatch: past the examine cap we stop,
    // so a fixture beyond it is NEVER reached however large the file. (The
    // elapsed time is asserted only as a smoke ceiling an order of magnitude
    // above the 150ms budget, so a loaded CI box cannot flake it.)
    expect(line).not.toContain('🇲🇽');
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
