import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Match } from '@claudinho/core';
import { readState, writeState } from '../src/cache';
import { inKnockoutPhase, runRefresh, shouldRefresh, shouldRefreshFixtures } from '../src/refresh';

// A time well outside any World Cup window (tournament starts 2026-06-11).
const PRE_WC = new Date('2026-06-04T16:00:00Z').getTime();

let dir: string;
const ORIG = process.env.CLAUDINHO_COMPETITION;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-refresh-'));
  process.env.XDG_CACHE_HOME = dir; // empty cache → stale → would refresh if windowed
  delete process.env.CLAUDINHO_COMPETITION;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (ORIG === undefined) delete process.env.CLAUDINHO_COMPETITION;
  else process.env.CLAUDINHO_COMPETITION = ORIG;
});

describe('shouldRefresh — competition-aware live window', () => {
  it('does NOT refresh outside a World Cup window (default competition)', () => {
    // No CLAUDINHO_COMPETITION → gated on the static WC schedule, which has no
    // match on 2026-06-04, so we must not poll.
    expect(shouldRefresh(PRE_WC)).toBe(false);
  });

  it('DOES refresh for a non-default competition (e.g. friendlies)', () => {
    // The WC schedule can't describe friendly windows, so the gate is bypassed
    // and a stale cache is allowed to refresh.
    process.env.CLAUDINHO_COMPETITION = 'fifa.friendly';
    expect(shouldRefresh(PRE_WC)).toBe(true);
  });
});

// ESPN-shaped scoreboard: the in-play match kicked off at 04:00Z (the provider
// files it under its NEXT day bucket) plus an already-FT match from the default
// bucket. A no-date fetchLive() would return [] here; the windowed path must
// keep only the in-play match.
const SCOREBOARD = {
  day: { date: '2026-06-16' },
  events: [
    {
      id: '760431',
      date: '2026-06-17T04:00Z',
      name: 'Jordan at Austria',
      season: { year: 2026, slug: 'group-stage' },
      status: {
        type: { name: 'STATUS_IN_PROGRESS', state: 'in', completed: false },
        displayClock: "76'",
        period: 2,
      },
      competitions: [
        {
          venue: { fullName: 'Ernst-Happel-Stadion' },
          competitors: [
            { homeAway: 'home', score: '2', team: { abbreviation: 'AUT', displayName: 'Austria' } },
            { homeAway: 'away', score: '1', team: { abbreviation: 'JOR', displayName: 'Jordan' } },
          ],
        },
      ],
    },
    {
      id: '760415',
      date: '2026-06-16T19:00Z',
      name: 'Senegal at France',
      season: { year: 2026, slug: 'group-stage' },
      status: { type: { name: 'STATUS_FULL_TIME', state: 'post', completed: true } },
      competitions: [
        {
          venue: { fullName: 'MetLife Stadium' },
          competitors: [
            { homeAway: 'home', score: '3', team: { abbreviation: 'FRA', displayName: 'France' } },
            { homeAway: 'away', score: '1', team: { abbreviation: 'SEN', displayName: 'Senegal' } },
          ],
        },
      ],
    },
  ],
};

describe('runRefresh — windowed live detection (statusline regression)', () => {
  // During the AUT-JOR window. A bare fetchLive() (no-date bucket) returned [],
  // so the statusline cache read empty mid-match and showed a countdown. The
  // refresher must now window around `now` and persist the in-play match.
  const DURING = new Date('2026-06-17T05:00:00Z');

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => SCOREBOARD })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('persists the adjacent-bucket live match, not an empty list', async () => {
    await runRefresh({ now: DURING, source: 'espn' });
    const state = readState();
    expect(state?.degraded).toBe(false);
    // Only the in-play match — the FT one in the default bucket is filtered out.
    expect((state?.live ?? []).map((m) => m.id)).toEqual(['760431']);
    expect((state?.live ?? [])[0]?.status).toBe('LIVE');
  });

  it('preserves cached knockout fixtures across a live-only refresh', async () => {
    // Pre-seed a fresh fixtures slice + a STALE live slice, then refresh during a
    // GROUP-stage live window (not knockout phase → fixtures not refetched). The
    // live write must NOT clobber the carried-over fixtures.
    const cachedFixture: Match = {
      id: '760491',
      stage: 'R32',
      kickoff: '2026-06-30T18:00Z',
      venue: 'X',
      home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
      away: { code: 'ECU', name: 'Ecuador', flag: '🇪🇨' },
      status: 'SCHEDULED',
      updatedAt: '2026-06-28T00:00Z',
    };
    writeState({
      updatedAt: '2026-06-17T04:00:00Z', // stale → live will refetch
      live: [],
      degraded: false,
      source: 'espn',
      competition: 'fifa.world',
      fixtures: [cachedFixture],
      fixturesUpdatedAt: '2026-06-17T04:55:00Z',
    });
    await runRefresh({ now: DURING, source: 'espn' });
    const state = readState();
    expect((state?.live ?? []).map((m) => m.id)).toEqual(['760431']); // live refreshed
    expect((state?.fixtures ?? []).map((m) => m.id)).toEqual(['760491']); // fixtures kept
  });
});

// A SCHEDULED Round-of-32 fixture with both nations resolved (slug → R32 stage).
const KO_SCOREBOARD = {
  day: { date: '2026-06-30' },
  events: [
    {
      id: '760491',
      date: '2026-06-30T18:00Z',
      name: 'Ecuador at Mexico',
      season: { year: 2026, slug: 'round-of-32' },
      status: { type: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false } },
      competitions: [
        {
          venue: { fullName: 'Estadio Banorte' },
          competitors: [
            { homeAway: 'home', score: '0', team: { abbreviation: 'MEX', displayName: 'Mexico' } },
            { homeAway: 'away', score: '0', team: { abbreviation: 'ECU', displayName: 'Ecuador' } },
          ],
        },
      ],
    },
  ],
};

describe('knockout fixtures cadence (statusline countdown across the knockouts)', () => {
  // After the group stage, the next static fixture is a knockout → knockout phase.
  const KO_NOW = new Date('2026-06-28T12:00:00Z').getTime();

  it('inKnockoutPhase / shouldRefreshFixtures gate on the phase, not a live window', () => {
    expect(inKnockoutPhase(PRE_WC)).toBe(false); // group stage hasn't even started
    expect(inKnockoutPhase(KO_NOW)).toBe(true); // next static fixture is the R32
    // Empty cache in the knockout phase → fixtures are stale → should refresh.
    expect(shouldRefreshFixtures(KO_NOW)).toBe(true);
    expect(shouldRefreshFixtures(PRE_WC)).toBe(false); // not knockout phase
  });

  it('does not chase a bundled bracket for a non-default competition', () => {
    process.env.CLAUDINHO_COMPETITION = 'fifa.friendly';
    expect(inKnockoutPhase(KO_NOW)).toBe(false);
    expect(shouldRefreshFixtures(KO_NOW)).toBe(false);
  });

  it('re-polls an EMPTY successful fetch on a SHORT TTL (boundary), long TTL once filled', () => {
    const base = {
      updatedAt: '2026-06-28T11:00:00Z',
      live: [],
      degraded: false,
      source: 'espn',
      competition: 'fifa.world',
    };
    const resolved: Match = {
      id: '760491',
      stage: 'R32',
      kickoff: '2026-06-30T18:00Z',
      venue: 'X',
      home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
      away: { code: 'ECU', name: 'Ecuador', flag: '🇪🇨' },
      status: 'SCHEDULED',
      updatedAt: '2026-06-28T00:00Z',
    };
    const stamp = (ms: number) => new Date(KO_NOW - ms).toISOString();
    // Empty fixtures (ESPN hasn't filed pairings) stamped 90s ago → short
    // (60s) TTL exceeded → re-poll, so the statusline can't sit on "⚽ —".
    expect(
      shouldRefreshFixtures(KO_NOW, { ...base, fixtures: [], fixturesUpdatedAt: stamp(90_000) }),
    ).toBe(true);
    // Empty, but only 30s ago → within the short TTL → don't stampede.
    expect(
      shouldRefreshFixtures(KO_NOW, { ...base, fixtures: [], fixturesUpdatedAt: stamp(30_000) }),
    ).toBe(false);
    // Once filled, the same 90s age is well within the long (15min) TTL.
    expect(
      shouldRefreshFixtures(KO_NOW, { ...base, fixtures: [resolved], fixturesUpdatedAt: stamp(90_000) }),
    ).toBe(false);
  });

  it('runRefresh caches the resolved knockout fixtures (no live match on now)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => KO_SCOREBOARD })),
    );
    try {
      await runRefresh({ now: new Date(KO_NOW), source: 'espn' });
      const state = readState();
      expect((state?.fixtures ?? []).map((m) => m.id)).toEqual(['760491']);
      expect(state?.fixtures?.[0]?.away.code).toBe('ECU');
      expect(state?.fixturesUpdatedAt).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('runRefresh re-polls an EMPTY fixtures cache only after the short TTL', async () => {
    // ESPN hasn't filed pairings yet → empty success. No live match at 12:00, so
    // every fetch here is a fixtures fetch — count them across three cycles.
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ day: {}, events: [] }) }));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      await runRefresh({ now: new Date(KO_NOW), source: 'espn' }); // fetch #1 → empty
      expect(readState()?.fixtures).toEqual([]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      await runRefresh({ now: new Date(KO_NOW + 30_000), source: 'espn' }); // within 60s → no fetch
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      await runRefresh({ now: new Date(KO_NOW + 90_000), source: 'espn' }); // past 60s → refetch
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
