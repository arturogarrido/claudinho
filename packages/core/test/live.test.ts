import { describe, expect, it } from 'vitest';
import {
  getKnockoutFixtures,
  getLiveMatches,
  getMatchesForDate,
  getNextFixtureForTeam,
  type Match,
  type ProviderAdapter,
} from '../src/index';

function fx(id: string, kickoff: string, over: Partial<Match> = {}): Match {
  return {
    id,
    stage: 'GROUP',
    group: 'A',
    kickoff,
    venue: 'X',
    home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
    away: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' },
    status: 'SCHEDULED',
    updatedAt: '2026-06-01T00:00Z',
    ...over,
  };
}

/** Adapter that supports the date-range window and records the call. */
function windowAdapter(live: Match[]) {
  const calls: Array<[string, string]> = [];
  const adapter: ProviderAdapter = {
    name: 'win',
    capabilities: { push: false, latencyHintSec: 0 },
    async fetchByDate() {
      return [];
    },
    async fetchLive() {
      return [];
    },
    async fetchWindow(start, end) {
      calls.push([start, end]);
      return live;
    },
  };
  return { adapter, calls };
}

/** Adapter that only supports single-date fetch (no fetchWindow). */
function dateAdapter(live: Match[]) {
  const calls: string[] = [];
  const adapter: ProviderAdapter = {
    name: 'date',
    capabilities: { push: false, latencyHintSec: 0 },
    async fetchByDate(d) {
      calls.push(d);
      return live;
    },
    async fetchLive() {
      return [];
    },
  };
  return { adapter, calls };
}

describe('getMatchesForDate — spanning-window overlay (P1)', () => {
  it('fetches a ±1-day UTC window and overlays live state by id', async () => {
    // '760415' is the bundled opener; give it a finished-result overlay.
    const overlay = fx('760415', '2026-06-11T19:00Z', {
      status: 'FT',
      score: { home: 2, away: 1 },
    });
    const { adapter, calls } = windowAdapter([overlay]);

    const { matches, degraded } = await getMatchesForDate(adapter, '2026-06-12');

    expect(degraded).toBe(false);
    expect(calls).toEqual([['2026-06-11', '2026-06-13']]); // the day ±1
    expect(matches.find((m) => m.id === '760415')?.status).toBe('FT');
  });

  it('falls back to a single-date fetch when the adapter has no fetchWindow', async () => {
    const { adapter, calls } = dateAdapter([]);
    await getMatchesForDate(adapter, '2026-06-12');
    expect(calls).toEqual(['2026-06-12']);
  });

  it('degrades to the static schedule on a provider error', async () => {
    const adapter: ProviderAdapter = {
      name: 'boom',
      capabilities: { push: false, latencyHintSec: 0 },
      async fetchByDate() {
        throw new Error('down');
      },
      async fetchLive() {
        return [];
      },
      async fetchWindow() {
        throw new Error('down');
      },
    };
    const { matches, degraded } = await getMatchesForDate(adapter, '2026-06-12');
    expect(degraded).toBe(true);
    expect(matches.length).toBeGreaterThan(0); // bundled fixtures still present
  });
});

describe('getLiveMatches — windowed in-play detection (P1)', () => {
  it('finds a live match the provider files under an ADJACENT day bucket', async () => {
    // Real incident: a 04:00Z kickoff live at 76', while the provider's no-date
    // "today" bucket already shows the prior, all-FT day → a bare fetchLive()
    // misses it and the statusline shows a countdown mid-match. The ±1-day
    // window around `now` must catch it.
    const liveLate = fx('760431', '2026-06-17T04:00Z', {
      status: 'LIVE',
      minute: 76,
      score: { home: 2, away: 1 },
    });
    const ftEarlier = fx('760415', '2026-06-16T19:00Z', { status: 'FT', score: { home: 3, away: 1 } });
    const upcoming = fx('760432', '2026-06-17T17:00Z', { status: 'SCHEDULED' });
    const { adapter, calls } = windowAdapter([ftEarlier, liveLate, upcoming]);

    const { matches, degraded, source } = await getLiveMatches(
      adapter,
      new Date('2026-06-17T05:46:00Z'),
    );

    expect(degraded).toBe(false);
    expect(source).toBe('win');
    expect(calls).toEqual([['2026-06-16', '2026-06-18']]); // now ±1 day
    // Only the in-play match — not the FT or the not-yet-started one.
    expect(matches.map((m) => m.id)).toEqual(['760431']);
    expect(matches[0]?.status).toBe('LIVE');
  });

  it('includes HT and excludes FT / SCHEDULED', async () => {
    const ht = fx('a', '2026-06-17T04:00Z', { status: 'HT', score: { home: 0, away: 0 } });
    const ft = fx('b', '2026-06-17T01:00Z', { status: 'FT' });
    const sched = fx('c', '2026-06-17T20:00Z', { status: 'SCHEDULED' });
    const { adapter } = windowAdapter([ht, ft, sched]);
    const { matches } = await getLiveMatches(adapter, new Date('2026-06-17T05:00:00Z'));
    expect(matches.map((m) => m.id)).toEqual(['a']);
  });

  it('falls back to fetchLive() when the adapter has no fetchWindow', async () => {
    const live = fx('z', '2026-06-17T04:00Z', { status: 'LIVE' });
    const calls: string[] = [];
    const adapter: ProviderAdapter = {
      name: 'date',
      capabilities: { push: false, latencyHintSec: 0 },
      async fetchByDate() {
        return [];
      },
      async fetchLive() {
        calls.push('live');
        return [live];
      },
    };
    const { matches } = await getLiveMatches(adapter, new Date('2026-06-17T05:00:00Z'));
    expect(calls).toEqual(['live']);
    expect(matches.map((m) => m.id)).toEqual(['z']);
  });

  it('degrades to empty on a provider error (never a confidently-empty live list)', async () => {
    const adapter: ProviderAdapter = {
      name: 'boom',
      capabilities: { push: false, latencyHintSec: 0 },
      async fetchByDate() {
        return [];
      },
      async fetchLive() {
        return [];
      },
      async fetchWindow() {
        throw new Error('down');
      },
    };
    const { matches, degraded } = await getLiveMatches(adapter, new Date('2026-06-17T05:00:00Z'));
    expect(degraded).toBe(true);
    expect(matches).toEqual([]);
  });
});

describe('getNextFixtureForTeam — live-resolved across the knockout phase', () => {
  // After the group stage the bundled knockout slots are placeholders (codes
  // like 2A/2B, flag 🏳️), so a static lookup is blind. The live overlay carries
  // the real pairing once ESPN assigns it.
  const KNOCKOUT_NOW = new Date('2026-06-28T12:00:00Z'); // R32 day, group stage done

  it('resolves a confirmed Round-of-32 tie from the live overlay (the bug)', async () => {
    // Overlay the bundled R32 id 760486 (a 2A-vs-2B placeholder) with the
    // confirmed Mexico vs Ecuador pairing ESPN has filed.
    const r32 = fx('760486', '2026-06-30T18:00Z', {
      stage: 'R32',
      group: undefined,
      home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
      away: { code: 'ECU', name: 'Ecuador', flag: '🇪🇨' },
    });
    const { adapter, calls } = windowAdapter([r32]);

    const { fixture, degraded, source } = await getNextFixtureForTeam(adapter, 'MEX', KNOCKOUT_NOW);

    expect(degraded).toBe(false);
    expect(calls).toEqual([['20260628', '20260719']]); // the knockout window
    expect(fixture?.id).toBe('760486');
    expect(fixture?.away.code).toBe('ECU');
    // Live overlay served this fixture → attribute the provider.
    expect(source).toBe('win');
  });

  it('case-insensitive team code', async () => {
    const r32 = fx('760486', '2026-06-30T18:00Z', {
      stage: 'R32',
      group: undefined,
      home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
      away: { code: 'ECU', name: 'Ecuador', flag: '🇪🇨' },
    });
    const { adapter } = windowAdapter([r32]);
    const { fixture } = await getNextFixtureForTeam(adapter, 'mex', KNOCKOUT_NOW);
    expect(fixture?.id).toBe('760486');
  });

  it('mid-group: the next GROUP fixture still wins and is NOT attributed to the overlay', async () => {
    // Empty knockout window; the team's next group game comes from the static
    // bundle, so it must not carry a live-provider attribution.
    const { adapter } = windowAdapter([]);
    const { fixture, degraded, source } = await getNextFixtureForTeam(
      adapter,
      'MEX',
      new Date('2026-06-13T12:00:00Z'),
    );
    expect(degraded).toBe(false);
    expect(fixture?.stage).toBe('GROUP');
    expect(source).toBeUndefined();
  });

  it('fails closed on a provider error: degraded, no invented knockout pairing', async () => {
    const adapter: ProviderAdapter = {
      name: 'boom',
      capabilities: { push: false, latencyHintSec: 0 },
      async fetchByDate() {
        return [];
      },
      async fetchLive() {
        return [];
      },
      async fetchWindow() {
        throw new Error('down');
      },
    };
    const { fixture, degraded, source } = await getNextFixtureForTeam(adapter, 'MEX', KNOCKOUT_NOW);
    expect(degraded).toBe(true);
    // The static skeleton has only a placeholder R32 slot for MEX, never a real
    // pairing — so no fixture, rather than a confidently-wrong one.
    expect(fixture).toBeUndefined();
    expect(source).toBeUndefined();
  });
});

describe('getKnockoutFixtures — resolved upcoming knockouts for the statusline cache', () => {
  const KO_NOW = new Date('2026-06-28T12:00:00Z');
  const ko = (id: string, kickoff: string, over: Partial<Match> = {}): Match =>
    fx(id, kickoff, { stage: 'R32', group: undefined, ...over });
  const placeholder = { code: '2A', name: 'Group A 2nd Place', flag: '🏳️' };

  it('returns only resolved, upcoming knockout fixtures, sorted by kickoff', async () => {
    const mexEcu = ko('760491', '2026-06-30T18:00Z', {
      home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
      away: { code: 'ECU', name: 'Ecuador', flag: '🇪🇨' },
    });
    const gerPar = ko('760489', '2026-06-29T13:30Z', {
      home: { code: 'GER', name: 'Germany', flag: '🇩🇪' },
      away: { code: 'PAR', name: 'Paraguay', flag: '🇵🇾' },
    });
    const { adapter } = windowAdapter([mexEcu, gerPar]);
    const { fixtures, degraded } = await getKnockoutFixtures(adapter, KO_NOW);
    expect(degraded).toBe(false);
    // Sorted by kickoff: Germany (Jun 29) before Mexico (Jun 30).
    expect(fixtures.map((m) => m.id)).toEqual(['760489', '760491']);
  });

  it('excludes unresolved placeholders, group games, and past fixtures', async () => {
    const unresolved = ko('760486', '2026-06-30T18:00Z', { home: placeholder, away: placeholder });
    const group = fx('760400', '2026-06-30T18:00Z'); // stage GROUP
    const past = ko('760488', '2026-06-27T18:00Z', {
      home: { code: 'BRA', name: 'Brazil', flag: '🇧🇷' },
      away: { code: 'JPN', name: 'Japan', flag: '🇯🇵' },
    });
    const { adapter } = windowAdapter([unresolved, group, past]);
    const { fixtures, degraded } = await getKnockoutFixtures(adapter, KO_NOW);
    expect(degraded).toBe(false);
    expect(fixtures).toEqual([]);
  });

  it('fails closed (degraded) on a provider error — caller must keep prior cache', async () => {
    const adapter: ProviderAdapter = {
      name: 'boom',
      capabilities: { push: false, latencyHintSec: 0 },
      async fetchByDate() {
        return [];
      },
      async fetchLive() {
        return [];
      },
      async fetchWindow() {
        throw new Error('down');
      },
    };
    const { fixtures, degraded } = await getKnockoutFixtures(adapter, KO_NOW);
    expect(degraded).toBe(true);
    expect(fixtures).toEqual([]);
  });

  it('degraded when the adapter has no window fetch (can never read the overlay)', async () => {
    const adapter: ProviderAdapter = {
      name: 'nowindow',
      capabilities: { push: false, latencyHintSec: 0 },
      async fetchByDate() {
        return [];
      },
      async fetchLive() {
        return [];
      },
    };
    const { fixtures, degraded } = await getKnockoutFixtures(adapter, KO_NOW);
    expect(degraded).toBe(true);
    expect(fixtures).toEqual([]);
  });
});
