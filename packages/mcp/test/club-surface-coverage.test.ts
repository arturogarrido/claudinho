import type { Match, ProviderAdapter } from '@claudinho/core';
import { FakeMarketProvider } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod/v3';
import { OUTPUT_SCHEMAS } from '../src/server';
import {
  toolGetBracket,
  toolGetMarketSignal,
  toolGetMatch,
  toolGetNextFixture,
  toolGetShareSnippet,
  toolGetToday,
} from '../src/tools';

/**
 * Club-surface coverage, MCP half (audit A03, CONTAINED): off the bundle every
 * tool built on the World Cup skeleton says "not available for this
 * competition yet" in text, and the bracket's structured view carries the
 * marker (inside the passthrough `view`, so the advertised schemas are
 * unchanged). Mirrors knockout-surface-coverage.test.ts.
 */
const NOW = new Date('2026-09-16T12:00:00Z');
const NOTICE = 'Not available for this competition yet.';
const pl: Match = {
  id: '800000001',
  stage: 'FRIENDLY',
  kickoff: '2026-09-16T14:00:00.000Z',
  venue: 'Vitality Stadium',
  home: { code: 'BOU', name: 'Bournemouth', flag: '🏳️' },
  away: { code: 'BRE', name: 'Brentford', flag: '🏳️' },
  status: 'SCHEDULED',
  updatedAt: NOW.toISOString(),
};
const adapter: ProviderAdapter = {
  name: 'espn',
  capabilities: { push: false, latencyHintSec: 0 },
  async fetchByDate() {
    return [pl];
  },
  async fetchLive() {
    return [];
  },
  async fetchWindow() {
    return [pl];
  },
};
const WC = /Mexico|South Africa|Round of 32/;
const ORIG = process.env.CLAUDINHO_COMPETITION;
beforeEach(() => {
  process.env.CLAUDINHO_COMPETITION = 'eng.1';
});
afterEach(() => {
  if (ORIG === undefined) delete process.env.CLAUDINHO_COMPETITION;
  else process.env.CLAUDINHO_COMPETITION = ORIG;
});

describe('club surface coverage (MCP) — no World Cup leakage off the bundle', () => {
  it('get_today on a World Cup date shows no World Cup fixture', async () => {
    const r = await toolGetToday({ date: '2026-06-11', adapter, now: NOW });
    expect(r.text).not.toMatch(WC);
  });

  it('get_next_fixture, get_match and get_market_signal say the feature is not available here', async () => {
    const next = await toolGetNextFixture({ team: 'ARS', adapter, now: NOW });
    expect(next.text).toContain(NOTICE);
    expect(next.data).toMatchObject({ fixture: null, degraded: false });
    const match = await toolGetMatch({ id: '760415', adapter, now: NOW });
    expect(match.text).toContain(NOTICE);
    expect(match.text).not.toMatch(WC);
    const market = await toolGetMarketSignal({ team: 'ARS', adapter, marketProvider: new FakeMarketProvider(), now: NOW });
    expect(market.text).toContain(NOTICE);
  });

  it('get_bracket carries the notice in text and the marker in the view; the schema still accepts it', async () => {
    const r = await toolGetBracket({ adapter });
    expect(r.text).toContain(NOTICE);
    expect(r.text).not.toMatch(WC);
    const data = r.data as { view: { stages: unknown[]; unsupported?: boolean }; source: string | null };
    expect(data.view.stages).toEqual([]);
    expect(data.view.unsupported).toBe(true);
    expect(data.source).toBeNull();
    expect(() => z.object(OUTPUT_SCHEMAS.get_bracket).strict().parse(r.data)).not.toThrow();
  });

  it('get_share_snippet for next, bracket and a World Cup id carries the notice, never the skeleton', async () => {
    for (const args of [{ team: 'ARS' }, { bracket: true }, { matchId: '760415' }]) {
      const r = await toolGetShareSnippet({ ...args, adapter, marketProvider: new FakeMarketProvider(), now: NOW });
      expect(r.text).toContain(NOTICE);
      expect(r.text).not.toMatch(WC);
    }
  });
});
