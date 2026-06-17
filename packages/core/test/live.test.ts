import { describe, expect, it } from 'vitest';
import { getLiveMatches, getMatchesForDate, type Match, type ProviderAdapter } from '../src/index';

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
