/**
 * The saved pin on every team-taking surface (0.11 · 2.5b, D2). `next`,
 * `share next` and `markets next` with no argument answer for the saved team
 * as a RESOLVED team (never re-resolved through the roster: its fixture by
 * `isTeam`, the id deciding; by code for an id-less pin, the bundle's nations);
 * `CLAUDINHO_TEAM` and an argument win over it; a pin under a flag or an
 * environment override does not apply (the file is untouched and the pin is
 * another competition's). On the ambient surfaces ONE pick function puts the
 * pinned team's match FIRST and keeps the others (a preference, never a
 * filter: the statusline's `+N` count and the hook's list keep the rest), for
 * the statusline's live line, its syncing matchup and its countdown, the hook
 * and `vibe`'s segment.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Match, ProviderAdapter } from '@claudinho/core';
import { attachFetchMeta, FakeMarketProvider } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CacheState, writeState } from '../src/cache';
import type { ScheduleSlice } from '../src/scheduleSlice';
vi.mock('node:child_process', () => ({ spawn: vi.fn(() => ({ unref: vi.fn() })) }));
import { cmdHook, cmdMarkets, cmdNext, cmdPrompt, cmdShare, cmdVibe, InputError } from '../src/commands';
import { resolveConfig } from '../src/config';
import { renderHook } from '../src/hook';
import { makeT } from '../src/i18n';
import { pickAmbientMatch, renderPrompt } from '../src/statusline';

const NOW = new Date('2026-10-10T15:00:00.000Z');
const m = (over: Partial<Match> = {}): Match => ({
  id: '800000001',
  stage: 'REGULAR',
  kickoff: '2026-10-11T14:00:00.000Z',
  venue: 'Emirates Stadium',
  home: { code: 'AFC', name: 'Arsenal FC', id: 'espn:359' },
  away: { code: 'CHE', name: 'Chelsea', id: 'espn:363' },
  status: 'SCHEDULED',
  updatedAt: NOW.toISOString(),
  ...over,
});
const other = (): Match => m({ id: '800000002', kickoff: '2026-10-10T14:10:00.000Z', home: { code: 'BRE', name: 'Brentford', id: 'espn:337' }, away: { code: 'LIV', name: 'Liverpool', id: 'espn:364' }, status: 'LIVE', minute: 50, score: { home: 1, away: 0 } });
const mine = (): Match => m({ kickoff: '2026-10-10T14:20:00.000Z', status: 'LIVE', minute: 40, score: { home: 2, away: 1 } });
const whole = (ms: Match[]) => attachFetchMeta(ms, { complete: true, omitted: 0, seasons: [] });
/** No standings: a query that needed the roster would be `rosterIncomplete`; the pin needs none. */
const adapter: ProviderAdapter = {
  name: 'espn',
  competition: 'eng.1',
  capabilities: { push: false, latencyHintSec: 0 },
  async fetchByDate() {
    return whole([m()]);
  },
  async fetchLive() {
    return whole([mine(), other()]);
  },
  async fetchWindow() {
    return whole([m()]);
  },
};

let tmp: string;
const ENV = ['XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'CLAUDINHO_COMPETITION', 'CLAUDINHO_TEAM', 'CLAUDINHO_COMPACT', 'CLAUDINHO_MAX'] as const;
const saved: Record<string, string | undefined> = {};
const outSpy = vi.spyOn(process.stdout, 'write');
let writes: string[] = [];
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'claudinho-pin-'));
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
const follow = (competition: string, team?: Record<string, string>) => {
  mkdirSync(join(tmp, 'config', 'claudinho'), { recursive: true });
  writeFileSync(join(tmp, 'config', 'claudinho', 'config.json'), JSON.stringify({ version: 1, competition, ...(team ? { team } : {}) }));
};
const ctxOf = (over: { json?: boolean; competition?: string } = {}, a: ProviderAdapter = adapter) => {
  const cfg = resolveConfig({ tz: 'UTC', color: false, source: 'espn', flavor: 'off', markets: false, ...over });
  return { cfg, t: makeT('en'), adapter: a, now: NOW, marketProvider: new FakeMarketProvider() };
};
const ARSENAL = { id: 'espn:359', code: 'ARS', name: 'Arsenal' };

describe('the commands', () => {
  it('`next` with no argument answers for the pinned club by its id, without re-resolving (no roster read)', async () => {
    follow('eng.1', ARSENAL);
    const ctx = ctxOf();
    expect(ctx.cfg.selection).toMatchObject({ chosenBy: 'saved', slug: 'eng.1' });
    await cmdNext(undefined, ctx);
    expect(text()).toContain('Chelsea');
    expect(text()).not.toMatch(/roster could not be read|Usage:/);
    writes = [];
    await cmdNext(undefined, ctxOf({ json: true }));
    const j = JSON.parse(text());
    expect(j.fixture?.id).toBe('800000001');
    expect(j.team).toMatchObject({ id: 'espn:359' });
    // The same query by ARGUMENT needs the roster this adapter does not serve: a different answer, so the pin was not re-resolved.
    writes = [];
    await cmdNext('ARS', ctxOf());
    expect(text()).toContain('roster could not be read');
  });

  it('`share next` and `markets next` with no argument take the pin too', async () => {
    follow('eng.1', ARSENAL);
    await cmdShare('next', undefined, {}, ctxOf());
    expect(text()).toContain('Chelsea');
    expect(text()).toContain('--competition premier-league next');
    writes = [];
    await cmdMarkets('next', undefined, ctxOf());
    // Off the World Cup the market sidecar is not offered; the command still answers for the pinned team, never "Usage".
    expect(text()).not.toContain('Usage:');
    expect(text()).toContain('Not available for this competition yet');
  });

  it('`CLAUDINHO_TEAM` and an argument win over the pin', async () => {
    follow('eng.1', ARSENAL);
    process.env.CLAUDINHO_TEAM = 'BRE';
    await cmdNext(undefined, ctxOf({ json: true }));
    expect(JSON.parse(text()).team).not.toMatchObject({ id: 'espn:359' });
    writes = [];
    await cmdNext('Chelsea', ctxOf({ json: true }));
    expect(JSON.parse(text()).team).not.toMatchObject({ id: 'espn:359' });
  });

  it('a pin under a flag or an environment override does not apply', async () => {
    follow('eng.1', ARSENAL);
    const laliga: ProviderAdapter = { ...adapter, competition: 'esp.1' };
    process.env.CLAUDINHO_COMPETITION = 'laliga';
    const envCtx = ctxOf({}, laliga);
    expect(envCtx.cfg.selection).toMatchObject({ chosenBy: 'env' });
    await expect(cmdNext(undefined, envCtx)).rejects.toThrow(InputError);
    await expect(cmdNext(undefined, envCtx)).rejects.toThrow(/Usage/);
    delete process.env.CLAUDINHO_COMPETITION;
    await expect(cmdNext(undefined, ctxOf({ competition: 'laliga' }, laliga))).rejects.toThrow(/Usage/);
    // Under its own competition, chosen explicitly, the pin applies neither: the file decides only when the file chose.
    await expect(cmdNext(undefined, ctxOf({ competition: 'premier-league' }))).rejects.toThrow(/Usage/);
  });

  it('an id-less pin (the bundle\'s Mexico) answers by code', async () => {
    follow('fifa.world', { code: 'MEX', name: 'Mexico' });
    const wc: ProviderAdapter = { ...adapter, competition: 'fifa.world', async fetchWindow() { return []; } };
    await cmdNext(undefined, { ...ctxOf({ json: true }, wc), now: new Date('2026-06-01T00:00:00Z') });
    const j = JSON.parse(text());
    expect(j.fixture?.home?.code === 'MEX' || j.fixture?.away?.code === 'MEX').toBe(true);
  });
});

describe('one pick function for the ambient surfaces', () => {
  it('pickAmbientMatch: the pinned team\'s match first (by id for a pin with one, by code for one without), the others kept', () => {
    const picked = pickAmbientMatch([other(), mine()], { team: ARSENAL });
    expect(picked.map((x) => x.id)).toEqual(['800000001', '800000002']);
    expect(pickAmbientMatch([other(), mine()], { code: 'AFC' }).map((x) => x.id)).toEqual(['800000001', '800000002']);
    // A side carrying another club's id is not the pin's, whatever its code.
    const impostor = m({ id: '800000003', home: { code: 'ARS', name: 'Arsenal', id: 'espn:999' } });
    expect(pickAmbientMatch([other(), impostor], { team: ARSENAL }).map((x) => x.id)).toEqual(['800000002', '800000003']);
    // An id-less pin matches by code.
    expect(pickAmbientMatch([other(), impostor], { team: { code: 'ARS', name: 'Arsenal' } }).map((x) => x.id)).toEqual(['800000003', '800000002']);
    // No pick: the order as given.
    expect(pickAmbientMatch([other(), mine()], undefined).map((x) => x.id)).toEqual(['800000002', '800000001']);
  });

  it('the statusline: the pinned match first and the rest counted (`+1`), never filtered to one', () => {
    const state: CacheState = { updatedAt: NOW.toISOString(), live: [other(), mine()], degraded: false, source: 'espn', competition: 'eng.1' };
    const line = renderPrompt(state, { defaultCompetition: false, teamKind: 'club', now: NOW, pick: { team: ARSENAL }, compact: true });
    expect(line).toMatch(/^⚽ AFC 2–1 CHE 40'/);
    expect(line).toContain('+1');
    // By code, the same.
    expect(renderPrompt(state, { defaultCompetition: false, teamKind: 'club', now: NOW, pick: { code: 'AFC' }, compact: true })).toContain('+1');
  });

  it('the hook lists the pinned match first and keeps the other', () => {
    const state: CacheState = { updatedAt: NOW.toISOString(), live: [other(), mine()], degraded: false, source: 'espn', competition: 'eng.1' };
    const ctx = renderHook(state, { defaultCompetition: false, teamKind: 'club', pick: { team: ARSENAL } }) ?? '';
    expect(ctx.indexOf('Arsenal FC')).toBeGreaterThan(-1);
    expect(ctx.indexOf('Arsenal FC')).toBeLessThan(ctx.indexOf('Brentford'));
  });

  it('through the commands, from the file: `prompt`, `hook` and `vibe` read the pin at the edge', () => {
    follow('eng.1', ARSENAL);
    writeState({ updatedAt: NOW.toISOString(), live: [other(), mine()], degraded: false, source: 'espn', competition: 'eng.1' }, NOW.getTime());
    const ctx = ctxOf();
    cmdPrompt(ctx, { cursor: undefined });
    expect(text()).toMatch(/AFC 2–1 CHE/);
    expect(text()).toContain('+1');
    writes = [];
    cmdHook(ctx);
    expect(text().indexOf('Arsenal FC')).toBeLessThan(text().indexOf('Brentford'));
    writes = [];
    cmdVibe(ctx);
    expect(text()).toMatch(/AFC 2–1 CHE/);
  });

  it('the countdown and the syncing matchup prefer the pinned fixture', () => {
    const later = m({ id: '800000005', kickoff: '2026-10-10T16:00:00.000Z', home: { code: 'BRE', name: 'Brentford', id: 'espn:337' }, away: { code: 'LIV', name: 'Liverpool', id: 'espn:364' } });
    const pinned = m({ id: '800000006', kickoff: '2026-10-10T18:00:00.000Z' });
    const iso = (ms: number) => new Date(ms).toISOString();
    const ago = NOW.getTime() - 10 * 60_000;
    const schedule: ScheduleSlice = {
      index: [later, pinned].map((x) => ({ id: x.id, kickoff: x.kickoff, on: true })),
      fixtures: [later, pinned],
      attemptedAt: iso(ago),
      updatedAt: iso(ago),
      failures: 0,
    };
    const state: CacheState = { updatedAt: iso(NOW.getTime() - 3_600_000), live: [], degraded: false, source: 'espn', competition: 'eng.1', schedule };
    // Without a pick the earliest counts down; with the pin, the pinned fixture.
    expect(renderPrompt(state, { defaultCompetition: false, teamKind: 'club', now: NOW })).toMatch(/BRE vs LIV in/);
    expect(renderPrompt(state, { defaultCompetition: false, teamKind: 'club', now: NOW, pick: { team: ARSENAL } })).toMatch(/AFC vs CHE in/);
  });
});
