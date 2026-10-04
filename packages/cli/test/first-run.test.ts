/**
 * First run (0.11 · 2.5b, D1): with no flag, no environment and no saved
 * choice, nothing is chosen, and nothing below the edge runs: the commands
 * that answer for a competition print ONE sentence and exit 1 (the input
 * error's code) with no request and no cache read; `--json` puts the valid
 * object `{ competition: null, noCompetition: true }` on stdout and the
 * sentence on stderr; the statusline prints `⚽ claudinho follow` with no
 * cache read and no refresher; the hook prints nothing and spawns nothing;
 * `vibe` prints its line with no live segment; `team`, `follow`, `init`,
 * `star` and `--version` need none. The finished World Cup is no longer a
 * default anyone falls into without choosing.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeMarketProvider, type ProviderAdapter } from '@claudinho/core';
vi.mock('node:child_process', () => ({ spawn: vi.fn(() => ({ unref: vi.fn() })) }));
// The cache module as it is, with its reader counted: a first run must not read the cache.
vi.mock('../src/cache', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/cache')>();
  return { ...real, readCurrentState: vi.fn(real.readCurrentState) };
});
import { spawn } from 'node:child_process';
import { readCurrentState } from '../src/cache';
import { cmdBracket, cmdHook, cmdLive, cmdMarkets, cmdMatch, cmdNext, cmdPrompt, cmdShare, cmdTable, cmdTeam, cmdToday, cmdVibe, InputError } from '../src/commands';
import { resolveConfig } from '../src/config';
import { makeT } from '../src/i18n';

let tmp: string;
const ENV = ['XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'CLAUDINHO_COMPETITION', 'CLAUDINHO_TEAM'] as const;
const saved: Record<string, string | undefined> = {};
const outSpy = vi.spyOn(process.stdout, 'write');
const errSpy = vi.spyOn(process.stderr, 'write');
let writes: string[] = [];
let errs: string[] = [];
let fetched = 0;
const counting: ProviderAdapter = {
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
  async fetchWindow() {
    fetched++;
    return [];
  },
};
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'claudinho-first-run-'));
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.XDG_CONFIG_HOME = join(tmp, 'config');
  process.env.XDG_CACHE_HOME = join(tmp, 'cache');
  writes = [];
  errs = [];
  fetched = 0;
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
  errSpy.mockImplementation((c: unknown) => {
    errs.push(String(c));
    return true;
  });
  vi.mocked(spawn).mockClear();
  vi.mocked(readCurrentState).mockClear();
});
afterEach(() => {
  outSpy.mockReset();
  errSpy.mockReset();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(tmp, { recursive: true, force: true });
});
const text = () => writes.join('');
const ctxOf = (over: { json?: boolean; lang?: string } = {}) => {
  const cfg = resolveConfig({ tz: 'UTC', color: false, source: 'espn', flavor: 'off', markets: false, ...over });
  return { cfg, t: makeT(cfg.lang), adapter: counting, now: new Date('2026-10-10T15:00:00Z'), marketProvider: new FakeMarketProvider() };
};

describe('the edge', () => {
  it('with nothing chosen the selection is none and the competition the empty string', () => {
    const cfg = resolveConfig({});
    expect(cfg.selection).toEqual({ kind: 'none' });
    expect(cfg.competition).toBe('');
  });
});

describe('the commands that answer for a competition', () => {
  const commands: Array<[string, (ctx: ReturnType<typeof ctxOf>) => Promise<void>]> = [
    ['today', (c) => cmdToday(undefined, c)],
    ['live', (c) => cmdLive(c)],
    ['next', (c) => cmdNext('MEX', c)],
    ['match', (c) => cmdMatch('760415', c)],
    ['table', (c) => cmdTable(undefined, c)],
    ['bracket', (c) => cmdBracket(undefined, {}, c)],
    ['markets', (c) => cmdMarkets(undefined, undefined, c)],
    ['share', (c) => cmdShare('live', undefined, {}, c)],
  ];

  it('each prints the one sentence (exit 1: an input error) naming `claudinho follow` and `follow --list`, with no request and no cache read', async () => {
    for (const [name, run] of commands) {
      writes = [];
      await expect(run(ctxOf()), name).rejects.toThrow(InputError);
      await expect(run(ctxOf()), name).rejects.toThrow(/claudinho follow/);
      await expect(run(ctxOf()), name).rejects.toThrow(/follow --list/);
      expect(text(), name).toBe('');
    }
    expect(fetched).toBe(0);
    expect(readCurrentState).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('every branch of `markets` and `share`: the sentence, no request, no cache read, no output on --json but the object', async () => {
    const branches: Array<[string, (ctx: ReturnType<typeof ctxOf>) => Promise<void>]> = [
      ['markets next', (c) => cmdMarkets('next', 'MEX', c)],
      ['markets <id>', (c) => cmdMarkets('760415', undefined, c)],
      ['markets <date>', (c) => cmdMarkets('2026-10-10', undefined, c)],
      ['share live', (c) => cmdShare('live', undefined, {}, c)],
      ['share table', (c) => cmdShare('table', 'A', {}, c)],
      ['share bracket', (c) => cmdShare('bracket', undefined, {}, c)],
      ['share next', (c) => cmdShare('next', 'MEX', {}, c)],
      ['share <id>', (c) => cmdShare('760415', undefined, {}, c)],
      ['share <date>', (c) => cmdShare('2026-10-10', undefined, {}, c)],
      ['share (today)', (c) => cmdShare(undefined, undefined, {}, c)],
    ];
    for (const [name, run] of branches) {
      writes = [];
      await expect(run(ctxOf()), name).rejects.toThrow(/claudinho follow/);
      expect(text(), name).toBe('');
      writes = [];
      await expect(run(ctxOf({ json: true })), name).rejects.toThrow(InputError);
      expect(JSON.parse(text()), name).toEqual({ competition: null, noCompetition: true });
    }
    expect(fetched).toBe(0);
    expect(readCurrentState).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('a REFUSED selection under --json writes nothing to stdout (the object is the first run\'s alone)', async () => {
    process.env.CLAUDINHO_COMPETITION = 'foo';
    await expect(cmdToday(undefined, ctxOf({ json: true }))).rejects.toThrow(InputError);
    expect(text()).toBe('');
  });

  it('the sentence in four locales', async () => {
    for (const lang of ['en', 'es', 'pt', 'fr']) {
      await expect(cmdToday(undefined, ctxOf({ lang })), lang).rejects.toThrow(/claudinho follow/);
    }
    const [en, es, pt, fr] = await Promise.all(['en', 'es', 'pt', 'fr'].map(async (lang) => cmdToday(undefined, ctxOf({ lang })).catch((e: Error) => e.message)));
    expect(new Set([en, es, pt, fr]).size).toBe(4);
  });

  it('`--json`: stdout is the valid object { competition: null, noCompetition: true }, the sentence goes to stderr, still exit 1', async () => {
    for (const [name, run] of commands) {
      writes = [];
      errs = [];
      await expect(run(ctxOf({ json: true })), name).rejects.toThrow(InputError);
      expect(JSON.parse(text()), name).toEqual({ competition: null, noCompetition: true });
    }
    expect(fetched).toBe(0);
  });
});

describe('the surfaces that need no competition', () => {
  it('`team` answers the World Cup roster', () => {
    cmdTeam('Mexico', ctxOf());
    expect(text()).toContain('MEX');
  });

  it('the statusline prints `⚽ claudinho follow` with no cache read and no refresher', () => {
    cmdPrompt(ctxOf(), { cursor: undefined });
    expect(text().trim()).toBe('⚽ claudinho follow');
    expect(readCurrentState).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('the hook prints nothing and spawns nothing', () => {
    cmdHook(ctxOf());
    expect(text()).toBe('');
    expect(readCurrentState).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('`vibe` prints its line with no live segment', () => {
    expect(() => cmdVibe(ctxOf())).not.toThrow();
    expect(text()).toContain('#VibingLaVidaLoca');
    expect(text()).not.toMatch(/\d–\d/);
  });
});
