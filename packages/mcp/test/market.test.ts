import {
  allFixtures,
  FakeMarketProvider,
  type Match,
  type MarketProvider,
  type ProviderAdapter,
} from '@claudinho/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

/**
 * Fixed clock for time-dependent gates (relevance, live windows, freshness) —
 * deterministic forever, including after the tournament when every fixture's
 * window is in the real past.
 */
const TEST_NOW = new Date('2026-06-13T12:00:00Z');

const synth = () => new FakeMarketProvider({ synthesize: true, now: TEST_NOW });

/** A fixture still upcoming at TEST_NOW (its market read is relevant). */
const upcoming = (): Match =>
  allFixtures().find(
    (m) => m.status === 'SCHEDULED' && Date.parse(m.kickoff) > TEST_NOW.getTime(),
  )!;

const upcomingDate = () => upcoming().kickoff.slice(0, 10);

type MarketData = {
  market: { url: null };
  informationalOnly: boolean;
  source: string;
};

describe('toolGetMarketSignal', () => {
  it('returns a link-free, informational signal for a match id', async () => {
    const id = upcoming().id;
    const r = await toolGetMarketSignal({
      matchId: id,
      adapter: fakeAdapter,
      marketProvider: synth(),
      now: TEST_NOW,
    });
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
    const r = await toolGetMarketSignal({ matchId: 'nope', adapter: fakeAdapter, marketProvider: synth() });
    expect((r.data as { signal: null }).signal).toBeNull();
    expect(r.text).toContain('No match found');
  });

  it("resolves a team's current-or-next fixture", async () => {
    const team = upcoming().home.code;
    const r = await toolGetMarketSignal({ team, adapter: fakeAdapter, marketProvider: synth(), now: TEST_NOW });
    const data = r.data as { team: string; informationalOnly: boolean };
    expect(data.team).toBe(team);
    expect(data.informationalOnly).toBe(true);
  });

  it("prefers the team's IN-PLAY match over their next fixture", async () => {
    const fixture = upcoming();
    const during = new Date(Date.parse(fixture.kickoff) + 30 * 60_000);
    const r = await toolGetMarketSignal({
      team: fixture.home.code,
      adapter: fakeAdapter,
      marketProvider: synth(),
      now: during,
    });
    expect((r.data as { matchId: string }).matchId).toBe(fixture.id);
  });

  it('suppresses the signal for a finished match (market reads are pre-match)', async () => {
    const opener = allFixtures()[0]!;
    const after = new Date(Date.parse(opener.kickoff) + 6 * 60 * 60_000);
    const r = await toolGetMarketSignal({
      matchId: opener.id,
      adapter: fakeAdapter,
      marketProvider: synth(),
      now: after,
    });
    expect((r.data as { signal: unknown }).signal).toBeNull();
    expect(r.text).toContain('market signals are pre-match and in-play reads');
  });

  it('dates the fixture in the null-signal text (agents skim)', async () => {
    const r = await toolGetMarketSignal({
      matchId: upcoming().id,
      adapter: fakeAdapter,
      marketProvider: new FakeMarketProvider(), // synthesize off → no signal
      now: TEST_NOW,
    });
    expect(r.text).toContain('No reliable market signal for');
    expect(r.text).toMatch(/\(.+\)/); // the "(Jun 18)"-style date disambiguator
  });

  it('lists a date of signals (default branch)', async () => {
    const date = upcomingDate();
    const r = await toolGetMarketSignal({
      date,
      tz: 'UTC',
      adapter: fakeAdapter,
      marketProvider: synth(),
      now: TEST_NOW,
    });
    const data = r.data as { date: string; signals: MarketData[] };
    expect(data.date).toBe(date);
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
      now: TEST_NOW,
    });
    expect((r.data as { signals: unknown[] }).signals).toEqual([]);
  });
});

describe('default-on market context', () => {
  it('get_today attaches reliable, link-free market signals', async () => {
    const r = await toolGetToday({
      date: upcomingDate(),
      tz: 'UTC',
      adapter: fakeAdapter,
      marketProvider: synth(),
      now: TEST_NOW,
    });
    const data = r.data as { marketSignals?: Record<string, MarketData> };
    expect(data.marketSignals).toBeDefined();
    expect(Object.values(data.marketSignals ?? {})[0]?.market.url).toBeNull();
  });

  it('get_match appends a reliable market block', async () => {
    const id = upcoming().id;
    const r = await toolGetMatch({ id, adapter: fakeAdapter, marketProvider: synth(), now: TEST_NOW });
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

describe('toolGetMarketSignal — a competition without markets', () => {
  // No injected provider: the tool builds one through the real factory, which
  // must hand back the network-free no-op off the default competition.
  const ORIG = process.env.CLAUDINHO_COMPETITION;
  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIG === undefined) delete process.env.CLAUDINHO_COMPETITION;
    else process.env.CLAUDINHO_COMPETITION = ORIG;
  });

  it('says market signals cover the World Cup only, and issues no request', async () => {
    process.env.CLAUDINHO_COMPETITION = 'eng.1';
    const fetchSpy = vi.fn(async () => {
      throw new Error('no market request may leave the process on eng.1');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const byDate = await toolGetMarketSignal({ date: upcomingDate(), adapter: fakeAdapter, now: TEST_NOW });
    expect(byDate.text).toContain('Market signals cover the World Cup only');
    expect((byDate.data as { complete: boolean }).complete).toBe(true);
    const byId = await toolGetMarketSignal({ matchId: upcoming().id, adapter: fakeAdapter, now: TEST_NOW });
    expect(byId.text).toContain('Market signals cover the World Cup only');
    expect((byId.data as { signal: unknown; complete: boolean })).toMatchObject({ signal: null, complete: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
