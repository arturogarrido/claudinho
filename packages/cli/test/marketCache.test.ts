import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MarketSignal } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readMarketCache, writeMarketCache } from '../src/marketCache';

const signal: MarketSignal = {
  matchId: '760415',
  source: 'polymarket',
  asOf: '2026-06-11T14:55:00Z',
  fetchedAt: '2026-06-11T14:56:00Z',
  outcomes: [
    { kind: 'home', teamCode: 'MEX', label: 'Mexico', probability: 0.56 },
    { kind: 'draw', label: 'Draw', probability: 0.25 },
    { kind: 'away', teamCode: 'RSA', label: 'South Africa', probability: 0.19 },
  ],
  favorite: { kind: 'home', teamCode: 'MEX', probability: 0.56, strength: 'slight' },
  stale: false,
  ambiguous: false,
};

const NOW = Date.parse('2026-06-11T15:00:00Z');

let dir: string;
const orig = process.env.XDG_CACHE_HOME;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-mc-'));
  process.env.XDG_CACHE_HOME = dir;
});
afterEach(() => {
  if (orig === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = orig;
  rmSync(dir, { recursive: true, force: true });
});

describe('market-signals cache', () => {
  it('round-trips a fresh positive signal', () => {
    writeMarketCache('polymarket', 'fifa.world', ['760415'], new Map([['760415', signal]]), NOW);
    const { signals, checked } = readMarketCache('polymarket', 'fifa.world', NOW + 60_000);
    expect(signals.get('760415')?.favorite?.teamCode).toBe('MEX');
    expect(checked.has('760415')).toBe(true);
  });

  it('negatively caches a checked-but-empty match', () => {
    writeMarketCache('polymarket', 'fifa.world', ['999'], new Map(), NOW); // attempted, no signal
    const { signals, checked } = readMarketCache('polymarket', 'fifa.world', NOW + 60_000);
    expect(signals.has('999')).toBe(false);
    expect(checked.has('999')).toBe(true); // known → skip re-fetch
  });

  it('expires positive entries after the positive TTL', () => {
    writeMarketCache('polymarket', 'fifa.world', ['760415'], new Map([['760415', signal]]), NOW);
    expect(readMarketCache('polymarket', 'fifa.world', NOW + 11 * 60_000).checked.has('760415')).toBe(false);
  });

  it('expires negative entries sooner than positive', () => {
    writeMarketCache('polymarket', 'fifa.world', ['999'], new Map(), NOW);
    // 5 minutes later: the negative entry (3m TTL) is gone, so we'd re-check.
    expect(readMarketCache('polymarket', 'fifa.world', NOW + 5 * 60_000).checked.has('999')).toBe(false);
  });

  it('does not bleed across source or competition', () => {
    writeMarketCache('polymarket', 'fifa.world', ['760415'], new Map([['760415', signal]]), NOW);
    expect(readMarketCache('polymarket', 'fifa.friendly', NOW).checked.size).toBe(0);
    expect(readMarketCache('other', 'fifa.world', NOW).checked.size).toBe(0);
  });

  it('ignores an empty attempt list and reads empty when absent', () => {
    writeMarketCache('polymarket', 'fifa.world', [], new Map(), NOW);
    expect(readMarketCache('polymarket', 'fifa.world', NOW).checked.size).toBe(0);
  });

  it('merges a later attempt into the existing cache', () => {
    writeMarketCache('polymarket', 'fifa.world', ['760415'], new Map([['760415', signal]]), NOW);
    writeMarketCache('polymarket', 'fifa.world', ['888'], new Map(), NOW + 1000);
    const { signals, checked } = readMarketCache('polymarket', 'fifa.world', NOW + 60_000);
    expect(signals.has('760415')).toBe(true);
    expect(checked.has('888')).toBe(true);
  });
});

describe('market-signals cache — malformed file must not crash a command', () => {
  /** Write raw JSON straight to the cache path, bypassing writeMarketCache. */
  function poison(json: unknown) {
    mkdirSync(join(dir, 'claudinho'), { recursive: true });
    writeFileSync(join(dir, 'claudinho', 'market-signals.json'), JSON.stringify(json));
  }

  it('skips a null entry instead of throwing (reported crash)', () => {
    poison({
      source: 'polymarket',
      competition: 'fifa.world',
      entries: { '760415': null, '760416': 'nope', '760417': 42 },
    });
    expect(() => readMarketCache('polymarket', 'fifa.world', NOW)).not.toThrow();
    const { signals, checked } = readMarketCache('polymarket', 'fifa.world', NOW);
    expect(signals.size).toBe(0);
    // Critically: a malformed entry must NOT be marked checked, or a junk file
    // would suppress the real fetch for that match.
    expect(checked.size).toBe(0);
  });

  it('survives a hostile toString in a cached signal', () => {
    poison({
      source: 'polymarket',
      competition: 'fifa.world',
      entries: {
        '760415': {
          fetchedAt: '2026-06-11T14:56:00Z',
          signal: { ...signal, source: { toString: null } },
        },
      },
    });
    expect(() => readMarketCache('polymarket', 'fifa.world', NOW)).not.toThrow();
    const { signals, checked } = readMarketCache('polymarket', 'fifa.world', NOW);
    // A signal whose source sanitizes to nothing is malformed, not a negative
    // result: it must be dropped AND left unchecked so the real fetch still runs.
    expect(signals.has('760415')).toBe(false);
    expect(checked.has('760415')).toBe(false);
  });

  it('does not mark a malformed POSITIVE body as checked (would suppress refetch)', () => {
    for (const bad of [false, {}, 'nope', 0, { outcomes: [] }]) {
      poison({
        source: 'polymarket',
        competition: 'fifa.world',
        entries: { '760415': { fetchedAt: '2026-06-11T14:56:00Z', signal: bad } },
      });
      const { signals, checked } = readMarketCache('polymarket', 'fifa.world', NOW);
      expect(signals.has('760415')).toBe(false);
      expect(checked.has('760415')).toBe(false);
    }
  });

  it('still honours a genuine negative entry (signal: null) as checked', () => {
    // Inside the 3-minute NEGATIVE TTL (14:59 -> 15:00), unlike the positive one.
    poison({
      source: 'polymarket',
      competition: 'fifa.world',
      entries: { '760415': { fetchedAt: '2026-06-11T14:59:00Z', signal: null } },
    });
    const { signals, checked } = readMarketCache('polymarket', 'fifa.world', NOW);
    expect(signals.has('760415')).toBe(false);
    expect(checked.has('760415')).toBe(true);
  });

  it('tolerates entries being absent or a non-object', () => {
    for (const entries of [undefined, null, 'x', 7, []]) {
      poison({ source: 'polymarket', competition: 'fifa.world', entries });
      expect(() => readMarketCache('polymarket', 'fifa.world', NOW)).not.toThrow();
    }
  });
});
