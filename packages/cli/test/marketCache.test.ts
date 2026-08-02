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

  /**
   * PROPERTY 7 — AVAILABILITY. An entry may suppress the real provider fetch
   * ONLY if it would actually render. Five shapes previously survived
   * sanitizing, were marked `checked`, and then displayed nothing — so the
   * cache hid the market line AND blocked the fetch that could have produced a
   * real one, for the full 10-minute positive TTL.
   *
   * Negative control: revert isUsableSignal to its three emptiness checks.
   */
  it('never marks an entry `checked` unless it would render', () => {
    const shapes: Array<[string, unknown]> = [
      ['all-other outcomes', { ...signal, outcomes: [{ kind: 'other', label: 'x', probability: 1 }] }],
      [
        'incoherent distribution',
        {
          ...signal,
          outcomes: [
            { kind: 'home', teamCode: 'MEX', label: 'Mexico', probability: 0.1 },
            { kind: 'away', teamCode: 'RSA', label: 'South Africa', probability: 0.1 },
          ],
        },
      ],
      ['ambiguous', { ...signal, ambiguous: true }],
      ['no determinable favorite', { ...signal, outcomes: [] }],
      ['unknown source', { ...signal, source: 'evilprovider' }],
    ];
    for (const [label, bad] of shapes) {
      poison({
        source: 'polymarket',
        competition: 'fifa.world',
        entries: { '760415': { fetchedAt: '2026-06-11T14:59:00Z', signal: bad } },
      });
      const { signals, checked } = readMarketCache('polymarket', 'fifa.world', NOW);
      expect(signals.has('760415'), label).toBe(false);
      expect(checked.has('760415'), `${label} must NOT suppress the refetch`).toBe(false);
    }
  });

  it('DOES serve a structurally-valid but STALE signal (markets renders it with a caveat)', () => {
    // The counterpart to the test above, and the reason `isUsableSignal` must
    // not fold in a freshness term: a provider reading that was already old
    // when written is a real result. Gating it out here made it un-cacheable —
    // re-fetched on every command forever — and silently removed the
    // stale-with-caveat rendering that `markets` is designed to show.
    poison({
      source: 'polymarket',
      competition: 'fifa.world',
      entries: {
        '760415': {
          fetchedAt: '2026-06-11T14:59:00Z',
          signal: { ...signal, asOf: '2026-06-11T14:00:00Z' },
        },
      },
    });
    const { signals, checked } = readMarketCache('polymarket', 'fifa.world', NOW);
    expect(signals.get('760415')?.stale).toBe(true); // honestly flagged...
    expect(checked.has('760415')).toBe(true); // ...but still a real result
  });

  it('treats a FUTURE fetchedAt as expired, not as permanently fresh', () => {
    poison({
      source: 'polymarket',
      competition: 'fifa.world',
      entries: { '760415': { fetchedAt: '2099-01-01T00:00:00Z', signal: null } },
    });
    const { checked } = readMarketCache('polymarket', 'fifa.world', NOW);
    expect(checked.has('760415')).toBe(false);
  });

  it('tolerates entries being absent or a non-object', () => {
    for (const entries of [undefined, null, 'x', 7, []]) {
      poison({ source: 'polymarket', competition: 'fifa.world', entries });
      expect(() => readMarketCache('polymarket', 'fifa.world', NOW)).not.toThrow();
    }
  });

  it('rejects an oversized cache before using any entry', () => {
    poison({
      source: 'polymarket',
      competition: 'fifa.world',
      entries: {},
      padding: 'x'.repeat(1024 * 1024),
    });
    expect(readMarketCache('polymarket', 'fifa.world', NOW)).toEqual({
      signals: new Map(),
      checked: new Set(),
    });
  });

  it('examines at most 256 entries from a poisoned cache', () => {
    const entries: Record<string, unknown> = {};
    for (let i = 0; i < 256; i++) {
      entries[`cached-${i}`] = { fetchedAt: '2026-06-11T14:59:00Z', signal: null };
    }
    entries.late = { fetchedAt: '2026-06-11T14:59:00Z', signal: null };
    poison({ source: 'polymarket', competition: 'fifa.world', entries });
    const result = readMarketCache('polymarket', 'fifa.world', NOW);
    expect(result.checked.size).toBe(256);
    expect(result.checked.has('late')).toBe(false);
  });
});
