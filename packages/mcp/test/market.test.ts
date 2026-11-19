import {
import { DISCLAIMER } from '../src/format';
  allFixtures,
  definitiveNone,
  FakeMarketProvider,
  type Match,
  type MarketProvider,
  type MarketSignal,
  PolymarketProvider,
  type ProviderAdapter,
  valid,
} from '@claudinho/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toolGetMarketSignal, toolGetMatch, toolGetToday } from '../src/tools';

/** Offline match adapter → the date branch uses the bundled static schedule. */
const fakeAdapter: ProviderAdapter = {
  name: 'fake',
  competition: 'fifa.world',
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
    expect(r.text).toContain(DISCLAIMER);
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

  it("dates the header by the fixture's calendar day in the requested timezone", async () => {
    // 01:00Z on Jun 14 is 19:00 on Jun 13 in Mexico City (UTC-6): the header's date follows the zone.
    const lateKickoff = allFixtures().find((m) => Date.parse(m.kickoff) === Date.parse('2026-06-14T01:00:00Z'))!;
    expect(lateKickoff).toBeDefined();
    const headerLine = (text: string) =>
      text.split('\n').find((l) => l.includes(`${lateKickoff.home.name} vs ${lateKickoff.away.name}`));
    const ask = (tz: string) =>
      toolGetMarketSignal({ matchId: lateKickoff.id, tz, adapter: fakeAdapter, marketProvider: synth(), now: TEST_NOW });
    expect(headerLine((await ask('UTC')).text)).toMatch(/ \(Jun 14\)$/);
    expect(headerLine((await ask('America/Mexico_City')).text)).toMatch(/ \(Jun 13\)$/);
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
    expect(r.text).toContain(DISCLAIMER);
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

  it('CLAUDINHO_MARKETS=off drops the market data a relevant fixture would carry, in data and in text', async () => {
    // A clock before the fixture's kickoff, so the market is relevant and the switch alone decides; the case
    // above passes no clock, and every bundled fixture is past by the wall clock whatever the switch says.
    const fixture = upcoming();
    const ask = () =>
      Promise.all([
        toolGetToday({ date: upcomingDate(), tz: 'UTC', adapter: fakeAdapter, marketProvider: synth(), now: TEST_NOW }),
        toolGetMatch({ id: fixture.id, adapter: fakeAdapter, marketProvider: synth(), now: TEST_NOW }),
      ]);
    const prev = process.env.CLAUDINHO_MARKETS;
    try {
      delete process.env.CLAUDINHO_MARKETS;
      const [onToday, onMatch] = await ask();
      expect((onToday.data as { marketSignals?: Record<string, unknown> }).marketSignals?.[fixture.id]).toBeDefined();
      expect(onMatch.text).toContain('Prediction markets');
      expect((onMatch.data as { marketSignal: unknown }).marketSignal).not.toBeNull();
      process.env.CLAUDINHO_MARKETS = 'off';
      const [offToday, offMatch] = await ask();
      expect((offToday.data as { marketSignals?: unknown }).marketSignals).toBeUndefined();
      expect(offMatch.text).not.toContain('Prediction markets');
      expect(offMatch.text).not.toContain('informational only');
      expect((offMatch.data as { marketSignal: unknown }).marketSignal).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.CLAUDINHO_MARKETS;
      else process.env.CLAUDINHO_MARKETS = prev;
    }
  });

  describe('the reliability gate on get_today and get_match (the twin of the CLI annotation case)', () => {
    /** A clean signal for the match, priced at `asOf` (the request's clock unless said otherwise). */
    const signalFor = (m: Match, over: Partial<MarketSignal> = {}): MarketSignal => ({
      matchId: m.id,
      source: 'polymarket',
      asOf: TEST_NOW.toISOString(),
      fetchedAt: TEST_NOW.toISOString(),
      outcomes: [
        { kind: 'home', teamCode: m.home.code, label: m.home.name, probability: 0.56 },
        { kind: 'draw', label: 'Draw', probability: 0.25 },
        { kind: 'away', teamCode: m.away.code, label: m.away.name, probability: 0.19 },
      ],
      favorite: { kind: 'home', teamCode: m.home.code, probability: 0.56, strength: 'slight' },
      stale: false,
      ambiguous: false,
      ...over,
    });
    /** A provider that answers the upcoming fixture with what `make` builds, a definitive none otherwise (no gate of its own). */
    const fixed = (make: (m: Match) => MarketSignal): MarketProvider => ({
      name: 'fixed',
      findSignal: async (m) => make(m),
      findSignals: async (matches) => ({
        results: new Map(
          matches.map(
            (m) => [m.id, m.id === upcoming().id ? valid(make(m)) : definitiveNone('no signal for this fixture')] as const,
          ),
        ),
        complete: true,
      }),
    });
    const ask = (marketProvider: MarketProvider) =>
      Promise.all([
        toolGetToday({ date: upcomingDate(), tz: 'UTC', adapter: fakeAdapter, marketProvider, now: TEST_NOW }),
        toolGetMatch({ id: upcoming().id, adapter: fakeAdapter, marketProvider, now: TEST_NOW }),
      ]);
    const signalsOf = (data: unknown) => (data as { marketSignals?: Record<string, unknown> }).marketSignals;

    it('control: a fresh, reliable signal is shown beside its fixture', async () => {
      const fixture = upcoming();
      const [today, match] = await ask(fixed((m) => signalFor(m)));
      expect(today.text).toContain(fixture.home.name);
      expect(signalsOf(today.data)?.[fixture.id]).toBeDefined();
      expect(match.text).toContain(fixture.home.name);
      expect(match.text).toContain('56%');
      expect(match.text).toContain('informational only');
      expect((match.data as { marketSignal: unknown }).marketSignal).not.toBeNull();
    });

    it('a stale signal is not shown: flagged stale by its provider, or priced longer ago than the freshness window', async () => {
      const fixture = upcoming();
      const hourAgo = new Date(TEST_NOW.getTime() - 60 * 60_000).toISOString();
      const stale = [
        fixed((m) => signalFor(m, { stale: true })),
        fixed((m) => signalFor(m, { asOf: hourAgo, fetchedAt: hourAgo })),
      ];
      for (const provider of stale) {
        const [today, match] = await ask(provider);
        expect(today.text).toContain(fixture.home.name);
        expect(signalsOf(today.data)?.[fixture.id]).toBeUndefined();
        expect(match.text).toContain(fixture.home.name);
        expect(match.text).not.toContain('56%');
        expect(match.text).not.toContain('informational only');
        expect((match.data as { marketSignal: unknown }).marketSignal).toBeNull();
      }
    });
  });

  it('get_today still lists its fixtures when the market provider throws: no signals, the read said to be incomplete', async () => {
    const boom: MarketProvider = {
      name: 'boom',
      findSignal: async () => {
        throw new Error('down');
      },
      findSignals: async () => {
        throw new Error('down');
      },
    };
    const fixture = upcoming();
    const r = await toolGetToday({ date: upcomingDate(), tz: 'UTC', adapter: fakeAdapter, marketProvider: boom, now: TEST_NOW });
    const data = r.data as { count: number; matches: Match[]; marketComplete: boolean; marketSignals?: unknown };
    expect(data.count).toBeGreaterThan(0);
    expect(data.matches.some((m) => m.id === fixture.id)).toBe(true);
    expect(r.text).toContain(fixture.home.name);
    expect(data.marketSignals).toBeUndefined();
    expect(data.marketComplete).toBe(false);
    expect(r.text).toContain('unavailable or incomplete');
  });
});

describe('toolGetMarketSignal — a competition without markets', () => {
  // No injected provider: the tool builds one through the real factory, which
  // must hand back the network-free no-op off the default competition.
  const ORIG = process.env.CLAUDINHO_COMPETITION;
  const ORIG_SRC = process.env.CLAUDINHO_MARKETS_SOURCE;
  // Spy on the REAL provider's entry point rather than on `fetch`: the copy is
  // decided by the competition alone, so the only observable that proves the
  // tool never consulted Polymarket is that its provider was never asked.
  const consulted = vi.spyOn(PolymarketProvider.prototype, 'findSignals');
  afterEach(() => {
    consulted.mockReset();
    if (ORIG === undefined) delete process.env.CLAUDINHO_COMPETITION;
    else process.env.CLAUDINHO_COMPETITION = ORIG;
    if (ORIG_SRC === undefined) delete process.env.CLAUDINHO_MARKETS_SOURCE;
    else process.env.CLAUDINHO_MARKETS_SOURCE = ORIG_SRC;
  });

  it('says market signals cover the World Cup only, and never consults the provider', async () => {
    process.env.CLAUDINHO_COMPETITION = 'eng.1';
    // test/setup.ts routes the default source to the no-op for hermeticity; this
    // test exists to prove the REAL source is gated, so ask for it explicitly.
    process.env.CLAUDINHO_MARKETS_SOURCE = 'polymarket';
    consulted.mockImplementation(async () => {
      throw new Error('Polymarket must not be consulted on eng.1');
    });
    // The competition is the request's adapter's (0.11 2.0); the environment
    // above only mirrors what a real run's edge would have read.
    const league = { ...fakeAdapter, competition: 'eng.1' };
    const byDate = await toolGetMarketSignal({ date: upcomingDate(), adapter: league, now: TEST_NOW });
    expect(byDate.text).toContain('Market signals cover the World Cup only');
    expect((byDate.data as { complete: boolean }).complete).toBe(true);
    // A World Cup fixture id is not a fixture of eng.1: off the bundle the id
    // lookup is unsupported (audit A03), and the provider is still never asked.
    const byId = await toolGetMarketSignal({ matchId: upcoming().id, adapter: league, now: TEST_NOW });
    expect(byId.text).toContain('Not available for this competition yet.');
    expect(byId.data as { signal: unknown; complete: boolean }).toMatchObject({ signal: null, complete: true });
    expect(consulted).not.toHaveBeenCalled();
  });
});
