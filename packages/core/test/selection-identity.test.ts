/**
 * 0.11 PR 2.0 — one competition selection per request, stable team identity.
 *
 * Three properties, each of which a later PR builds on:
 *
 *   SELECTION  the competition a request is for is decided ONCE, at the edge,
 *              and carried by the adapter built for it. Nothing below the edge
 *              reads the environment again, so a request cannot change its mind
 *              halfway through (24 call sites used to re-resolve it).
 *   IDENTITY   a team from the feed carries the provider's stable id, on the
 *              live path and the cache path alike. A code is a display label.
 *   METADATA   what the provider said ABOUT a response (its season) travels
 *              with that response, never on a field shared between calls.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EspnAdapter } from '../src/adapters/espn';
import { attachFetchMeta, fetchMeta } from '../src/adapters/meta';
import type { ProviderAdapter } from '../src/adapters/types';
import { bundleApplies } from '../src/competition';
import { getKnockoutFixtures, getLiveMatches, getMatchesForDate, makeAdapter } from '../src/live';
import { FakeMarketProvider } from '../src/markets/fake';
import { PolymarketProvider } from '../src/markets/polymarket';
import { makeMarketProvider } from '../src/markets/provider';
import { allFixtures } from '../src/schedule';
import { parseCachedMatch, parseEspnEvent, parseEspnSeason, parseEspnStandings } from '../src/trust';
import type { Match } from '../src/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGES = join(HERE, '..', '..');

const ENV = ['CLAUDINHO_COMPETITION', 'CLAUDINHO_MARKETS_SOURCE'] as const;
const saved: Partial<Record<(typeof ENV)[number], string | undefined>> = {};
beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  delete process.env.CLAUDINHO_COMPETITION;
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** The cache file is JSON on disk; a round trip is exactly what happens. */
const roundTrip = <T>(v: T): unknown => JSON.parse(JSON.stringify(v));

/** A `{ok, json}` response double (the adapter's no-stream fallback reads it). */
function response(body: unknown) {
  return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, json: async () => body };
}

const SEASON_2026 = {
  year: 2026,
  startDate: '2026-06-01T04:00Z',
  endDate: '2027-06-01T03:59Z',
  displayName: '2026-27 English Premier League',
  type: { id: '1', name: '2026-27 English Premier League' },
};
const SEASON_2024 = {
  year: 2024,
  startDate: '2024-06-01T04:00Z',
  endDate: '2025-06-01T03:59Z',
  displayName: '2024-25 English Premier League',
  type: { id: '1', name: '2024-25 English Premier League' },
};

type RawTeam = { id?: unknown; abbreviation: string; displayName: string };
function event(id: string, date: string, home: RawTeam, away: RawTeam, slug = 'regular-season') {
  return {
    id,
    date,
    season: { slug },
    status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
    competitions: [
      {
        competitors: [
          { homeAway: 'home', team: home },
          { homeAway: 'away', team: away },
        ],
      },
    ],
  };
}
const ARSENAL: RawTeam = { id: '359', abbreviation: 'ARS', displayName: 'Arsenal' };
const CHELSEA: RawTeam = { id: '363', abbreviation: 'CHE', displayName: 'Chelsea' };

function scoreboard(season: unknown, events: unknown[]) {
  return { leagues: [{ season }], events };
}

/** A minimal non-ESPN adapter that states the competition it serves. */
function fakeAdapter(competition: string, over: Partial<ProviderAdapter> = {}): ProviderAdapter {
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
    ...over,
  };
}

function seal(parts: unknown): Match {
  const r = parseCachedMatch(parts);
  if (r.kind !== 'valid') throw new Error(`expected a valid match, got ${r.kind}`);
  return r.value;
}

// ───────────────────────────── selection ─────────────────────────────

describe('selection — decided once, at the edge', () => {
  it('an adapter built for one competition never asks the environment again', async () => {
    process.env.CLAUDINHO_COMPETITION = 'esp.1';
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: unknown) => {
      urls.push(String(url));
      return response(scoreboard(SEASON_2026, []));
    });
    const adapter = makeAdapter('espn', { competition: 'eng.1', enrichGroups: false });
    await getMatchesForDate(adapter, '2026-10-10');
    // The environment changes while the "request" is still running.
    process.env.CLAUDINHO_COMPETITION = 'ita.1';
    await getLiveMatches(adapter, new Date('2026-10-10T12:00:00Z'));

    expect(adapter.competition).toBe('eng.1');
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).toContain('/soccer/eng.1/');
  });

  it('whether the bundle applies is the adapter’s competition, not the environment', async () => {
    // Environment says World Cup (the default); the adapter serves a league.
    const league = await getMatchesForDate(fakeAdapter('eng.1'), '2026-06-11');
    expect(league.matches).toEqual([]);

    // Environment says a league; the adapter serves the World Cup.
    process.env.CLAUDINHO_COMPETITION = 'eng.1';
    const worldCup = await getMatchesForDate(fakeAdapter('fifa.world'), '2026-06-11');
    expect(worldCup.matches.length).toBe(allFixtures().length);
  });

  it('the bundle question takes the competition as an argument', () => {
    process.env.CLAUDINHO_COMPETITION = 'eng.1';
    expect(bundleApplies('fifa.world')).toBe(true);
    delete process.env.CLAUDINHO_COMPETITION;
    expect(bundleApplies('eng.1')).toBe(false);
    expect(bundleApplies('uefa.nations')).toBe(false);
  });

  it('the market sidecar is gated by the competition it is given', () => {
    process.env.CLAUDINHO_MARKETS_SOURCE = 'polymarket';
    // The environment says World Cup; the request is for a league.
    expect(makeMarketProvider(undefined, 'eng.1')).toBeInstanceOf(FakeMarketProvider);
    // The environment says a league; the request is for the World Cup.
    process.env.CLAUDINHO_COMPETITION = 'eng.1';
    expect(makeMarketProvider(undefined, 'fifa.world')).toBeInstanceOf(PolymarketProvider);
  });

  // The structural half: a test that only looked for `process.env` would have
  // passed BEFORE this change (the environment was already read in one
  // function) while 24 call sites still re-resolved the competition with no
  // argument. So this pins the calls.
  describe('nothing below the edge resolves the competition', () => {
    function sources(dir: string): string[] {
      return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sources(path);
        return /\.(ts|tsx|mts)$/.test(name) ? [path] : [];
      });
    }
    function callSites(pkg: string, pattern: RegExp): string[] {
      const out: string[] = [];
      for (const file of sources(join(PACKAGES, pkg, 'src'))) {
        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, i) => {
          const code = line.replace(/\/\/.*$/, '');
          if (/^\s*(\*|\/\*)/.test(line)) return; // doc comments
          if (/export function resolveCompetition\b/.test(code)) return; // the definition
          // Forward slashes on every platform, so the expectations below hold on Windows.
          if (pattern.test(code)) out.push(`${relative(PACKAGES, file).split(sep).join('/')}:${i + 1}`);
        });
      }
      return out;
    }

    it('core never calls resolveCompetition', () => {
      expect(callSites('core', /\bresolveCompetition\(/)).toEqual([]);
    });

    it('the CLI resolves it once, in option resolution', () => {
      const sites = callSites('cli', /\bresolveCompetition\(/);
      expect(sites.map((s) => s.replace(/:\d+$/, ''))).toEqual(['cli/src/config.ts']);
    });

    it('the MCP server resolves it once, where it builds the request’s adapter', () => {
      const sites = callSites('mcp', /\bresolveCompetition\(/);
      expect(sites.map((s) => s.replace(/:\d+$/, ''))).toEqual(['mcp/src/tools.ts']);
    });

    it('scripts that call core do so with the current signatures', () => {
      // Found in review: `scripts/release-qa.sh` still called
      // `makeAdapter('espn')`. The script is not type-checked; the call threw
      // before any fetch, its stderr is discarded, and the drift tripwire read
      // the empty output as "feed unreachable" and SKIPPED — a broken check
      // reporting itself as a quiet day.
      const REPO = join(PACKAGES, '..');
      const scriptDirs = [join(REPO, 'scripts'), ...['core', 'cli', 'mcp'].map((p) => join(PACKAGES, p, 'scripts'))];
      const offenders: string[] = [];
      for (const dir of scriptDirs) {
        let names: string[] = [];
        try {
          names = readdirSync(dir);
        } catch {
          continue; // a package without scripts
        }
        for (const name of names) {
          const path = join(dir, name);
          if (!statSync(path).isFile()) continue;
          const text = readFileSync(path, 'utf8');
          // One-argument makeAdapter, or any argument-less resolver/gate call.
          if (/\bmakeAdapter\(\s*(['"][^'"]*['"])?\s*\)/.test(text)) offenders.push(`${name}: makeAdapter without a competition`);
          if (/\b(bundleApplies|marketsCoverCompetition|makeMarketProvider)\(\s*\)/.test(text)) offenders.push(`${name}: a competition-less call`);
        }
      }
      expect(offenders).toEqual([]);
    });

    it('no call anywhere omits the argument', () => {
      const argless = ['core', 'cli', 'mcp'].flatMap((pkg) =>
        callSites(pkg, /\b(resolveCompetition|bundleApplies|marketsCoverCompetition)\(\s*\)/),
      );
      expect(argless).toEqual([]);
    });
  });
});

// ───────────────────────────── identity ─────────────────────────────

describe('identity — the provider’s stable id, on both paths', () => {
  it('a team from the feed carries a provider-namespaced id', () => {
    const r = parseEspnEvent(event('401878761', '2026-10-10T11:30Z', ARSENAL, CHELSEA));
    expect(r.kind).toBe('valid');
    if (r.kind !== 'valid') return;
    // A club has no flag (0.11 · 2.2): with no competition stated, a team is a club.
    expect(r.value.home).toEqual({ code: 'ARS', name: 'Arsenal', id: 'espn:359' });
    expect(r.value.away.id).toBe('espn:363');
  });

  it('the cache path returns the same team, id included', () => {
    const r = parseEspnEvent(event('401878761', '2026-10-10T11:30Z', ARSENAL, CHELSEA));
    if (r.kind !== 'valid') throw new Error('fixture must be valid');
    expect(seal(roundTrip(r.value))).toEqual(r.value);
  });

  it('a feed team without an id has none, and nothing is invented', () => {
    const r = parseEspnEvent(
      event('401878761', '2026-10-10T11:30Z', { abbreviation: 'ARS', displayName: 'Arsenal' }, CHELSEA),
    );
    if (r.kind !== 'valid') throw new Error('fixture must be valid');
    expect('id' in r.value.home).toBe(false);
    expect(r.value.away.id).toBe('espn:363');
  });

  it('bundled skeleton teams have no id', () => {
    for (const m of allFixtures()) {
      expect('id' in m.home).toBe(false);
      expect('id' in m.away).toBe(false);
    }
  });

  const cached = (home: unknown, away: unknown) => ({
    id: '401878761',
    stage: 'FRIENDLY',
    kickoff: '2026-10-10T11:30:00.000Z',
    venue: 'Emirates Stadium',
    home,
    away,
    status: 'SCHEDULED',
    updatedAt: '2026-10-10T10:00:00.000Z',
  });

  describe('the comparison rule', () => {
    it('cache path: one id on both sides is one team twice, whatever the spelling', () => {
      // The half of audit A04 that 0.10.1 could not close: a cached Team had
      // no id, so the seal compared code + name and let this through.
      const r = parseCachedMatch(
        cached(
          { code: 'ARS', name: 'Arsenal', flag: '🏳️', id: 'espn:359' },
          { code: 'AFC', name: 'Arsenal FC', flag: '🏳️', id: 'espn:359' },
        ),
      );
      expect(r.kind).not.toBe('valid');
    });

    it('live path: the same refusal comes from the same rule', () => {
      const r = parseEspnEvent(
        event('401878761', '2026-10-10T11:30Z', ARSENAL, {
          id: '359',
          abbreviation: 'AFC',
          displayName: 'Arsenal FC',
        }),
      );
      expect(r.kind).not.toBe('valid');
    });

    it('a shared code is not sameness: two clubs, two ids, two names', () => {
      // Libertadores: Always Ready and Carabobo are both `CAR`.
      const r = parseCachedMatch(
        cached(
          { code: 'CAR', name: 'Carabobo', flag: '🏳️', id: 'espn:17468' },
          { code: 'CAR', name: 'Always Ready', flag: '🏳️', id: 'espn:9101' },
        ),
      );
      expect(r.kind).toBe('valid');
    });

    it('an id never licenses what the labels refuse: one code and name is one team', () => {
      // A reader cannot tell "Mexico" from "Mexico", whatever ids ride along.
      const r = parseCachedMatch(
        cached(
          { code: 'MEX', name: 'Mexico', flag: '🇲🇽', id: 'espn:203' },
          { code: 'MEX', name: 'Mexico', flag: '🇲🇽', id: 'espn:999' },
        ),
      );
      expect(r.kind).not.toBe('valid');
    });

    it('when either side lacks an id, the code-and-name comparison stands', () => {
      const same = parseCachedMatch(
        cached(
          { code: 'MEX', name: 'Mexico', flag: '🇲🇽', id: 'espn:203' },
          { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
        ),
      );
      expect(same.kind).not.toBe('valid');
      const different = parseCachedMatch(
        cached(
          { code: 'MEX', name: 'Mexico', flag: '🇲🇽', id: 'espn:203' },
          { code: 'RSA', name: 'South Africa', flag: '🇿🇦' },
        ),
      );
      expect(different.kind).toBe('valid');
    });

    it('an id that is not a provider id is dropped, not trusted', () => {
      for (const bad of ['359', 'espn:', 'espn:../../x', 'ESPN:359', 'espn:359 ', 359, { a: 1 }]) {
        const m = seal(
          cached(
            { code: 'ARS', name: 'Arsenal', flag: '🏳️', id: bad },
            { code: 'CHE', name: 'Chelsea', flag: '🏳️', id: 'espn:363' },
          ),
        );
        expect('id' in m.home).toBe(false);
        expect(m.away.id).toBe('espn:363');
      }
    });
  });

  describe('tables', () => {
    const entry = (id: string, abbr: string, name: string, rank: number) => ({
      team: { id, abbreviation: abbr, displayName: name },
      stats: [
        { name: 'gamesPlayed', value: 0 },
        { name: 'wins', value: 0 },
        { name: 'ties', value: 0 },
        { name: 'losses', value: 0 },
        { name: 'pointsFor', value: 0 },
        { name: 'pointsAgainst', value: 0 },
        { name: 'pointDifferential', value: 0 },
        { name: 'points', value: 0 },
        { name: 'rank', value: rank },
      ],
    });
    const standings = {
      children: [
        {
          name: 'Group A',
          standings: { entries: [entry('17468', 'CAR', 'Carabobo', 1), entry('2674', 'BOT', 'Botafogo', 2)] },
        },
        {
          name: 'Group B',
          standings: { entries: [entry('9101', 'CAR', 'Always Ready', 1), entry('2690', 'FLA', 'Flamengo', 2)] },
        },
      ],
    };

    it('a standings row carries its team’s id', () => {
      const tables = parseEspnStandings(standings).items;
      expect(tables[0]?.rows.map((r) => r.team.id)).toEqual(['espn:17468', 'espn:2674']);
      expect(tables[1]?.rows.map((r) => r.team.id)).toEqual(['espn:9101', 'espn:2690']);
    });

    it('a fixture’s group comes from its teams’ ids, so a shared code cannot mislabel it', async () => {
      // Two clubs are `CAR`, in different groups. Keyed by code, whichever table
      // was read last named BOTH fixtures' group.
      const events = [
        event('1001', '2026-04-08T00:00Z', { id: '17468', abbreviation: 'CAR', displayName: 'Carabobo' }, { id: '2674', abbreviation: 'BOT', displayName: 'Botafogo' }, 'group-stage'),
        event('1002', '2026-04-08T02:00Z', { id: '9101', abbreviation: 'CAR', displayName: 'Always Ready' }, { id: '2690', abbreviation: 'FLA', displayName: 'Flamengo' }, 'group-stage'),
      ];
      const adapter = new EspnAdapter({
        competition: 'conmebol.libertadores',
        fetchImpl: (async (url: unknown) =>
          response(String(url).includes('/standings') ? standings : scoreboard(SEASON_2026, events))) as unknown as typeof fetch,
      });
      const matches = await adapter.fetchByDate('2026-04-08');
      expect(matches.map((m) => [m.id, m.group])).toEqual([
        ['1001', 'A'],
        ['1002', 'B'],
      ]);
    });
  });

  it('a team with an id is never given ANOTHER team’s group through a shared code', () => {
    // Found in review: after both id lookups missed, enrichment fell back
    // to codes unconditionally. Standings that carry Always Ready (`CAR`, Group
    // B) but omit Carabobo's row then put Carabobo's fixture in Group B.
    const carabobo = event(
      '1001',
      '2026-04-08T00:00Z',
      { id: '17468', abbreviation: 'CAR', displayName: 'Carabobo' },
      { id: '2674', abbreviation: 'BOT', displayName: 'Botafogo' },
      'group-stage',
    );
    const r = parseEspnEvent(carabobo, {
      groupByTeam: { CAR: 'B' },
      groupByTeamId: { 'espn:9101': 'B' },
    });
    expect(r.kind).toBe('valid');
    if (r.kind !== 'valid') return;
    expect(r.value.group).toBeUndefined();
  });

  it('a known id on either side outranks a code on the other', () => {
    // Found in review of the fix above: home-then-away meant an id-less home
    // team's CODE (shared with another club, in another group) was consulted
    // before the away team's ID, which names the fixture's group for certain.
    const idlessHome = event(
      '1006',
      '2026-04-08T00:00Z',
      { abbreviation: 'CAR', displayName: 'Carabobo' },
      { id: '2674', abbreviation: 'BOT', displayName: 'Botafogo' },
      'group-stage',
    );
    const r = parseEspnEvent(idlessHome, {
      groupByTeam: { CAR: 'B', BOT: 'A' }, // `CAR` here is Always Ready's row
      groupByTeamId: { 'espn:2674': 'A', 'espn:9101': 'B' },
    });
    expect(r.kind === 'valid' && r.value.group).toBe('A');
  });

  it('the code map still serves a team the feed gave no id, and a table that carried none', () => {
    const noIds = event(
      '1004',
      '2026-04-08T00:00Z',
      { abbreviation: 'CAR', displayName: 'Carabobo' },
      { abbreviation: 'BOT', displayName: 'Botafogo' },
      'group-stage',
    );
    const byCodeOnly = parseEspnEvent(noIds, { groupByTeam: { CAR: 'A' }, groupByTeamId: { 'espn:9101': 'B' } });
    expect(byCodeOnly.kind === 'valid' && byCodeOnly.value.group).toBe('A');

    // No id map at all (the standings rows carried no ids): codes are all there is.
    const withIds = event(
      '1005',
      '2026-04-08T00:00Z',
      { id: '17468', abbreviation: 'CAR', displayName: 'Carabobo' },
      { id: '2674', abbreviation: 'BOT', displayName: 'Botafogo' },
      'group-stage',
    );
    const noIdMap = parseEspnEvent(withIds, { groupByTeam: { CAR: 'A' } });
    expect(noIdMap.kind === 'valid' && noIdMap.value.group).toBe('A');
  });

  it('standings that carry no ids at all still enrich by code, through the adapter', async () => {
    // The adapter must not hand the parser an EMPTY id map: that would read as
    // "ids are known, and this team's is in no group".
    const row = (abbr: string, name: string, rank: number) => ({
      team: { abbreviation: abbr, displayName: name },
      stats: ['gamesPlayed', 'wins', 'ties', 'losses', 'pointsFor', 'pointsAgainst', 'pointDifferential', 'points']
        .map((n) => ({ name: n, value: 0 }))
        .concat([{ name: 'rank', value: rank }]),
    });
    const idless = { children: [{ name: 'Group C', standings: { entries: [row('CAR', 'Carabobo', 1), row('BOT', 'Botafogo', 2)] } }] };
    const events = [
      event('1001', '2026-04-08T00:00Z', { id: '17468', abbreviation: 'CAR', displayName: 'Carabobo' }, { id: '2674', abbreviation: 'BOT', displayName: 'Botafogo' }, 'group-stage'),
    ];
    const adapter = new EspnAdapter({
      competition: 'conmebol.libertadores',
      fetchImpl: (async (url: unknown) =>
        response(String(url).includes('/standings') ? idless : scoreboard(SEASON_2026, events))) as unknown as typeof fetch,
    });
    const [match] = await adapter.fetchByDate('2026-04-08');
    expect(match?.group).toBe('C');
  });

  it('a code is a display label: a real abbreviation is neither refused nor rewritten', () => {
    // Universidad O&M plays the Concacaf Champions Cup as `O&M` (measured on
    // the real feed, Oct 2 2026). A `[A-Z0-9]{2,4}` grammar would have dropped
    // its matches or invented `UNI`.
    const r = parseEspnEvent(
      event('1003', '2026-02-18T01:00Z', { id: '10101', abbreviation: 'O&M', displayName: 'Universidad O&M' }, { id: '2', abbreviation: 'LAFC', displayName: 'LAFC' }),
    );
    expect(r.kind).toBe('valid');
    if (r.kind !== 'valid') return;
    expect(r.value.home.code).toBe('O&M');
    expect(r.value.away.code).toBe('LAFC');
  });
});

// ───────────────────────────── season + result metadata ─────────────────────────────

describe('season — what the provider reported about ONE response', () => {
  it('is sealed from the payload', () => {
    const r = parseEspnSeason(scoreboard(SEASON_2024, []));
    expect(r.kind).toBe('valid');
    if (r.kind !== 'valid') return;
    expect(r.value).toEqual({
      year: 2024,
      label: '2024-25 English Premier League',
      startDate: '2024-06-01T04:00:00.000Z',
      endDate: '2025-06-01T03:59:00.000Z',
    });
  });

  it('is absent, not guessed, when the payload does not state a readable year', () => {
    for (const bad of [{}, { leagues: [] }, { leagues: [{ season: { year: '2026' } }] }, { leagues: [{ season: { year: 20260 } }] }, { leagues: 'x' }]) {
      expect(parseEspnSeason(bad).kind).not.toBe('valid');
    }
  });

  it('travels with the fetch result', async () => {
    const adapter = new EspnAdapter({
      competition: 'eng.1',
      enrichGroups: false,
      fetchImpl: (async () => response(scoreboard(SEASON_2026, [event('1', '2026-10-10T11:30Z', ARSENAL, CHELSEA)]))) as unknown as typeof fetch,
    });
    const matches = await adapter.fetchByDate('2026-10-10');
    expect(matches).toHaveLength(1);
    expect(fetchMeta(matches)?.season?.year).toBe(2026);
  });

  it('survives the adapter’s own filtering: fetchLive returns a new array with the same metadata', async () => {
    const liveNow = {
      ...event('1', '2026-10-10T11:30Z', ARSENAL, CHELSEA),
      status: { type: { name: 'STATUS_IN_PROGRESS', state: 'in' }, displayClock: "12'" },
      competitions: [
        {
          competitors: [
            { homeAway: 'home', score: '1', team: ARSENAL },
            { homeAway: 'away', score: '0', team: CHELSEA },
          ],
        },
      ],
    };
    const adapter = new EspnAdapter({
      competition: 'eng.1',
      enrichGroups: false,
      fetchImpl: (async () => response(scoreboard(SEASON_2026, [liveNow]))) as unknown as typeof fetch,
    });
    const live = await adapter.fetchLive();
    expect(live).toHaveLength(1);
    expect(fetchMeta(live)?.season?.year).toBe(2026);
  });

  it('two overlapping calls on one adapter each keep their own', async () => {
    // The dated query for a past edition is answered LAST. A field on the
    // adapter (how `lastError` works, "best-effort under concurrency") would
    // hand the current query the past season, or the other way round.
    const release: Record<string, () => void> = {};
    const adapter = new EspnAdapter({
      competition: 'eng.1',
      enrichGroups: false,
      fetchImpl: (async (url: unknown) => {
        const past = String(url).includes('20240914');
        await new Promise<void>((resolve) => {
          release[past ? 'past' : 'now'] = resolve;
        });
        return response(
          past
            ? scoreboard(SEASON_2024, [event('24', '2024-09-14T11:30Z', ARSENAL, CHELSEA)])
            : scoreboard(SEASON_2026, [event('26', '2026-10-10T11:30Z', ARSENAL, CHELSEA)]),
        );
      }) as unknown as typeof fetch,
    });
    const pastCall = adapter.fetchByDate('2024-09-14');
    const nowCall = adapter.fetchByDate('2026-10-10');
    await vi.waitFor(() => expect(Object.keys(release).sort()).toEqual(['now', 'past']));
    release.now?.();
    const now = await nowCall;
    release.past?.();
    const past = await pastCall;

    expect(fetchMeta(now)?.season?.year).toBe(2026);
    expect(fetchMeta(past)?.season?.year).toBe(2024);
  });

  it('a dated query returns its response’s season with the result', async () => {
    const adapter = new EspnAdapter({
      competition: 'eng.1',
      enrichGroups: false,
      fetchImpl: (async () => response(scoreboard(SEASON_2024, [event('24', '2024-09-14T11:30Z', ARSENAL, CHELSEA)]))) as unknown as typeof fetch,
    });
    const result = await getMatchesForDate(adapter, '2024-09-14');
    expect(result.season).toMatchObject({ year: 2024, label: '2024-25 English Premier League' });
  });

  it('the knockout-fixtures read returns its response’s season too', async () => {
    // The refresher compares it with the live response's season: fixtures it
    // just refetched are only "this season's" if their own response says so.
    const final: Match = {
      id: '760517',
      stage: 'F',
      kickoff: '2026-07-19T19:00:00.000Z',
      venue: 'MetLife Stadium',
      home: { code: 'ESP', name: 'Spain', flag: '🇪🇸', id: 'espn:164' },
      away: { code: 'ARG', name: 'Argentina', flag: '🇦🇷', id: 'espn:202' },
      status: 'SCHEDULED',
      updatedAt: '2026-07-14T00:00:00.000Z',
    };
    const adapter = fakeAdapter('fifa.world', {
      fetchWindow: async () =>
        attachFetchMeta([final], { season: { year: 2026, label: '2026 FIFA World Cup' } }),
    });
    const r = await getKnockoutFixtures(adapter, new Date('2026-07-14T19:30:00Z'));
    expect(r.fixtures.map((m) => m.id)).toEqual(['760517']);
    expect(r.season?.year).toBe(2026);
  });

  describe('the bundle is the 2026 edition', () => {
    const liveOpener: Match = {
      id: '900000001',
      stage: 'GROUP',
      kickoff: '2030-06-13T19:00:00.000Z',
      venue: 'Estadio Centenario',
      home: { code: 'URU', name: 'Uruguay', flag: '🇺🇾', id: 'espn:212' },
      away: { code: 'ARG', name: 'Argentina', flag: '🇦🇷', id: 'espn:202' },
      status: 'SCHEDULED',
      updatedAt: '2030-06-01T00:00:00.000Z',
    };
    const season = (year: number) => ({
      year,
      label: `${year} FIFA World Cup`,
      startDate: `${year}-06-11T04:00:00.000Z`,
      endDate: `${year}-12-31T04:59:00.000Z`,
    });

    it('applies when the provider reports the bundle’s own season', async () => {
      const adapter = fakeAdapter('fifa.world', {
        fetchByDate: async () => attachFetchMeta([liveOpener], { season: season(2026) }),
      });
      const { matches } = await getMatchesForDate(adapter, '2026-06-11');
      expect(matches.length).toBe(allFixtures().length + 1);
    });

    it('does not apply to a response from another season of the same competition', async () => {
      const adapter = fakeAdapter('fifa.world', {
        fetchByDate: async () => attachFetchMeta([liveOpener], { season: season(2030) }),
      });
      const { matches, degraded } = await getMatchesForDate(adapter, '2026-06-11');
      expect(degraded).toBe(false);
      expect(matches).toEqual([liveOpener]);
    });

    it('offline, with no provider answer, it stays the 2026 edition', async () => {
      const adapter = fakeAdapter('fifa.world', {
        fetchByDate: async () => {
          throw new Error('offline');
        },
      });
      const { matches, degraded } = await getMatchesForDate(adapter, '2026-06-11');
      expect(degraded).toBe(true);
      expect(matches.length).toBe(allFixtures().length);
    });

    it('the rule itself', () => {
      expect(bundleApplies('fifa.world', season(2026))).toBe(true);
      expect(bundleApplies('fifa.world', season(2030))).toBe(false);
      expect(bundleApplies('fifa.world', season(2022))).toBe(false);
      expect(bundleApplies('eng.1', season(2026))).toBe(false);
    });
  });
});
