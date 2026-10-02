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
import { runRefresh, shouldRefresh } from '../src/refresh';
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
      expect(json()).toMatchObject({ fixture: null, unsupported: true });
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
