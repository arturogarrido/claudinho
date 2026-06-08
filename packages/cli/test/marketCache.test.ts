import { mkdtempSync, rmSync } from 'node:fs';
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
  it('round-trips fresh signals', () => {
    writeMarketCache('polymarket', 'fifa.world', new Map([['760415', signal]]), NOW);
    const got = readMarketCache('polymarket', 'fifa.world', NOW + 60_000);
    expect(got.get('760415')?.source).toBe('polymarket');
    expect(got.get('760415')?.favorite?.teamCode).toBe('MEX');
  });

  it('expires entries past the TTL', () => {
    writeMarketCache('polymarket', 'fifa.world', new Map([['760415', signal]]), NOW);
    const got = readMarketCache('polymarket', 'fifa.world', NOW + 11 * 60_000);
    expect(got.size).toBe(0);
  });

  it('does not bleed across a different source or competition', () => {
    writeMarketCache('polymarket', 'fifa.world', new Map([['760415', signal]]), NOW);
    expect(readMarketCache('polymarket', 'fifa.friendly', NOW).size).toBe(0);
    expect(readMarketCache('other', 'fifa.world', NOW).size).toBe(0);
  });

  it('reads empty when the cache is absent (never throws)', () => {
    expect(readMarketCache('polymarket', 'fifa.world', NOW).size).toBe(0);
  });

  it('ignores an empty write', () => {
    writeMarketCache('polymarket', 'fifa.world', new Map(), NOW);
    expect(readMarketCache('polymarket', 'fifa.world', NOW).size).toBe(0);
  });
});
