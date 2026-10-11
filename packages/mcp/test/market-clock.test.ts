/**
 * A market read is judged by the REQUEST's clock end to end: the relevance gate, the reliability gate, and the
 * provider's own staleness stamp. The provider here builds its signal the way a provider builds one (core's
 * `buildMarketSignal`, the real provider's tail), priced an hour before a bundled kickoff and stamped stale or
 * fresh by the clock it is HANDED (`options.now`). Every wall clock has passed every bundled kickoff by months, so
 * a market read that hands the provider no clock is stamped stale by the wall clock: the strict surfaces drop the
 * signal and the dedicated market tool shows it under the stale caveat, on every day this file runs.
 */
import {
  allFixtures,
  buildMarketSignal,
  definitiveNone,
  type Match,
  type MarketProvider,
  type MarketSignal,
  type ProviderAdapter,
  valid,
} from '@claudinho/core';
import { describe, expect, it } from 'vitest';
import { toolGetMarketSignal, toolGetMatch, toolGetShareSnippet, toolGetToday } from '../src/tools';

const fixture = allFixtures().find(
  (m) => m.status === 'SCHEDULED' && Date.parse(m.kickoff) > Date.parse('2026-06-13T12:00:00Z') && new Date(m.kickoff).getUTCHours() >= 2,
)!;
const before = new Date(Date.parse(fixture.kickoff) - 3_600_000);
const day = before.toISOString().slice(0, 10);
const wc: ProviderAdapter = {
  name: 'fake',
  competition: 'fifa.world',
  capabilities: { push: false, latencyHintSec: 0 },
  async fetchByDate(): Promise<Match[]> {
    return [];
  },
  async fetchLive(): Promise<Match[]> {
    return [];
  },
  async fetchWindow(): Promise<Match[]> {
    return [];
  },
};
const sig = (m: Match, now: Date | undefined): MarketSignal =>
  buildMarketSignal({
    match: m,
    source: 'polymarket',
    asOf: before.toISOString(),
    fetchedAt: before.toISOString(),
    outcomes: [
      { kind: 'home', teamCode: m.home.code, label: m.home.name, probability: 0.56 },
      { kind: 'draw', label: 'Draw', probability: 0.25 },
      { kind: 'away', teamCode: m.away.code, label: m.away.name, probability: 0.19 },
    ],
    liquidity: 250_000,
    now,
  });
const marketProvider: MarketProvider = {
  name: 'fixed',
  findSignal: async (m, options) => (m.id === fixture.id ? sig(m, options?.now) : undefined),
  findSignals: async (ms, options) => ({
    results: new Map(ms.map((m) => [m.id, m.id === fixture.id ? valid(sig(m, options?.now)) : definitiveNone('no signal for this fixture')] as const)),
    complete: true,
  }),
};
const common = { competition: 'world-cup', tz: 'UTC', lang: 'en', flavor: 'off' as const, adapter: wc, marketProvider, now: before };

describe("a market read is judged by the request's clock, the provider's staleness stamp included", () => {
  it("get_today: the day's fixture carries its market line", async () => {
    const r = await toolGetToday({ ...common, date: day });
    expect(r.text).toContain('56%');
  });

  it('get_match: the match carries its market line', async () => {
    const r = await toolGetMatch({ ...common, id: fixture.id });
    expect(r.text).toContain('56%');
  });

  it('get_market_signal by id: the signal, fresh by the request clock', async () => {
    const r = await toolGetMarketSignal({ ...common, matchId: fixture.id });
    expect(r.text).toContain('56%');
    expect(r.text).not.toContain('stale');
  });

  it("get_market_signal by team: the team's next fixture's signal, fresh by the request clock", async () => {
    const r = await toolGetMarketSignal({ ...common, team: fixture.home.code });
    expect(r.text).toContain('56%');
    expect(r.text).not.toContain('stale');
  });

  it("get_market_signal by date: the day's signal, fresh by the request clock", async () => {
    const r = await toolGetMarketSignal({ ...common, date: day });
    expect(r.text).toContain('56%');
    expect(r.text).not.toContain('stale');
  });

  it("get_share_snippet for the day: the card's market block", async () => {
    const r = await toolGetShareSnippet({ ...common, date: day });
    expect(r.text).toContain('56%');
  });
});
