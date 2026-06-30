/**
 * CROSS-SURFACE COVERAGE GUARD — the structural defense against Claudinho's most
 * recurring bug class: a team-facing surface reading the resultless static
 * skeleton instead of the live overlay. The bundled knockout slots are
 * placeholders (codes like 2A/2B, flag 🏳️), so any surface that doesn't reach
 * the live overlay is SILENTLY blind to a confirmed knockout tie — no crash, no
 * wrong data, just a stale placeholder. That single bug shipped as v0.8.2
 * (seeds), v0.8.6 (third-place), and v0.8.7 (next fixture) — three hotfixes, one
 * root cause in three different surfaces.
 *
 * This test pins ONE fake resolved knockout fixture (Mexico vs Ecuador, R32) and
 * asserts EVERY team-facing CLI surface renders the real nations — never the
 * placeholder. If you add a new surface, add it here; if an existing surface
 * stops live-resolving, this fails. See `.cursor/rules/surface-parity.mdc` and
 * AGENTS.md "Knockout surfaces live-resolve".
 *
 * The statusline can't live-fetch (hot path, <150ms, cache-only), so it
 * live-resolves INDIRECTLY: the refresher caches resolved knockout fixtures and
 * the statusline reads them, failing closed to "⚽ —" (never a placeholder leak)
 * when the cache lacks the pairing. Both contracts are asserted at the bottom.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeMarketProvider, type Match, type ProviderAdapter } from '@claudinho/core';
import { cmdBracket, cmdMarkets, cmdNext, cmdShare } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';
import type { CacheState } from '../src/cache';
import { renderPrompt } from '../src/statusline';

// A confirmed R32 tie ESPN has filed over the bundled placeholder slot 760486
// (in the bundle: "Group A 2nd" vs "Group B 2nd", both 🏳️). The overlay carries
// the real nations; a surface that reads the skeleton would still show 🏳️.
const RESOLVED_R32_ID = '760486';
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

/** Adapter that serves the resolved knockout fixture on the window fetch. */
function overlayAdapter(window: Match[]): ProviderAdapter {
  return {
    name: 'espn',
    capabilities: { push: false, latencyHintSec: 0 },
    async fetchByDate() {
      return [];
    },
    async fetchLive() {
      return [];
    },
    async fetchWindow() {
      return window;
    },
  };
}

const PLACEHOLDER_FLAG = '🏳️';
// Group stage is over on R32 day, so a static lookup is blind — only the overlay
// carries the pairing.
const KNOCKOUT_NOW = new Date('2026-06-28T12:00:00Z');

function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return {
    lang: 'en',
    tz: 'UTC',
    json: false,
    color: false,
    source: 'espn',
    flavor: 'off',
    markets: false,
    ...over,
  };
}
const ctx = () => ({
  cfg: cfg(),
  t: makeT('en'),
  adapter: overlayAdapter([r32MexEcu()]),
  now: KNOCKOUT_NOW,
  marketProvider: undefined,
});

const outSpy = vi.spyOn(process.stdout, 'write');
let writes: string[] = [];
beforeEach(() => {
  writes = [];
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
});
afterEach(() => outSpy.mockReset());
const text = () => writes.join('');

describe('knockout surface coverage — every team-facing CLI surface live-resolves', () => {
  it('`next <team>` shows the resolved opponent, not the placeholder', async () => {
    await cmdNext('MEX', ctx());
    const t = text();
    expect(t).toContain('Ecuador'); // resolved from the overlay
    expect(t).not.toContain(PLACEHOLDER_FLAG);
  });

  it('`share next <team>` shows the resolved opponent, not the placeholder', async () => {
    await cmdShare('next', 'MEX', {}, ctx());
    const t = text();
    expect(t).toContain('Ecuador');
    expect(t).not.toContain(PLACEHOLDER_FLAG);
  });

  it('`bracket` renders the resolved tie in its slot', async () => {
    await cmdBracket('R32', {}, ctx());
    const t = text();
    expect(t).toContain('Mexico');
    expect(t).toContain('Ecuador');
  });

  it('`share bracket` renders the resolved tie in its slot', async () => {
    await cmdShare('bracket', 'R32', {}, ctx());
    const t = text();
    expect(t).toContain('Mexico');
    expect(t).toContain('Ecuador');
  });

  it('`markets next <team>` resolves the opponent, not the placeholder', async () => {
    // marketFixtureForTeam must live-resolve the KO tie (offline fake provider
    // keeps the market fetch off the network — we only assert nation resolution).
    await cmdMarkets('next', 'MEX', { ...ctx(), marketProvider: new FakeMarketProvider() });
    const t = text();
    expect(t).toContain('Mexico');
    expect(t).toContain('Ecuador');
    expect(t).not.toContain(PLACEHOLDER_FLAG);
  });
});

describe('statusline hot-path contract — live-resolve from cache, else fail closed', () => {
  // The statusline NEVER fetches on the hot path; it reads the cache the
  // refresher fills. When the cache carries the resolved knockout fixture it
  // shows it (real flags); when it doesn't, it fails closed to `⚽ —` — never a
  // 🏳️ placeholder leak.
  const baseCache = (over: Partial<CacheState> = {}): CacheState => ({
    updatedAt: KNOCKOUT_NOW.toISOString(),
    live: [],
    degraded: false,
    source: 'espn',
    competition: 'fifa.world',
    ...over,
  });

  it('shows the resolved tie (real flags) when the refresher cached it', () => {
    const cache = baseCache({ fixtures: [r32MexEcu()], fixturesUpdatedAt: KNOCKOUT_NOW.toISOString() });
    const line = renderPrompt(cache, { team: 'MEX', now: KNOCKOUT_NOW });
    expect(line).toContain('🇲🇽'); // resolved home
    expect(line).toContain('🇪🇨'); // resolved away
    expect(line).not.toContain(PLACEHOLDER_FLAG);
  });

  it('fails closed to "⚽ —" (no 🏳️ leak) when the cache lacks the fixture', () => {
    const line = renderPrompt(baseCache(), { team: 'MEX', now: KNOCKOUT_NOW });
    expect(line).toBe('⚽ —');
    expect(renderPrompt(baseCache(), { now: KNOCKOUT_NOW })).toBe('⚽ —'); // no-team too
  });
});
