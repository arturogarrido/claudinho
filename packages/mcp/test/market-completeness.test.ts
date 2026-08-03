/**
 * "There are none" and "we could not check" are different answers.
 *
 * `BatchResolution` carries `complete`, and every surface was collapsing it to
 * `resolvedValues` immediately — so a provider outage or an expired enrichment
 * deadline rendered as the confident "No reliable market signals", which is the
 * confidently-wrong output this project refuses everywhere else. The batch knew;
 * the caller threw the knowledge away.
 */
import {
  allFixtures,
  type Match,
  type MarketProvider,
  type MarketSignal,
  type ProviderAdapter,
  valid,
} from '@claudinho/core';
import { describe, expect, it } from 'vitest';
import {
  cachedMarketSignals,
  toolGetMarketSignal,
  toolGetMatch,
  toolGetShareSnippet,
  toolGetToday,
} from '../src/tools';

const NOW = new Date('2026-06-11T15:00:00Z');
const provider = (complete: boolean): MarketProvider =>
  ({
    name: complete ? 'empty' : 'dead',
    findSignal: async () => undefined,
    findSignals: async () => ({ results: new Map(), complete }),
  }) as unknown as MarketProvider;

const adapter: ProviderAdapter = {
  name: 'fake',
  capabilities: { push: false, latencyHintSec: 0 },
  fetchByDate: async () => [],
  fetchLive: async () => [],
};

const upcoming = (): Match =>
  allFixtures().find(
    (match) => match.status === 'SCHEDULED' && Date.parse(match.kickoff) > NOW.getTime(),
  )!;

const date = () => upcoming().kickoff.slice(0, 10);

describe('an incomplete market read does not render as an empty one', () => {
  it('says the data was unavailable when the batch did not finish', async () => {
    const r = await toolGetMarketSignal({
      date: '2026-06-11', marketProvider: provider(false), now: NOW,
    } as never);
    expect(r.text).toContain('unavailable or incomplete');
    expect(r.text).not.toContain('No reliable market signals');
    expect((r.data as { complete: boolean }).complete).toBe(false);
  });

  it('says there are none when the batch DID finish and found none', async () => {
    const r = await toolGetMarketSignal({
      date: '2026-06-11', marketProvider: provider(true), now: NOW,
    } as never);
    expect(r.text).toContain('No reliable market signals');
    expect((r.data as { complete: boolean }).complete).toBe(true);
  });

  it('propagates completeness through get_today default-on enrichment', async () => {
    const incomplete = await toolGetToday({
      date: date(),
      tz: 'UTC',
      adapter,
      marketProvider: provider(false),
      now: NOW,
    });
    expect(incomplete.text).toContain('unavailable or incomplete');
    expect(incomplete.data).toMatchObject({ marketComplete: false });
    expect(incomplete.data).not.toHaveProperty('marketSignals');

    const complete = await toolGetToday({
      date: date(),
      tz: 'UTC',
      adapter,
      marketProvider: provider(true),
      now: NOW,
    });
    expect(complete.text).not.toContain('unavailable or incomplete');
    expect(complete.data).toMatchObject({ marketComplete: true });
  });

  it('propagates completeness through get_match default-on enrichment', async () => {
    const r = await toolGetMatch({
      id: upcoming().id,
      adapter,
      marketProvider: provider(false),
      now: NOW,
    });
    expect(r.text).toContain('unavailable or incomplete');
    expect(r.data).toMatchObject({ marketComplete: false, marketSignal: null });
  });

  it('propagates completeness into share data and the pasteable card', async () => {
    const r = await toolGetShareSnippet({
      date: date(),
      adapter,
      marketProvider: provider(false),
      now: NOW,
    });
    expect(r.text).toContain('Market data unavailable or incomplete');
    expect(r.data).toMatchObject({ marketComplete: false, marketSignals: {} });
  });

  it('does not call an incomplete dedicated match read "no signal"', async () => {
    const r = await toolGetMarketSignal({
      matchId: upcoming().id,
      adapter,
      marketProvider: provider(false),
      now: NOW,
    });
    expect(r.text).toContain('unavailable or incomplete');
    expect(r.text).not.toContain('No reliable market signal');
    expect(r.data).toMatchObject({ complete: false, signal: null });
  });
});

describe('cachedMarketSignals completeness through the production memory cache', () => {
  it('keeps a cached hit while propagating an incomplete miss', async () => {
    const hit: Match = {
      ...upcoming(),
      id: '997201',
      home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
      away: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' },
    };
    const miss: Match = {
      ...upcoming(),
      id: '997202',
      home: { code: 'BRA', name: 'Brazil', flag: '🇧🇷' },
      away: { code: 'MAR', name: 'Morocco', flag: '🇲🇦' },
    };
    const stamp = new Date().toISOString();
    const signal: MarketSignal = {
      matchId: hit.id,
      source: 'polymarket',
      sourceMarketId: `market-${hit.id}`,
      asOf: stamp,
      fetchedAt: stamp,
      outcomes: [
        { kind: 'home', teamCode: 'MEX', label: 'Mexico', probability: 0.56 },
        { kind: 'draw', label: 'Draw', probability: 0.25 },
        { kind: 'away', teamCode: 'RSA', label: 'South Africa', probability: 0.19 },
      ],
      favorite: { kind: 'home', teamCode: 'MEX', probability: 0.56, strength: 'slight' },
      stale: false,
      ambiguous: false,
    };
    const oldSource = process.env.CLAUDINHO_MARKETS_SOURCE;
    const oldCompetition = process.env.CLAUDINHO_COMPETITION;
    process.env.CLAUDINHO_MARKETS_SOURCE = 'polymarket';
    process.env.CLAUDINHO_COMPETITION = `mixed-cache-${Date.now()}`;

    try {
      const complete: MarketProvider = {
        name: 'seed',
        async findSignal() {
          return signal;
        },
        async findSignals(matches) {
          return {
            results: new Map(matches.map((m) => [m.id, valid(signal)])),
            complete: true,
          };
        },
      };
      const seeded = await cachedMarketSignals({}, [hit], () => complete);
      expect(seeded).toMatchObject({ complete: true });
      expect(seeded.signals.get(hit.id)).toBe(signal);

      let fetchedIds: string[] = [];
      const partial: MarketProvider = {
        name: 'partial',
        async findSignal() {
          return undefined;
        },
        async findSignals(matches) {
          fetchedIds = matches.map((m) => m.id);
          return { results: new Map(), complete: false };
        },
      };
      const mixed = await cachedMarketSignals({}, [hit, miss], () => partial);

      expect(fetchedIds).toEqual([miss.id]);
      expect(mixed.signals.get(hit.id)).toBe(signal);
      expect(mixed.signals.has(miss.id)).toBe(false);
      expect(mixed.complete).toBe(false);
    } finally {
      if (oldSource === undefined) delete process.env.CLAUDINHO_MARKETS_SOURCE;
      else process.env.CLAUDINHO_MARKETS_SOURCE = oldSource;
      if (oldCompetition === undefined) delete process.env.CLAUDINHO_COMPETITION;
      else process.env.CLAUDINHO_COMPETITION = oldCompetition;
    }
  });
});
