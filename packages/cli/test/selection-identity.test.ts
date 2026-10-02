/**
 * 0.11 PR 2.0 — the CLI half of "one competition selection per request".
 *
 * The CLI's edge is option resolution (`resolveConfig`): that is where the
 * environment is read, once. Every command, the statusline, the hook and the
 * refresher then act on `cfg.competition`. These tests drive the real commands
 * (pin the CALL, not the function) with the environment saying something else.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { allFixtures, EspnAdapter, type Match, type ProviderAdapter } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CACHE_VERSION, cachePath, readState, writeState } from '../src/cache';
import { cmdHook, cmdNext, cmdPrompt, cmdRefresh, cmdToday, InputError } from '../src/commands';
import { type CliConfig, resolveConfig } from '../src/config';
import { makeT } from '../src/i18n';
import { withPersistedBackoff } from '../src/providerBackoff';
import { runRefresh, shouldRefresh, shouldRefreshFixtures } from '../src/refresh';
import { TOURNAMENT_COMPLETE_LINE } from '../src/statusline';

// The statusline and hook spawn a detached refresher; a test must never fork one.
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return {
    lang: 'en',
    tz: 'UTC',
    json: false,
    color: false,
    source: 'espn',
    flavor: 'off',
    markets: false,
    competition: 'fifa.world',
    ...over,
  };
}
const t = makeT('en');

function fakeAdapter(competition: string): ProviderAdapter {
  return {
    name: 'fake',
    competition,
    capabilities: { push: false, latencyHintSec: 0 },
    async fetchByDate(): Promise<Match[]> {
      return [];
    },
    async fetchLive(): Promise<Match[]> {
      return [];
    },
  };
}

function live(id: string, home: [string, string], away: [string, string], now: Date): Match {
  return {
    id,
    stage: 'FRIENDLY',
    kickoff: new Date(now.getTime() - 50 * 60_000).toISOString(),
    venue: 'Stadium',
    home: { code: home[0], name: home[1], flag: '🏳️' },
    away: { code: away[0], name: away[1], flag: '🏳️' },
    status: 'LIVE',
    minute: 50,
    score: { home: 1, away: 0 },
    updatedAt: now.toISOString(),
  };
}

/** A `{ok, json}` response double. */
function response(body: unknown) {
  return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, json: async () => body };
}
const season = (year: number) => ({
  year,
  startDate: `${year}-06-11T04:00Z`,
  endDate: `${year}-12-31T04:59Z`,
  displayName: `${year} FIFA World Cup`,
});

const ENV = [
  'CLAUDINHO_COMPETITION',
  'CLAUDINHO_TEAM',
  'CLAUDINHO_FLAGS',
  'CLAUDINHO_MAX',
  'CLAUDINHO_COMPACT',
  'XDG_CACHE_HOME',
] as const;
const saved: Partial<Record<(typeof ENV)[number], string | undefined>> = {};
let dir: string;
let stdout: string[] = [];
let stderr: string[] = [];
const outSpy = vi.spyOn(process.stdout, 'write');
const errSpy = vi.spyOn(process.stderr, 'write');

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  dir = mkdtempSync(join(tmpdir(), 'claudinho-selection-'));
  process.env.XDG_CACHE_HOME = dir;
  for (const k of ['CLAUDINHO_COMPETITION', 'CLAUDINHO_TEAM', 'CLAUDINHO_MAX', 'CLAUDINHO_COMPACT'] as const) {
    delete process.env[k];
  }
  process.env.CLAUDINHO_FLAGS = 'off'; // codes, so assertions read plainly
  stdout = [];
  stderr = [];
  outSpy.mockImplementation((c: unknown) => {
    stdout.push(String(c));
    return true;
  });
  errSpy.mockImplementation((c: unknown) => {
    stderr.push(String(c));
    return true;
  });
  vi.mocked(spawn).mockClear();
});
afterEach(() => {
  outSpy.mockReset();
  errSpy.mockReset();
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
const out = () => stdout.join('');
const json = () => JSON.parse(out());

// ───────────────────────────── the edge ─────────────────────────────

describe('the CLI resolves the competition once, in option resolution', () => {
  it('explicit beats the environment, the environment beats the default', () => {
    expect(resolveConfig({}).competition).toBe('fifa.world');
    process.env.CLAUDINHO_COMPETITION = 'esp.1';
    expect(resolveConfig({}).competition).toBe('esp.1');
    expect(resolveConfig({ competition: 'eng.1' }).competition).toBe('eng.1');
  });

  it('a command fetches and warns for its config’s competition, whatever the environment says', async () => {
    process.env.CLAUDINHO_COMPETITION = 'esp.1';
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: unknown) => {
      urls.push(String(url));
      return response({ leagues: [{ season: season(2026) }], events: [] });
    });
    await cmdToday('2026-10-10', { cfg: cfg({ competition: 'eng.1', json: true }), t });

    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).toContain('/soccer/eng.1/');
    expect(stderr.join('')).toContain('eng.1');
    expect(stderr.join('')).not.toContain('esp.1');
  });

  it('the statusline and the hook read the cache of their config’s competition', () => {
    process.env.CLAUDINHO_COMPETITION = 'esp.1';
    const now = new Date();
    writeState({
      updatedAt: now.toISOString(),
      live: [live('1', ['ARS', 'Arsenal'], ['CHE', 'Chelsea'], now)],
      degraded: false,
      source: 'espn',
      competition: 'eng.1',
    });
    cmdPrompt({ cfg: cfg({ competition: 'eng.1' }), t }, { cursor: undefined });
    expect(out()).toContain('ARS 1–0 CHE');

    stdout = [];
    cmdHook({ cfg: cfg({ competition: 'eng.1' }), t });
    expect(out()).toContain('Arsenal 1–0 Chelsea');
  });

  it('the refresher it spawns is told the same competition', () => {
    process.env.CLAUDINHO_COMPETITION = 'esp.1';
    // No cache at all → the statusline forks one refresher.
    cmdPrompt({ cfg: cfg({ competition: 'eng.1' }), t }, { cursor: undefined });
    expect(spawn).toHaveBeenCalledTimes(1);
    const opts = vi.mocked(spawn).mock.calls[0]?.[2] as { env?: Record<string, string> } | undefined;
    expect(opts?.env?.CLAUDINHO_COMPETITION).toBe('eng.1');
  });

  it('the World Cup sign-off is for the World Cup: another competition never says goodbye', () => {
    // Long after the final, with a fresh snapshot that holds nothing live.
    const now = new Date();
    for (const competition of ['fifa.world', 'eng.1']) {
      writeState({ updatedAt: now.toISOString(), live: [], degraded: false, source: 'espn', competition });
    }
    process.env.CLAUDINHO_COMPETITION = 'eng.1'; // the environment is not asked
    cmdPrompt({ cfg: cfg({ competition: 'fifa.world' }), t }, { cursor: undefined });
    expect(out()).toContain(TOURNAMENT_COMPLETE_LINE);

    stdout = [];
    delete process.env.CLAUDINHO_COMPETITION;
    cmdPrompt({ cfg: cfg({ competition: 'eng.1' }), t }, { cursor: undefined });
    expect(out()).not.toContain('World Cup');
    expect(out()).toContain('⚽ —');
  });

  it('a provider throttle is persisted for the adapter’s competition', async () => {
    const adapter = new EspnAdapter({
      competition: 'eng.1',
      enrichGroups: false,
      fetchImpl: (async () => ({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: { get: () => '120' },
      })) as unknown as typeof fetch,
    });
    await expect(withPersistedBackoff(adapter, 'espn').fetchByDate('2026-10-10')).rejects.toBeTruthy();
    expect(readState('espn', 'eng.1')?.backoffUntil).toBeDefined();
    expect(readState('espn', 'fifa.world')).toBeUndefined();
  });

  it('the refresh command refreshes its config’s competition', async () => {
    process.env.CLAUDINHO_COMPETITION = 'esp.1';
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: unknown) => {
      urls.push(String(url));
      return response({ leagues: [{ season: season(2026) }], events: [] });
    });
    await cmdRefresh({ cfg: cfg({ competition: 'eng.1' }), t });
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).toContain('/soccer/eng.1/');
    expect(readState('espn', 'eng.1')?.competition).toBe('eng.1');
    expect(readState('espn', 'esp.1')).toBeUndefined();
    expect(readState('espn', 'fifa.world')).toBeUndefined();
  });

  it('refresh triggers take the competition as an argument', () => {
    const PRE_WC = new Date('2026-06-04T16:00:00Z').getTime(); // no World Cup window
    // Off the bundle nothing describes the windows, so a stale cache refreshes…
    expect(shouldRefresh(PRE_WC, undefined, 'eng.1')).toBe(true);
    // …and the environment cannot turn the World Cup's schedule gate off.
    process.env.CLAUDINHO_COMPETITION = 'eng.1';
    expect(shouldRefresh(PRE_WC, undefined, 'fifa.world')).toBe(false);
  });
});

// ───────────────────────────── team arguments ─────────────────────────────

describe('team arguments under the World Cup behave exactly as before', () => {
  const ctx = () => ({ cfg: cfg({ json: true }), t, adapter: fakeAdapter('fifa.world') });

  it.each([
    ['Mexico', 'MEX'],
    ['mex', 'MEX'],
    ['DR Congo', 'COD'],
    ['Türkiye', 'TUR'],
  ])('`next %s` answers for %s', async (query, code) => {
    await cmdNext(query, ctx());
    expect(json().team).toBe(code);
  });

  it('an ambiguous name errors with its candidates instead of guessing', async () => {
    await expect(cmdNext('south', ctx())).rejects.toThrow(InputError);
    await expect(cmdNext('south', ctx())).rejects.toThrow(/South Africa \(RSA\).*South Korea \(KOR\)/);
  });

  it('CLAUDINHO_TEAM by name filters the statusline and leads the hook', () => {
    const now = new Date();
    writeState({
      updatedAt: now.toISOString(),
      live: [
        live('1', ['CAN', 'Canada'], ['QAT', 'Qatar'], now),
        live('2', ['MEX', 'Mexico'], ['RSA', 'South Africa'], now),
      ],
      degraded: false,
      source: 'espn',
      competition: 'fifa.world',
    });
    process.env.CLAUDINHO_TEAM = 'mexico';
    cmdPrompt({ cfg: cfg(), t }, { cursor: undefined });
    expect(out()).toContain('MEX 1–0 RSA');
    expect(out()).not.toContain('CAN');

    stdout = [];
    cmdHook({ cfg: cfg(), t });
    const lines = out().split('\n');
    expect(lines[1]).toContain('Mexico');
  });
});

describe.each(['eng.1', 'uefa.nations', 'concacaf.nations.league'])(
  'off the bundle (%s) the World Cup roster is never consulted',
  (competition) => {
    // Environment and config agree here, so a failure is about the roster and
    // nothing else.
    beforeEach(() => {
      process.env.CLAUDINHO_COMPETITION = competition;
    });
    const ctx = () => ({ cfg: cfg({ competition, json: true }), t, adapter: fakeAdapter(competition) });

    it('`next ALA` is not New Zealand, `next rac` is not Curaçao', async () => {
      await cmdNext('ALA', ctx());
      expect(json()).toMatchObject({ team: 'ALA', fixture: null, unsupported: true });
      expect(out()).not.toMatch(/NZL|New Zealand/);

      stdout = [];
      await cmdNext('rac', ctx());
      expect(json()).toMatchObject({ team: 'RAC', unsupported: true });
      expect(out()).not.toMatch(/CUW|Cura/);
    });

    it('a name gets the honest "not available yet", not a World Cup lookup error', async () => {
      await cmdNext('Arsenal', ctx());
      expect(json()).toMatchObject({ team: 'Arsenal', fixture: null, unsupported: true });
    });

    it('an argument with nothing readable in it is no team at all', async () => {
      // Zero-width characters only: the label role reduces it to nothing.
      await expect(cmdNext('\u200b\u200b\u200b\u200b', ctx())).rejects.toThrow(InputError);
    });

    it('CLAUDINHO_TEAM=ala filters by ALA, not by New Zealand', () => {
      const now = new Date();
      writeState({
        updatedAt: now.toISOString(),
        live: [
          live('1', ['GIR', 'Girona'], ['SEV', 'Sevilla'], now),
          live('2', ['ALA', 'Alavés'], ['BAR', 'Barcelona'], now),
        ],
        degraded: false,
        source: 'espn',
        competition,
      });
      process.env.CLAUDINHO_TEAM = 'ala';
      cmdPrompt({ cfg: cfg({ competition }), t }, { cursor: undefined });
      expect(out()).toContain('ALA 1–0 BAR');
      expect(out()).not.toContain('GIR');

      stdout = [];
      cmdHook({ cfg: cfg({ competition }), t });
      expect(out().split('\n')[1]).toContain('Alavés');
    });
  },
);

describe('a Nations League keeps nations as nations', () => {
  it('teams keep their feed names and their generated flags', () => {
    process.env.CLAUDINHO_COMPETITION = 'concacaf.nations.league';
    process.env.CLAUDINHO_FLAGS = 'on';
    const now = new Date();
    const m = live('1', ['MEX', 'Mexico'], ['USA', 'United States'], now);
    writeState({
      updatedAt: now.toISOString(),
      live: [{ ...m, home: { ...m.home, flag: '🇲🇽' }, away: { ...m.away, flag: '🇺🇸' } }],
      degraded: false,
      source: 'espn',
      competition: 'concacaf.nations.league',
    });
    cmdHook({ cfg: cfg({ competition: 'concacaf.nations.league' }), t });
    expect(out()).toContain('🇲🇽 Mexico 1–0 United States 🇺🇸');
  });
});

// ───────────────────────────── the cache ─────────────────────────────

describe('a cache written by 0.10.1 is an empty cache', () => {
  /** 0.10.1's schema version. Literal on purpose: this is about THAT format. */
  const V2 = 2;

  it('the statusline shows nothing from it and never touches the network', () => {
    let fetches = 0;
    vi.stubGlobal('fetch', async () => {
      fetches++;
      return response({});
    });
    const now = new Date();
    const path = cachePath('espn', 'fifa.world');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        version: V2,
        updatedAt: now.toISOString(),
        live: [live('1', ['MEX', 'Mexico'], ['RSA', 'South Africa'], now)],
        degraded: false,
        source: 'espn',
        competition: 'fifa.world',
      }),
    );
    expect(readState('espn', 'fifa.world')).toBeUndefined();

    cmdPrompt({ cfg: cfg(), t }, { cursor: undefined });
    expect(out()).not.toContain('MEX 1–0 RSA');
    expect(fetches).toBe(0);
  });

  it('the refresher writes the new format', async () => {
    expect(CACHE_VERSION).toBeGreaterThan(V2);
    vi.stubGlobal('fetch', async () => response({ leagues: [{ season: season(2026) }], events: [] }));
    await runRefresh({
      source: 'espn',
      competition: 'fifa.world',
      now: new Date('2026-06-11T19:30:00Z'), // the opener is in play
      jitterMs: 0,
    });
    expect(readState('espn', 'fifa.world')?.version).toBe(CACHE_VERSION);
  });
});

describe('season in the cache', () => {
  /** The knockout span (Jun 28 to Jul 19) as the adapter asks for it: a month at a time. */
  const KNOCKOUT_MONTH = /dates=20260[67](&|$)/;
  const OPENER_LIVE = new Date('2026-06-11T19:30:00Z');
  const knockout = allFixtures().find((m) => m.stage === 'F');
  const carried: Match = {
    ...(knockout as Match),
    home: { code: 'ESP', name: 'Spain', flag: '🇪🇸' },
    away: { code: 'ARG', name: 'Argentina', flag: '🇦🇷' },
  };

  function seed(year: number) {
    writeState({
      // Stale enough that the live slice is due; the fixtures slice is fresh.
      updatedAt: new Date(OPENER_LIVE.getTime() - 60_000).toISOString(),
      live: [],
      degraded: false,
      source: 'espn',
      competition: 'fifa.world',
      fixtures: [carried],
      fixturesUpdatedAt: OPENER_LIVE.toISOString(),
      season: {
        year,
        label: `${year} FIFA World Cup`,
        startDate: `${year}-06-11T04:00:00.000Z`,
        endDate: `${year}-12-31T04:59:00.000Z`,
      },
      // The slice records the season of the response that produced it.
      fixturesSeason: { year, label: `${year} FIFA World Cup` },
    });
  }
  const refresh = (year: number) => {
    vi.stubGlobal('fetch', async () => response({ leagues: [{ season: season(year) }], events: [] }));
    return runRefresh({ source: 'espn', competition: 'fifa.world', now: OPENER_LIVE, jitterMs: 0 });
  };

  it('a refresh records the season its response reported', async () => {
    await refresh(2026);
    expect(readState('espn', 'fifa.world')?.season).toMatchObject({ year: 2026, label: '2026 FIFA World Cup' });
  });

  it('the same season keeps the slice it did not refresh', async () => {
    seed(2026);
    await refresh(2026);
    expect(readState('espn', 'fifa.world')?.fixtures).toHaveLength(1);
  });

  it('a different season replaces the cached state whole: nothing is merged across seasons', async () => {
    seed(2026);
    await refresh(2030);
    const state = readState('espn', 'fifa.world');
    expect(state?.season?.year).toBe(2030);
    expect(state?.fixtures).toBeUndefined();
    expect(state?.fixturesUpdatedAt).toBeUndefined();
  });

  it('a response that states no readable season does not inherit the cached one', async () => {
    // Found in review: `season` started from the cache and was replaced only
    // when the new response HAD one, so fresh live data was published under the
    // previous response's season. The stored season describes the response that
    // last refreshed `live`; when that response states none, none is stored.
    seed(2026);
    vi.stubGlobal('fetch', async () =>
      response({ leagues: [{ season: { year: '2030' } }], events: [] }),
    );
    await runRefresh({ source: 'espn', competition: 'fifa.world', now: OPENER_LIVE, jitterMs: 0 });
    const state = readState('espn', 'fifa.world');
    expect(state?.degraded).toBe(false);
    expect(state?.updatedAt).toBe(OPENER_LIVE.toISOString());
    expect(state?.season).toBeUndefined();
    // Unknown is not "different": nothing says the edition changed, so the
    // slice this cycle did not refetch is still carried.
    expect(state?.fixtures).toHaveLength(1);
  });

  it('a carried slice keeps its OWN season across cycles, even while the live season is unknown', async () => {
    // Found in review of the fix above: the fixtures' season was re-derived
    // each cycle from the snapshot's (live) season. One live response with no
    // readable season cleared it; the next, readable and DIFFERENT, then found
    // nothing to compare the carried fixtures against and kept them.
    seed(2026);
    vi.stubGlobal('fetch', async () => response({ leagues: [{ season: { year: '2030' } }], events: [] }));
    await runRefresh({ source: 'espn', competition: 'fifa.world', now: OPENER_LIVE, jitterMs: 0 });
    const between = readState('espn', 'fifa.world');
    expect(between?.season).toBeUndefined();
    expect(between?.fixtures).toHaveLength(1);
    expect(between?.fixturesSeason?.year).toBe(2026); // its provenance survives

    vi.stubGlobal('fetch', async () => response({ leagues: [{ season: season(2030) }], events: [] }));
    await runRefresh({
      source: 'espn',
      competition: 'fifa.world',
      now: new Date(OPENER_LIVE.getTime() + 20_000),
      jitterMs: 0,
    });
    const after = readState('espn', 'fifa.world');
    expect(after?.season?.year).toBe(2030);
    expect(after?.fixtures).toBeUndefined();
    expect(after?.fixturesSeason).toBeUndefined();
  });

  it('a failed live fetch keeps the season the snapshot was written for', async () => {
    seed(2026);
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline');
    });
    await runRefresh({ source: 'espn', competition: 'fifa.world', now: OPENER_LIVE, jitterMs: 0 });
    const state = readState('espn', 'fifa.world');
    expect(state?.degraded).toBe(true);
    expect(state?.season?.year).toBe(2026);
  });

  it('a slice the same cycle refetched is the new season’s, and is kept', async () => {
    // A semi-final is in play and the next fixtures are knockouts, so this
    // cycle refetches BOTH slices; the fixtures it just read are not "carried".
    const SEMI_LIVE = new Date('2026-07-14T19:30:00Z');
    writeState({
      updatedAt: new Date(SEMI_LIVE.getTime() - 60_000).toISOString(),
      live: [],
      degraded: false,
      source: 'espn',
      competition: 'fifa.world',
      fixtures: [carried],
      season: { year: 2026, label: '2026 FIFA World Cup' },
      fixturesSeason: { year: 2026, label: '2026 FIFA World Cup' },
    });
    const final = {
      id: '760517',
      date: '2026-07-19T19:00Z',
      season: { slug: 'final' },
      status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
      competitions: [
        {
          competitors: [
            { homeAway: 'home', team: { id: '164', abbreviation: 'ESP', displayName: 'Spain' } },
            { homeAway: 'away', team: { id: '202', abbreviation: 'ARG', displayName: 'Argentina' } },
          ],
        },
      ],
    };
    vi.stubGlobal('fetch', async () => response({ leagues: [{ season: season(2030) }], events: [final] }));
    await runRefresh({ source: 'espn', competition: 'fifa.world', now: SEMI_LIVE, jitterMs: 0 });

    const state = readState('espn', 'fifa.world');
    expect(state?.season?.year).toBe(2030);
    expect(state?.fixtures?.map((m) => m.id)).toEqual(['760517']);
    expect(state?.fixtures?.[0]?.home.id).toBe('espn:164');
    expect(state?.fixturesSeason?.year).toBe(2030);
  });

  it('a refetched slice is kept only if ITS response is the same season', async () => {
    // Found in review: a slice the cycle refetched was exempt from the
    // rollover whatever season its own response reported. An old binary in a
    // new edition is exactly this: the live window answers for 2030, while the
    // bundle's knockout window (2026 dates) answers for 2026 — and the cache
    // then said "2030" while holding the 2026 final as the next match.
    const SEMI_LIVE = new Date('2026-07-14T19:30:00Z');
    writeState({
      updatedAt: new Date(SEMI_LIVE.getTime() - 60_000).toISOString(),
      live: [],
      degraded: false,
      source: 'espn',
      competition: 'fifa.world',
      season: { year: 2026, label: '2026 FIFA World Cup' },
    });
    const final2026 = {
      id: '760517',
      date: '2026-07-19T19:00Z',
      season: { slug: 'final' },
      status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
      competitions: [
        {
          competitors: [
            { homeAway: 'home', team: { id: '164', abbreviation: 'ESP', displayName: 'Spain' } },
            { homeAway: 'away', team: { id: '202', abbreviation: 'ARG', displayName: 'Argentina' } },
          ],
        },
      ],
    };
    vi.stubGlobal('fetch', async (url: unknown) =>
      // The knockout span is asked a month at a time (June, July); the live
      // window is the days around "now".
      KNOCKOUT_MONTH.test(String(url))
        ? response({ leagues: [{ season: season(2026) }], events: [final2026] })
        : response({ leagues: [{ season: season(2030) }], events: [] }),
    );
    await runRefresh({ source: 'espn', competition: 'fifa.world', now: SEMI_LIVE, jitterMs: 0 });

    const state = readState('espn', 'fifa.world');
    expect(state?.season?.year).toBe(2030);
    expect(state?.fixtures).toBeUndefined();
    expect(state?.fixturesUpdatedAt).toBeUndefined();
  });

  it('a slice dropped for its season is asked for again on the empty cadence, not on every prompt', async () => {
    // Found in review: the drop also erased the ATTEMPT stamp, and a cache with
    // neither stamp is "infinitely stale" — so while the disagreement lasted
    // (an old binary in a new edition: it lasts until the user upgrades) every
    // statusline or hook tick fetched the knockout window again. The attempt
    // happened; the cadence that follows a fetch with nothing to keep applies.
    const SEMI_LIVE = new Date('2026-07-14T19:30:00Z');
    writeState({
      updatedAt: new Date(SEMI_LIVE.getTime() - 60_000).toISOString(),
      live: [],
      degraded: false,
      source: 'espn',
      competition: 'fifa.world',
      season: { year: 2026, label: '2026 FIFA World Cup' },
    });
    let knockoutRequests = 0;
    vi.stubGlobal('fetch', async (url: unknown) => {
      if (KNOCKOUT_MONTH.test(String(url))) {
        knockoutRequests++;
        return response({ leagues: [{ season: season(2026) }], events: [] });
      }
      return response({ leagues: [{ season: season(2030) }], events: [] });
    });
    await runRefresh({ source: 'espn', competition: 'fifa.world', now: SEMI_LIVE, jitterMs: 0 });
    expect(knockoutRequests).toBe(2); // one ask of the span: its two months
    const state = readState('espn', 'fifa.world');
    expect(state?.fixtures).toBeUndefined();
    expect(state?.fixturesAttemptedAt).toBe(SEMI_LIVE.toISOString());

    // The next prompt, seconds later: no trigger, and a refresher that runs
    // anyway (the live slice has its own clock) leaves the window alone.
    const soon = SEMI_LIVE.getTime() + 20_000;
    expect(shouldRefreshFixtures(soon, state, 'fifa.world')).toBe(false);
    await runRefresh({ source: 'espn', competition: 'fifa.world', now: new Date(soon), jitterMs: 0 });
    expect(knockoutRequests).toBe(2);

    // Past the empty cadence it is asked for again — the disagreement is
    // retried, not cached as a conclusion.
    const later = SEMI_LIVE.getTime() + 61_000;
    expect(shouldRefreshFixtures(later, readState('espn', 'fifa.world'), 'fifa.world')).toBe(true);
    await runRefresh({ source: 'espn', competition: 'fifa.world', now: new Date(later), jitterMs: 0 });
    expect(knockoutRequests).toBe(4); // asked once more
  });

  it('a CARRIED slice dropped at a rollover is asked for on the next prompt', async () => {
    // The other side of the rule above: keeping the attempt stamp must not
    // delay a real rollover. The carried slice was fetched ten minutes ago, so
    // this cycle refreshes only the live slice; the live response says 2030,
    // the slice goes, and its ten-minute-old attempt no longer holds anyone back.
    const SEMI_LIVE = new Date('2026-07-14T19:30:00Z');
    const fetchedAt = new Date(SEMI_LIVE.getTime() - 10 * 60_000).toISOString();
    writeState({
      updatedAt: new Date(SEMI_LIVE.getTime() - 60_000).toISOString(),
      live: [],
      degraded: false,
      source: 'espn',
      competition: 'fifa.world',
      fixtures: [carried],
      fixturesUpdatedAt: fetchedAt,
      fixturesAttemptedAt: fetchedAt,
      season: { year: 2026, label: '2026 FIFA World Cup' },
      fixturesSeason: { year: 2026, label: '2026 FIFA World Cup' },
    });
    let knockoutRequests = 0;
    vi.stubGlobal('fetch', async (url: unknown) => {
      if (KNOCKOUT_MONTH.test(String(url))) knockoutRequests++;
      return response({ leagues: [{ season: season(2030) }], events: [] });
    });
    await runRefresh({ source: 'espn', competition: 'fifa.world', now: SEMI_LIVE, jitterMs: 0 });
    expect(knockoutRequests).toBe(0); // the slice was fresh: this cycle did not ask
    const state = readState('espn', 'fifa.world');
    expect(state?.fixtures).toBeUndefined();
    expect(state?.fixturesAttemptedAt).toBe(fetchedAt);
    expect(shouldRefreshFixtures(SEMI_LIVE.getTime() + 1_000, state, 'fifa.world')).toBe(true);
  });

  describe('an answer that left a record out cannot erase what the slice already held', () => {
    // Found in the plan review of the windows change: a knockout answer with a
    // record the parser refused is still a successful fetch, and the refresher
    // replaced the slice with it. A tie the answer could not read then
    // vanished from the countdown, though nothing said it was gone.
    const SEMI_LIVE = new Date('2026-07-14T19:30:00Z');
    const third = allFixtures().find((m) => m.stage === '3P') as Match;
    const heldThird: Match = {
      ...third,
      home: { code: 'FRA', name: 'France', flag: '🇫🇷' },
      away: { code: 'BRA', name: 'Brazil', flag: '🇧🇷' },
    };
    // A semi-final already under way when the refresh runs: not "still to be played".
    const semi = allFixtures().find((m) => m.stage === 'SF') as Match;
    const played: Match = {
      ...semi,
      kickoff: '2026-07-14T19:00:00.000Z',
      home: { code: 'ESP', name: 'Spain', flag: '🇪🇸' },
      away: { code: 'FRA', name: 'France', flag: '🇫🇷' },
    };
    const raw = (id: string, date: string, slug: string, home: [string, string, string], away: [string, string, string], status = { type: { name: 'STATUS_SCHEDULED', state: 'pre' } }) => ({
      id,
      date,
      season: { slug },
      status,
      competitions: [
        {
          competitors: [
            { homeAway: 'home', team: { id: home[0], abbreviation: home[1], displayName: home[2] } },
            { homeAway: 'away', team: { id: away[0], abbreviation: away[1], displayName: away[2] } },
          ],
        },
      ],
    });
    const final = raw('760517', '2026-07-19T19:00Z', 'final', ['164', 'ESP', 'Spain'], ['202', 'ARG', 'Argentina']);
    // The third-place match, with a status the parser does not know: refused.
    const unreadable = raw(third.id, '2026-07-18T19:00Z', '3rd-place-match', ['478', 'FRA', 'France'], ['205', 'BRA', 'Brazil'], {
      type: { name: 'STATUS_SOMETHING_NEW', state: 'limbo' },
    });
    const OLD = new Date(SEMI_LIVE.getTime() - 20 * 60_000).toISOString();
    function seedSlice(
      liveSeason: { year: number; label: string } | null = { year: 2026, label: '2026 FIFA World Cup' },
      sliceSeason: { year: number; label: string } | null = { year: 2026, label: '2026 FIFA World Cup' },
    ) {
      const old = OLD;
      writeState({
        updatedAt: SEMI_LIVE.toISOString(), // live is fresh: this cycle refreshes the slice only
        live: [],
        degraded: false,
        source: 'espn',
        competition: 'fifa.world',
        fixtures: [played, heldThird, carried].sort((a, b) => a.kickoff.localeCompare(b.kickoff)),
        fixturesUpdatedAt: old,
        fixturesAttemptedAt: old,
        ...(liveSeason ? { season: liveSeason } : {}),
        ...(sliceSeason ? { fixturesSeason: sliceSeason } : {}),
      });
    }
    const july = (events: unknown[]) =>
      vi.stubGlobal('fetch', async (url: unknown) =>
        response({ leagues: [{ season: season(2026) }], events: /dates=202607(&|$)/.test(String(url)) ? events : [] }),
      );

    it('the fixture it does not mention stays, beside the ones it does', async () => {
      seedSlice();
      july([final, unreadable]);
      await runRefresh({ source: 'espn', competition: 'fifa.world', now: SEMI_LIVE, jitterMs: 0 });
      const state = readState('espn', 'fifa.world');
      // Kept: the tie still to be played. Not kept: the one that has kicked off.
      expect(state?.fixtures?.map((m) => m.id)).toEqual([third.id, '760517']);
      expect(state?.fixtures?.map((m) => m.id)).not.toContain(semi.id);
      expect(state?.fixtures?.[0]?.home.name).toBe('France'); // the one that was held
      expect(state?.fixtures?.[1]?.home.id).toBe('espn:164'); // the one just read
      expect(state?.fixturesUpdatedAt).toBe(SEMI_LIVE.toISOString());
    });

    it('a WHOLE answer replaces the slice: what it does not mention is gone', async () => {
      seedSlice();
      july([final]);
      await runRefresh({ source: 'espn', competition: 'fifa.world', now: SEMI_LIVE, jitterMs: 0 });
      expect(readState('espn', 'fifa.world')?.fixtures?.map((m) => m.id)).toEqual(['760517']);
    });

    it('a tie the answer READ and set aside is not put back: postponed, cancelled', async () => {
      // Found in review. "Not mentioned" was asked of the list of upcoming,
      // resolved ties, so a tie the provider had just postponed looked
      // unmentioned and its old scheduled copy returned to the countdown.
      for (const name of ['STATUS_POSTPONED', 'STATUS_CANCELED']) {
        seedSlice();
        const setAside = raw(third.id, '2026-07-18T19:00Z', '3rd-place-match', ['478', 'FRA', 'France'], ['205', 'BRA', 'Brazil'], {
          type: { name, state: 'pre' },
        });
        // An unrelated record nobody can read keeps the answer incomplete.
        const stranger = raw('760599', '2026-07-16T19:00Z', 'semifinals', ['164', 'ESP', 'Spain'], ['478', 'FRA', 'France'], {
          type: { name: 'STATUS_SOMETHING_NEW', state: 'limbo' },
        });
        july([final, setAside, stranger]);
        await runRefresh({ source: 'espn', competition: 'fifa.world', now: SEMI_LIVE, jitterMs: 0 });
        expect(readState('espn', 'fifa.world')?.fixtures?.map((m) => m.id), name).toEqual(['760517']);
      }
    });

    describe('when either season is unknown, an incomplete answer is no answer: the slice stands as it was', () => {
      // Found in review. Without both seasons nothing can be merged (the two
      // could be different editions), and the answer replaced the slice: a
      // known final was erased by an answer that had not read July.
      const group = raw('760420', '2026-06-20T19:00Z', 'group-stage', ['203', 'MEX', 'Mexico'], ['467', 'RSA', 'South Africa']);
      const answer = (leagues: unknown[]) =>
        vi.stubGlobal('fetch', async (url: unknown) =>
          response({ leagues, events: /dates=202607(&|$)/.test(String(url)) ? [unreadable] : [group] }),
        );
      const held = () => [played, heldThird, carried].sort((a, b) => a.kickoff.localeCompare(b.kickoff)).map((m) => m.id);

      it('the answer states no season', async () => {
        seedSlice();
        answer([{}]);
        await runRefresh({ source: 'espn', competition: 'fifa.world', now: SEMI_LIVE, jitterMs: 0 });
        const state = readState('espn', 'fifa.world');
        expect(state?.fixtures?.map((m) => m.id)).toEqual(held());
        expect(state?.fixturesSeason?.year).toBe(2026);
        // Not a success: the slice keeps its stamp, and the attempt is what paces the next ask.
        expect(state?.fixturesUpdatedAt).toBe(OLD);
        expect(state?.fixturesAttemptedAt).toBe(SEMI_LIVE.toISOString());
      });

      it('the slice was stored with none', async () => {
        seedSlice(null, null);
        answer([{ season: season(2026) }]);
        await runRefresh({ source: 'espn', competition: 'fifa.world', now: SEMI_LIVE, jitterMs: 0 });
        const state = readState('espn', 'fifa.world');
        expect(state?.fixtures?.map((m) => m.id)).toEqual(held());
        expect(state?.fixturesUpdatedAt).toBe(OLD);
      });

      it('an EMPTY slice has nothing to lose: the incomplete answer is taken', async () => {
        writeState({
          updatedAt: SEMI_LIVE.toISOString(),
          live: [],
          degraded: false,
          source: 'espn',
          competition: 'fifa.world',
          fixtures: [],
          fixturesUpdatedAt: OLD,
          fixturesAttemptedAt: OLD,
        });
        vi.stubGlobal('fetch', async (url: unknown) =>
          response({ leagues: [{}], events: /dates=202607(&|$)/.test(String(url)) ? [final, unreadable] : [] }),
        );
        await runRefresh({ source: 'espn', competition: 'fifa.world', now: SEMI_LIVE, jitterMs: 0 });
        const state = readState('espn', 'fifa.world');
        expect(state?.fixtures?.map((m) => m.id)).toEqual(['760517']);
        expect(state?.fixturesUpdatedAt).toBe(SEMI_LIVE.toISOString());
      });
    });

    it('and nothing is kept from a slice of ANOTHER season: that answer replaces it', async () => {
      // The snapshot's live season is unknown here, so the rollover rule below
      // the union has nothing to compare: only the union's own rule can refuse.
      seedSlice(null);
      vi.stubGlobal('fetch', async (url: unknown) =>
        response({ leagues: [{ season: season(2030) }], events: /dates=202607(&|$)/.test(String(url)) ? [final, unreadable] : [] }),
      );
      await runRefresh({ source: 'espn', competition: 'fifa.world', now: SEMI_LIVE, jitterMs: 0 });
      // The answer is 2030's; the held third-place tie was 2026's.
      const state = readState('espn', 'fifa.world');
      expect(state?.fixtures?.map((m) => m.id)).toEqual(['760517']);
      expect(state?.fixturesSeason?.year).toBe(2030);
    });
  });

  it('a throttle that arrives after a sibling request failed is persisted, and the next refresh asks nothing', async () => {
    // A live read is three day requests, sent together. If the window answered
    // on the first failure, the refresher would publish with no backoff while
    // a 429 was still on its way.
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (url: unknown) => {
      const u = String(url);
      requests.push(u);
      if (/dates=20260610(&|$)/.test(u)) return { ok: false, status: 500, statusText: 'Server Error', headers: { get: () => null } };
      if (/dates=20260612(&|$)/.test(u)) {
        await new Promise((r) => setTimeout(r, 30));
        return { ok: false, status: 429, statusText: 'Too Many Requests', headers: { get: (n: string) => (n.toLowerCase() === 'retry-after' ? '600' : null) } };
      }
      return response({ leagues: [{ season: season(2026) }], events: [] });
    });
    await runRefresh({ source: 'espn', competition: 'fifa.world', now: OPENER_LIVE, jitterMs: 0 });
    expect(requests).toHaveLength(3);
    const state = readState('espn', 'fifa.world');
    expect(state?.degraded).toBe(true);
    expect(Date.parse(state?.backoffUntil ?? '')).toBeGreaterThanOrEqual(OPENER_LIVE.getTime() + 600_000);
    // The next refresher, twenty seconds later, honours it.
    await runRefresh({ source: 'espn', competition: 'fifa.world', now: new Date(OPENER_LIVE.getTime() + 20_000), jitterMs: 0 });
    expect(requests).toHaveLength(3);
  });

  it('a dated query never writes the live cache', async () => {
    await cmdToday('2026-06-11', {
      cfg: cfg({ json: true }),
      t,
      adapter: fakeAdapter('fifa.world'),
    });
    expect(readState('espn', 'fifa.world')).toBeUndefined();
  });
});
