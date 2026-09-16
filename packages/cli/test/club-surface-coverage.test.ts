import type { Match, ProviderAdapter } from '@claudinho/core';
import { FakeMarketProvider } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CacheState } from '../src/cache';
import { cmdBracket, cmdMarkets, cmdMatch, cmdNext, cmdShare, cmdToday } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';
import { renderPrompt } from '../src/statusline';

/**
 * Club-surface coverage, first version (audit A03, CONTAINED): under a
 * competition other than the bundled World Cup, NO surface may leak the
 * World Cup skeleton, and the paths built on it say "not available for this
 * competition yet" instead of "no fixture" / a World Cup bracket. Mirrors
 * knockout-surface-coverage.test.ts. 0.11 (2.2) grows this into the full club
 * rendering test (no 🏳️, no nation rename, no "Friendly").
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
function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return { lang: 'en', tz: 'UTC', json: false, color: false, source: 'espn', flavor: 'off', markets: false, ...over };
}
const ctx = (over: Partial<CliConfig> = {}) => ({
  cfg: cfg(over),
  t: makeT('en'),
  adapter,
  now: NOW,
  marketProvider: new FakeMarketProvider(),
});

const ORIG = process.env.CLAUDINHO_COMPETITION;
const outSpy = vi.spyOn(process.stdout, 'write');
let writes: string[] = [];
beforeEach(() => {
  process.env.CLAUDINHO_COMPETITION = 'eng.1';
  writes = [];
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
});
afterEach(() => {
  outSpy.mockReset();
  if (ORIG === undefined) delete process.env.CLAUDINHO_COMPETITION;
  else process.env.CLAUDINHO_COMPETITION = ORIG;
});
const text = () => writes.join('');
const WC = /Mexico|South Africa|Round of 32/;

describe('club surface coverage — no World Cup leakage off the bundle', () => {
  it('`today` shows the provider\'s fixture and none of the bundle', async () => {
    await cmdToday('2026-09-16', ctx());
    expect(text()).toContain('Bournemouth');
    expect(text()).not.toMatch(WC);
  });

  it('`today <World Cup date>` shows no World Cup fixture', async () => {
    await cmdToday('2026-06-11', ctx());
    expect(text()).not.toMatch(WC);
  });

  it('`next` says the feature is not available here, not "no fixture"', async () => {
    await cmdNext('ARS', ctx());
    expect(text()).toContain(NOTICE);
    expect(text()).not.toContain('No upcoming fixture');
    expect(text()).not.toMatch(WC);
  });

  it('`next --json` carries the marker', async () => {
    await cmdNext('ARS', ctx({ json: true }));
    expect(JSON.parse(text())).toMatchObject({ fixture: null, degraded: false, unsupported: true });
  });

  it('`bracket` shows the notice and no World Cup topology', async () => {
    await cmdBracket(undefined, {}, ctx());
    expect(text()).toContain(NOTICE);
    expect(text()).not.toMatch(WC);
  });

  it('`match <World Cup id>` says the feature is not available here', async () => {
    await cmdMatch('760415', ctx());
    expect(text()).toContain(NOTICE);
    expect(text()).not.toMatch(WC);
  });

  it('`markets next` says the feature is not available here', async () => {
    await cmdMarkets('next', 'ARS', ctx());
    expect(text()).toContain(NOTICE);
    expect(text()).not.toMatch(WC);
  });

  it('`share next`, `share bracket` and `share <World Cup id>` carry the notice, never the skeleton', async () => {
    for (const args of [['next', 'ARS'], ['bracket', undefined], ['760415', undefined]] as const) {
      writes = [];
      await cmdShare(args[0], args[1], {}, ctx());
      expect(text()).toContain(NOTICE);
      expect(text()).not.toMatch(WC);
    }
  });
});

describe('statusline off the bundle', () => {
  it('never counts down to a bundled World Cup fixture', () => {
    // A June 2026 clock, when the bundle had upcoming group games: with no
    // cached fixtures the hot path must fail closed, not read the skeleton.
    const cache: CacheState = {
      updatedAt: '2026-06-10T12:00:00.000Z',
      live: [],
      degraded: false,
      source: 'espn',
      competition: 'eng.1',
    };
    const line = renderPrompt(cache, { defaultCompetition: false, now: new Date('2026-06-10T12:00:00Z') });
    expect(line).toBe('⚽ —');
    expect(renderPrompt(cache, { defaultCompetition: false, team: 'MEX', now: new Date('2026-06-10T12:00:00Z') })).toBe('⚽ —');
  });
});
