/**
 * The edges of the saved choice and the pin (0.11 · 2.5b) that the main
 * suites do not reach, each a rule a revert left green:
 *   - on the ambient surfaces `CLAUDINHO_TEAM` wins over the saved pin;
 *   - `follow <alias>` saves what it was given, whatever the environment says
 *     (the target is resolved as the flag would be; the environment decides
 *     what is ANSWERED, never what is saved);
 *   - `follow` never writes THROUGH a link at the config path: the link is
 *     replaced by the user's own file, and what it pointed at is untouched;
 *   - with nothing chosen `_refresh` asks nobody and writes nothing, and
 *     `vibe` reads no cache;
 *   - the cache directory takes the Windows leg (`%LOCALAPPDATA%`) through
 *     core's one path rule.
 */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Match } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('node:child_process', () => ({ spawn: vi.fn(() => ({ unref: vi.fn() })) }));
vi.mock('../src/cache', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/cache')>();
  return { ...real, readCurrentState: vi.fn(real.readCurrentState) };
});
import { readCurrentState, writeState } from '../src/cache';
import { cmdFollow, cmdPrompt, cmdRefresh, cmdVibe } from '../src/commands';
import { resolveConfig } from '../src/config';
import { makeT } from '../src/i18n';
import { cacheDir } from '../src/paths';

const NOW = new Date('2026-10-10T15:00:00.000Z');
const m = (over: Partial<Match>): Match => ({
  id: '800000001',
  stage: 'REGULAR',
  kickoff: '2026-10-10T14:20:00.000Z',
  venue: 'Emirates Stadium',
  home: { code: 'AFC', name: 'Arsenal FC', id: 'espn:359' },
  away: { code: 'CHE', name: 'Chelsea', id: 'espn:363' },
  status: 'LIVE',
  minute: 40,
  score: { home: 2, away: 1 },
  updatedAt: NOW.toISOString(),
  ...over,
});
const mine = () => m({});
const other = () =>
  m({ id: '800000002', kickoff: '2026-10-10T14:10:00.000Z', home: { code: 'BRE', name: 'Brentford', id: 'espn:337' }, away: { code: 'LIV', name: 'Liverpool', id: 'espn:364' }, minute: 50, score: { home: 1, away: 0 } });

let tmp: string;
const ENV = ['XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'CLAUDINHO_COMPETITION', 'CLAUDINHO_TEAM', 'LOCALAPPDATA'] as const;
const saved: Record<string, string | undefined> = {};
const outSpy = vi.spyOn(process.stdout, 'write');
let writes: string[] = [];
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'claudinho-follow-edges-'));
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.XDG_CONFIG_HOME = join(tmp, 'config');
  process.env.XDG_CACHE_HOME = join(tmp, 'cache');
  writes = [];
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
  vi.mocked(readCurrentState).mockClear();
});
afterEach(() => {
  outSpy.mockReset();
  vi.unstubAllGlobals();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(tmp, { recursive: true, force: true });
});
const text = () => writes.join('');
const configFile = () => join(tmp, 'config', 'claudinho', 'config.json');
const follow = (body: Record<string, unknown>) => {
  mkdirSync(join(tmp, 'config', 'claudinho'), { recursive: true });
  writeFileSync(configFile(), JSON.stringify(body));
};
const ctxOf = () => {
  const cfg = resolveConfig({ tz: 'UTC', color: false, source: 'espn', flavor: 'off', markets: false });
  return { cfg, t: makeT('en'), now: NOW };
};

describe('the ambient pick', () => {
  it('CLAUDINHO_TEAM wins over the saved pin', () => {
    follow({ version: 1, competition: 'eng.1', team: { id: 'espn:359', code: 'ARS', name: 'Arsenal' } });
    // Cached with the pinned match SECOND, so no preference and the pin read differently.
    writeState({ updatedAt: NOW.toISOString(), live: [other(), mine()], degraded: false, source: 'espn', competition: 'eng.1' }, NOW.getTime());
    process.env.CLAUDINHO_TEAM = 'BRE';
    cmdPrompt(ctxOf(), { cursor: undefined });
    expect(text()).toMatch(/^⚽ BRE 1–0 LIV 50'/);
    expect(text()).toContain('+1');
    // Without it, the pin decides.
    writes = [];
    delete process.env.CLAUDINHO_TEAM;
    cmdPrompt(ctxOf(), { cursor: undefined });
    expect(text()).toMatch(/^⚽ AFC 2–1 CHE 40'/);
    // An empty one is absent: the pin decides.
    writes = [];
    process.env.CLAUDINHO_TEAM = '';
    cmdPrompt(ctxOf(), { cursor: undefined });
    expect(text()).toMatch(/^⚽ AFC 2–1 CHE 40'/);
  });
});

describe('follow writes what it was given, as its own file', () => {
  it('the environment decides what is answered, never what is saved', async () => {
    process.env.CLAUDINHO_COMPETITION = 'laliga';
    await cmdFollow('premier-league', {}, ctxOf());
    expect(JSON.parse(readFileSync(configFile(), 'utf8'))).toEqual({ version: 1, competition: 'eng.1' });
    // And it says the environment wins while it is set.
    expect(text()).toMatch(/CLAUDINHO_COMPETITION is set/);
  });

  it('a link at the config path is replaced, never written through', async () => {
    if (process.platform === 'win32') return;
    const target = join(tmp, 'elsewhere.json');
    writeFileSync(target, 'not mine');
    mkdirSync(join(tmp, 'config', 'claudinho'), { recursive: true });
    symlinkSync(target, configFile());
    await cmdFollow('premier-league', {}, ctxOf());
    expect(readFileSync(target, 'utf8')).toBe('not mine');
    expect(lstatSync(configFile()).isSymbolicLink()).toBe(false);
    expect(JSON.parse(readFileSync(configFile(), 'utf8'))).toEqual({ version: 1, competition: 'eng.1' });
  });
});

describe('the pin and the override, beside the main suites', () => {
  it('a refused override carries no pin (the refusal is the answer), whatever the file holds', () => {
    follow({ version: 1, competition: 'eng.1', team: { id: 'espn:359', code: 'ARS', name: 'Arsenal' } });
    process.env.CLAUDINHO_COMPETITION = 'foo';
    const cfg = resolveConfig({});
    expect(cfg.selection.kind).toBe('refused');
    expect(cfg.pin).toBeUndefined();
    // And an empty environment is absent: the file chooses, and its pin applies.
    process.env.CLAUDINHO_COMPETITION = '';
    expect(resolveConfig({}).pin).toEqual({ id: 'espn:359', code: 'ARS', name: 'Arsenal' });
  });

  it('`follow off --json` under the environment: the environment is in effect, nothing is saved, nothing is overridden', async () => {
    follow({ version: 1, competition: 'eng.1' });
    process.env.CLAUDINHO_COMPETITION = 'laliga';
    await cmdFollow('off', {}, { ...ctxOf(), cfg: { ...ctxOf().cfg, json: true } });
    const j = JSON.parse(text());
    expect(j.competition).toMatchObject({ slug: 'esp.1', chosenBy: 'env' });
    expect(j.saved).toBeNull();
    expect(j.override).toBeUndefined();
    expect(j.removed).toBe(true);
    expect(existsSync(configFile())).toBe(false);
  });
});

describe('nothing chosen, beside the main first-run suite', () => {
  it('`_refresh` asks nobody and writes nothing', async () => {
    let fetched = 0;
    vi.stubGlobal('fetch', async () => {
      fetched++;
      return new Response('{}', { status: 200 });
    });
    const ctx = ctxOf();
    expect(ctx.cfg.selection).toEqual({ kind: 'none' });
    await cmdRefresh(ctx);
    expect(fetched).toBe(0);
    const dir = join(tmp, 'cache', 'claudinho');
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
  });

  it('`vibe` reads no cache', () => {
    cmdVibe(ctxOf());
    expect(text()).toContain('#VibingLaVidaLoca');
    expect(readCurrentState).not.toHaveBeenCalled();
  });
});

describe('the cache directory', () => {
  it('takes %LOCALAPPDATA% on Windows when XDG_CACHE_HOME is not set (core cacheDirFor)', () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    delete process.env.XDG_CACHE_HOME;
    process.env.LOCALAPPDATA = join(tmp, 'local');
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      expect(cacheDir()).toBe(join(tmp, 'local', 'claudinho'));
    } finally {
      if (platform) Object.defineProperty(process, 'platform', platform);
    }
  });
});
