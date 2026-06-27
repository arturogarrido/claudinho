import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  matchFlavor,
  type GroupStandings,
  type Match,
  type ProviderAdapter,
} from '@claudinho/core';
import {
  standingsResourceText,
  toolGetLive,
  toolGetNextFixture,
  toolGetStandings,
  toolGetBracket,
  toolGetToday,
} from '../src/tools';

// Fixed in-tournament clock — pin it on calls whose result is "now"-relative
// (e.g. a team's next fixture), so they don't rot as real time passes a team's
// last known fixture (knockouts are placeholders, so resolution goes null).
const TEST_NOW = new Date('2026-06-13T12:00:00Z');

function liveMatch(over: Partial<Match> = {}): Match {
  return {
    id: '760415',
    stage: 'GROUP',
    group: 'A',
    kickoff: '2026-06-11T19:00Z',
    venue: 'Estadio Banorte',
    city: 'Mexico City',
    country: 'Mexico',
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
  window?: Match[];
  throws?: boolean;
  standings?: GroupStandings[];
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
    async fetchWindow() {
      if (opts.throws) throw new Error('network down');
      return opts.window ?? opts.live ?? opts.byDate ?? [];
    },
    // Only advertise fetchStandings when given tables — so the no-standings
    // tests exercise the degraded fallback, and these exercise the live path.
    ...(opts.standings
      ? {
          async fetchStandings() {
            if (opts.throws) throw new Error('network down');
            return opts.standings as GroupStandings[];
          },
        }
      : {}),
  };
}

const A_TABLE: GroupStandings = {
  group: 'A',
  rows: [
    { team: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' }, played: 1, won: 1, drawn: 0, lost: 0, goalsFor: 2, goalsAgainst: 0, goalDiff: 2, points: 3 },
    { team: { code: 'KOR', name: 'South Korea', flag: '🇰🇷' }, played: 1, won: 1, drawn: 0, lost: 0, goalsFor: 2, goalsAgainst: 1, goalDiff: 1, points: 3 },
  ],
};

describe('toolGetLive', () => {
  it('formats live matches with score and minute + structured data', async () => {
    const r = await toolGetLive({ adapter: fakeAdapter({ live: [liveMatch()] }) });
    expect(r.text).toContain('🇲🇽 Mexico 1–0 South Africa 🇿🇦');
    expect(r.text).toContain("LIVE 67'");
    // City + country travel with the venue so the model never guesses a city.
    expect(r.text).toContain('Estadio Banorte, Mexico City, Mexico');
    expect(r.text).toContain('not affiliated');
    expect((r.data as { count: number }).count).toBe(1);
    // Structured payload carries the city too.
    expect((r.data as { matches: Match[] }).matches[0]?.city).toBe('Mexico City');
  });

  it('reports the empty state with no live matches', async () => {
    const r = await toolGetLive({ adapter: fakeAdapter({ live: [] }) });
    expect(r.text).toContain('No matches in play');
    expect((r.data as { count: number }).count).toBe(0);
  });

  it('appends commentary flair at flavor=full and omits it at flavor=off', async () => {
    const flair = matchFlavor(liveMatch(), { level: 'full' }); // goal moment, en
    expect(flair).not.toBe('');

    const full = await toolGetLive({ adapter: fakeAdapter({ live: [liveMatch()] }), flavor: 'full' });
    expect(full.text).toContain(`— ${flair}`);

    const off = await toolGetLive({ adapter: fakeAdapter({ live: [liveMatch()] }), flavor: 'off' });
    expect(off.text).not.toContain(flair);
    // Structured data is unaffected by flavor — facts stay clean.
    expect((off.data as { matches: Match[] }).matches[0]?.score).toEqual({ home: 1, away: 0 });
  });

  it('flags degraded AND says the feed is down (not "no matches in play")', async () => {
    const r = await toolGetLive({ adapter: fakeAdapter({ throws: true }) });
    expect((r.data as { degraded: boolean }).degraded).toBe(true);
    // The honesty fix: degraded must NOT read as "nothing is on".
    expect(r.text).toContain('Live scores unavailable');
    expect(r.text).not.toContain('No matches in play');
  });
});

describe('toolGetToday', () => {
  it('overlays live state onto the static schedule for the opener date', async () => {
    const r = await toolGetToday({
      date: '2026-06-11',
      tz: 'UTC', // pin grouping tz so the test is independent of the runner's zone
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
      tz: 'UTC',
      adapter: fakeAdapter({ throws: true }),
    });
    const data = r.data as { degraded: boolean; count: number };
    expect(data.degraded).toBe(true);
    expect(data.count).toBeGreaterThan(0); // static fixtures still present
    expect(r.text).toContain('Live scores unavailable'); // and it says so
  });
});

describe('toolGetNextFixture (pure static)', () => {
  it('returns the next fixture for a team code', async () => {
    const r = await toolGetNextFixture({ team: 'bra', now: TEST_NOW });
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
  // Stub the network so the real makeAdapter() path runs hermetically: the
  // adapter is built (proving resolveAdapter doesn't recurse) and degrades to
  // the static schedule — no live fetch, no flaky CI timeout.
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline (test)'))));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('toolGetStandings resolves a real adapter without recursing', async () => {
    const r = await toolGetStandings({ group: 'A' });
    expect(r.text).toContain('Group A'); // static fallback rendered
  });
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

  it('renders the authoritative table (not degraded) with attribution', async () => {
    const r = await toolGetStandings({ group: 'A', adapter: fakeAdapter({ standings: [A_TABLE] }) });
    const data = r.data as {
      degraded: boolean;
      source: string | null;
      tables: { group: string; standings: Array<{ team: { code: string }; points: number }> };
    };
    expect(data.degraded).toBe(false);
    expect(data.source).toBe('fake');
    expect(data.tables.group).toBe('A');
    expect(data.tables.standings[0]?.team.code).toBe('MEX');
    expect(data.tables.standings[0]?.points).toBe(3);
    expect(r.text).toContain('Group A');
    expect(r.text).not.toContain('Live standings unavailable');
  });
});

describe('MCP live-data attribution localizes with lang (PR #43 review fix)', () => {
  it('localizes the attribution line for today + standings when lang is set', async () => {
    const esStandings = await toolGetStandings({
      group: 'A',
      lang: 'es',
      adapter: fakeAdapter({ standings: [A_TABLE] }),
    });
    expect(esStandings.text).toContain('Datos en vivo:');
    expect(esStandings.text).not.toContain('Live data:');

    const esToday = await toolGetToday({
      date: '2026-06-11',
      tz: 'UTC',
      lang: 'es',
      adapter: fakeAdapter({ byDate: [liveMatch()] }),
    });
    expect(esToday.text).toContain('Datos en vivo:');

    // en path is unchanged.
    const enStandings = await toolGetStandings({
      group: 'A',
      lang: 'en',
      adapter: fakeAdapter({ standings: [A_TABLE] }),
    });
    expect(enStandings.text).toContain('Live data:');
  });
});

describe('toolGetBracket', () => {
  it('returns structure-only bracket when live fetch fails', async () => {
    const r = await toolGetBracket({ adapter: fakeAdapter({ throws: true }) });
    const data = r.data as { degraded: boolean; view: { stages: unknown[] } };
    expect(data.degraded).toBe(true);
    expect(data.view.stages.length).toBeGreaterThan(0);
    expect(r.text).toContain('Round of 32');
    expect(r.text).toContain('Live scores unavailable');
    expect(r.text).not.toContain('Live data:');
  });

  it('localizes bracket output when lang is es', async () => {
    const r = await toolGetBracket({ lang: 'es', adapter: fakeAdapter({ throws: true }) });
    expect(r.text).toContain('Dieciseisavos de final');
    expect(r.text).toContain('Marcadores en vivo no disponibles');
  });

  it('filters to a single stage', async () => {
    const r = await toolGetBracket({ stage: 'F', adapter: fakeAdapter({ throws: true }) });
    const data = r.data as { view: { stages: Array<{ stage: string; matches: unknown[] }> } };
    expect(data.view.stages).toHaveLength(1);
    expect(data.view.stages[0]?.stage).toBe('F');
    expect(data.view.stages[0]?.matches).toHaveLength(1);
  });

  it('honors tz for kickoff calendar dates', async () => {
    const utc = await toolGetBracket({ tz: 'UTC', adapter: fakeAdapter({ throws: true }) });
    const mx = await toolGetBracket({
      tz: 'America/Mexico_City',
      adapter: fakeAdapter({ throws: true }),
    });
    // R32 760501 kicks off 2026-07-04T01:30Z — Jul 4 UTC, Jul 3 in Mexico City.
    expect(utc.text).toContain('Jul 4, 01:30');
    expect(mx.text).toContain('Jul 3, 19:30');
  });
});

describe('standingsResourceText (standings:// resource)', () => {
  const DISCLAIMER = 'not affiliated'; // matches the get_standings tool path

  it('attributes the live provider on an authoritative table', async () => {
    const text = await standingsResourceText('a', fakeAdapter({ standings: [A_TABLE] }));
    expect(text).toContain('Group A');
    expect(text).toContain('Mexico');
    // The provider-attribution constraint: live data MUST say where it came from.
    expect(text).toContain('Live data:');
    expect(text).toContain(DISCLAIMER);
  });

  it('drops attribution but keeps the disclaimer + notice when degraded', async () => {
    const text = await standingsResourceText('A', fakeAdapter({ throws: true }));
    expect(text).not.toContain('Live data:'); // no live provider served it
    expect(text).toContain('Live standings unavailable');
    expect(text).toContain(DISCLAIMER);
  });

  it('renders a clean message for an unknown group', async () => {
    const text = await standingsResourceText('Z', fakeAdapter({ standings: [A_TABLE] }));
    expect(text).toContain('No group Z.');
    expect(text).toContain(DISCLAIMER);
  });
});
