import {
  allFixtures,
  FakeMarketProvider,
  type GroupStandings,
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

/**
 * Feed DOWN (e.g. an ESPN 403 from a sandbox) → every share path degrades.
 * Distinct from `fakeAdapter` (reachable but empty): a thrown fetch must NOT
 * paste as an authoritative "nothing's on" / scheduled card.
 */
const downAdapter: ProviderAdapter = {
  name: 'espn',
  capabilities: { push: false, latencyHintSec: 0 },
  async fetchByDate(): Promise<Match[]> {
    throw new Error('ESPN 403');
  },
  async fetchLive(): Promise<Match[]> {
    throw new Error('ESPN 403');
  },
};

/** A match adapter that also serves an authoritative Group A table. */
const standingsAdapter: ProviderAdapter = {
  ...fakeAdapter,
  async fetchStandings(): Promise<GroupStandings[]> {
    return [
      {
        group: 'A',
        rows: [
          { team: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' }, played: 1, won: 1, drawn: 0, lost: 0, goalsFor: 2, goalsAgainst: 0, goalDiff: 2, points: 3 },
          { team: { code: 'KOR', name: 'South Korea', flag: '🇰🇷' }, played: 1, won: 1, drawn: 0, lost: 0, goalsFor: 2, goalsAgainst: 1, goalDiff: 1, points: 3 },
        ],
      },
    ];
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

describe('toolGetShareSnippet — group standings table', () => {
  it('renders a standings card from the authoritative table', async () => {
    const r = await toolGetShareSnippet({ group: 'a', adapter: standingsAdapter, marketProvider: synth() });
    const data = r.data as {
      kind: string;
      group: string;
      degraded: boolean;
      source: string | null;
      tables: Array<{ group: string; standings: unknown[] }>;
    };
    expect(data.kind).toBe('table');
    expect(data.group).toBe('A');
    expect(data.degraded).toBe(false);
    expect(data.source).toBe('fake');
    expect(data.tables[0]?.standings).toHaveLength(2);
    // text IS the pasteable snippet, self-contained.
    expect(r.text).toContain('Group A · standings');
    expect(r.text).toContain('1. 🇲🇽 MEX');
    expect(r.text).toContain(DISCLAIMER);
    expect(r.text).toContain('Try it: npx @claudinho/cli table A');
    // Standings are facts only — never a market line.
    expect(r.text).not.toContain('informational only');
    expect(r.text).not.toMatch(BANNED);
  });

  it('fails closed to a degraded roster (no fetchStandings) with a not-live notice', async () => {
    const r = await toolGetShareSnippet({ group: 'A', adapter: fakeAdapter, marketProvider: synth() });
    const data = r.data as { degraded: boolean; source: string | null };
    expect(data.degraded).toBe(true);
    expect(data.source).toBeNull(); // degraded ⇒ no provider attribution
    expect(r.text).toContain('Group A · standings');
    expect(r.text).not.toContain('Live data:');
    expect(r.text).toContain('Live standings unavailable — group roster, not live results.');
    expect(r.text).toContain(DISCLAIMER);
  });

  it('renders an empty-state card for an unknown group', async () => {
    const r = await toolGetShareSnippet({ group: 'Z', adapter: standingsAdapter, marketProvider: synth() });
    expect(r.text).toContain('No group Z.');
    expect(r.text).toContain(DISCLAIMER);
  });
});

describe('toolGetShareSnippet — degraded honesty (feed down)', () => {
  // The bug the 3rd-party review caught: live/match/date dropped `degraded`, so a
  // feed outage pasted as an authoritative empty/scheduled card. Each path must
  // now flag degraded, drop attribution, and say the data is not live.
  it('live: says the feed is down — NOT "no matches in play"', async () => {
    const r = await toolGetShareSnippet({ live: true, adapter: downAdapter, marketProvider: synth() });
    const data = r.data as { degraded: boolean; source: string | null };
    expect(data.degraded).toBe(true);
    expect(data.source).toBeNull();
    expect(r.text).toContain('Live scores unavailable');
    expect(r.text).not.toContain('No matches in play');
    expect(r.text).not.toContain('Live data:'); // no attribution when degraded
    expect(r.text).toContain(DISCLAIMER);
  });

  it('match: marks a static fixture as not-live when the feed is down', async () => {
    const id = allFixtures()[0]!.id;
    const r = await toolGetShareSnippet({ matchId: id, adapter: downAdapter, marketProvider: synth() });
    const data = r.data as { degraded: boolean; source: string | null };
    expect(data.degraded).toBe(true);
    expect(data.source).toBeNull();
    expect(r.text).toContain('Live data unavailable — showing the bundled schedule, not live scores.');
    expect(r.text).not.toContain('Live data:');
    expect(r.text).toContain(DISCLAIMER);
  });

  it('date: marks static fixtures as not-live when the feed is down', async () => {
    const r = await toolGetShareSnippet({
      date: '2026-06-13',
      tz: 'UTC',
      adapter: downAdapter,
      marketProvider: synth(),
      now: TEST_NOW,
    });
    const data = r.data as { degraded: boolean; source: string | null };
    expect(data.degraded).toBe(true);
    expect(data.source).toBeNull();
    expect(r.text).toContain('Live data unavailable — showing the bundled schedule, not live scores.');
    expect(r.text).not.toContain('Live data:');
    expect(r.text).toContain(DISCLAIMER);
  });
});
