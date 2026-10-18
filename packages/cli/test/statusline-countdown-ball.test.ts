/**
 * The countdown line starts with the ball (0.12.0, item 4).
 *
 * The live line (`⚽ ARS 2–1 CHE 50'`) and the syncing line (`⚽ ARS vs CHE live · syncing…`) start with `⚽ `; the
 * countdown did not (`ARS vs LEE in 2d4h`). It now does, on both of its forms: `claudinho prompt`'s English one
 * (`⚽ ARS vs LEE in 2d4h`, and for a due fixture, #183, `⚽ BET vs BAR now`) and `ambient --json`'s line in the
 * reader's language (`⚽ ARS vs LEE en 2d4h`, `⚽ BET vs BAR ahora`), whose `lineParts` stay ONE plain part holding
 * the whole line, ball included. The width's final cut (`promptLine`: `truncateVisible(unfitted, columns)`, core's
 * `text.ts`, the `…` marker one column) counts the ball as two display columns and its space as one, so a narrow
 * `--columns` cuts a line that starts with `⚽`.
 *
 * Every kickoff here is one every wall clock has already passed, and every render is handed its request clock.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Match } from '@claudinho/core';
import { displayWidth } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CacheState, writeState } from '../src/cache';
import { cmdAmbient, cmdPrompt } from '../src/commands';
import * as cursorPayload from '../src/cursorPayload';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';
import { renderPrompt } from '../src/statusline';
import { described } from './config-of';

vi.mock('node:child_process', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:child_process')>();
  return { ...mod, spawn: vi.fn(() => ({ unref() {} })) };
});

type Lang = 'en' | 'es' | 'pt' | 'fr';
const LANGS: Lang[] = ['en', 'es', 'pt', 'fr'];
/** Core's `countdownPhrase`: the language's `in` before a span, its bare word for a kickoff at or before the clock. */
const IN: Record<Lang, string> = { en: 'in', es: 'en', pt: 'em', fr: 'dans' };
const NOW_WORD: Record<Lang, string> = { en: 'now', es: 'ahora', pt: 'agora', fr: 'maintenant' };

const MIN = 60_000;
const HOUR = 60 * MIN;
/** The request clock: two weeks before this change (every wall clock has passed it and both kickoffs below). */
const NOW = new Date('2026-10-03T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

type Club = { id: string; code: string; name: string };
const ARS: Club = { id: 'espn:359', code: 'ARS', name: 'Arsenal' };
const LEE: Club = { id: 'espn:357', code: 'LEE', name: 'Leeds United' };
const BET: Club = { id: 'espn:244', code: 'BET', name: 'Real Betis' };
const BAR: Club = { id: 'espn:83', code: 'BAR', name: 'Barcelona' };

const fixture = (id: string, kickoff: number, home: Club, away: Club): Match =>
  ({ id, stage: 'REGULAR', kickoff: iso(kickoff), venue: 'Stadium', home, away, status: 'SCHEDULED', updatedAt: iso(NOW.getTime() - HOUR) }) as Match;

/** Arsenal v Leeds, 52 hours after the clock: "in 2d4h". */
const AHEAD = fixture('501', NOW.getTime() + 52 * HOUR, ARS, LEE);
/** Real Betis v Barcelona, a minute before the clock, still SCHEDULED: due (#183), "now". */
const DUE = fixture('502', NOW.getTime() - MIN, BET, BAR);

/**
 * A snapshot off the bundle at the clock: its live slice read 20 seconds ago, whole and empty, not degraded (so
 * neither the live nor the syncing line decides), its schedule slice as the refresher writes it.
 */
const snapshot = (competition: string, fixtures: Match[]): CacheState => ({
  updatedAt: iso(NOW.getTime() - 20_000),
  live: [],
  degraded: false,
  source: 'espn',
  competition,
  liveComplete: true,
  schedule: {
    index: fixtures.map((m) => ({ id: m.id, kickoff: m.kickoff, on: true })),
    fixtures,
    attemptedAt: iso(NOW.getTime() - 10 * MIN),
    updatedAt: iso(NOW.getTime() - 10 * MIN),
    failures: 0,
    complete: true,
  },
});
const COUNTDOWN = () => snapshot('eng.1', [AHEAD]);
const DUE_STATE = () => snapshot('esp.1', [DUE]);

const cfg = (competition: string, lang: Lang = 'en'): CliConfig =>
  described({ lang, tz: undefined, json: true, color: false, source: 'espn', competition, flavor: 'off', markets: true });

let dir: string;
let writes: string[] = [];
const outSpy = vi.spyOn(process.stdout, 'write');
const saved = { cache: process.env.XDG_CACHE_HOME, team: process.env.CLAUDINHO_TEAM, flags: process.env.CLAUDINHO_FLAGS };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-countdown-ball-'));
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
  for (const [k, v] of [['XDG_CACHE_HOME', saved.cache], ['CLAUDINHO_TEAM', saved.team], ['CLAUDINHO_FLAGS', saved.flags]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(dir, { recursive: true, force: true });
});

const prompt = (competition: string, lang: Lang = 'en') => {
  writes = [];
  cmdPrompt({ cfg: cfg(competition, lang), t: makeT(lang), now: NOW }, { cursor: undefined });
  return writes.join('').trim();
};
type Part = { text: string; style?: string };
type View = { line: string; lineParts: Part[]; idle: boolean; empty: boolean; next: { id: string } | null };
const ambient = (competition: string, lang: Lang, opts: { columns?: number } = {}): View => {
  writes = [];
  cmdAmbient({ cfg: cfg(competition, lang), t: makeT(lang), now: NOW }, opts);
  return JSON.parse(writes.join('')) as View;
};

describe('`claudinho prompt`: the countdown line starts with the ball', () => {
  it('a fixture ahead: `⚽ ARS vs LEE in 2d4h`', () => {
    writeState(COUNTDOWN(), NOW.getTime());
    expect(prompt('eng.1')).toBe('⚽ ARS vs LEE in 2d4h');
  });

  it('a due fixture (#183): `⚽ BET vs BAR now`', () => {
    writeState(DUE_STATE(), NOW.getTime());
    expect(prompt('esp.1')).toBe('⚽ BET vs BAR now');
  });

  it('the English line in every language (prompt is an ambient surface): the ball, then `in` / `now`', () => {
    for (const lang of LANGS) {
      writeState(COUNTDOWN(), NOW.getTime());
      expect(prompt('eng.1', lang), lang).toBe('⚽ ARS vs LEE in 2d4h');
      writeState(DUE_STATE(), NOW.getTime());
      expect(prompt('esp.1', lang), lang).toBe('⚽ BET vs BAR now');
    }
  });
});

describe('`claudinho ambient --json --lang <code>`: the line starts with the ball, one plain part', () => {
  for (const lang of LANGS) {
    it(`${lang}: a fixture ahead: \`⚽ ARS vs LEE ${IN[lang]} 2d4h\`, lineParts one plain part, neither idle nor empty`, () => {
      writeState(COUNTDOWN(), NOW.getTime());
      const v = ambient('eng.1', lang);
      expect(v.line).toBe(`⚽ ARS vs LEE ${IN[lang]} 2d4h`);
      expect(v.lineParts).toEqual([{ text: `⚽ ARS vs LEE ${IN[lang]} 2d4h` }]);
      expect(v).toMatchObject({ idle: false, empty: false });
      expect(v.next?.id).toBe('501');
    });

    it(`${lang}: a due fixture: \`⚽ BET vs BAR ${NOW_WORD[lang]}\`, lineParts one plain part, neither idle nor empty`, () => {
      writeState(DUE_STATE(), NOW.getTime());
      const v = ambient('esp.1', lang);
      expect(v.line).toBe(`⚽ BET vs BAR ${NOW_WORD[lang]}`);
      expect(v.lineParts).toEqual([{ text: `⚽ BET vs BAR ${NOW_WORD[lang]}` }]);
      expect(v).toMatchObject({ idle: false, empty: false });
      expect(v.next?.id).toBe('502');
    });
  }
});

/**
 * The width: `⚽ ARS vs LEE in 2d4h` is 21 display columns (the ball 2, its space 1, the rest 18). The final cut is
 * core's `truncateVisible(line, columns)`: a line wider than `columns` keeps the clusters that fit in `columns - 1`
 * and appends `…` (one column), never splitting the ball.
 */
describe('--columns: the final cut counts the ball (2 columns) and its space', () => {
  it('--columns 21 (the line\'s own width): the whole line, ball included', () => {
    writeState(COUNTDOWN(), NOW.getTime());
    const v = ambient('eng.1', 'en', { columns: 21 });
    expect(v.line).toBe('⚽ ARS vs LEE in 2d4h');
    expect(displayWidth(v.line)).toBe(21);
    expect(v.lineParts).toEqual([{ text: '⚽ ARS vs LEE in 2d4h' }]);
  });

  it('--columns 20 (one column short, which the line without its ball fitted): `⚽ ARS vs LEE in 2d…`', () => {
    writeState(COUNTDOWN(), NOW.getTime());
    const v = ambient('eng.1', 'en', { columns: 20 });
    expect(v.line).toBe('⚽ ARS vs LEE in 2d…');
    expect(displayWidth(v.line)).toBe(20);
    expect(v.lineParts).toEqual([{ text: '⚽ ARS vs LEE in 2d…' }]);
  });

  it('--columns 12 (a cut mid-line): `⚽ ARS vs L…`, 12 columns, one plain part', () => {
    writeState(COUNTDOWN(), NOW.getTime());
    const v = ambient('eng.1', 'en', { columns: 12 });
    expect(v.line).toBe('⚽ ARS vs L…');
    expect(displayWidth(v.line)).toBe(12);
    expect(v.lineParts).toEqual([{ text: '⚽ ARS vs L…' }]);
    expect(v).toMatchObject({ idle: false, empty: false });
  });

  it('--columns 12 in Spanish, a due fixture: `⚽ BET vs B…`', () => {
    writeState(DUE_STATE(), NOW.getTime());
    expect(ambient('esp.1', 'es', { columns: 12 }).line).toBe('⚽ BET vs B…');
  });

  it('--columns 3: the ball and the marker, `⚽…`', () => {
    writeState(COUNTDOWN(), NOW.getTime());
    const v = ambient('eng.1', 'en', { columns: 3 });
    expect(v.line).toBe('⚽…');
    expect(v.lineParts).toEqual([{ text: '⚽…' }]);
  });

  it('--columns 2: the ball does not fit beside the marker, so the marker alone, `…` (the cut never splits a cluster)', () => {
    writeState(COUNTDOWN(), NOW.getTime());
    expect(ambient('eng.1', 'en', { columns: 2 }).line).toBe('…');
  });

  it('the renderer itself, at the same widths: `renderPrompt` with `columns` cuts the same line', () => {
    const opts = { defaultCompetition: false, teamKind: 'club' as const, now: NOW };
    expect(renderPrompt(COUNTDOWN(), opts)).toBe('⚽ ARS vs LEE in 2d4h');
    expect(renderPrompt(COUNTDOWN(), { ...opts, columns: 12 })).toBe('⚽ ARS vs L…');
    expect(renderPrompt(COUNTDOWN(), { ...opts, columns: 3 })).toBe('⚽…');
    expect(renderPrompt(DUE_STATE(), opts)).toBe('⚽ BET vs BAR now');
  });
});
