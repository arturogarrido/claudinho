/**
 * MARKET-GATE DEGRADED GUARD (CLI) — review-discipline rule 11. A market signal is
 * cached by match id, but display labels come from the *current* `Match`. When the
 * live feed degrades and a knockout slot falls back to the bundle's 🏳️ placeholder
 * (SAME id, unresolved teams), a cached MEX/ECU signal must NOT print as
 * "Group A Winner 45% · …" — the fail-closed violation reviewers caught in 0.8.12.
 *
 * The shipped fix gates every render through core `marketSignalRendersFor(match,
 * signal)`. The unit test covers the predicate; THIS reconstructs the adverse
 * cache state (a resolved-then-cached signal + a degraded fixture sharing its id)
 * and drives the real CLI entry points end-to-end. Pairs with the resolved-path
 * `knockout-surface-coverage.test.ts`; this is its degraded twin.
 */
import {
  buildMarketSignal,
  FakeMarketProvider,
  type Match,
  type MarketSignal,
  normalizeOutcomes,
  type ProviderAdapter,
} from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdMarkets, cmdToday } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';

const KO_ID = '760486'; // the canonical fake R32 tie used across coverage tests
const KICK = '2026-06-30T18:00Z';
const RENDER_NOW = new Date('2026-06-30T12:00:00Z'); // pre-kickoff → market-relevant

function mexEcu(over: Partial<Match> = {}): Match {
  return {
    id: KO_ID,
    stage: 'R32',
    kickoff: KICK,
    venue: 'SoFi Stadium',
    home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
    away: { code: 'ECU', name: 'Ecuador', flag: '🇪🇨' },
    status: 'SCHEDULED',
    updatedAt: '2026-06-30T00:00Z',
    ...over,
  };
}

/**
 * The bundle placeholder the feed degrades back to — same id, unresolved teams.
 * Mirrors the real bundled slot 760486 (`2A`/`2B`, "Group A/B 2nd Place", 🏳️).
 */
function placeholder(): Match {
  return mexEcu({
    home: { code: '2A', name: 'Group A 2nd Place', flag: '🏳️' },
    away: { code: '2B', name: 'Group B 2nd Place', flag: '🏳️' },
  });
}

/** A signal cached while the fixture WAS resolved: matchId KO_ID, MEX/ECU outcomes. */
function cachedSignal(): MarketSignal {
  return buildMarketSignal({
    match: mexEcu(),
    source: 'fake',
    asOf: '2026-06-30T11:55Z',
    outcomes: normalizeOutcomes([
      { kind: 'home', teamCode: 'MEX', label: 'Mexico', probability: 0.45 },
      { kind: 'draw', label: 'Draw', probability: 0.32 },
      { kind: 'away', teamCode: 'ECU', label: 'Ecuador', probability: 0.23 },
    ]),
    liquidity: 500_000,
    now: new Date('2026-06-30T11:55Z'),
  });
}

const provider = () => new FakeMarketProvider({ signals: { [KO_ID]: cachedSignal() } });

function adapterFor(window: Match[]): ProviderAdapter {
  return {
    name: 'espn',
    capabilities: { push: false, latencyHintSec: 0 },
    async fetchByDate() {
      return window;
    },
    async fetchLive() {
      return [];
    },
    async fetchWindow() {
      return window;
    },
  };
}

function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return { lang: 'en', tz: 'UTC', json: false, color: false, source: 'espn', flavor: 'off', ...over };
}
const ctx = (window: Match[]) => ({
  cfg: cfg(),
  t: makeT('en'),
  adapter: adapterFor(window),
  marketProvider: provider(),
  now: RENDER_NOW,
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

describe('CLI market gate — cached signal must not render against a degraded placeholder (rule 11)', () => {
  it('today: SUPPRESSES the inherited market when the fixture degraded to a placeholder', async () => {
    await cmdToday('2026-06-30', ctx([placeholder()]));
    const o = text();
    expect(o).toContain('Group A 2nd Place'); // the placeholder fixture itself still renders
    expect(o).not.toContain('45%'); // its inherited market percentages do NOT leak
    expect(o).not.toContain('32%');
  });

  it('today: SHOWS the market when the fixture is resolved (positive control)', async () => {
    await cmdToday('2026-06-30', ctx([mexEcu()]));
    const o = text();
    expect(o).toContain('Mexico');
    expect(o).toContain('45%'); // proves the signal WAS a live candidate, not gated for another reason
  });

  it('markets <date>: drops the mismatched signal from the listing', async () => {
    await cmdMarkets('2026-06-30', undefined, ctx([placeholder()]));
    expect(text()).not.toContain('45%');
  });

  it('markets <date>: lists it when the fixture is resolved (positive control)', async () => {
    await cmdMarkets('2026-06-30', undefined, ctx([mexEcu()]));
    expect(text()).toContain('45%');
  });
});
