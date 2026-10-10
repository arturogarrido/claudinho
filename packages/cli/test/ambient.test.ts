/**
 * `claudinho ambient --json`: the statusline's structured twin for a program (the Claude Code plugin's band and
 * toasts). The SAME hot-path rules as `prompt` (cache-only, no network, no market, the refresher trigger) and the
 * same renderers: `line` is `renderPrompt`'s text, `context` the hook's block, `live` the sealed bounded reader's
 * list of core's `Match` records (with the two preference booleans), the selection through `selectionExtras`, the
 * snapshot's own deadline (`staleAfter`), the disclaimer from core's constant. Exit 0 always; one JSON object.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Match } from '@claudinho/core';
import { DISCLAIMER } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeBackoffNote, writeState } from '../src/cache';
import { cmdAmbient } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';
import { DISPLAY_STALE_MS, renderHook, renderPrompt } from '../src/statusline';
import { described } from './config-of';

vi.mock('node:child_process', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:child_process')>();
  return { ...mod, spawn: vi.fn(() => ({ unref() {} })) };
});
import { spawn } from 'node:child_process';

const NOW = new Date('2026-10-10T15:00:00Z');
const ARS = { code: 'ARS', name: 'Arsenal', id: 'espn:359' };
const CHE = { code: 'CHE', name: 'Chelsea', id: 'espn:363' };
const BOU = { code: 'BOU', name: 'Bournemouth', id: 'espn:349' };
const BRE = { code: 'BRE', name: 'Brentford', id: 'espn:337' };
const live = (id: string, home: typeof ARS, away: typeof ARS, score: [number, number], minute = 50): Match => ({
  id,
  stage: 'REGULAR',
  kickoff: new Date(NOW.getTime() - minute * 60_000).toISOString(),
  venue: 'Emirates Stadium',
  home,
  away,
  status: 'LIVE',
  minute,
  score: { home: score[0], away: score[1] },
  updatedAt: NOW.toISOString(),
});
const seed = (matches: Match[], ageMs = 0) => {
  const at = new Date(NOW.getTime() - ageMs).toISOString();
  writeState({ updatedAt: at, live: matches, degraded: false, source: 'espn', competition: 'eng.1' }, NOW.getTime());
};
const cfg = (over: Partial<CliConfig> = {}): CliConfig =>
  described({ lang: 'en', tz: undefined, json: true, color: false, source: 'espn', competition: 'eng.1', flavor: 'off', markets: true, ...over });

let dir: string;
let writes: string[] = [];
const outSpy = vi.spyOn(process.stdout, 'write');
const env = { cache: process.env.XDG_CACHE_HOME, team: process.env.CLAUDINHO_TEAM, flags: process.env.CLAUDINHO_FLAGS };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-ambient-'));
  process.env.XDG_CACHE_HOME = dir;
  delete process.env.CLAUDINHO_TEAM;
  process.env.CLAUDINHO_FLAGS = '0';
  writes = [];
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
  vi.mocked(spawn).mockClear();
});
afterEach(() => {
  outSpy.mockReset();
  for (const [k, v] of [['XDG_CACHE_HOME', env.cache], ['CLAUDINHO_TEAM', env.team], ['CLAUDINHO_FLAGS', env.flags]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(dir, { recursive: true, force: true });
});
const view = () => {
  const text = writes.join('');
  expect(text.trim().split('\n'), 'one JSON line').toHaveLength(1);
  return JSON.parse(text) as Record<string, unknown>;
};
const ctx = (over: Partial<CliConfig> = {}) => ({ cfg: cfg(over), t: makeT('en'), now: NOW });

describe('claudinho ambient --json', () => {
  it('prints one object: the prompt line, the hook context, the sealed live list, the selection, the deadline, the disclaimer', () => {
    seed([live('1', ARS, CHE, [2, 1])]);
    cmdAmbient(ctx());
    const v = view();
    expect(v.line).toBe("⚽ ARS 2–1 CHE 50'");
    expect(v.context).toBe(renderHook({ updatedAt: NOW.toISOString(), live: [live('1', ARS, CHE, [2, 1])], degraded: false, source: 'espn', competition: 'eng.1' }, { flags: false, defaultCompetition: false, teamKind: 'club', now: NOW }));
    expect(v.live).toMatchObject({ total: 1, shown: 1, truncated: false, complete: true });
    const items = (v.live as { items: Array<Record<string, unknown>> }).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: '1', status: 'LIVE', minute: 50, score: { home: 2, away: 1 }, picked: false, pinned: false });
    expect((items[0] as { home: Record<string, unknown> }).home).toEqual(ARS); // a club: no flag key
    expect(v.next).toBeNull();
    expect(v.pick).toBeNull();
    expect(v.competition).toEqual({ slug: 'eng.1', alias: 'premier-league', name: 'Premier League', chosenBy: 'saved' });
    expect(v).toMatchObject({ degraded: false, source: 'espn', updatedAt: NOW.toISOString(), disclaimer: DISCLAIMER });
    expect(v.staleAfter).toBe(new Date(NOW.getTime() + DISPLAY_STALE_MS).toISOString());
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
  });

  it('the line is renderPrompt\'s, fitted to --columns with the overflow marker reserved', () => {
    seed([live('1', ARS, CHE, [2, 1]), live('2', BOU, BRE, [0, 0]), live('3', BRE, BOU, [1, 1])]);
    cmdAmbient(ctx(), { columns: 24 });
    const v = view();
    const line = String(v.line);
    expect(line).toMatch(/ \+\d$/u); // the marker survives the cut
    expect([...line].length).toBeLessThanOrEqual(24);
    writes = [];
    cmdAmbient(ctx());
    expect(view().line).toBe(renderPrompt({ updatedAt: NOW.toISOString(), live: [live('1', ARS, CHE, [2, 1]), live('2', BOU, BRE, [0, 0]), live('3', BRE, BOU, [1, 1])], degraded: false, source: 'espn', competition: 'eng.1' }, { flags: false, defaultCompetition: false, teamKind: 'club', now: NOW }));
  });

  it('`pinned` is the saved pin\'s side by id; `picked` is the ambient preference\'s side; `pick` says which', () => {
    seed([live('1', ARS, CHE, [2, 1]), live('2', BOU, BRE, [0, 0])]);
    cmdAmbient(ctx({ pin: { id: 'espn:359', code: 'ARS', name: 'Arsenal' } }));
    let v = view();
    let items = (v.live as { items: Array<Record<string, unknown>> }).items;
    expect(items.map((m) => [m.id, m.picked, m.pinned])).toEqual([['1', true, true], ['2', false, false]]);
    expect(v.pick).toEqual({ id: 'espn:359', code: 'ARS', name: 'Arsenal' });
    writes = [];
    process.env.CLAUDINHO_TEAM = 'BOU'; // the environment's code preference: picked, never pinned
    cmdAmbient(ctx({ pin: { id: 'espn:359', code: 'ARS', name: 'Arsenal' } }));
    v = view();
    items = (v.live as { items: Array<Record<string, unknown>> }).items;
    expect(items.map((m) => [m.id, m.picked, m.pinned])).toEqual([['2', true, false], ['1', false, true]]);
    expect(v.pick).toEqual({ code: 'BOU' });
  });

  it('nothing chosen: the first-run object alone, no cache read, no spawn; a refused value: the empty line alone', () => {
    cmdAmbient({ ...ctx(), cfg: cfg({ selection: { kind: 'none' }, competition: '' }) });
    expect(view()).toEqual({ competition: null, noCompetition: true, line: '⚽ claudinho follow' });
    writes = [];
    cmdAmbient({ ...ctx(), cfg: cfg({ selection: { kind: 'refused', value: 'nope', aliases: ['premier-league'], chosenBy: 'env' }, competition: '' }) });
    expect(view()).toEqual({ line: '⚽ —' });
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
  });

  it('triggers the refresher exactly as prompt does: none on a fresh cache, one on a stale one', () => {
    seed([live('1', ARS, CHE, [2, 1])]);
    cmdAmbient(ctx());
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
    seed([live('1', ARS, CHE, [2, 1])], 10 * 60_000);
    cmdAmbient(ctx());
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1);
    expect(view()).toMatchObject({ live: { items: [], complete: true } }); // stale: the reader shows nothing
  });

  it('a throttle in effect stops the spawn, as it stops prompt\'s (the one trigger, the note consulted)', () => {
    seed([live('1', ARS, CHE, [2, 1])], 10 * 60_000);
    writeBackoffNote('espn', 'eng.1', NOW.getTime() + 10 * 60_000, NOW.getTime());
    cmdAmbient(ctx());
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
    expect(view().line).toBeTypeOf('string');
  });

  it('no cache at all: the empty line, the live list empty and complete, the deadline absent', () => {
    cmdAmbient(ctx());
    const v = view();
    expect(v.line).toBe('⚽ —');
    expect(v.live).toMatchObject({ items: [], total: 0, shown: 0, complete: true });
    expect(v.context).toBeNull();
    expect(v.staleAfter).toBeNull();
    expect(v.updatedAt).toBeNull();
    expect(v.next).toBeNull();
    expect(v).toMatchObject({ degraded: false, source: null, disclaimer: DISCLAIMER });
  });
});
