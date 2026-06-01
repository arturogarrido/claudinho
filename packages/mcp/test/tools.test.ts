import { describe, expect, it } from 'vitest';
import type { Match, ProviderAdapter } from '@claudinho/core';
import {
  toolGetLive,
  toolGetNextFixture,
  toolGetStandings,
  toolGetToday,
} from '../src/tools';

function liveMatch(over: Partial<Match> = {}): Match {
  return {
    id: '760415',
    stage: 'GROUP',
    group: 'A',
    kickoff: '2026-06-11T19:00Z',
    venue: 'Estadio Banorte',
    home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
    away: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' },
    status: 'LIVE',
    minute: 67,
    score: { home: 1, away: 0 },
    updatedAt: '2026-06-11T20:07Z',
    ...over,
  };
}

/** A fake adapter so tests never touch the network. */
function fakeAdapter(opts: {
  live?: Match[];
  byDate?: Match[];
  throws?: boolean;
}): ProviderAdapter {
  return {
    name: 'fake',
    capabilities: { push: false, latencyHintSec: 0 },
    async fetchByDate() {
      if (opts.throws) throw new Error('network down');
      return opts.byDate ?? [];
    },
    async fetchLive() {
      if (opts.throws) throw new Error('network down');
      return opts.live ?? [];
    },
  };
}

describe('toolGetLive', () => {
  it('formats live matches with score and minute + structured data', async () => {
    const r = await toolGetLive({ adapter: fakeAdapter({ live: [liveMatch()] }) });
    expect(r.text).toContain('🇲🇽 Mexico 1–0 South Africa 🇿🇦');
    expect(r.text).toContain("LIVE 67'");
    expect(r.text).toContain('not affiliated');
    expect((r.data as { count: number }).count).toBe(1);
  });

  it('reports the empty state with no live matches', async () => {
    const r = await toolGetLive({ adapter: fakeAdapter({ live: [] }) });
    expect(r.text).toContain('No matches in play');
    expect((r.data as { count: number }).count).toBe(0);
  });

  it('flags degraded when the provider throws', async () => {
    const r = await toolGetLive({ adapter: fakeAdapter({ throws: true }) });
    expect((r.data as { degraded: boolean }).degraded).toBe(true);
  });
});

describe('toolGetToday', () => {
  it('overlays live state onto the static schedule for the opener date', async () => {
    const r = await toolGetToday({
      date: '2026-06-11',
      adapter: fakeAdapter({ byDate: [liveMatch()] }),
    });
    const data = r.data as { date: string; count: number; matches: Match[] };
    expect(data.date).toBe('2026-06-11');
    expect(data.count).toBeGreaterThan(0);
    // The overlaid opener should now be LIVE.
    const opener = data.matches.find((m) => m.id === '760415');
    expect(opener?.status).toBe('LIVE');
  });

  it('falls back to the static schedule when the provider throws', async () => {
    const r = await toolGetToday({
      date: '2026-06-11',
      adapter: fakeAdapter({ throws: true }),
    });
    const data = r.data as { degraded: boolean; count: number };
    expect(data.degraded).toBe(true);
    expect(data.count).toBeGreaterThan(0); // static fixtures still present
  });
});

describe('toolGetNextFixture (pure static)', () => {
  it('returns the next fixture for a team code', async () => {
    const r = await toolGetNextFixture({ team: 'bra' });
    const data = r.data as { team: string; fixture: Match | null };
    expect(data.team).toBe('BRA');
    expect(data.fixture).toBeTruthy();
    expect(r.text).toContain('Next up for BRA');
  });

  it('handles an unknown team gracefully', async () => {
    const r = await toolGetNextFixture({ team: 'ZZZ' });
    expect((r.data as { fixture: null }).fixture).toBeNull();
  });
});

// Regression: every other tool test injects `adapter`, which masked an
// infinite recursion in resolveAdapter() on the *production* (no-injection)
// path — `args.adapter ?? resolveAdapter(args)` called itself instead of
// makeAdapter(). This exercises a network tool WITHOUT an injected adapter so
// the real resolveAdapter → makeAdapter path is covered. The fetch may
// succeed or degrade; we only assert it returns (does not throw/recurse).
describe('production adapter path (no injection)', () => {
  it('toolGetStandings resolves a real adapter without recursing', async () => {
    const r = await toolGetStandings({ group: 'A' });
    expect(r.text).toContain('Group A');
  }, 20000);
});

describe('toolGetStandings', () => {
  it('returns all 12 group tables (static fallback)', async () => {
    const r = await toolGetStandings({ adapter: fakeAdapter({ throws: true }) });
    const data = r.data as { tables: Array<{ group: string }> };
    expect(Array.isArray(data.tables)).toBe(true);
    expect(data.tables).toHaveLength(12);
  });

  it('returns a single group when asked', async () => {
    const r = await toolGetStandings({ group: 'A', adapter: fakeAdapter({ throws: true }) });
    const data = r.data as { tables: { group: string; standings: unknown[] } };
    expect(data.tables.group).toBe('A');
    expect(data.tables.standings).toHaveLength(4);
    expect(r.text).toContain('Group A');
  });

  it('reports a clean message for an unknown group (not an empty table)', async () => {
    const r = await toolGetStandings({ group: 'Z', adapter: fakeAdapter({ throws: true }) });
    expect(r.text).toContain('No group "Z"');
    expect(r.text).not.toContain('P  W  D  L'); // no table header rendered
    expect((r.data as { tables: null }).tables).toBeNull();
  });
});
