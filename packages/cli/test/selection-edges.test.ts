/**
 * The selection on the CLI, where the acceptance tests do not reach
 * (0.11 · 2.5a): the mode line and the `competition` key on `markets` (every
 * branch); `team --json` carries no key; the refusal in the reader's
 * language; the ambient commands never start a refresher for a refused
 * selection, and the refresher itself refreshes nothing; `share --copy`
 * copies exactly the card printed (no mode line in it).
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Match, ProviderAdapter } from '@claudinho/core';
import { FakeMarketProvider, nationToFlag } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cmdBracket,
  cmdVibe,
  cmdHook,
  cmdMarkets,
  cmdMatch,
  cmdNext,
  cmdPrompt,
  cmdRefresh,
  cmdShare,
  cmdTable,
  cmdTeam,
  cmdToday,
  InputError,
} from '../src/commands';
import { readCurrentState } from '../src/cache';
import { type CliConfig, resolveConfig } from '../src/config';
import { makeT } from '../src/i18n';

// The cache reader, observed: a refused selection reads no cache.
vi.mock('../src/cache', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/cache')>();
  return { ...real, readCurrentState: vi.fn(real.readCurrentState) };
});
// Only `spawn` is stubbed: `execFileSync` runs the built binary below.
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

const NOW = new Date('2026-06-11T12:00:00Z');
const opener: Match = {
  id: '760415',
  stage: 'GROUP',
  group: 'A',
  kickoff: '2026-06-11T19:00:00.000Z',
  venue: 'Estadio Banorte',
  home: { code: 'MEX', name: 'Mexico', flag: nationToFlag('Mexico') },
  away: { code: 'RSA', name: 'South Africa', flag: nationToFlag('South Africa') },
  status: 'SCHEDULED',
  updatedAt: NOW.toISOString(),
};
const adapterFor = (competition: string): ProviderAdapter => ({
  name: 'espn',
  competition,
  capabilities: { push: false, latencyHintSec: 0 },
  async fetchByDate() {
    return [opener];
  },
  async fetchLive() {
    return [];
  },
  async fetchWindow() {
    return [opener];
  },
});
const ENV = ['CLAUDINHO_COMPETITION', 'CLAUDINHO_TEAM'] as const;
const saved: Partial<Record<(typeof ENV)[number], string | undefined>> = {};
let writes: string[] = [];
let errs: string[] = [];
const outSpy = vi.spyOn(process.stdout, 'write');
const errSpy = vi.spyOn(process.stderr, 'write');
beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  delete process.env.CLAUDINHO_COMPETITION;
  delete process.env.CLAUDINHO_TEAM;
  writes = [];
  errs = [];
  vi.mocked(spawn).mockClear();
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
  errSpy.mockImplementation((c: unknown) => {
    errs.push(String(c));
    return true;
  });
});
afterEach(() => {
  outSpy.mockReset();
  errSpy.mockReset();
  vi.unstubAllGlobals();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
const text = () => writes.join('');
const cfgOf = (opts: { competition?: string; json?: boolean; lang?: string } = {}): CliConfig =>
  resolveConfig({ tz: 'UTC', color: false, source: 'espn', flavor: 'off', markets: false, ...opts });
const ctxOf = (cfg: CliConfig) => ({
  cfg,
  t: makeT(cfg.lang),
  adapter: adapterFor(cfg.competition),
  now: NOW,
  marketProvider: new FakeMarketProvider(),
});

describe('markets names its competition on every branch', () => {
  const LINE = 'World Cup · from the command line';

  it('text: the date, a team\'s next fixture, a match id, and a match id off the markets\' scope', async () => {
    for (const [target, team, competition] of [
      ['2026-06-11', undefined, 'world-cup'],
      ['next', 'MEX', 'world-cup'],
      ['760415', undefined, 'world-cup'],
    ] as const) {
      writes = [];
      await cmdMarkets(target, team, ctxOf(cfgOf({ competition })));
      expect(text(), target).toContain(LINE);
    }
    writes = [];
    await cmdMarkets('760415', undefined, ctxOf(cfgOf({ competition: 'premier-league' })));
    expect(text()).toContain('Premier League · from the command line');
  });

  it('--json: the `competition` key on every branch, and no mode line', async () => {
    const key = { slug: 'fifa.world', alias: 'world-cup', name: 'World Cup', chosenBy: 'flag' };
    for (const [target, team] of [['2026-06-11', undefined], ['next', 'MEX'], ['760415', undefined]] as const) {
      writes = [];
      await cmdMarkets(target, team, ctxOf(cfgOf({ competition: 'world-cup', json: true })));
      const j = JSON.parse(text()) as Record<string, unknown>;
      expect(j.competition, target).toEqual(key);
      expect(text(), target).not.toContain('from the command line');
    }
    writes = [];
    await cmdMarkets('760415', undefined, ctxOf(cfgOf({ competition: 'premier-league', json: true })));
    expect((JSON.parse(text()) as Record<string, unknown>).competition).toEqual({ slug: 'eng.1', alias: 'premier-league', name: 'Premier League', chosenBy: 'flag' });
  });
});

describe('team is not a competition-answering command', () => {
  it('its --json carries no `competition` key', () => {
    cmdTeam('Mexico', ctxOf(cfgOf({ json: true })));
    const j = JSON.parse(text()) as Record<string, unknown>;
    expect(j.team).toMatchObject({ code: 'MEX' });
    expect('competition' in j).toBe(false);
  });

  it('a raw slug named explicitly is not the World Cup either: refused', () => {
    expect(() => cmdTeam('Mexico', ctxOf(cfgOf({ competition: 'fifa.friendly' })))).toThrow(InputError);
  });
});

describe('a refused selection', () => {
  it('is refused in the reader\'s language, naming the value and the aliases', async () => {
    const cfg = cfgOf({ competition: 'foo', lang: 'es' });
    await expect(cmdToday('2026-06-11', ctxOf(cfg))).rejects.toThrow(/Competición desconocida "foo"/);
    await expect(cmdToday('2026-06-11', ctxOf(cfg))).rejects.toThrow(/premier-league/);
  });

  it('wins over a valid environment when it is the flag, and loses to a valid flag when it is the environment', () => {
    process.env.CLAUDINHO_COMPETITION = 'eng.1';
    expect(cfgOf({ competition: 'foo' }).selection.kind).toBe('refused');
    process.env.CLAUDINHO_COMPETITION = 'foo';
    expect(cfgOf({ competition: 'laliga' })).toMatchObject({ competition: 'esp.1', selection: { chosenBy: 'flag' } });
  });

  it('no ambient command reads the cache for it: the statusline, the hook, vibe', () => {
    process.env.CLAUDINHO_COMPETITION = 'foo';
    const cfg = cfgOf();
    vi.mocked(readCurrentState).mockClear();
    cmdPrompt({ cfg, t: makeT('en') }, { cursor: undefined });
    cmdHook({ cfg, t: makeT('en') });
    cmdVibe({ cfg, t: makeT('en') });
    expect(vi.mocked(readCurrentState)).not.toHaveBeenCalled();
    // The same commands under a valid selection do read it (the check above can see a read).
    process.env.CLAUDINHO_COMPETITION = 'eng.1';
    cmdVibe({ cfg: cfgOf(), t: makeT('en') });
    expect(vi.mocked(readCurrentState)).toHaveBeenCalled();
  });

  it('the statusline and the hook start no refresher for it', () => {
    process.env.CLAUDINHO_COMPETITION = 'foo';
    const cfg = cfgOf();
    cmdPrompt({ cfg, t: makeT('en') }, { cursor: undefined });
    expect(text()).toBe('⚽ —\n');
    cmdHook({ cfg, t: makeT('en') });
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
    // The same configuration, valid: the empty cache starts one (the check above can see a spawn).
    process.env.CLAUDINHO_COMPETITION = 'eng.1';
    cmdPrompt({ cfg: cfgOf(), t: makeT('en') }, { cursor: undefined });
    expect(vi.mocked(spawn)).toHaveBeenCalled();
  });

  it('the refresher, spawned with it, asks the provider nothing', async () => {
    let fetched = 0;
    vi.stubGlobal('fetch', async () => {
      fetched++;
      return new Response('{}', { status: 200 });
    });
    process.env.CLAUDINHO_COMPETITION = 'foo';
    await cmdRefresh({ cfg: cfgOf(), t: makeT('en') });
    expect(fetched).toBe(0);
  });
});

describe('share --copy copies exactly the card printed', () => {
  it('no mode line in the card, on stdout or on the clipboard', async () => {
    const copy = vi.fn((_text: string) => true);
    await cmdShare('2026-06-11', undefined, { copy: true }, { ...ctxOf(cfgOf({ competition: 'world-cup' })), copy });
    const printed = text().replace(/\n$/, '');
    expect(copy).toHaveBeenCalledWith(printed);
    expect(printed).not.toContain('from the command line');
    expect(printed.split('\n')[0]).toMatch(/ · World Cup$/);
  });
});

describe('the mode line and the key on the branches with no header, and the rest', () => {
  const WC = 'World Cup · from the command line';
  const KEY = { slug: 'fifa.world', alias: 'world-cup', name: 'World Cup', chosenBy: 'flag' };

  it('next with no fixture: its header, then the line; match with none, markets with none: the line comes first', async () => {
    // `next` names the team asked whether or not it found a fixture (0.11 · 2.7c).
    await cmdNext('Everton', ctxOf(cfgOf({ competition: 'premier-league' })));
    const [header, mode] = text().trim().split('\n');
    expect(header).toBe('Next up for Everton');
    expect(mode?.trim()).toBe('Premier League · from the command line');
    for (const call of [
      () => cmdMatch('999999', ctxOf(cfgOf({ competition: 'world-cup' }))),
      () => cmdMarkets('next', 'ZZZ', ctxOf(cfgOf({ competition: 'world-cup' }))),
      () => cmdMarkets('999999', undefined, ctxOf(cfgOf({ competition: 'world-cup' }))),
    ]) {
      writes = [];
      await call();
      expect(text().trim().split('\n')[0]).toBe(WC);
    }
  });

  it('table with its tables: one line before them', async () => {
    const row = { team: { code: 'MEX', name: 'Mexico', flag: opener.home.flag }, played: 1, won: 1, drawn: 0, lost: 0, goalsFor: 2, goalsAgainst: 0, goalDiff: 2, points: 3, rank: 1 };
    const withTable: ProviderAdapter = { ...adapterFor('fifa.world'), async fetchStandings() { return [{ group: 'A', rows: [row] }]; } };
    await cmdTable(undefined, { ...ctxOf(cfgOf({ competition: 'world-cup' })), adapter: withTable });
    const l = text().split('\n');
    const mode = l.findIndex((x) => x.trim() === WC);
    expect(mode).toBeGreaterThan(-1);
    expect(mode).toBeLessThan(l.findIndex((x) => /Group A/.test(x)));
    expect(l.filter((x) => x.trim() === WC)).toHaveLength(1);
  });

  it('bracket\'s tree: the line after the header, and the key in --json', async () => {
    await cmdBracket(undefined, {}, ctxOf(cfgOf({ competition: 'world-cup' })));
    const l = text().split('\n');
    const header = l.findIndex((x) => /Knockout bracket/.test(x));
    expect(header).toBeGreaterThan(-1);
    expect(l[header + 1]?.trim()).toBe(WC);
    writes = [];
    await cmdBracket(undefined, {}, ctxOf(cfgOf({ competition: 'world-cup', json: true })));
    expect((JSON.parse(text()) as Record<string, unknown>).competition).toEqual(KEY);
  });

  it('share table and share bracket --json carry the key', async () => {
    for (const target of ['table', 'bracket']) {
      writes = [];
      await cmdShare(target, undefined, {}, ctxOf(cfgOf({ competition: 'world-cup', json: true })));
      expect((JSON.parse(text()) as Record<string, unknown>).competition, target).toEqual(KEY);
    }
  });
});

const DIST = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist', 'index.js');

describe.skipIf(!existsSync(DIST))('the built binary: the global option, and the exits', () => {
  /** Run the built CLI; never throws: the exit code is part of the answer. */
  const run = (args: string[], env: Record<string, string> = {}) => {
    const base = { ...process.env, ...env };
    if (!('CLAUDINHO_COMPETITION' in env)) delete base.CLAUDINHO_COMPETITION;
    try {
      const stdout = execFileSync(process.execPath, [DIST, ...args], { env: base, encoding: 'utf8', input: '', timeout: 15_000, stdio: ['pipe', 'pipe', 'pipe'] });
      return { code: 0, stdout, stderr: '' };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? -1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
    }
  };

  it('`--competition foo` and `-c foo` are refused with the aliases, exit 1, before anything is asked', { timeout: 60_000 }, () => {
    for (const flag of ['--competition', '-c']) {
      const r = run([flag, 'foo', 'today']);
      expect(r.code, flag).toBe(1);
      expect(r.stdout, flag).toBe('');
      expect(r.stderr, flag).toContain('"foo"');
      expect(r.stderr, flag).toContain('premier-league');
    }
  });

  it('`-c premier-league team Mexico` is refused; `-c world-cup team Mexico --json` answers', { timeout: 60_000 }, () => {
    const refused = run(['-c', 'premier-league', 'team', 'Mexico']);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toMatch(/World Cup nations only/);
    const answered = run(['-c', 'world-cup', 'team', 'Mexico', '--json']);
    expect(answered.code).toBe(0);
    expect(JSON.parse(answered.stdout)).toMatchObject({ team: { code: 'MEX' } });
  });

  it('an unknown CLAUDINHO_COMPETITION: the hook prints nothing and the statusline the empty line, both exit 0', { timeout: 60_000 }, () => {
    const hook = run(['hook'], { CLAUDINHO_COMPETITION: 'foo' });
    expect(hook).toMatchObject({ code: 0, stdout: '' });
    const prompt = run(['prompt'], { CLAUDINHO_COMPETITION: 'foo' });
    expect(prompt).toMatchObject({ code: 0, stdout: '⚽ —\n' });
  });
});
