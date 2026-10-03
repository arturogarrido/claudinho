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
 * Club-surface coverage, MCP half (audit A03, CONTAINED): off the bundle no
 * tool reads the World Cup skeleton. Since 0.11 (2.1c) `get_next_fixture` and
 * `get_match` read the competition's own schedule ahead, and `get_bracket`
 * says a league season has none (`inapplicable`, top level and inside `view`);
 * the market tool still says "not available for this competition yet" (see
 * verdict-parity.test.ts, which owns that contract). Mirrors
 * knockout-surface-coverage.test.ts.
 *
 * The adapter below states nothing about its answers (no metadata) and has no
 * standings: every read of it is "not whole", which is what it is answered as.
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
  competition: 'eng.1',
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

  it('get_next_fixture and get_match read this competition, never the World Cup; get_market_signal is not available here', async () => {
    const next = await toolGetNextFixture({ team: 'ARS', adapter, now: NOW });
    expect(next.text).toContain('roster could not be read whole');
    expect(next.text).not.toContain(NOTICE);
    expect(next.data).toMatchObject({ fixture: null, degraded: false, rosterIncomplete: true });
    const match = await toolGetMatch({ id: '760415', adapter, now: NOW });
    expect(match.text).toContain('may be incomplete');
    expect(match.text).not.toContain(NOTICE);
    expect(match.text).not.toMatch(WC);
    expect(() => z.object(OUTPUT_SCHEMAS.get_match).strict().parse(match.data)).not.toThrow();
    const market = await toolGetMarketSignal({ team: 'ARS', adapter, marketProvider: new FakeMarketProvider(), now: NOW });
    expect(market.text).toContain(NOTICE);
  });

  it('get_bracket says a league season has none, in text and in the view; the schema still accepts it', async () => {
    const r = await toolGetBracket({ adapter });
    expect(r.text).toContain('This competition has no bracket.');
    expect(r.text).not.toMatch(WC);
    const data = r.data as { view: { stages: unknown[]; inapplicable?: boolean }; source: string | null; inapplicable?: boolean };
    expect(data.view.stages).toEqual([]);
    expect(data.view.inapplicable).toBe(true);
    expect(data.inapplicable).toBe(true);
    expect(data.source).toBeNull();
    expect(() => z.object(OUTPUT_SCHEMAS.get_bracket).strict().parse(r.data)).not.toThrow();
  });

  it('get_share_snippet for next, bracket and a World Cup id never pastes the skeleton', async () => {
    const said = [
      [{ team: 'ARS' }, 'roster could not be read whole'],
      [{ bracket: true }, 'This competition has no bracket.'],
      [{ matchId: '760415' }, 'may be incomplete'],
    ] as const;
    for (const [args, sentence] of said) {
      const r = await toolGetShareSnippet({ ...args, adapter, marketProvider: new FakeMarketProvider(), now: NOW });
      expect(r.text, JSON.stringify(args)).toContain(sentence);
      expect(r.text, JSON.stringify(args)).not.toContain(NOTICE);
      expect(r.text, JSON.stringify(args)).not.toMatch(WC);
    }
  });
});
