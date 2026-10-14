/**
 * The goal moments, 4a-i: what `claudinho ambient --json` adds for the plugin's toasts, celebration and band.
 *
 *   - `finished`: the snapshot's `play.finished` records (the refresher's record of a match it saw in play and a whole
 *     read then returned finished), listed only from a fresh snapshot whose live read was whole, each for 10 minutes
 *     from its own time, judged by the reader's clock; each carries the hook's line for it, `(FT)` in the minute's
 *     place;
 *   - per record, live and finished: `pinnedSide` (the SAVED pin's side by core's `isPinnedSide`, never
 *     `CLAUDINHO_TEAM`) and `names` (the names the hook's line prints, a nation's roster name included); per live
 *     record, `lastGoal`, re-sealed by the reader with core's `sealEvent`, else null;
 *   - `lineParts`: the band's line as parts, built by the fitter, whose texts join to `line` exactly, the score
 *     token `strong` where the fit kept it whole;
 * and nothing the statusline, the hook or `prompt` prints changes.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Match } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ambientView } from '../src/ambient';
import { writeState } from '../src/cache';
import { cmdAmbient, cmdHook, cmdPrompt } from '../src/commands';
import * as cursorPayload from '../src/cursorPayload';
import type { CliConfig } from '../src/config';
import { hookLine, renderHook } from '../src/hook';
import { makeT } from '../src/i18n';
import { DISPLAY_STALE_MS, renderPrompt } from '../src/statusline';
import { described } from './config-of';

vi.mock('node:child_process', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:child_process')>();
  return { ...mod, spawn: vi.fn(() => ({ unref() {} })) };
});

const NOW = new Date('2026-10-10T15:00:00Z');
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
type T = { code: string; name: string; id?: string };
const ARS: T = { code: 'ARS', name: 'Arsenal', id: 'espn:359' };
const CHE: T = { code: 'CHE', name: 'Chelsea', id: 'espn:363' };
const BOU: T = { code: 'BOU', name: 'Bournemouth', id: 'espn:349' };
const BRE: T = { code: 'BRE', name: 'Brentford', id: 'espn:337' };
const live = (id: string, home: T, away: T, score: [number, number], minute = 50): Match => ({
  id,
  stage: 'REGULAR',
  kickoff: new Date(NOW.getTime() - minute * MIN).toISOString(),
  venue: 'Emirates Stadium',
  home,
  away,
  status: 'LIVE',
  minute,
  score: { home: score[0], away: score[1] },
  updatedAt: NOW.toISOString(),
});
const ft = (id: string, home: T, away: T, score: [number, number]): Match => ({
  id,
  stage: 'REGULAR',
  kickoff: new Date(NOW.getTime() - 110 * MIN).toISOString(),
  venue: 'Vitality Stadium',
  home,
  away,
  status: 'FT',
  score: { home: score[0], away: score[1] },
  updatedAt: NOW.toISOString(),
});
/** One entry of the snapshot's `play.finished`, first seen finished `agoMs` before NOW. */
const done = (m: Match, agoMs = MIN) => ({ match: m, at: iso(NOW.getTime() - agoMs) });
type Seed = { ageMs?: number; liveComplete?: unknown; play?: unknown; competition?: string };
const seed = (matches: unknown[], o: Seed = {}) => {
  const at = new Date(NOW.getTime() - (o.ageMs ?? 0)).toISOString();
  const schedule = { updatedAt: at, attemptedAt: at, failures: 0, complete: true };
  writeState(
    {
      updatedAt: at,
      live: matches,
      degraded: false,
      source: 'espn',
      competition: o.competition ?? 'eng.1',
      schedule,
      ...('liveComplete' in o ? (o.liveComplete === undefined ? {} : { liveComplete: o.liveComplete }) : { liveComplete: true }),
      ...(o.play !== undefined ? { play: o.play } : {}),
    } as never,
    NOW.getTime(),
  );
};
const cfg = (over: Partial<CliConfig> = {}): CliConfig =>
  described({ lang: 'en', tz: undefined, json: true, color: false, source: 'espn', competition: 'eng.1', flavor: 'off', markets: true, ...over });

let dir: string;
let writes: string[] = [];
const outSpy = vi.spyOn(process.stdout, 'write');
const env = { cache: process.env.XDG_CACHE_HOME, team: process.env.CLAUDINHO_TEAM, flags: process.env.CLAUDINHO_FLAGS };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-ambient-goal-'));
  process.env.XDG_CACHE_HOME = dir;
  delete process.env.CLAUDINHO_TEAM;
  process.env.CLAUDINHO_FLAGS = '0';
  writes = [];
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
  vi.spyOn(cursorPayload, 'readCursorPayload').mockReturnValue(undefined);
});
afterEach(() => {
  outSpy.mockReset();
  for (const [k, v] of [['XDG_CACHE_HOME', env.cache], ['CLAUDINHO_TEAM', env.team], ['CLAUDINHO_FLAGS', env.flags]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(dir, { recursive: true, force: true });
});
type Rec = Record<string, unknown>;
const view = () => {
  const text = writes.join('');
  expect(text.trim().split('\n'), 'one JSON line').toHaveLength(1);
  return JSON.parse(text) as Rec;
};
const ctx = (over: Partial<CliConfig> = {}) => ({ cfg: cfg(over), t: makeT('en'), now: NOW });
const ambient = (over: Partial<CliConfig> = {}, opts: { columns?: number } = {}) => {
  writes = [];
  cmdAmbient(ctx(over), opts);
  return view();
};
const liveItems = (v: Rec) => (v.live as { items: Rec[] }).items;
const finishedOf = (v: Rec) => v.finished as Rec[];
type Part = { text: string; style?: string };
const partsOf = (v: { lineParts?: unknown }) => v.lineParts as Part[];
const joined = (parts: Part[]) => parts.map((p) => p.text).join('');
const strong = (parts: Part[]) => parts.filter((p) => p.style === 'strong');

describe('ambient --json: finished', () => {
  it('lists the snapshot\'s play.finished records, each with pinnedSide, names and the hook\'s line ending (FT), from a fresh whole snapshot', () => {
    seed([live('1', ARS, CHE, [2, 1])], { play: { seen: [{ id: '1', at: iso(NOW.getTime() - MIN) }], finished: [done(ft('9', BOU, BRE, [1, 3]))] } });
    const v = ambient();
    const f = finishedOf(v);
    expect(f.map((m) => m.id)).toEqual(['9']);
    expect(f[0]).toMatchObject({ id: '9', status: 'FT', score: { home: 1, away: 3 }, pinnedSide: null, names: { home: 'Bournemouth', away: 'Brentford' } });
    expect(f[0]?.line).toBe('Bournemouth 1–3 Brentford (FT)');
    expect(String(f[0]?.line)).toMatch(/\(FT\)$/u);
    expect(liveItems(v).map((m) => m.id)).toEqual(['1']);
  });

  it('a finished record is never in live, even when the snapshot\'s live list carries it', () => {
    const nine = ft('9', BOU, BRE, [1, 3]);
    seed([live('1', ARS, CHE, [2, 1]), nine], { play: { seen: [], finished: [done(nine)] } });
    const v = ambient();
    expect(liveItems(v).map((m) => m.id)).toEqual(['1']);
    expect(finishedOf(v).map((m) => m.id)).toEqual(['9']);
  });

  it('hidden (an empty list) when the snapshot does not say its live read was whole: false, absent, not a boolean', () => {
    for (const liveComplete of [false, undefined, 'yes']) {
      seed([], { liveComplete, play: { seen: [], finished: [done(ft('9', BOU, BRE, [1, 3]))] } });
      expect(finishedOf(ambient()), `liveComplete ${String(liveComplete)}`).toEqual([]);
    }
  });

  it('listed for its own 10 minutes by the reader\'s clock, even from a snapshot older than the display window', () => {
    // The snapshot is stamped at the full-time read and the entry with it; after the last match ends the refresher
    // stops polling, so the snapshot ages past `DISPLAY_STALE_MS` while the entry is still inside its own 10 minutes.
    expect(DISPLAY_STALE_MS).toBe(5 * MIN);
    for (const [label, agoMs, listed] of [
      ['+6 minutes', 6 * MIN, true],
      ['+9 minutes', 9 * MIN, true],
      ['+10 minutes and 1 ms', 10 * MIN + 1, false],
    ] as const) {
      seed([], { ageMs: agoMs, play: { seen: [], finished: [done(ft('9', BOU, BRE, [1, 3]), agoMs)] } });
      const v = ambient();
      expect(finishedOf(v).map((m) => m.id), label).toEqual(listed ? ['9'] : []);
      if (listed) expect(finishedOf(v)[0]?.line, label).toBe('Bournemouth 1–3 Brentford (FT)');
    }
  });

  it('from a snapshot past the display window, an entry past its own 10 minutes is still hidden, and so is every entry when liveComplete is not true', () => {
    seed([], { ageMs: 6 * MIN, play: { seen: [], finished: [done(ft('8', ARS, CHE, [0, 0]), 11 * MIN), done(ft('9', BOU, BRE, [1, 3]), 6 * MIN)] } });
    expect(finishedOf(ambient()).map((m) => m.id)).toEqual(['9']);
    for (const liveComplete of [false, undefined, 'yes']) {
      seed([], { ageMs: 6 * MIN, liveComplete, play: { seen: [], finished: [done(ft('9', BOU, BRE, [1, 3]), 6 * MIN)] } });
      expect(finishedOf(ambient()), `liveComplete ${String(liveComplete)}`).toEqual([]);
    }
  });

  it('an entry lasts 10 minutes from its own time, by the reader\'s clock; one stamped in the future is not believed', () => {
    seed([], {
      play: {
        seen: [],
        finished: [
          done(ft('7', ARS, CHE, [0, 0]), 9 * MIN),
          done(ft('8', BOU, BRE, [1, 0]), 11 * MIN),
          done(ft('9', BRE, BOU, [2, 2]), -60 * MIN),
        ],
      },
    });
    expect(finishedOf(ambient()).map((m) => m.id)).toEqual(['7']);
  });

  it('a malformed play slice lists nothing and never throws; a malformed entry is left out beside a readable one', () => {
    for (const play of ['x', 42, [], { finished: 'x' }, { finished: [null, 3, { match: null, at: iso(NOW.getTime()) }] }]) {
      seed([], { play });
      expect(finishedOf(ambient()), JSON.stringify(play)).toEqual([]);
    }
    seed([], { play: { seen: [], finished: [{ match: { id: 'junk' }, at: iso(NOW.getTime()) }, done(ft('9', BOU, BRE, [1, 3]))] } });
    expect(finishedOf(ambient()).map((m) => m.id)).toEqual(['9']);
  });
});

describe('ambient --json: pinnedSide is the SAVED pin\'s side', () => {
  it("'home' or 'away' from the saved pin, on live and finished records; null for the others", () => {
    seed([live('1', ARS, CHE, [2, 1]), live('2', BOU, BRE, [0, 0])], { play: { seen: [], finished: [done(ft('9', CHE, ARS, [1, 1]))] } });
    const v = ambient({ pin: { id: 'espn:359', code: 'ARS', name: 'Arsenal' } });
    expect(liveItems(v).map((m) => [m.id, m.pinnedSide])).toEqual([['1', 'home'], ['2', null]]);
    expect(finishedOf(v).map((m) => [m.id, m.pinnedSide])).toEqual([['9', 'away']]);
  });

  it('null with no saved pin; CLAUDINHO_TEAM picks a match and never sets it', () => {
    seed([live('1', ARS, CHE, [2, 1]), live('2', BOU, BRE, [0, 0])], { play: { seen: [], finished: [done(ft('9', BOU, ARS, [1, 1]))] } });
    let v = ambient();
    expect(liveItems(v).map((m) => [m.id, m.pinnedSide])).toEqual([['1', null], ['2', null]]);
    expect(finishedOf(v).map((m) => m.pinnedSide)).toEqual([null]);
    process.env.CLAUDINHO_TEAM = 'BOU'; // the environment's code preference: picked, never pinned
    v = ambient();
    expect(liveItems(v).map((m) => [m.id, m.picked, m.pinnedSide])).toEqual([['2', true, null], ['1', false, null]]);
    expect(finishedOf(v).map((m) => m.pinnedSide)).toEqual([null]);
    // With a saved pin beside it, the pin decides the side, CLAUDINHO_TEAM only the order.
    v = ambient({ pin: { id: 'espn:359', code: 'ARS', name: 'Arsenal' } });
    expect(liveItems(v).map((m) => [m.id, m.picked, m.pinnedSide])).toEqual([['2', true, null], ['1', false, 'home']]);
    expect(finishedOf(v).map((m) => m.pinnedSide)).toEqual(['away']);
  });

  it('identity, as `pinned`: a pin with the record\'s id pins under another code; a pin with another id does not pin the same code', () => {
    seed([live('1', ARS, CHE, [2, 1])]);
    expect(liveItems(ambient({ pin: { id: 'espn:359', code: 'XXX', name: 'Elsewhere' } }))[0]?.pinnedSide).toBe('home');
    expect(liveItems(ambient({ pin: { id: 'espn:999', code: 'ARS', name: 'Arsenal' } }))[0]?.pinnedSide).toBeNull();
  });
});

describe('ambient --json: names are the names the hook\'s line prints', () => {
  it("a club competition: the record's own names (a club coded like a nation is never renamed)", () => {
    const MXL: T = { code: 'MEX', name: 'Mexicali FC', id: 'espn:5001' };
    seed([live('1', ARS, CHE, [2, 1]), live('2', MXL, BRE, [0, 0])], { play: { seen: [], finished: [done(ft('9', BOU, BRE, [1, 3]))] } });
    const v = ambient();
    expect(liveItems(v).map((m) => m.names)).toEqual([{ home: 'Arsenal', away: 'Chelsea' }, { home: 'Mexicali FC', away: 'Brentford' }]);
    expect(finishedOf(v)[0]?.names).toEqual({ home: 'Bournemouth', away: 'Brentford' });
  });

  it('a nations competition (the World Cup): the roster name the hook pins, not the feed\'s', () => {
    const JUN = new Date('2026-06-20T20:00:00Z');
    const mexRsa = { id: '700123', stage: 'GROUP', group: 'A', kickoff: '2026-06-20T19:00:00Z', venue: 'Estadio Azteca', home: { code: 'MEX', name: 'Mexiko' }, away: { code: 'RSA', name: 'South Africa' }, score: { home: 1, away: 0 }, minute: 67, status: 'LIVE', updatedAt: '2026-06-20T20:00:00Z' };
    const state = { updatedAt: JUN.toISOString(), live: [mexRsa], degraded: false, source: 'espn', competition: 'fifa.world', liveComplete: true } as never;
    const v = ambientView(state, { defaultCompetition: true, teamKind: 'nation', now: JUN, flags: false });
    const item = v.live.items[0] as unknown as Rec;
    expect(item.names).toEqual({ home: 'Mexico', away: 'South Africa' });
    expect(item.line).toBe("Mexico 1–0 South Africa (67')"); // the same names, in the hook's own line
    expect(renderHook(state, { defaultCompetition: true, teamKind: 'nation', now: JUN, flags: false })).toContain('Mexico 1–0 South Africa');
  });
});

describe('ambient --json: lastGoal is re-sealed from the snapshot', () => {
  it('a valid stored object comes back equal; a malformed one, or none, is null', () => {
    const cases: Array<[string, unknown]> = [
      ['valid', { type: 'GOAL', minute: 50, side: 'home', teamCode: 'ARS', player: 'Bukayo Saka' }],
      ['valid, added time, a penalty', { type: 'PEN', minute: 90, added: 3, side: 'away', teamCode: 'CHE', player: 'Cole Palmer' }],
      ['minute -1', { type: 'GOAL', minute: -1, side: 'home', teamCode: 'ARS' }],
      ['side middle', { type: 'GOAL', minute: 50, side: 'middle', teamCode: 'ARS' }],
      ['a string', 'x'],
      ['a number', 42],
      ['null', null],
      ['absent', undefined],
    ];
    const records = cases.map(([, g], i) => ({ ...live(String(i + 1), ARS, CHE, [2, 1]), ...(g === undefined ? {} : { lastGoal: g }) }));
    seed(records);
    const items = liveItems(ambient());
    expect(items.map((m) => m.id)).toEqual(cases.map((_, i) => String(i + 1)));
    for (const [i, [label, g]] of cases.entries()) {
      const want = i < 2 ? g : null;
      expect(items[i], label).toHaveProperty('lastGoal', want);
    }
  });

  it("only a scoring event of the record's own side is a lastGoal: a card or a substitution is null, a code that is not its side's is null", () => {
    // ARS (home) v CHE (away) on every record.
    const cases: Array<[string, unknown, boolean]> = [
      ['a yellow card', { type: 'YELLOW', minute: 50, side: 'home', teamCode: 'ARS', player: 'Bukayo Saka' }, false],
      ['a red card', { type: 'RED', minute: 50, side: 'away', teamCode: 'CHE', player: 'Cole Palmer' }, false],
      ['a substitution', { type: 'SUB', minute: 50, side: 'home', teamCode: 'ARS' }, false],
      ['a goal for home under the away code', { type: 'GOAL', minute: 50, side: 'home', teamCode: 'CHE', player: 'Bukayo Saka' }, false],
      ['a goal for away under another code', { type: 'GOAL', minute: 50, side: 'away', teamCode: 'BOU', player: 'Cole Palmer' }, false],
      ['an own goal credited to away, the away code', { type: 'OWN_GOAL', minute: 63, side: 'away', teamCode: 'CHE', player: 'William Saliba' }, true],
      ['a penalty for home, the home code', { type: 'PEN', minute: 70, side: 'home', teamCode: 'ARS', player: 'Bukayo Saka' }, true],
    ];
    seed(cases.map(([, g], i) => ({ ...live(String(i + 1), ARS, CHE, [2, 1]), lastGoal: g })));
    const items = liveItems(ambient());
    expect(items.map((m) => m.id)).toEqual(cases.map((_, i) => String(i + 1)));
    for (const [i, [label, g, kept]] of cases.entries()) expect(items[i], label).toHaveProperty('lastGoal', kept ? g : null);
  });
});

describe('ambient --json: lineParts', () => {
  it('one match, uncut: the texts join to the line, and exactly one part is strong, the score token', () => {
    seed([live('1', ARS, CHE, [2, 1])]);
    const v = ambient();
    expect(v.line).toBe("⚽ ARS 2–1 CHE 50'");
    const parts = partsOf(v);
    expect(joined(parts)).toBe(v.line);
    expect(strong(parts)).toEqual([{ text: '2–1', style: 'strong' }]);
  });

  it('two matches with +N, the joins exact and every strong part a whole score token', () => {
    seed([live('1', BOU, BRE, [0, 1]), live('2', ARS, CHE, [2, 1]), live('3', BRE, BOU, [1, 1])]);
    for (const columns of [30, 40]) {
      const v = ambient({}, { columns });
      expect(String(v.line)).toMatch(/ \+\d$/u);
      const parts = partsOf(v);
      expect(joined(parts), `columns ${columns}`).toBe(v.line);
      expect(strong(parts).length).toBeGreaterThan(0);
      for (const p of strong(parts)) expect(p.text).toMatch(/^\d+–\d+$/u);
    }
    const two = ambient({}, { columns: 40 });
    expect(strong(partsOf(two)).map((p) => p.text)).toEqual(['0–1', '2–1']);
  });

  it('+more (a list nobody could scan whole): the joins exact', () => {
    seed([live('1', ARS, CHE, [2, 1]), ...Array.from({ length: 599 }, () => ({ status: 'LIVE', home: { code: 'AAA' }, away: { code: 'BBB' } }))]);
    const v = ambient();
    expect(String(v.line)).toMatch(/\+more$/u);
    expect(joined(partsOf(v))).toBe(v.line);
    const narrow = ambient({}, { columns: 6 });
    expect(joined(partsOf(narrow))).toBe(narrow.line);
  });

  it('a --columns width that cuts the line: the joins exact, and a score token the fit cut is not strong', () => {
    seed([live('1', ARS, CHE, [2, 1])]);
    for (const columns of [16, 12, 9, 8, 6]) {
      const v = ambient({}, { columns });
      const parts = partsOf(v);
      expect(joined(parts), `columns ${columns}`).toBe(v.line);
      for (const p of strong(parts)) expect(p.text, `columns ${columns}`).toBe('2–1');
      if (!String(v.line).includes('2–1')) expect(strong(parts), `columns ${columns}`).toEqual([]);
    }
  });

  it('a width below the suffix\'s own width: the joins exact, nothing wider', () => {
    seed([live('1', ARS, CHE, [2, 1]), live('2', BOU, BRE, [0, 0])]);
    for (const columns of [3, 2, 1]) {
      const v = ambient({}, { columns });
      expect(joined(partsOf(v)), `columns ${columns}`).toBe(v.line);
    }
  });

  it('flags on and off (the World Cup\'s nations): the joins exact, the score strong', () => {
    const JUN = new Date('2026-06-20T20:00:00Z');
    const mexRsa = { id: '700123', stage: 'GROUP', group: 'A', kickoff: '2026-06-20T19:00:00Z', venue: 'Estadio Azteca', home: { code: 'MEX', name: 'Mexico' }, away: { code: 'RSA', name: 'South Africa' }, score: { home: 1, away: 0 }, minute: 67, status: 'LIVE', updatedAt: '2026-06-20T20:00:00Z' };
    const state = { updatedAt: JUN.toISOString(), live: [mexRsa], degraded: false, source: 'espn', competition: 'fifa.world', liveComplete: true } as never;
    for (const flags of [true, false]) {
      const v = ambientView(state, { defaultCompetition: true, teamKind: 'nation', now: JUN, flags });
      const parts = partsOf(v);
      expect(joined(parts), `flags ${flags}`).toBe(v.line);
      expect(strong(parts).map((p) => p.text), `flags ${flags}`).toEqual(['1–0']);
    }
    expect(ambientView(state, { defaultCompetition: true, teamKind: 'nation', now: JUN, flags: true }).line).not.toBe(
      ambientView(state, { defaultCompetition: true, teamKind: 'nation', now: JUN, flags: false }).line,
    );
  });

  it('the countdown, the syncing line and nothing known: one plain part, the line itself', () => {
    const at = NOW.toISOString();
    const ahead: Match = { id: '9', stage: 'REGULAR', kickoff: new Date(NOW.getTime() + 3 * 3_600_000).toISOString(), venue: 'Vitality Stadium', home: BOU, away: BRE, status: 'SCHEDULED', updatedAt: at };
    writeState({ updatedAt: at, live: [], degraded: false, source: 'espn', competition: 'eng.1', schedule: { fixtures: [ahead], updatedAt: at, attemptedAt: at, failures: 0, complete: true }, liveComplete: true } as never, NOW.getTime());
    let v = ambient();
    expect(v.line).toBe('BOU vs BRE in 3h0m');
    expect(v.lineParts).toEqual([{ text: 'BOU vs BRE in 3h0m' }]);
    const kicked: Match = { ...ahead, kickoff: new Date(NOW.getTime() - 30 * MIN).toISOString() };
    writeState({ updatedAt: at, live: [], degraded: false, source: 'espn', competition: 'eng.1', schedule: { index: [{ id: kicked.id, kickoff: kicked.kickoff, on: true }], fixtures: [kicked], updatedAt: at, attemptedAt: at, failures: 0, complete: true }, liveComplete: false } as never, NOW.getTime());
    v = ambient();
    expect(v.line).toBe('⚽ BOU vs BRE live · syncing…');
    expect(v.lineParts).toEqual([{ text: '⚽ BOU vs BRE live · syncing…' }]);
    rmSync(dir, { recursive: true, force: true });
    v = ambient();
    expect(v.line).toBe('⚽ —');
    expect(v.lineParts).toEqual([{ text: '⚽ —' }]);
  });

  it("the World Cup's sign-off: one plain part", () => {
    const AUG = new Date('2026-08-01T12:00:00Z');
    const v = ambientView({ updatedAt: AUG.toISOString(), live: [], degraded: false, source: 'espn', competition: 'fifa.world', liveComplete: true } as never, { defaultCompetition: true, teamKind: 'nation', now: AUG });
    expect(v.idle).toBe(true);
    expect(v.lineParts).toEqual([{ text: v.line }]);
  });
});

describe('the statusline, the hook and prompt read none of it', () => {
  it('the prompt line, the hook block and `claudinho prompt` and `claudinho hook` are byte-identical with and without play and lastGoal', () => {
    const plain = [live('1', ARS, CHE, [2, 1]), live('2', BOU, BRE, [0, 0])];
    const withGoal = [
      { ...plain[0], lastGoal: { type: 'GOAL', minute: 50, side: 'home', teamCode: 'ARS', player: 'Bukayo Saka' } },
      { ...plain[1], lastGoal: null },
    ];
    const playSlice = { seen: [{ id: '1', at: iso(NOW.getTime() - MIN) }], finished: [done(ft('9', CHE, BRE, [3, 0]))] };
    const surfaces = () => {
      const v = ambient();
      writes = [];
      cmdPrompt(ctx());
      const prompt = writes.join('');
      writes = [];
      cmdHook(ctx());
      const hook = writes.join('');
      return { line: v.line, context: v.context, prompt, hook };
    };
    seed(plain);
    const before = surfaces();
    expect(before.prompt.trim()).toBe(before.line);
    expect(before.hook).toContain('Arsenal 2–1 Chelsea');
    seed(withGoal, { play: playSlice });
    const after = surfaces();
    expect(after).toEqual(before);
    const opts = { flags: false, defaultCompetition: false, teamKind: 'club' as const, now: NOW };
    const state = (live: unknown[], extra: object = {}) => ({ updatedAt: NOW.toISOString(), live, degraded: false, source: 'espn', competition: 'eng.1', liveComplete: true, ...extra }) as never;
    expect(renderPrompt(state(withGoal, { play: playSlice }), opts)).toBe(renderPrompt(state(plain), opts));
    expect(renderHook(state(withGoal, { play: playSlice }), opts)).toBe(renderHook(state(plain), opts));
    expect(after.hook).not.toContain('FT');
  });
});

describe('ambient --json: the key order', () => {
  it('line, lineParts, idle, empty, context, live, finished, current, next, pick, competition, degraded, source, updatedAt, staleAfter, disclaimer, attribution', () => {
    seed([live('1', ARS, CHE, [2, 1])]);
    expect(Object.keys(ambient())).toEqual(['line', 'lineParts', 'idle', 'empty', 'context', 'live', 'finished', 'current', 'next', 'pick', 'competition', 'degraded', 'source', 'updatedAt', 'staleAfter', 'disclaimer', 'attribution']);
  });
});

describe('hookLine: (FT) for a finished record', () => {
  it('a record with status FT prints (FT) in place of the minute', () => {
    expect(hookLine(ft('9', BOU, BRE, [1, 3]), { flags: false, pin: false })).toBe('Bournemouth 1–3 Brentford (FT)');
    expect(hookLine({ ...ft('9', BOU, BRE, [1, 3]), minute: 90 }, { flags: false, pin: false })).toBe('Bournemouth 1–3 Brentford (FT)');
  });

  it('a live record\'s line is unchanged: the minute, half-time, else live', () => {
    expect(hookLine(live('1', ARS, CHE, [2, 1]), { flags: false, pin: false })).toBe("Arsenal 2–1 Chelsea (50')");
    expect(hookLine({ ...live('1', ARS, CHE, [2, 1]), status: 'HT', minute: undefined }, { flags: false, pin: false })).toBe('Arsenal 2–1 Chelsea (half-time)');
    expect(hookLine({ ...live('1', ARS, CHE, [2, 1]), minute: undefined }, { flags: false, pin: false })).toBe('Arsenal 2–1 Chelsea (live)');
  });
});
