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

const NOW = new Date('2026-06-29T12:00:00Z');

/** A resolved knockout tie in the cache — what the statusline must find. */
const resolvedTie = {
  id: '760489',
  stage: 'R32',
  kickoff: '2026-06-29T20:30:00.000Z',
  venue: 'Estadio Azteca',
  home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
  away: { code: 'ECU', name: 'Ecuador', flag: '🇪🇨' },
  status: 'SCHEDULED',
  updatedAt: '2026-06-29T11:59:00Z',
};

/** Passes `isMatchShaped` (id/kickoff strings, both codes) but cannot be sealed. */
const junkFixture = (i: number) => ({
  id: `x${i}`, // not an ESPN id — refused at the seal
  kickoff: '2026-06-29T20:30:00.000Z',
  home: { code: 'AAA' },
  away: { code: 'BBB' },
});

const cache = (fixtures: unknown[]) =>
  ({
    version: 2,
    updatedAt: '2026-06-29T11:59:30Z',
    live: [],
    fixtures,
    degraded: false,
    source: 'espn',
    competition: 'fifa.world',
  }) as never;

describe('cached knockout fixtures: readable pairings survive malformed siblings', () => {
  it('displays a sealed pairing found after malformed records', () => {
    const line = renderPrompt(
      cache([...Array.from({ length: 64 }, (_, i) => junkFixture(i)), resolvedTie]),
      { now: NOW },
    );
    expect(line).toContain('🇲🇽');
    expect(line).toContain('🇪🇨');
  });

  it('bounds the examined records without a wall-clock assertion', () => {
    let touched = 0;
    const many = [
      ...Array.from({ length: 600 }, (_, i) => {
        const fixture = junkFixture(i);
        Object.defineProperty(fixture, 'id', {
          enumerable: true,
          get() {
            touched = Math.max(touched, i + 1);
            return `x${i}`;
          },
        });
        return fixture;
      }),
      resolvedTie,
    ];
    const line = renderPrompt(cache(many), { now: NOW });
    expect(line).not.toContain('🇲🇽');
    expect(touched).toBeLessThanOrEqual(512);
  });
});
