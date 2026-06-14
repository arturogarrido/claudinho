import {
  allFixtures,
  FakeMarketProvider,
  type Match,
  type MarketProvider,
  type ProviderAdapter,
} from '@claudinho/core';
import { describe, expect, it } from 'vitest';
import { toolGetShareSnippet } from '../src/tools';

/** Offline match adapter → the date/live branches use the bundled static schedule. */
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

// A fixed in-tournament clock. It pins BOTH the synth provider's freshness AND the
// tool's market-relevance gate (which is "now"-relative): without passing this `now`
// to the tool, a date snippet's market block silently drops once these fixtures fall
// into the real past — which is exactly how this suite rotted on 2026-06-13.
const TEST_NOW = new Date('2026-06-13T12:00:00Z');
const synth = () => new FakeMarketProvider({ synthesize: true, now: TEST_NOW });

const HASHTAG = '#VibingLaVidaLoca';
const DISCLAIMER = 'not affiliated with FIFA or Anthropic';
const BANNED = /\b(bet|betting|wager|gambling|value pick|edge|lock)\b/i;

type ShareData = {
  kind: string;
  team?: string;
  source: string | null;
  informationalOnly: boolean;
  style: string;
  snippet: string;
  matches: Match[];
  marketSignals: Record<string, { market: { url: null } }>;
};

describe('toolGetShareSnippet', () => {
  it('a date snippet carries the card, hashtag, disclaimer, and link-free market data', async () => {
    const r = await toolGetShareSnippet({
      date: '2026-06-13',
      tz: 'UTC',
      adapter: fakeAdapter,
      marketProvider: synth(),
      now: TEST_NOW,
    });
    const data = r.data as ShareData;
    expect(data.kind).toBe('today');
    expect(data.style).toBe('social');
    expect(data.matches.length).toBeGreaterThan(0);
    expect(typeof data.snippet).toBe('string');
    // text IS the pasteable snippet (self-contained).
    expect(r.text).toBe(data.snippet);
    expect(r.text).toContain(HASHTAG);
    expect(r.text).toContain(DISCLAIMER);
    expect(r.text).toContain('informational only');
    expect(r.text).not.toMatch(BANNED);
    // Market data is link-free (url always null).
    const sigs = Object.values(data.marketSignals);
    expect(sigs.length).toBeGreaterThan(0);
    expect(sigs.every((s) => s.market.url === null)).toBe(true);
  });

  it("resolves a team's next fixture", async () => {
    const team = allFixtures()[0]!.home.code;
    const r = await toolGetShareSnippet({ team, marketProvider: synth(), adapter: fakeAdapter });
    const data = r.data as ShareData;
    expect(data.kind).toBe('next');
    expect(data.team).toBe(team);
    expect(data.informationalOnly).toBe(true);
    expect(r.text).toContain(`Next up for`);
    expect(r.text).toContain(HASHTAG);
    expect(r.text).toContain(DISCLAIMER);
    expect(r.text).toContain(`Try it: npx @claudinho/cli next ${team}`);
  });

  it('renders a clear empty state for an unknown team (not a void card)', async () => {
    const r = await toolGetShareSnippet({ team: 'ZZZ', adapter: fakeAdapter, marketProvider: synth() });
    expect(r.text).toContain('No upcoming fixture found for ZZZ.');
    expect(r.text).toContain(DISCLAIMER);
  });

  it('resolves a single match by id', async () => {
    const id = allFixtures()[0]!.id;
    const r = await toolGetShareSnippet({ matchId: id, marketProvider: synth(), adapter: fakeAdapter });
    const data = r.data as ShareData;
    expect(data.kind).toBe('match');
    expect(data.matches[0]?.id).toBe(id);
    expect(r.text).toContain(DISCLAIMER);
  });

  it('live snippets carry no market data', async () => {
    const r = await toolGetShareSnippet({ live: true, marketProvider: synth(), adapter: fakeAdapter });
    const data = r.data as ShareData;
    expect(data.kind).toBe('live');
    expect(Object.keys(data.marketSignals)).toHaveLength(0);
    expect(r.text).toContain('Live match pulse');
    expect(r.text).toContain(DISCLAIMER);
  });

  it('compact style and toggles are honored', async () => {
    const r = await toolGetShareSnippet({
      date: '2026-06-13',
      tz: 'UTC',
      style: 'compact',
      includeHashtag: false,
      adapter: fakeAdapter,
      marketProvider: synth(),
    });
    const data = r.data as ShareData;
    expect(data.style).toBe('compact');
    expect(r.text).not.toContain(HASHTAG);
    expect(r.text).toContain(DISCLAIMER); // disclaimer is non-optional
    expect(r.text).toMatch(/[A-Z]{3} vs [A-Z]{3}/);
  });

  it('omits market lines when CLAUDINHO_MARKETS=off', async () => {
    const prev = process.env.CLAUDINHO_MARKETS;
    process.env.CLAUDINHO_MARKETS = 'off';
    try {
      const r = await toolGetShareSnippet({
        date: '2026-06-13',
        tz: 'UTC',
        adapter: fakeAdapter,
        marketProvider: synth(),
      });
      expect(r.text).not.toContain('informational only');
      expect(Object.keys((r.data as ShareData).marketSignals)).toHaveLength(0);
    } finally {
      if (prev === undefined) delete process.env.CLAUDINHO_MARKETS;
      else process.env.CLAUDINHO_MARKETS = prev;
    }
  });

  it('includeMarkets:false skips the provider entirely and emits no market data', async () => {
    let called = false;
    const tripwire: MarketProvider = {
      name: 'tripwire',
      findSignal: async () => {
        called = true;
        throw new Error('should not be called');
      },
      findSignals: async () => {
        called = true;
        throw new Error('should not be called');
      },
    };
    const r = await toolGetShareSnippet({
      date: '2026-06-13',
      tz: 'UTC',
      includeMarkets: false,
      adapter: fakeAdapter,
      marketProvider: tripwire,
    });
    expect(called).toBe(false); // no fetch
    expect(Object.keys((r.data as ShareData).marketSignals)).toHaveLength(0);
    expect(r.text).not.toContain('informational only');
  });

  it('still renders a snippet when the market provider throws', async () => {
    const boom: MarketProvider = {
      name: 'boom',
      findSignal: async () => {
        throw new Error('down');
      },
      findSignals: async () => {
        throw new Error('down');
      },
    };
    const r = await toolGetShareSnippet({
      date: '2026-06-13',
      tz: 'UTC',
      adapter: fakeAdapter,
      marketProvider: boom,
    });
    expect(r.text).toContain(HASHTAG); // degraded gracefully — card still renders
    expect(Object.keys((r.data as ShareData).marketSignals)).toHaveLength(0);
  });
});
