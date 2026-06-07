import { describe, expect, it } from 'vitest';
import { getMatchesForDate, type Match, type ProviderAdapter } from '../src/index';

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
