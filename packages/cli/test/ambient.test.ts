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
import { DISCLAIMER, displayWidth } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeBackoffNote, writeState } from '../src/cache';
import { ambientView } from '../src/ambient';
import { cmdAmbient, cmdPrompt } from '../src/commands';
import * as cursorPayload from '../src/cursorPayload';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';
import { renderHook } from '../src/hook';
import { DISPLAY_STALE_MS, renderPrompt } from '../src/statusline';
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
  // The schedule slice as the refresher writes it off the bundle (the smoke's seed writes the same): a snapshot
  // with none says discovery was never made, and `refreshWanted` then starts one on a cache of any age.
  const schedule = { updatedAt: at, attemptedAt: at, failures: 0, complete: true };
  // The read that filled the slice was WHOLE (the snapshot states it: an empty list is "nothing on" only then).
  writeState({ updatedAt: at, live: matches, degraded: false, source: 'espn', competition: 'eng.1', schedule, liveComplete: true } as never, NOW.getTime());
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
    expect(v).toMatchObject({ current: true, degraded: false, source: 'espn', updatedAt: NOW.toISOString(), disclaimer: DISCLAIMER });
    expect(Object.keys(v)).toEqual(['line', 'idle', 'empty', 'context', 'live', 'current', 'next', 'pick', 'competition', 'degraded', 'source', 'updatedAt', 'staleAfter', 'disclaimer']);
    expect(v).toMatchObject({ idle: false, empty: false });
    expect(items[0]?.line).toBe("Arsenal 2–1 Chelsea (50')"); // the hook's own line for the record
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

  it('fits WHOLE segments to --columns: a segment that does not fit beside the marker is counted in it', () => {
    seed([live('1', BOU, BRE, [0, 1]), live('2', ARS, CHE, [2, 1]), live('3', BRE, BOU, [1, 1])]);
    cmdAmbient(ctx(), { columns: 30 });
    expect(view().line).toBe("⚽ BOU 0–1 BRE 50' +2");
    writes = [];
    cmdAmbient(ctx(), { columns: 40 });
    expect(view().line).toBe("⚽ BOU 0–1 BRE 50' · ARS 2–1 CHE 50' +1");
  });

  it('the 200-column ceiling is the same fitter: at the ceiling whole segments are dropped and counted (prompt and ambient alike)', () => {
    // Eight segments (the cap) of 25 columns (codes at their 8-column bound) joined by " · " come to 223 columns:
    // seven fit beside " +1" (198), the eighth is counted, never cut mid-segment, and the marker survives.
    const wide = { code: 'ABCDEFGH', name: 'Wide Home', id: 'espn:1001' };
    const also = { code: 'IJKLMNOP', name: 'Wide Away', id: 'espn:1002' };
    const many = Array.from({ length: 8 }, (_, i) => live(String(i + 1), wide, also, [i % 4, 1]));
    seed(many);
    cmdAmbient(ctx());
    const fitted = String(view().line);
    expect(fitted.split(' · ')).toHaveLength(7);
    expect(fitted).toMatch(/ \+1$/u);
    expect(fitted).not.toContain('…');
    expect(ambientView({ updatedAt: NOW.toISOString(), live: many, degraded: false, source: 'espn', competition: 'eng.1' }, { flags: false, defaultCompetition: false, teamKind: 'club', now: NOW }).line).toBe(fitted);
    expect(renderPrompt({ updatedAt: NOW.toISOString(), live: many, degraded: false, source: 'espn', competition: 'eng.1' }, { flags: false, defaultCompetition: false, teamKind: 'club', now: NOW })).toBe(fitted);
    // prompt's OWN write on the same cache (the command, not its renderer).
    vi.spyOn(cursorPayload, 'readCursorPayload').mockReturnValue(undefined);
    writes = [];
    cmdPrompt(ctx());
    expect(writes.join('').trim()).toBe(fitted);
  });

  it('at a width at or below the marker\'s own, the marker is what survives and the line never exceeds the width', () => {
    seed([live('1', ARS, CHE, [2, 1]), live('2', BOU, BRE, [0, 0])]);
    cmdAmbient(ctx(), { columns: 3 }); // " +1" is 3 columns: the body gets none
    expect(String(view().line)).toMatch(/\+1$/u);
    expect(displayWidth(String(view().line))).toBeLessThanOrEqual(3);
    writes = [];
    cmdAmbient(ctx(), { columns: 2 }); // below the marker: the width's cut, nothing wider
    expect(displayWidth(String(view().line))).toBeLessThanOrEqual(2);
    writes = [];
    seed([live('1', ARS, CHE, [2, 1]), ...Array.from({ length: 599 }, () => ({ status: 'LIVE', home: { code: 'AAA' }, away: { code: 'BBB' } }))] as Match[]);
    cmdAmbient(ctx(), { columns: 6 }); // " +more" is 6 columns
    expect(String(view().line)).toMatch(/\+more$/u);
    expect(displayWidth(String(view().line))).toBeLessThanOrEqual(6);
  });

  it('a stamp the reader does not believe (future skew) gives no updatedAt, no staleAfter and current false; one inside the allowance is believed', () => {
    const base = { live: [live('1', ARS, CHE, [2, 1])], degraded: false, source: 'espn', competition: 'eng.1', liveComplete: true };
    const opts = { flags: false, defaultCompetition: false, teamKind: 'club' as const, now: NOW };
    const future = ambientView({ ...base, updatedAt: '2099-01-01T00:00:00.000Z' }, opts);
    expect(future.live.items).toEqual([]);
    expect(future).toMatchObject({ updatedAt: null, staleAfter: null, current: false, source: 'espn' });
    const near = new Date(NOW.getTime() + 30_000).toISOString(); // inside the reader's skew allowance
    const soon = ambientView({ ...base, updatedAt: near }, opts);
    expect(soon.live.items.map((m) => m.id)).toEqual(['1']);
    expect(soon).toMatchObject({ updatedAt: near, current: true });
    expect(soon.staleAfter).toBe(new Date(NOW.getTime() + 30_000 + DISPLAY_STALE_MS).toISOString());
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

  it('a fresh DEGRADED snapshot is never current: an empty list after a failed read says nothing was read, not that nothing is on', () => {
    // The cold refresh whose discovery and live probe both failed writes exactly this: a fresh stamp, no live
    // records, `degraded: true`, no schedule window. The line says nothing is known; so must the view.
    const at = NOW.toISOString();
    // The snapshot even CLAIMS a whole read (the refresher never writes that beside `degraded`; a stated rule gets its
    // own case): degraded alone makes it not current.
    writeState({ updatedAt: at, live: [], degraded: true, source: 'espn', competition: 'eng.1', schedule: { updatedAt: at, attemptedAt: at, failures: 1, complete: false }, liveComplete: true } as never, NOW.getTime());
    cmdAmbient(ctx());
    let v = view();
    expect(v.line).toBe('⚽ —');
    expect(v).toMatchObject({ current: false, degraded: true, live: { items: [], complete: true } });
    // A fresh degraded snapshot that still carries a live record: the line shows it (best effort, as before), the
    // list carries it, and `current` is still false: a program may show it and must not conclude from it.
    writes = [];
    writeState({ updatedAt: at, live: [live('1', ARS, CHE, [2, 1])], degraded: true, source: 'espn', competition: 'eng.1', schedule: { updatedAt: at, attemptedAt: at, failures: 1, complete: false }, liveComplete: true } as never, NOW.getTime());
    cmdAmbient(ctx());
    v = view();
    expect(v.line).toBe("⚽ ARS 2–1 CHE 50'");
    expect((v.live as { items: unknown[] }).items).toHaveLength(1);
    expect(v).toMatchObject({ current: false, degraded: true });
  });

  it('the read\'s completeness is the snapshot\'s to state: an empty list after a read that was not whole is never current; absent is not whole; a value that is not a boolean is not believed', () => {
    // A live read that succeeded but omitted a record (an unreadable score beside readable siblings) is not
    // degraded and persists an empty list: the view must not call that "nothing on".
    const at = NOW.toISOString();
    const schedule = { updatedAt: at, attemptedAt: at, failures: 0, complete: true };
    for (const [liveComplete, current] of [[false, false], [undefined, false], ['yes', false], [true, true]] as const) {
      writes = [];
      writeState({ updatedAt: at, live: [], degraded: false, source: 'espn', competition: 'eng.1', schedule, ...(liveComplete === undefined ? {} : { liveComplete }) } as never, NOW.getTime());
      cmdAmbient(ctx());
      const v = view();
      expect(v.current, `liveComplete ${String(liveComplete)}`).toBe(current);
      expect(v).toMatchObject({ degraded: false, live: { items: [], complete: true } });
      expect(v.line).toBe('⚽ —'); // no discovered window: nothing to sync to
    }
  });

  it('the view says what its line is, before any fit: the edition-complete line is `idle` however narrow the band', () => {
    // The World Cup after its final: every window elapsed, no fixture to count down to, the sign-off line.
    const AUG = new Date('2026-08-01T12:00:00Z');
    const state = { updatedAt: AUG.toISOString(), live: [], degraded: false, source: 'espn', competition: 'fifa.world', liveComplete: true } as never;
    const wide = ambientView(state, { defaultCompetition: true, teamKind: 'nation', now: AUG });
    expect(wide.line).toBe('⚽ World Cup 2026 is complete · claudinho follow --list');
    expect(wide).toMatchObject({ idle: true, empty: false });
    const narrow = ambientView(state, { defaultCompetition: true, teamKind: 'nation', now: AUG, columns: 10 });
    expect(displayWidth(narrow.line)).toBeLessThanOrEqual(10);
    expect(narrow.line).not.toBe(wide.line); // fitted
    expect(narrow).toMatchObject({ idle: true, empty: false }); // and still the idle line, by the field
    // Off the bundle a season's end prints nothing known: empty, never idle.
    const off = ambientView({ ...(state as object), competition: 'eng.1' } as never, { defaultCompetition: false, teamKind: 'club', now: AUG });
    expect(off.line).toBe('⚽ —');
    expect(off).toMatchObject({ idle: false, empty: true });
  });

  it("each live record carries the hook's own line for it, flags and roster names as the hook prints them: one formatter", () => {
    const JUN = new Date('2026-06-20T20:00:00Z');
    const mexRsa = { id: '700123', stage: 'GROUP', group: 'A', kickoff: '2026-06-20T19:00:00Z', venue: 'Estadio Azteca', home: { code: 'MEX', name: 'Mexico' }, away: { code: 'RSA', name: 'South Africa' }, score: { home: 1, away: 0 }, minute: 67, status: 'LIVE', updatedAt: '2026-06-20T20:00:00Z' };
    const state = { updatedAt: JUN.toISOString(), live: [mexRsa], degraded: false, source: 'espn', competition: 'fifa.world', liveComplete: true } as never;
    const flagged = ambientView(state, { defaultCompetition: true, teamKind: 'nation', now: JUN, flags: true });
    expect(flagged.live.items[0]?.line).toBe("🇲🇽 Mexico 1–0 South Africa 🇿🇦 (67')");
    expect(renderHook(state, { defaultCompetition: true, teamKind: 'nation', now: JUN, flags: true })).toContain(flagged.live.items[0]?.line);
    const plain = ambientView(state, { defaultCompetition: true, teamKind: 'nation', now: JUN, flags: false });
    expect(plain.live.items[0]?.line).toBe("Mexico 1–0 South Africa (67')");
    expect(renderHook(state, { defaultCompetition: true, teamKind: 'nation', now: JUN, flags: false })).toContain(plain.live.items[0]?.line);
  });

  it('`pinned` is identity: a pin with the record\'s id pins under another code; a pin with another id does not pin the same code', () => {
    seed([live('1', ARS, CHE, [2, 1]), live('2', BOU, BRE, [0, 0])]);
    cmdAmbient(ctx({ pin: { id: 'espn:359', code: 'XXX', name: 'Elsewhere' } }));
    let items = (view().live as { items: Array<Record<string, unknown>> }).items;
    expect(items.map((m) => [m.id, m.pinned])).toEqual([['1', true], ['2', false]]);
    writes = [];
    cmdAmbient(ctx({ pin: { id: 'espn:999', code: 'ARS', name: 'Arsenal' } }));
    items = (view().live as { items: Array<Record<string, unknown>> }).items;
    expect(items.map((m) => [m.id, m.pinned])).toEqual([['1', false], ['2', false]]);
  });

  it('a CLAUDINHO_TEAM the hot path cannot read (a name off the bundle): no preference, never the pin, said as pickUnreadable', () => {
    seed([live('1', ARS, CHE, [2, 1]), live('2', BOU, BRE, [0, 0])]);
    process.env.CLAUDINHO_TEAM = 'Arsenal';
    cmdAmbient(ctx({ pin: { id: 'espn:359', code: 'ARS', name: 'Arsenal' } }));
    const v = view();
    expect(v.pick).toBeNull();
    expect(v.pickUnreadable).toBe(true);
    const items = (v.live as { items: Array<Record<string, unknown>> }).items;
    expect(items.map((m) => [m.id, m.picked, m.pinned])).toEqual([['1', false, true], ['2', false, false]]); // the order kept, the pin still named
    writes = [];
    delete process.env.CLAUDINHO_TEAM;
    cmdAmbient(ctx({ pin: { id: 'espn:359', code: 'ARS', name: 'Arsenal' } }));
    expect('pickUnreadable' in view()).toBe(false);
  });

  it('nothing chosen: the first-run object alone, no cache read, no spawn; a refused value: the empty line alone', () => {
    cmdAmbient({ ...ctx(), cfg: cfg({ selection: { kind: 'none' }, competition: '' }) });
    expect(view()).toEqual({ competition: null, noCompetition: true, line: '⚽ claudinho follow' });
    writes = [];
    cmdAmbient({ ...ctx(), cfg: cfg({ selection: { kind: 'refused', value: 'nope', aliases: ['premier-league'], chosenBy: 'env' }, competition: '' }) });
    expect(view()).toEqual({ line: '⚽ —', empty: true }); // the fallback object says nothing is known, as a view does
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
  });

  it('triggers the refresher exactly as prompt does: none on a fresh cache, one once discovery is due (measured against prompt)', () => {
    vi.spyOn(cursorPayload, 'readCursorPayload').mockReturnValue(undefined);
    const STALE = 2 * 3600_000; // discovery is hourly off the bundle: due on a two-hour-old slice
    seed([live('1', ARS, CHE, [2, 1])]);
    cmdAmbient(ctx());
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
    seed([live('1', ARS, CHE, [2, 1])], STALE);
    writes = [];
    cmdAmbient(ctx());
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1);
    expect(view()).toMatchObject({ live: { items: [], complete: true }, current: false }); // stale: the reader shows nothing, and says the list is not current
    // prompt on the same two caches: the same two answers (one trigger, `refreshWanted`).
    vi.mocked(spawn).mockClear();
    seed([live('1', ARS, CHE, [2, 1])]);
    cmdPrompt(ctx());
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
    seed([live('1', ARS, CHE, [2, 1])], STALE);
    cmdPrompt(ctx());
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1);
  });

  it('a throttle in effect stops the spawn, as it stops prompt\'s (the one trigger, the note consulted)', () => {
    seed([live('1', ARS, CHE, [2, 1])], 2 * 3600_000); // discovery due (the case above spawns here)
    writeBackoffNote('espn', 'eng.1', NOW.getTime() + 10 * 60_000, NOW.getTime());
    cmdAmbient(ctx());
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
    expect(view().line).toBeTypeOf('string');
  });

  it('no cache at all: the empty line, the live list empty and complete, the deadline absent', () => {
    cmdAmbient(ctx());
    const v = view();
    expect(v.line).toBe('⚽ —');
    expect(v).toMatchObject({ empty: true, idle: false }); // the view SAYS nothing is known: a program never greps the line
    expect(v.live).toMatchObject({ items: [], total: 0, shown: 0, complete: true });
    expect(v.current).toBe(false);
    expect(v.context).toBeNull();
    expect(v.staleAfter).toBeNull();
    expect(v.updatedAt).toBeNull();
    expect(v.next).toBeNull();
    expect(v).toMatchObject({ degraded: false, source: null, disclaimer: DISCLAIMER });
  });
});
