/**
 * The selection on the CLI, where the acceptance tests do not reach
 * (0.11 · 2.5a): the mode line and the `competition` key on `markets` (every
 * branch); `team --json` carries no key; the refusal in the reader's
 * language; the ambient commands never start a refresher for a refused
 * selection, and the refresher itself refreshes nothing; `share --copy`
 * copies exactly the card printed (no mode line in it).
 */
import { spawn } from 'node:child_process';
import type { Match, ProviderAdapter } from '@claudinho/core';
import { FakeMarketProvider } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdHook, cmdMarkets, cmdPrompt, cmdRefresh, cmdShare, cmdTeam, cmdToday, InputError } from '../src/commands';
import { type CliConfig, resolveConfig } from '../src/config';
import { makeT } from '../src/i18n';

vi.mock('node:child_process', () => ({ spawn: vi.fn(() => ({ unref: vi.fn() })) }));

const NOW = new Date('2026-06-11T12:00:00Z');
const opener: Match = {
  id: '760415',
  stage: 'GROUP',
  group: 'A',
  kickoff: '2026-06-11T19:00:00.000Z',
  venue: 'Estadio Banorte',
  home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
  away: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' },
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
