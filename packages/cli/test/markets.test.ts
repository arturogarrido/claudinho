import {
  allFixtures,
  DISCLAIMER,
  definitiveNone,
  FakeMarketProvider,
  type Match,
  type MarketProvider,
  type MarketSignal,
  PolymarketProvider,
  type ProviderAdapter,
  valid,
} from '@claudinho/core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdMarkets, cmdMatch, cmdToday, InputError } from '../src/commands';
import type { CliConfig } from '../src/config';
import { described } from './config-of';
import { makeT } from '../src/i18n';

/** Offline match adapter → commands fall back to the bundled static schedule. */
const fakeAdapter: ProviderAdapter = {
  name: 'fake',
  competition: 'fifa.world',
  capabilities: { push: false, latencyHintSec: 0 },
  async fetchByDate(): Promise<Match[]> {
    return [];
  },
  async fetchLive(): Promise<Match[]> {
    return [];
  },
};

/**
 * Fixed clock for every time-dependent gate (market relevance, live windows) —
 * keeps the suite deterministic forever, including after the tournament ends
 * (when every fixture's live window is in the real past).
 */
const TEST_NOW = new Date('2026-06-13T12:00:00Z');

/** A synthesizing market provider with the same fixed clock (deterministic). */
const synth = () => new FakeMarketProvider({ synthesize: true, now: TEST_NOW });

/** An unfinished read, optionally retaining the valid signals found so far. */
function incomplete(withSignals = false): MarketProvider {
  const base = synth();
  return {
    name: 'incomplete',
    findSignal: async () => undefined,
    findSignals: async (matches) => {
      const results = new Map();
      if (withSignals) {
        for (const match of matches) {
          const signal = await base.findSignal(match);
          if (signal) results.set(match.id, valid(signal));
        }
      }
      return { results, complete: false };
    },
  };
}

/** A fixture still upcoming at TEST_NOW (its market read is relevant). */
const upcoming = (): Match =>
  allFixtures().find(
    (m) => m.status === 'SCHEDULED' && Date.parse(m.kickoff) > TEST_NOW.getTime(),
  )!;

const upcomingDate = () => upcoming().kickoff.slice(0, 10);

function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return described({ lang: 'en', tz: 'UTC', json: true, color: false, source: 'espn', competition: 'fifa.world', flavor: 'off', ...over });
}
const ctx = (over: Partial<CliConfig>, marketProvider: MarketProvider, now: Date = TEST_NOW) => ({
  cfg: cfg(over),
  t: makeT('en'),
  adapter: fakeAdapter,
  marketProvider,
  now,
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
    await cmdMarkets(upcomingDate(), undefined, ctx({ json: true }, synth()));
    const data = json() as {
      date: string;
      informationalOnly: boolean;
      marketSignals: Record<string, { source: string; matchId: string }>;
    };
    expect(data.date).toBe(upcomingDate());
    expect(data.informationalOnly).toBe(true);
    expect((data as typeof data & { complete: boolean }).complete).toBe(true);
    const ids = Object.keys(data.marketSignals);
    expect(ids.length).toBeGreaterThan(0);
    expect(data.marketSignals[ids[0]!]?.source).toBe('fake');
    expect(data.marketSignals[ids[0]!]?.matchId).toBe(ids[0]);
  });

  it('renders attribution + dual disclaimers and no betting language', async () => {
    await cmdMarkets(upcomingDate(), undefined, ctx({ json: false }, synth()));
    const o = text();
    expect(o).toContain(`Market signals · ${upcomingDate()}`);
    expect(o).toContain('informational only');
    expect(o).toContain(DISCLAIMER);
    expect(o).toContain('Prediction-market data is informational only.');
    expect(o).not.toMatch(/\b(bet|betting|wager|gambling|value pick|edge|lock)\b/i);
  });

  it('says so when no signals are available', async () => {
    await cmdMarkets('2026-06-13', undefined, ctx({ json: false }, new FakeMarketProvider()));
    expect(text()).toContain('No market signals available');
  });

  it('marks an empty map incomplete when the provider throws', async () => {
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
    const data = json();
    expect(Object.keys(data.marketSignals).length).toBe(0);
    expect(data.complete).toBe(false);
  });

  it('keeps partial signals but warns that the date read was incomplete', async () => {
    await cmdMarkets(upcomingDate(), undefined, ctx({ json: false }, incomplete(true)));
    expect(text()).toContain('Prediction markets');
    expect(text()).toContain('unavailable or incomplete');
  });
});

describe('cmdMarkets — single match', () => {
  it('returns the signal for a known match id', async () => {
    const id = upcoming().id;
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

  it('does not collapse an unfinished read into a confident null signal', async () => {
    await cmdMarkets(upcoming().id, undefined, ctx({ json: true }, incomplete()));
    expect(json()).toMatchObject({ complete: false, signal: null });

    writes = [];
    await cmdMarkets(upcoming().id, undefined, ctx({ json: false }, incomplete()));
    expect(text()).toContain('unavailable or incomplete');
    expect(text()).not.toContain('No market signal for this match');
  });

  it("dates the header by the fixture's calendar day in the configured timezone", async () => {
    // 01:00Z on Jun 14 is 19:00 on Jun 13 in Mexico City (UTC-6): the header's date follows the zone.
    const lateKickoff = allFixtures().find((m) => Date.parse(m.kickoff) === Date.parse('2026-06-14T01:00:00Z'))!;
    expect(lateKickoff).toBeDefined();
    const headerLine = () => text().split('\n').find((l) => l.includes(`${lateKickoff.home.name} vs ${lateKickoff.away.name}`));
    await cmdMarkets(lateKickoff.id, undefined, ctx({ json: false, tz: 'UTC' }, synth()));
    expect(headerLine()).toMatch(/ · Jun 14$/);

    writes = [];
    await cmdMarkets(lateKickoff.id, undefined, ctx({ json: false, tz: 'America/Mexico_City' }, synth()));
    expect(headerLine()).toMatch(/ · Jun 13$/);
  });

  it('suppresses the signal for a finished match (market reads are pre-match)', async () => {
    // The tournament opener is long past at this clock.
    const opener = allFixtures()[0]!;
    const after = new Date(Date.parse(opener.kickoff) + 6 * 60 * 60_000);
    await cmdMarkets(opener.id, undefined, ctx({ json: true }, synth(), after));
    expect(json().signal).toBeNull();

    await cmdMarkets(opener.id, undefined, ctx({ json: false }, synth(), after));
    expect(text()).toContain('market signals are pre-match and in-play reads');
  });
});

describe('cmdMarkets — next <team>', () => {
  it('throws InputError when the team is missing and CLAUDINHO_TEAM is unset', async () => {
    const prev = process.env.CLAUDINHO_TEAM;
    delete process.env.CLAUDINHO_TEAM;
    try {
      await expect(cmdMarkets('next', undefined, ctx({}, synth()))).rejects.toBeInstanceOf(
        InputError,
      );
    } finally {
      if (prev !== undefined) process.env.CLAUDINHO_TEAM = prev;
    }
  });

  it('falls back to CLAUDINHO_TEAM when the team argument is omitted', async () => {
    const prev = process.env.CLAUDINHO_TEAM;
    process.env.CLAUDINHO_TEAM = upcoming().home.code.toLowerCase();
    try {
      await cmdMarkets('next', undefined, ctx({ json: true }, synth()));
      expect((json() as { team: string }).team).toBe(upcoming().home.code.toUpperCase());
    } finally {
      if (prev === undefined) delete process.env.CLAUDINHO_TEAM;
      else process.env.CLAUDINHO_TEAM = prev;
    }
  });

  it('echoes the team and an informational-only flag', async () => {
    const team = upcoming().home.code;
    await cmdMarkets('next', team, ctx({ json: true }, synth()));
    const data = json() as { team: string; informationalOnly: boolean };
    expect(data.team).toBe(team);
    expect(data.informationalOnly).toBe(true);
  });

  it('accepts a team NAME (not just a code) via the shared resolver', async () => {
    // `markets next` funnels through resolveTeamArg like `next`, so a nation
    // name resolves to its code (Holland → NED). Regression for the follow-up.
    await cmdMarkets('next', 'holland', ctx({ json: true }, synth()));
    expect((json() as { team: string }).team).toBe('NED');
  });

  it("prefers the team's IN-PLAY match over their next fixture", async () => {
    const fixture = upcoming();
    const during = new Date(Date.parse(fixture.kickoff) + 30 * 60_000);
    await cmdMarkets('next', fixture.home.code, ctx({ json: true }, synth(), during));
    expect((json() as { matchId: string }).matchId).toBe(fixture.id);
  });

  it('surfaces an incomplete current-or-next read', async () => {
    const team = upcoming().home.code;
    await cmdMarkets('next', team, ctx({ json: true }, incomplete()));
    expect(json()).toMatchObject({ team, complete: false, signal: null });
  });
});

describe('cmdMarkets — a competition without markets', () => {
  // No injected provider: the command builds one through the real factory, and
  // the factory must hand back the network-free no-op off the default
  // competition. The copy says the sidecar covers the World Cup only rather
  // than reporting a "no signal" it never looked for.
  const ORIG_COMP = process.env.CLAUDINHO_COMPETITION;
  const ORIG_XDG = process.env.XDG_CACHE_HOME;
  const ORIG_SRC = process.env.CLAUDINHO_MARKETS_SOURCE;
  let dir: string;
  // Spy on the REAL provider's entry point rather than on `fetch`: the copy is
  // decided by the competition alone, so the only observable that proves the
  // command never consulted Polymarket is that its provider was never asked.
  // (A first version spied on `fetch` and stayed green with the gate deleted.)
  const consulted = vi.spyOn(PolymarketProvider.prototype, 'findSignals');
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'claudinho-markets-'));
    process.env.XDG_CACHE_HOME = dir; // the on-disk market cache stays out of ~/.cache
    process.env.CLAUDINHO_COMPETITION = 'eng.1';
    // test/setup.ts routes the default source to the no-op for hermeticity; this
    // suite exists to prove the REAL source is gated, so ask for it explicitly.
    process.env.CLAUDINHO_MARKETS_SOURCE = 'polymarket';
    consulted.mockClear();
    consulted.mockImplementation(async () => {
      throw new Error('Polymarket must not be consulted on eng.1');
    });
  });
  afterEach(() => {
    consulted.mockReset();
    rmSync(dir, { recursive: true, force: true });
    if (ORIG_COMP === undefined) delete process.env.CLAUDINHO_COMPETITION;
    else process.env.CLAUDINHO_COMPETITION = ORIG_COMP;
    if (ORIG_XDG === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = ORIG_XDG;
    if (ORIG_SRC === undefined) delete process.env.CLAUDINHO_MARKETS_SOURCE;
    else process.env.CLAUDINHO_MARKETS_SOURCE = ORIG_SRC;
  });
  // The competition is the config's and the adapter's (0.11 2.0); the
  // environment above only mirrors what a real run's edge would have read.
  const noProviderCtx = (over: Partial<CliConfig>) => ({
    cfg: cfg({ competition: 'eng.1', ...over }),
    t: makeT('en'),
    adapter: { ...fakeAdapter, competition: 'eng.1' },
    now: TEST_NOW,
  });

  it('says market signals cover the World Cup only, and issues no request', async () => {
    await cmdMarkets(upcomingDate(), undefined, noProviderCtx({ json: false }));
    const o = text();
    expect(o).toContain('Market signals cover the World Cup only');
    expect(o).not.toContain('No market signals available');
    expect(o).toContain(DISCLAIMER);
    expect(consulted).not.toHaveBeenCalled();
  });

  it('reports a complete, empty sidecar in --json (checked everything there was to check)', async () => {
    await cmdMarkets(upcomingDate(), undefined, noProviderCtx({ json: true }));
    const data = json() as { complete: boolean; marketSignals: Record<string, unknown> };
    expect(data.complete).toBe(true);
    expect(Object.keys(data.marketSignals)).toEqual([]);
    expect(consulted).not.toHaveBeenCalled();
  });

  it('a bundled World Cup id is not available off the bundle, and issues no request', async () => {
    // Audit A03 (0.10.1): under `eng.1` a World Cup id used to resolve through
    // the skeleton and print the market scope copy for a match that is not
    // this competition's. Off the bundle the lookup is honest: the notice, no
    // provider consulted, no market copy.
    await cmdMarkets(upcoming().id, undefined, noProviderCtx({ json: false }));
    const o = text();
    expect(o).toContain('Not available for this competition yet.');
    expect(o).not.toContain('Market signals cover the World Cup only');
    expect(o).toContain(DISCLAIMER);
    expect(consulted).not.toHaveBeenCalled();
  });
});

/**
 * The default-on annotation (`today`, `match <id>`) shows a signal only through the strict gate, and a market read
 * that cannot be made never costs the fixtures. Each case has an on-disk market cache of its own: a signal one case
 * cached would otherwise be a hit in the next.
 */
describe('the default-on market annotation on today and match (fail closed)', () => {
  const ORIG_XDG = process.env.XDG_CACHE_HOME;
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'claudinho-annotation-'));
    process.env.XDG_CACHE_HOME = dir;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (ORIG_XDG === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = ORIG_XDG;
  });

  /** A clean signal for the match, priced at `asOf` (the request's clock unless said otherwise). */
  const signalFor = (m: Match, over: Partial<MarketSignal> = {}): MarketSignal => ({
    matchId: m.id,
    source: 'polymarket',
    asOf: TEST_NOW.toISOString(),
    fetchedAt: TEST_NOW.toISOString(),
    outcomes: [
      { kind: 'home', teamCode: m.home.code, label: m.home.name, probability: 0.56 },
      { kind: 'draw', label: 'Draw', probability: 0.25 },
      { kind: 'away', teamCode: m.away.code, label: m.away.name, probability: 0.19 },
    ],
    favorite: { kind: 'home', teamCode: m.home.code, probability: 0.56, strength: 'slight' },
    stale: false,
    ambiguous: false,
    ...over,
  });
  /** A provider that answers every match with what `make` builds, a definitive none otherwise. */
  const fixed = (make: (m: Match) => MarketSignal): MarketProvider => ({
    name: 'fixed',
    findSignal: async (m) => make(m),
    findSignals: async (matches) => ({
      results: new Map(matches.map((m) => [m.id, m.id === upcoming().id ? valid(make(m)) : definitiveNone('no signal for this fixture')] as const)),
      complete: true,
    }),
  });
  const runs = (provider: MarketProvider, over: Partial<CliConfig> = {}) => [
    () => cmdToday(upcomingDate(), ctx({ json: false, ...over }, provider)),
    () => cmdMatch(upcoming().id, ctx({ json: false, ...over }, provider)),
  ];

  it('control: a fresh, reliable signal is shown beside its fixture', async () => {
    for (const run of runs(fixed((m) => signalFor(m)))) {
      writes = [];
      await run();
      expect(text()).toContain(upcoming().home.name);
      expect(text()).toContain('56%');
      expect(text()).toContain('informational only');
    }
  });

  it('a stale signal is not shown: flagged stale by its provider, or priced longer ago than the freshness window', async () => {
    const stale = [
      fixed((m) => signalFor(m, { stale: true })),
      fixed((m) => signalFor(m, { asOf: new Date(TEST_NOW.getTime() - 60 * 60_000).toISOString(), fetchedAt: new Date(TEST_NOW.getTime() - 60 * 60_000).toISOString() })),
    ];
    for (const provider of stale) {
      for (const run of runs(provider)) {
        rmSync(join(dir, 'claudinho'), { recursive: true, force: true }); // no case reads the previous one's cache
        writes = [];
        await run();
        expect(text()).toContain(upcoming().home.name);
        expect(text()).not.toContain('56%');
        expect(text()).not.toContain('informational only');
      }
    }
  });

  it('--no-markets: no market line, and the provider is never asked', async () => {
    let asked = false;
    const tripwire: MarketProvider = {
      name: 'tripwire',
      findSignal: async () => {
        asked = true;
        throw new Error('must not be asked');
      },
      findSignals: async () => {
        asked = true;
        throw new Error('must not be asked');
      },
    };
    for (const run of runs(tripwire, { markets: false })) {
      writes = [];
      await run();
      expect(text()).toContain(upcoming().home.name);
      expect(text()).not.toContain('informational only');
      expect(text()).not.toContain('Market data unavailable');
    }
    expect(asked).toBe(false);
  });

  it('a market provider that throws: the fixtures still show, with the market data said to be unavailable or incomplete', async () => {
    const boom: MarketProvider = {
      name: 'boom',
      findSignal: async () => {
        throw new Error('down');
      },
      findSignals: async () => {
        throw new Error('down');
      },
    };
    for (const run of runs(boom)) {
      writes = [];
      await run();
      expect(text()).toContain(upcoming().home.name);
      expect(text()).toContain('Market data unavailable or incomplete');
      expect(text()).not.toContain('informational only');
    }
    writes = [];
    await cmdToday(upcomingDate(), ctx({ json: true }, boom));
    expect(json()).toMatchObject({ marketComplete: false, marketSignals: {} });
    writes = [];
    await cmdMatch(upcoming().id, ctx({ json: true }, boom));
    expect(json()).toMatchObject({ marketComplete: false });
  });
});
