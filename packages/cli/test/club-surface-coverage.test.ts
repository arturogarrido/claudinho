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
 * World Cup skeleton. Since 0.11 (2.1c) `next` and `match <id>` read the
 * competition's own schedule ahead and `bracket` says a league season has none;
 * the market sidecar still says "not available for this competition yet".
 * Mirrors knockout-surface-coverage.test.ts. 0.11 (2.2) grows this into the
 * full club rendering test (no 🏳️, no nation rename, no "Friendly").
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
function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return { lang: 'en', tz: 'UTC', json: false, color: false, source: 'espn', competition: 'eng.1', flavor: 'off', markets: false, ...over };
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

  it('`next` reads this competition, never the World Cup: a club it cannot identify is "couldn\'t reach", not "no fixture"', async () => {
    await cmdNext('ARS', ctx());
    expect(text()).toContain("couldn't reach the data provider");
    expect(text()).not.toContain(NOTICE);
    expect(text()).not.toContain('No upcoming fixture');
    expect(text()).not.toMatch(WC);
  });

  it('`next --json` says it is degraded, with no verdict', async () => {
    await cmdNext('ARS', ctx({ json: true }));
    const data = JSON.parse(text());
    expect(data).toMatchObject({ fixture: null, degraded: true, source: null });
    expect('unsupported' in data).toBe(false);
  });

  it('`bracket` says a league season has none, and shows no World Cup topology', async () => {
    await cmdBracket(undefined, {}, ctx());
    expect(text()).toContain('This competition has no bracket.');
    expect(text()).not.toMatch(WC);
  });

  it('`match <World Cup id>` is never the World Cup opener: the read was not whole, and says so', async () => {
    await cmdMatch('760415', ctx());
    expect(text()).toContain('may be incomplete');
    expect(text()).not.toContain(NOTICE);
    expect(text()).not.toMatch(WC);
  });

  it('`markets next` says the feature is not available here', async () => {
    await cmdMarkets('next', 'ARS', ctx());
    expect(text()).toContain(NOTICE);
    expect(text()).not.toMatch(WC);
  });

  it('`share next`, `share bracket` and `share <World Cup id>` never paste the skeleton', async () => {
    const said = [
      [['next', 'ARS'], "Couldn't reach the data provider"],
      [['bracket', undefined], 'This competition has no bracket.'],
      [['760415', undefined], 'may be incomplete'],
    ] as const;
    for (const [args, sentence] of said) {
      writes = [];
      await cmdShare(args[0], args[1], {}, ctx());
      expect(text(), args[0]).toContain(sentence);
      expect(text(), args[0]).not.toContain(NOTICE);
      expect(text(), args[0]).not.toMatch(WC);
    }
  });

  it('`markets next --json` and `markets <World Cup id> --json` carry the marker', async () => {
    // Review P2 on #129: the text branches said "not available" while the JSON
    // branches emitted `complete:true, signal:null` — indistinguishable from a
    // successful empty result. Both selectors, since each has its own branch.
    for (const args of [['next', 'ARS'], ['760415', undefined]] as const) {
      writes = [];
      await cmdMarkets(args[0], args[1], ctx({ json: true }));
      expect(JSON.parse(text())).toMatchObject({ complete: true, signal: null, unsupported: true });
    }
  });

  it('`share next --json`, `share <World Cup id> --json` and `share bracket --json` carry what the snippet says', async () => {
    // The sibling of the market P2: the snippet text warns, the structured
    // half must say so too (the batch-1 `partial` lesson, same shape).
    const said = [
      [['next', 'ARS'], { degraded: true, source: null }],
      [['760415', undefined], { degraded: false, source: null, partial: {} }],
      [['bracket', undefined], { degraded: false, source: null, inapplicable: true }],
    ] as const;
    for (const [args, keys] of said) {
      writes = [];
      await cmdShare(args[0], args[1], {}, ctx({ json: true }));
      const data = JSON.parse(text()) as { snippet: string };
      expect(data, args[0]).toMatchObject(keys);
      expect('unsupported' in data, args[0]).toBe(false);
      expect(data.snippet, args[0]).not.toMatch(WC);
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

  it('never merges the bundle back in when the refresher cached fixtures', () => {
    // Two mechanisms cover the empty cache above (no fixtures → an empty
    // schedule), so that case cannot see the merge. WITH cached fixtures the
    // schedule is `mergeLive(bundle, cached)`: a bundle that is the World Cup
    // skeleton wins the countdown (the opener is sooner and resolved), while
    // the club tie, flagless until 0.11, renders as nothing. Off the bundle the
    // merge base must be empty: "⚽ —", never "🇲🇽 vs 🇿🇦 in 1d".
    const now = new Date('2026-06-10T12:00:00Z');
    const club: Match = { ...pl, kickoff: '2026-06-12T20:00:00.000Z', updatedAt: now.toISOString() };
    const cache: CacheState = {
      updatedAt: now.toISOString(),
      live: [],
      degraded: false,
      source: 'espn',
      competition: 'eng.1',
      fixtures: [club],
      fixturesUpdatedAt: now.toISOString(),
    };
    for (const team of [undefined, 'MEX']) {
      const line = renderPrompt(cache, { defaultCompetition: false, team, now });
      expect(line).toBe('⚽ —');
      expect(line).not.toMatch(WC);
    }
  });
});
