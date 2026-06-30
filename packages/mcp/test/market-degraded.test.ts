/**
 * MARKET-GATE DEGRADED GUARD (MCP) — twin of
 * packages/cli/test/market-degraded.test.ts (see that header). review-discipline
 * rule 11: a market signal cached by match id must NOT surface against a degraded
 * 🏳️ placeholder that inherited its id when the live feed falls back to the bundle.
 * Drives the real MCP tools with the adverse cache state reconstructed.
 */
import {
  buildMarketSignal,
  FakeMarketProvider,
  type Match,
  type MarketSignal,
  normalizeOutcomes,
  type ProviderAdapter,
} from '@claudinho/core';
import { describe, expect, it } from 'vitest';
import { toolGetMarketSignal, toolGetToday } from '../src/tools';

const KO_ID = '760486'; // the canonical fake R32 tie used across coverage tests
const KICK = '2026-06-30T18:00Z';
const RENDER_NOW = new Date('2026-06-30T12:00:00Z'); // pre-kickoff → market-relevant

function mexEcu(over: Partial<Match> = {}): Match {
  return {
    id: KO_ID,
    stage: 'R32',
    kickoff: KICK,
    venue: 'SoFi Stadium',
    home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
    away: { code: 'ECU', name: 'Ecuador', flag: '🇪🇨' },
    status: 'SCHEDULED',
    updatedAt: '2026-06-30T00:00Z',
    ...over,
  };
}

/**
 * The bundle placeholder the feed degrades back to — same id, unresolved teams.
 * Mirrors the real bundled slot 760486 (`2A`/`2B`, "Group A/B 2nd Place", 🏳️).
 */
function placeholder(): Match {
  return mexEcu({
    home: { code: '2A', name: 'Group A 2nd Place', flag: '🏳️' },
    away: { code: '2B', name: 'Group B 2nd Place', flag: '🏳️' },
  });
}

/** A signal cached while the fixture WAS resolved: matchId KO_ID, MEX/ECU outcomes. */
function cachedSignal(): MarketSignal {
  return buildMarketSignal({
    match: mexEcu(),
    source: 'fake',
    asOf: '2026-06-30T11:55Z',
    outcomes: normalizeOutcomes([
      { kind: 'home', teamCode: 'MEX', label: 'Mexico', probability: 0.45 },
      { kind: 'draw', label: 'Draw', probability: 0.32 },
      { kind: 'away', teamCode: 'ECU', label: 'Ecuador', probability: 0.23 },
    ]),
    liquidity: 500_000,
    now: new Date('2026-06-30T11:55Z'),
  });
}

const provider = () => new FakeMarketProvider({ signals: { [KO_ID]: cachedSignal() } });

function adapterFor(window: Match[]): ProviderAdapter {
  return {
    name: 'espn',
    capabilities: { push: false, latencyHintSec: 0 },
    async fetchByDate() {
      return window;
    },
    async fetchLive() {
      return [];
    },
    async fetchWindow() {
      return window;
    },
  };
}
const args = (window: Match[]) => ({
  date: '2026-06-30',
  tz: 'UTC',
  adapter: adapterFor(window),
  marketProvider: provider(),
  now: RENDER_NOW,
});

describe('MCP market gate — cached signal must not surface against a degraded placeholder (rule 11)', () => {
  it('get_today: DROPS the inherited market when the fixture degraded to a placeholder', async () => {
    const r = await toolGetToday(args([placeholder()]));
    const data = r.data as { marketSignals?: Record<string, unknown> };
    expect(data.marketSignals?.[KO_ID]).toBeUndefined();
  });

  it('get_today: KEEPS the market when the fixture is resolved (positive control)', async () => {
    const r = await toolGetToday(args([mexEcu()]));
    const data = r.data as { marketSignals?: Record<string, unknown> };
    expect(data.marketSignals?.[KO_ID]).toBeDefined();
  });

  it('get_market_signal { date }: drops the mismatched signal from the listing', async () => {
    const r = await toolGetMarketSignal(args([placeholder()]));
    expect((r.data as { signals: unknown[] }).signals).toHaveLength(0);
  });

  it('get_market_signal { date }: lists it when resolved (positive control)', async () => {
    const r = await toolGetMarketSignal(args([mexEcu()]));
    expect((r.data as { signals: unknown[] }).signals).toHaveLength(1);
  });
});
