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
 * The statusline is the one surface that CANNOT live-fetch (hot path, <150ms,
 * cache-only) — its contract is the opposite: it must FAIL CLOSED (never leak a
 * placeholder/wrong team) until the refresher caches resolved knockout fixtures
 * (tracked follow-up). That contract is asserted at the bottom.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Match, ProviderAdapter } from '@claudinho/core';
import { cmdBracket, cmdNext, cmdShare } from '../src/commands';
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
});

describe('statusline hot-path contract — fail closed, never leak a placeholder', () => {
  // The statusline reads a cache (live matches only) and NEVER fetches on the
  // hot path. Today it has no resolved knockout fixture to show, so for a team
  // between its group finish and its knockout game it must fail closed (no
  // placeholder team, no wrong opponent) — currently `⚽ —`.
  it('does not leak a 🏳️ placeholder or a wrong opponent for a knockout-bound team', () => {
    const cache: CacheState = {
      updatedAt: KNOCKOUT_NOW.toISOString(),
      live: [],
      degraded: false,
      source: 'espn',
      competition: 'fifa.world',
    };
    const line = renderPrompt(cache, { team: 'MEX', now: KNOCKOUT_NOW });
    expect(line).not.toContain(PLACEHOLDER_FLAG);
    expect(line).not.toContain('Ecuador'); // cache can't carry it yet — must not invent it
    // TODO(statusline-knockout-cache): once the refresher caches resolved
    // knockout fixtures, upgrade this to assert the line SHOWS "Ecuador".
  });
});
