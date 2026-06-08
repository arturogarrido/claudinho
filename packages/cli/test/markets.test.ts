import {
  allFixtures,
  FakeMarketProvider,
  type Match,
  type MarketProvider,
  type ProviderAdapter,
} from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdMarkets, InputError } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';

/** Offline match adapter → commands fall back to the bundled static schedule. */
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

/** A synthesizing market provider with a fixed clock (deterministic). */
const synth = () =>
  new FakeMarketProvider({ synthesize: true, now: new Date('2026-06-13T12:00:00Z') });

function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return { lang: 'en', tz: 'UTC', json: true, color: false, source: 'espn', flavor: 'off', ...over };
}
const ctx = (over: Partial<CliConfig>, marketProvider: MarketProvider) => ({
  cfg: cfg(over),
  t: makeT('en'),
  adapter: fakeAdapter,
  marketProvider,
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

const json = () => JSON.parse(writes.join(''));
const text = () => writes.join('');

describe('cmdMarkets — date listing', () => {
  it('emits a sidecar JSON shape keyed by matchId', async () => {
    await cmdMarkets('2026-06-13', undefined, ctx({ json: true }, synth()));
    const data = json() as {
      date: string;
      informationalOnly: boolean;
      marketSignals: Record<string, { source: string; matchId: string }>;
    };
    expect(data.date).toBe('2026-06-13');
    expect(data.informationalOnly).toBe(true);
    const ids = Object.keys(data.marketSignals);
    expect(ids.length).toBeGreaterThan(0);
    expect(data.marketSignals[ids[0]!]?.source).toBe('fake');
    expect(data.marketSignals[ids[0]!]?.matchId).toBe(ids[0]);
  });

  it('renders attribution + dual disclaimers and no betting language', async () => {
    await cmdMarkets('2026-06-13', undefined, ctx({ json: false }, synth()));
    const o = text();
    expect(o).toContain('Market signals · 2026-06-13');
    expect(o).toContain('informational only');
    expect(o).toContain('Not affiliated with FIFA or Anthropic.');
    expect(o).toContain('Prediction-market data is informational only.');
    expect(o).not.toMatch(/\b(bet|betting|wager|gambling|value pick|edge|lock)\b/i);
  });

  it('says so when no signals are available', async () => {
    await cmdMarkets('2026-06-13', undefined, ctx({ json: false }, new FakeMarketProvider()));
    expect(text()).toContain('No market signals available');
  });

  it('degrades to an empty map when the provider throws', async () => {
    const boom: MarketProvider = {
      name: 'boom',
      findSignal: async () => {
        throw new Error('down');
      },
      findSignals: async () => {
        throw new Error('down');
      },
    };
    await cmdMarkets('2026-06-13', undefined, ctx({ json: true }, boom));
    expect(Object.keys(json().marketSignals).length).toBe(0);
  });
});

describe('cmdMarkets — single match', () => {
  it('returns the signal for a known match id', async () => {
    const id = allFixtures()[0]!.id;
    await cmdMarkets(id, undefined, ctx({ json: true }, synth()));
    const data = json() as { matchId: string; signal: { source: string; matchId: string } | null };
    expect(data.matchId).toBe(id);
    expect(data.signal?.source).toBe('fake');
    expect(data.signal?.matchId).toBe(id);
  });

  it('returns a null signal for an unknown match id', async () => {
    await cmdMarkets('does-not-exist', undefined, ctx({ json: true }, synth()));
    expect(json().signal).toBeNull();
  });
});

describe('cmdMarkets — next <team>', () => {
  it('throws InputError when the team is missing', async () => {
    await expect(cmdMarkets('next', undefined, ctx({}, synth()))).rejects.toBeInstanceOf(
      InputError,
    );
  });

  it('echoes the team and an informational-only flag', async () => {
    const team = allFixtures()[0]!.home.code;
    await cmdMarkets('next', team, ctx({ json: true }, synth()));
    const data = json() as { team: string; informationalOnly: boolean };
    expect(data.team).toBe(team);
    expect(data.informationalOnly).toBe(true);
  });
});
