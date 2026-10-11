/**
 * A signal's `stale` is DERIVED: its `asOf` against the clock the seal is handed, never a stored flag. A cache
 * (the CLI's file, the MCP server's memory) keeps a signal past the request that stamped it, and a later request
 * may carry an earlier clock (a replay, a test's pin): a flag stamped by the writer's clock must not outlive it.
 * A malformed flag cannot coerce freshness either way; an unusable `asOf` is stale.
 */
import { describe, expect, it } from 'vitest';
import { buildMarketSignal } from '../src/markets/normalize';
import type { Match } from '../src/types';
import { parseCachedMarketSignal } from '../src/trust/market';

const NOW = new Date('2026-07-01T12:05:00.000Z');
const base = {
  matchId: '760415',
  source: 'polymarket',
  asOf: '2026-07-01T12:00:00.000Z', // five minutes before NOW, inside the freshness window
  fetchedAt: '2026-07-01T12:00:00.000Z',
  outcomes: [
    { kind: 'home', teamCode: 'MEX', label: 'Mexico', probability: 0.5 },
    { kind: 'draw', label: 'Draw', probability: 0.3 },
    { kind: 'away', teamCode: 'ECU', label: 'Ecuador', probability: 0.2 },
  ],
  liquidity: 500_000,
  volume24h: 1_000,
  stale: false,
  ambiguous: false,
};
const sealed = (raw: unknown, now = NOW) => {
  const r = parseCachedMarketSignal(raw, { now });
  if (r.kind !== 'valid') throw new Error(`not valid: ${r.kind}`);
  return r.value;
};

describe("a signal's staleness is derived from its asOf against the clock the seal is handed", () => {
  it('a stored stale: true (stamped by a later clock) on a reading fresh by this clock is not stale', () => {
    expect(sealed({ ...base, stale: true }).stale).toBe(false);
  });

  it('a malformed stale flag on a fresh reading is not stale (the flag is not read)', () => {
    expect(sealed({ ...base, stale: 'yes' }).stale).toBe(false);
  });

  it('a stored stale: false on a reading older than the window is stale', () => {
    expect(sealed({ ...base, stale: false }, new Date('2026-07-01T13:00:00.000Z')).stale).toBe(true);
  });
});

/**
 * A signal fetched after the clock it is judged by is no evidence for that request: every leg of it was priced at
 * most a minute after its fetch clock (the provider's per-leg guard), and nothing in it says which. The seal refuses
 * it as unresolved (never a definitive negative), so a cache hit read under an earlier clock is a miss and is fetched
 * again. A signal's `fetchedAt` is the clock its builder was handed.
 */
describe('a signal is evidence for a clock only if it was fetched at or before it', () => {
  // Every leg was priced at most a minute after the signal's fetch clock F (the provider's per-leg guard), so a read
  // at J serves it only when F <= J: its legs are then at most a minute after J, the uncached read's own bound. Any
  // allowance on F would compound with the leg's.
  it('fetched one millisecond after the clock: refused as unresolved', () => {
    const r = parseCachedMarketSignal({ ...base, fetchedAt: new Date(NOW.getTime() + 1).toISOString() }, { now: NOW });
    expect(r.kind).toBe('unresolved');
  });

  it('fetched at the clock: valid', () => {
    const r = parseCachedMarketSignal({ ...base, fetchedAt: NOW.toISOString() }, { now: NOW });
    expect(r.kind).toBe('valid');
  });

  it('a fetchedAt absent, empty, unparseable or of the wrong type: refused as malformed (no clock can place it)', () => {
    const { fetchedAt: _f, ...absent } = base;
    for (const raw of [absent, { ...base, fetchedAt: '' }, { ...base, fetchedAt: 'nope' }, { ...base, fetchedAt: 12345 }]) {
      expect(parseCachedMarketSignal(raw, { now: NOW }).kind, JSON.stringify((raw as Record<string, unknown>).fetchedAt ?? 'absent')).toBe('malformed');
    }
  });

  it('the builder stamps fetchedAt with the clock it is handed', () => {
    const match = { id: '760415', home: { code: 'MEX', name: 'Mexico' }, away: { code: 'ECU', name: 'Ecuador' } } as unknown as Match;
    const s = buildMarketSignal({ match, source: 'polymarket', asOf: base.asOf, outcomes: base.outcomes as never, liquidity: 500_000, now: NOW });
    expect(s.fetchedAt).toBe(NOW.toISOString());
    expect(s.outcomes).toHaveLength(3);
  });
});
