/**
 * `claudinho follow` (0.11 · 2.5b, D2): the one writer of the config file.
 * `follow <alias|slug> [--team <query>]` resolves the competition as the flag
 * does and the team exactly as `next <query>` does (the bundle's nations
 * offline, no id; off it discovery, then the roster, then `resolveClub`), writes
 * `{ version, competition, team? }` atomically with 0600 ENFORCED (an existing
 * 0644 file included), and prints the choice as the mode line will show it.
 * `follow` alone prints the choice and its source, or why there is none;
 * `follow --list` the table with the current one marked; `follow off` removes
 * the file. An ambiguous or unknown team writes nothing: the previous file
 * stays as it was. `follow <another competition>` without `--team` drops a
 * saved pin (a club's id is the same everywhere; a pin never carries over by
 * accident).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EspnAdapter, type ProviderAdapter } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdFollow, InputError } from '../src/commands';
import { resolveConfig } from '../src/config';
import { makeT } from '../src/i18n';

const STATS = ['gamesPlayed', 'wins', 'ties', 'losses', 'pointsFor', 'pointsAgainst', 'pointDifferential', 'points', 'rank'];
const NOW = new Date('2026-10-10T15:00:00.000Z');
type Season = { year: number; displayName: string; startDate?: string; endDate?: string };
const S2026: Season = { year: 2026, displayName: '2026-27 English Premier League', startDate: '2026-08-01T04:00Z', endDate: '2027-05-30T03:59Z' };
type Side = { id?: string; abbr: string; name: string };
type Ev = { id: string; date: string; home: Side; away: Side };
const ARS: Side = { id: '359', abbr: 'ARS', name: 'Arsenal' };
const CHE: Side = { id: '363', abbr: 'CHE', name: 'Chelsea' };
const LIV: Side = { id: '364', abbr: 'LIV', name: 'Liverpool' };
const BRE: Side = { id: '337', abbr: 'BRE', name: 'Brentford' };
const CARABOBO: Side = { id: '7001', abbr: 'CAR', name: 'Carabobo' };
const ALWAYS_READY: Side = { id: '7002', abbr: 'CAR', name: 'Always Ready' };
const AMERICA: Side = { id: '227', abbr: 'AME', name: 'Club América' };
function event(e: Ev) {
  const side = (s: Side, homeAway: string) => ({ homeAway, score: '0', team: { ...(s.id ? { id: s.id } : {}), abbreviation: s.abbr, displayName: s.name } });
  return { id: e.id, date: e.date, season: { slug: 'regular-season' }, status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' }, period: 0 }, competitions: [{ competitors: [side(e.home, 'home'), side(e.away, 'away')] }] };
}
function table(name: string, sides: Side[]) {
  return { children: [{ name, standings: { entries: sides.map((s, i) => ({ team: { ...(s.id ? { id: s.id } : {}), abbreviation: s.abbr, displayName: s.name }, stats: STATS.map((n) => ({ name: n, value: n === 'rank' ? i + 1 : 0 })) })) } }] };
}
const PL_TABLE = table('2026-27 English Premier League', [ARS, CHE, LIV]);
const LIB_TABLE = { children: [{ name: 'Group A', standings: { entries: [CARABOBO].map((s) => ({ team: { id: s.id, abbreviation: s.abbr, displayName: s.name }, stats: STATS.map((n) => ({ name: n, value: n === 'rank' ? 1 : 0 })) })) } }] };
const NO_TABLE = { name: 'Concacaf Champions Cup', season: { year: 2026 }, seasons: [{ year: 2016 }] };
const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const easternDay = (iso: string) => eastern.format(new Date(iso)).replace(/-/g, '');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function feed(competition: string, opts: { events?: Ev[]; standings?: unknown; season?: Season } = {}) {
  const urls: string[] = [];
  const events = opts.events ?? [];
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('/standings')) return json(opts.standings ?? PL_TABLE);
    const asked = new URL(url).searchParams.get('dates') ?? '';
    if (asked.includes('-')) return json({ code: 400 }, 400);
    const inBucket = (e: Ev) => (asked.length === 8 ? easternDay(e.date) === asked : asked.length === 6 ? easternDay(e.date).startsWith(asked) : false);
    return json({ leagues: [{ season: opts.season ?? S2026 }], events: events.filter(inBucket).map(event) });
  }) as unknown as typeof fetch;
  return { adapter: new EspnAdapter({ competition, fetchImpl, now: () => NOW.getTime() }) as ProviderAdapter, urls };
}
const UPCOMING: Ev[] = [
  { id: '41', date: '2026-10-11T14:00:00Z', home: ARS, away: CHE },
  { id: '42', date: '2026-10-12T14:00:00Z', home: BRE, away: LIV },
];

let tmp: string;
let configFile: string;
const ENV = ['XDG_CONFIG_HOME', 'CLAUDINHO_COMPETITION', 'CLAUDINHO_TEAM'] as const;
const saved: Record<string, string | undefined> = {};
const outSpy = vi.spyOn(process.stdout, 'write');
let writes: string[] = [];
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'claudinho-follow-'));
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.XDG_CONFIG_HOME = tmp;
  configFile = join(tmp, 'claudinho', 'config.json');
  writes = [];
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
});
afterEach(() => {
  outSpy.mockReset();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(tmp, { recursive: true, force: true });
});
const text = () => writes.join('');
const read = () => JSON.parse(readFileSync(configFile, 'utf8')) as Record<string, unknown>;
const mode = (p: string) => statSync(p).mode & 0o777;
/** The command's context: the edge's config (which reads the file as it now is), and an adapter for `--team`. */
const ctxOf = (adapter?: ProviderAdapter, over: { json?: boolean; lang?: string; competition?: string } = {}) => {
  const cfg = resolveConfig({ tz: 'UTC', color: false, source: 'espn', flavor: 'off', markets: false, ...over });
  return { cfg, t: makeT(cfg.lang), adapter, now: NOW };
};

describe('writing the choice', () => {
  it('`follow premier-league` writes the file (version 1, the slug) atomically with 0600, and prints the choice as the mode line shows it', async () => {
    await cmdFollow('premier-league', {}, ctxOf());
    expect(read()).toEqual({ version: 1, competition: 'eng.1' });
    if (process.platform !== 'win32') expect(mode(configFile)).toBe(0o600);
    expect(text()).toContain('Premier League');
    // No stray temp file beside it.
    expect(existsSync(join(tmp, 'claudinho'))).toBe(true);
    expect(readFileSync(configFile, 'utf8').endsWith('\n')).toBe(true);
  });

  it('0600 is ENFORCED on every successful write: an existing 0644 file is not kept at 0644', async () => {
    if (process.platform === 'win32') return;
    mkdirSync(join(tmp, 'claudinho'), { recursive: true });
    writeFileSync(configFile, JSON.stringify({ version: 1, competition: 'esp.1' }), { mode: 0o644 });
    expect(mode(configFile)).toBe(0o644);
    await cmdFollow('premier-league', {}, ctxOf());
    expect(mode(configFile)).toBe(0o600);
    expect(read()).toEqual({ version: 1, competition: 'eng.1' });
  });

  it('a slug and a raw slug: saved as given; the raw one is said to be experimental', async () => {
    await cmdFollow('esp.1', {}, ctxOf());
    expect(read()).toEqual({ version: 1, competition: 'esp.1' });
    writes = [];
    await cmdFollow('fifa.friendly', {}, ctxOf());
    expect(read()).toEqual({ version: 1, competition: 'fifa.friendly' });
    expect(text()).toContain('experimental');
  });

  it('`follow foo` is refused with the aliases, nothing written; the previous file stays', async () => {
    await cmdFollow('premier-league', {}, ctxOf());
    await expect(cmdFollow('foo', {}, ctxOf())).rejects.toThrow(InputError);
    await expect(cmdFollow('foo', {}, ctxOf())).rejects.toThrow(/premier-league/);
    expect(read()).toEqual({ version: 1, competition: 'eng.1' });
  });

  it('the edge reads the saved choice: after `follow`, `resolveConfig({})` says saved; the environment still wins; the flag over both', async () => {
    await cmdFollow('premier-league', {}, ctxOf());
    expect(resolveConfig({})).toMatchObject({ competition: 'eng.1', selection: { kind: 'selected', slug: 'eng.1', chosenBy: 'saved' } });
    process.env.CLAUDINHO_COMPETITION = 'laliga';
    expect(resolveConfig({})).toMatchObject({ competition: 'esp.1', selection: { chosenBy: 'env' } });
    expect(resolveConfig({ competition: 'serie-a' })).toMatchObject({ competition: 'ita.1', selection: { chosenBy: 'flag' } });
  });
});

describe('the pin', () => {
  it('`follow premier-league --team arsenal` stores { id, code, name } from the roster, exactly as `next` resolves it', async () => {
    const { adapter, urls } = feed('eng.1', { events: UPCOMING });
    await cmdFollow('premier-league', { team: 'arsenal' }, ctxOf(adapter));
    expect(read()).toEqual({ version: 1, competition: 'eng.1', team: { id: 'espn:359', code: 'ARS', name: 'Arsenal' } });
    // The reads `next` makes: discovery (the month requests), then the standings.
    expect(urls.some((u) => u.includes('/standings'))).toBe(true);
    expect(urls.some((u) => /dates=\d{6}(&|$)/.test(u))).toBe(true);
    expect(text()).toContain('Arsenal');
  });

  it('`follow concacaf-champions-cup --team "Club América"` stores it from the schedule ahead (no table there)', async () => {
    const { adapter } = feed('concacaf.champions', {
      events: [{ id: '51', date: '2026-10-14T02:00:00Z', home: AMERICA, away: { id: '228', abbr: 'TOL', name: 'Toluca' } }],
      standings: NO_TABLE,
      season: { year: 2026, displayName: '2026 Concacaf Champions Cup', startDate: '2026-02-01T05:00Z', endDate: '2026-12-31T04:59Z' },
    });
    await cmdFollow('concacaf-champions-cup', { team: 'Club América' }, ctxOf(adapter));
    expect(read()).toEqual({ version: 1, competition: 'concacaf.champions', team: { id: 'espn:227', code: 'AME', name: 'Club América' } });
  });

  it('a club in the fixtures but not in the complete table is stored, as `next` resolves an exact name', async () => {
    const { adapter } = feed('eng.1', { events: [{ id: '43', date: '2026-10-13T14:00:00Z', home: { id: '350', abbr: 'NFO', name: 'Nottingham Forest' }, away: CHE }] });
    await cmdFollow('premier-league', { team: 'Nottingham Forest' }, ctxOf(adapter));
    expect(read()).toEqual({ version: 1, competition: 'eng.1', team: { id: 'espn:350', code: 'NFO', name: 'Nottingham Forest' } });
  });

  it('an ambiguous code (CAR in the table and CAR in the fixtures) writes nothing and names the candidates; an unknown team writes nothing and says what `next` says', async () => {
    await cmdFollow('premier-league', {}, ctxOf());
    const { adapter } = feed('conmebol.libertadores', { events: [{ id: '61', date: '2026-10-12T22:00:00Z', home: ALWAYS_READY, away: { id: '7003', abbr: 'BOL', name: 'Bolívar' } }], standings: LIB_TABLE });
    await expect(cmdFollow('libertadores', { team: 'CAR' }, ctxOf(adapter))).rejects.toThrow(/Carabobo.*Always Ready|Always Ready.*Carabobo/);
    expect(read()).toEqual({ version: 1, competition: 'eng.1' });
    const { adapter: pl } = feed('eng.1', { events: UPCOMING });
    await expect(cmdFollow('premier-league', { team: 'Nowhere FC' }, ctxOf(pl))).rejects.toThrow(/Nowhere FC/);
    expect(read()).toEqual({ version: 1, competition: 'eng.1' });
  });

  it('`follow world-cup --team Mexico` stores { code, name } with no id, offline', async () => {
    let fetched = 0;
    const adapter: ProviderAdapter = {
      name: 'espn',
      competition: 'fifa.world',
      capabilities: { push: false, latencyHintSec: 0 },
      async fetchByDate() {
        fetched++;
        return [];
      },
      async fetchLive() {
        fetched++;
        return [];
      },
    };
    await cmdFollow('world-cup', { team: 'Mexico' }, ctxOf(adapter));
    expect(read()).toEqual({ version: 1, competition: 'fifa.world', team: { code: 'MEX', name: 'Mexico' } });
    expect(fetched).toBe(0);
  });

  it('`follow champions-league` after a pinned Arsenal drops the pin; `follow premier-league --team` keeps the competition when the team is unknown', async () => {
    const { adapter } = feed('eng.1', { events: UPCOMING });
    await cmdFollow('premier-league', { team: 'arsenal' }, ctxOf(adapter));
    expect(read().team).toBeDefined();
    await cmdFollow('champions-league', {}, ctxOf());
    expect(read()).toEqual({ version: 1, competition: 'uefa.champions' });
  });
});

describe('reading the choice back', () => {
  it('`follow` alone prints the choice and its source; with none, why there is none', async () => {
    await cmdFollow(undefined, {}, ctxOf());
    expect(text()).toMatch(/No competition|none/i);
    writes = [];
    await cmdFollow('premier-league', {}, ctxOf());
    writes = [];
    await cmdFollow(undefined, {}, ctxOf());
    expect(text()).toContain('Premier League');
    expect(text()).toContain(configFile);
  });

  it('a malformed, versionless, unreadable file and a SYMLINK to a valid file read as none, and `follow` says why', async () => {
    mkdirSync(join(tmp, 'claudinho'), { recursive: true });
    const cases: Array<[string, RegExp]> = [
      ['{not json', /malformed|could not be read|parse/i],
      [JSON.stringify({ competition: 'eng.1' }), /version/i],
    ];
    for (const [body, why] of cases) {
      writeFileSync(configFile, body);
      writes = [];
      await cmdFollow(undefined, {}, ctxOf());
      expect(text(), body).toMatch(why);
      expect(resolveConfig({}).selection.kind, body).toBe('none');
    }
    rmSync(configFile);
    const target = join(tmp, 'target.json');
    writeFileSync(target, JSON.stringify({ version: 1, competition: 'eng.1' }));
    symlinkSync(target, configFile);
    writes = [];
    await cmdFollow(undefined, {}, ctxOf());
    expect(text()).toMatch(/symlink|link/i);
    expect(resolveConfig({}).selection.kind).toBe('none');
  });

  it('`follow --list` prints the fifteen with the current one marked; `follow off` removes the file', async () => {
    await cmdFollow('premier-league', {}, ctxOf());
    writes = [];
    await cmdFollow(undefined, { list: true }, ctxOf());
    const rows = text().split('\n').filter((l) => /\b(world-cup|premier-league|club-world-cup)\b/.test(l));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(text().split('\n').filter((l) => /· (nations|clubs) ·|· (nation|club) ·/.test(l))).toHaveLength(15);
    const current = text().split('\n').find((l) => l.includes('premier-league')) ?? '';
    expect(current).toMatch(/\*|current|›|→|✓/);
    writes = [];
    await cmdFollow('off', {}, ctxOf());
    expect(existsSync(configFile)).toBe(false);
    expect(resolveConfig({}).selection.kind).toBe('none');
    // `off` with no file is not an error.
    await cmdFollow('off', {}, ctxOf());
  });

  it('`--json`: `follow premier-league --json` emits the choice; `follow --json` emits it or null', async () => {
    await cmdFollow('premier-league', {}, ctxOf(undefined, { json: true }));
    expect(JSON.parse(text())).toMatchObject({ competition: { slug: 'eng.1', alias: 'premier-league', chosenBy: 'saved' }, path: configFile });
    writes = [];
    await cmdFollow('off', {}, ctxOf(undefined, { json: true }));
    writes = [];
    await cmdFollow(undefined, {}, ctxOf(undefined, { json: true }));
    expect(JSON.parse(text())).toMatchObject({ competition: null, noCompetition: true });
  });
});
