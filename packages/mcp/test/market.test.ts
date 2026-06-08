import {
  allFixtures,
  FakeMarketProvider,
  type Match,
  type MarketProvider,
  type ProviderAdapter,
} from '@claudinho/core';
import { describe, expect, it } from 'vitest';
import { toolGetMarketSignal, toolGetMatch, toolGetToday } from '../src/tools';

/** Offline match adapter → the date branch uses the bundled static schedule. */
const fakeAdapter: ProviderAdapter = {
  name: 'fake',
  capabilities: { push: false, latencyHintSec: 0 },
  async fetchByDate(): Promise<Match[]> {
    return [];
  },
  async fetchLive(): Promise<Match[]> {
    return [];
  },
};

const synth = () =>
  new FakeMarketProvider({ synthesize: true, now: new Date('2026-06-13T12:00:00Z') });

type MarketData = {
  market: { url: null };
  informationalOnly: boolean;
  source: string;
};

describe('toolGetMarketSignal', () => {
  it('returns a link-free, informational signal for a match id', async () => {
    const id = allFixtures()[0]!.id;
    const r = await toolGetMarketSignal({ matchId: id, marketProvider: synth() });
    const data = r.data as { matchId: string; signal: MarketData | null };
    expect(data.matchId).toBe(id);
    expect(data.signal).not.toBeNull();
    expect(data.signal?.market.url).toBeNull();
    expect(data.signal?.informationalOnly).toBe(true);
    expect(data.signal?.source).toBe('fake');
    expect(r.text).toContain('informational only');
    expect(r.text).not.toMatch(/\b(bet|betting|wager|gambling|value pick|edge|lock)\b/i);
  });

  it('returns a null signal for an unknown match id', async () => {
    const r = await toolGetMarketSignal({ matchId: 'nope', marketProvider: synth() });
    expect((r.data as { signal: null }).signal).toBeNull();
    expect(r.text).toContain('No match found');
  });

  it("resolves a team's next fixture", async () => {
    const team = allFixtures()[0]!.home.code;
    const r = await toolGetMarketSignal({ team, marketProvider: synth() });
    const data = r.data as { team: string; informationalOnly: boolean };
    expect(data.team).toBe(team);
    expect(data.informationalOnly).toBe(true);
  });

  it('lists a date of signals (default branch)', async () => {
    const r = await toolGetMarketSignal({
      date: '2026-06-13',
      tz: 'UTC',
      adapter: fakeAdapter,
      marketProvider: synth(),
    });
    const data = r.data as { date: string; signals: MarketData[] };
    expect(data.date).toBe('2026-06-13');
    expect(data.signals.length).toBeGreaterThan(0);
    expect(data.signals.every((s) => s.market.url === null)).toBe(true);
  });

  it('degrades to an empty list when the provider throws', async () => {
    const boom: MarketProvider = {
      name: 'boom',
      findSignal: async () => {
        throw new Error('down');
      },
      findSignals: async () => {
        throw new Error('down');
      },
    };
    const r = await toolGetMarketSignal({
      date: '2026-06-13',
      tz: 'UTC',
      adapter: fakeAdapter,
      marketProvider: boom,
    });
    expect((r.data as { signals: unknown[] }).signals).toEqual([]);
  });
});

describe('default-on market context', () => {
  it('get_today attaches reliable, link-free market signals', async () => {
    const r = await toolGetToday({
      date: '2026-06-13',
      tz: 'UTC',
      adapter: fakeAdapter,
      marketProvider: synth(),
    });
    const data = r.data as { marketSignals?: Record<string, MarketData> };
    expect(data.marketSignals).toBeDefined();
    expect(Object.values(data.marketSignals ?? {})[0]?.market.url).toBeNull();
  });

  it('get_match appends a reliable market block', async () => {
    const id = allFixtures()[0]!.id;
    const r = await toolGetMatch({ id, adapter: fakeAdapter, marketProvider: synth() });
    const data = r.data as { marketSignal: MarketData | null };
    expect(data.marketSignal).not.toBeNull();
    expect(r.text).toContain('Prediction markets');
    expect(r.text).not.toMatch(/\b(bet|betting|wager|gambling)\b/i);
  });

  it('get_today omits market signals when CLAUDINHO_MARKETS=off', async () => {
    const prev = process.env.CLAUDINHO_MARKETS;
    process.env.CLAUDINHO_MARKETS = 'off';
    try {
      const r = await toolGetToday({
        date: '2026-06-13',
        tz: 'UTC',
        adapter: fakeAdapter,
        marketProvider: synth(),
      });
      expect((r.data as { marketSignals?: unknown }).marketSignals).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.CLAUDINHO_MARKETS;
      else process.env.CLAUDINHO_MARKETS = prev;
    }
  });
});
