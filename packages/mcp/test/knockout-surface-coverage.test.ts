/**
 * CROSS-SURFACE COVERAGE GUARD (MCP) — twin of
 * packages/cli/test/knockout-surface-coverage.test.ts. See that file's header for
 * the full rationale: the recurring bug is a team-facing surface reading the
 * resultless static skeleton (knockout slots are 🏳️ placeholders) instead of the
 * live overlay. This pins ONE fake resolved knockout fixture (Mexico vs Ecuador,
 * R32) and asserts EVERY team-facing MCP tool renders the real nations.
 *
 * If you add a team-facing MCP tool, add it here. See
 * `.cursor/rules/surface-parity.mdc` and AGENTS.md "Knockout surfaces live-resolve".
 */
import { describe, expect, it } from 'vitest';
import { FakeMarketProvider, type Match, type ProviderAdapter } from '@claudinho/core';
import {
  toolGetBracket,
  toolGetMarketSignal,
  toolGetNextFixture,
  toolGetShareSnippet,
} from '../src/tools';

const RESOLVED_R32_ID = '760486'; // bundle: "Group A 2nd" vs "Group B 2nd" (both 🏳️)
function r32MexEcu(): Match {
  return {
    id: RESOLVED_R32_ID,
    stage: 'R32',
    kickoff: '2026-06-30T18:00Z',
    venue: 'SoFi Stadium',
    home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
    away: { code: 'ECU', name: 'Ecuador', flag: '🇪🇨' },
    status: 'SCHEDULED',
    updatedAt: '2026-06-28T00:00Z',
  };
}

const overlayAdapter: ProviderAdapter = {
  name: 'espn',
  capabilities: { push: false, latencyHintSec: 0 },
  async fetchByDate() {
    return [];
  },
  async fetchLive() {
    return [];
  },
  async fetchWindow() {
    return [r32MexEcu()];
  },
};

const PLACEHOLDER_FLAG = '🏳️';
const KNOCKOUT_NOW = new Date('2026-06-28T12:00:00Z'); // group stage done

describe('knockout surface coverage — every team-facing MCP tool live-resolves', () => {
  it('get_next_fixture shows the resolved opponent, not the placeholder', async () => {
    const r = await toolGetNextFixture({ team: 'MEX', now: KNOCKOUT_NOW, adapter: overlayAdapter });
    expect(r.text).toContain('Ecuador');
    expect(r.text).not.toContain(PLACEHOLDER_FLAG);
    expect((r.data as { fixture: Match | null }).fixture?.away.code).toBe('ECU');
  });

  it('get_share_snippet { team } shows the resolved opponent', async () => {
    const r = await toolGetShareSnippet({ team: 'MEX', now: KNOCKOUT_NOW, adapter: overlayAdapter });
    expect(r.text).toContain('Ecuador');
    expect(r.text).not.toContain(PLACEHOLDER_FLAG);
  });

  it('get_bracket renders the resolved tie in its slot', async () => {
    const r = await toolGetBracket({ stage: 'R32', now: KNOCKOUT_NOW, adapter: overlayAdapter });
    expect(r.text).toContain('Mexico');
    expect(r.text).toContain('Ecuador');
  });

  it('get_share_snippet { bracket } renders the resolved tie in its slot', async () => {
    const r = await toolGetShareSnippet({
      bracket: true,
      knockoutStage: 'R32',
      now: KNOCKOUT_NOW,
      adapter: overlayAdapter,
    });
    expect(r.text).toContain('Mexico');
    expect(r.text).toContain('Ecuador');
  });

  it('get_market_signal { team } resolves the opponent, not the placeholder', async () => {
    // marketFixtureForTeam must live-resolve the KO tie (offline fake provider
    // keeps the market fetch off the network — we only assert nation resolution).
    const r = await toolGetMarketSignal({
      team: 'MEX',
      now: KNOCKOUT_NOW,
      adapter: overlayAdapter,
      marketProvider: new FakeMarketProvider(),
    });
    expect(r.text).toContain('Mexico');
    expect(r.text).toContain('Ecuador');
    expect(r.text).not.toContain(PLACEHOLDER_FLAG);
    expect((r.data as { matchId: string | null }).matchId).toBe(RESOLVED_R32_ID);
  });
});
