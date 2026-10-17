/**
 * `claudinho ambient --json` in the reader's language (0.12.0, item 3; the design packet's C1 and C2):
 *
 *   - a SELECTED competition's view gains `lang` (the CLI's resolved language: `--lang`, `CLAUDINHO_LANG`, `LANG`'s
 *     language part, else `en`, each tried only when it is one of the four) and `words` (the ten moment words from
 *     core's `moment.*` keys, `{team}` left as a template), placed after `competition`; the first-run object and
 *     the `{ line, empty }` fallback stay as they are;
 *   - on the ambient path only, `line` and `lineParts` are in `lang`: the countdown through core's
 *     `countdownPhrase`, `live · syncing…` through `ambient.syncing`, the live segment's `HT` and `LIVE` through
 *     `status.ht` and `status.live`; the stated exceptions stay English (`+more`, the World Cup's sign-off, `⚽ —`),
 *     and `idle` and `empty` still say what those English lines are;
 *   - `claudinho prompt`, `claudinho hook`, `context`, `attribution`, `disclaimer` and each record's `line` stay
 *     English in every language.
 *
 * The kickoff's bare `now` (`ahora`) arrives with the kickoff fix this item is rebased on; nothing here needs it.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Match } from '@claudinho/core';
import { DISCLAIMER, displayWidth } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeState } from '../src/cache';
import { cmdAmbient, cmdHook, cmdPrompt } from '../src/commands';
import * as cursorPayload from '../src/cursorPayload';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';
import { NOTHING_KNOWN_LINE, TOURNAMENT_COMPLETE_LINE } from '../src/statusline';
import { described } from './config-of';

vi.mock('node:child_process', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:child_process')>();
  return { ...mod, spawn: vi.fn(() => ({ unref() {} })) };
});

type Lang = 'en' | 'es' | 'pt' | 'fr';
const LANGS: Lang[] = ['en', 'es', 'pt', 'fr'];
/** The `words` a view carries per language (core's `moment.*`, templates). */
const WORDS: Record<Lang, Record<string, string>> = {
  en: { goal: 'GOAL!', ownGoal: 'Own goal', ownGoalDetail: 'own goal', goalFor: 'Goal for {team}', goals: 'Goals', scoreUpdated: 'Score updated', penalties: 'Penalties', fullTime: 'Full time', win: '{team} win', draw: 'Draw' },
  es: { goal: '¡GOL!', ownGoal: 'Gol en contra', ownGoalDetail: 'gol en contra', goalFor: 'Gol de {team}', goals: 'Goles', scoreUpdated: 'Marcador corregido', penalties: 'Penales', fullTime: 'Final', win: 'Gana {team}', draw: 'Empate' },
  pt: { goal: 'GOL!', ownGoal: 'Gol contra', ownGoalDetail: 'gol contra', goalFor: 'Gol · {team}', goals: 'Gols', scoreUpdated: 'Placar corrigido', penalties: 'Pênaltis', fullTime: 'Fim de jogo', win: '{team} vence', draw: 'Empate' },
  fr: { goal: 'BUT !', ownGoal: 'But contre son camp', ownGoalDetail: 'contre son camp', goalFor: 'But pour {team}', goals: 'Buts', scoreUpdated: 'Score corrigé', penalties: 'Tirs au but', fullTime: 'Fin du match', win: '{team} gagne', draw: 'Match nul' },
};
const IN: Record<Lang, string> = { en: 'in', es: 'en', pt: 'em', fr: 'dans' };
const SYNCING: Record<Lang, string> = { en: 'live · syncing…', es: 'en vivo · sincronizando…', pt: 'ao vivo · sincronizando…', fr: 'en direct · synchronisation…' };
const HT: Record<Lang, string> = { en: 'HT', es: 'DESC', pt: 'INT', fr: 'MT' };
const LIVE: Record<Lang, string> = { en: 'LIVE', es: 'EN VIVO', pt: 'AO VIVO', fr: 'DIRECT' };

const NOW = new Date('2026-10-10T15:00:00Z');
const MIN = 60_000;
type T = { code: string; name: string; id?: string };
const ARS: T = { code: 'ARS', name: 'Arsenal', id: 'espn:359' };
const CHE: T = { code: 'CHE', name: 'Chelsea', id: 'espn:363' };
const BOU: T = { code: 'BOU', name: 'Bournemouth', id: 'espn:349' };
const BRE: T = { code: 'BRE', name: 'Brentford', id: 'espn:337' };
const live = (id: string, home: T, away: T, score: [number, number], over: Partial<Match> = {}): Match => ({
  id,
  stage: 'REGULAR',
  kickoff: new Date(NOW.getTime() - 50 * MIN).toISOString(),
  venue: 'Emirates Stadium',
  home,
  away,
  status: 'LIVE',
  minute: 50,
  score: { home: score[0], away: score[1] },
  updatedAt: NOW.toISOString(),
  ...over,
});
const at = NOW.toISOString();
const seedLive = (matches: unknown[]) =>
  writeState(
    { updatedAt: at, live: matches, degraded: false, source: 'espn', competition: 'eng.1', schedule: { updatedAt: at, attemptedAt: at, failures: 0, complete: true }, liveComplete: true } as never,
    NOW.getTime(),
  );
const ahead: Match = { id: '9', stage: 'REGULAR', kickoff: new Date(NOW.getTime() + 17 * MIN).toISOString(), venue: 'Vitality Stadium', home: BOU, away: BRE, status: 'SCHEDULED', updatedAt: at };
const seedCountdown = () =>
  writeState(
    { updatedAt: at, live: [], degraded: false, source: 'espn', competition: 'eng.1', schedule: { fixtures: [ahead], updatedAt: at, attemptedAt: at, failures: 0, complete: true }, liveComplete: true } as never,
    NOW.getTime(),
  );
const seedSyncing = () => {
  const kicked: Match = { ...ahead, kickoff: new Date(NOW.getTime() - 30 * MIN).toISOString() };
  writeState(
    { updatedAt: at, live: [], degraded: false, source: 'espn', competition: 'eng.1', schedule: { index: [{ id: kicked.id, kickoff: kicked.kickoff, on: true }], fixtures: [kicked], updatedAt: at, attemptedAt: at, failures: 0, complete: true }, liveComplete: false } as never,
    NOW.getTime(),
  );
};

const cfg = (over: Partial<CliConfig> = {}): CliConfig =>
  described({ lang: 'en', tz: undefined, json: true, color: false, source: 'espn', competition: 'eng.1', flavor: 'off', markets: true, ...over });

let dir: string;
let writes: string[] = [];
const outSpy = vi.spyOn(process.stdout, 'write');
const saved = { cache: process.env.XDG_CACHE_HOME, team: process.env.CLAUDINHO_TEAM, flags: process.env.CLAUDINHO_FLAGS };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-ambient-lang-'));
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
type Rec = Record<string, unknown>;
const printed = () => {
  const text = writes.join('');
  expect(text.trim().split('\n'), 'one JSON line').toHaveLength(1);
  return JSON.parse(text) as Rec;
};
const ctx = (lang: Lang, over: Partial<CliConfig> = {}, now = NOW) => ({ cfg: cfg({ lang, ...over }), t: makeT(lang), now });
const ambient = (lang: Lang, opts: { columns?: number } = {}, over: Partial<CliConfig> = {}, now = NOW) => {
  writes = [];
  cmdAmbient(ctx(lang, over, now), opts);
  return printed();
};
type Part = { text: string; style?: string };
const joined = (v: Rec) => (v.lineParts as Part[]).map((p) => p.text).join('');

describe('ambient --json: lang and words on a selected view', () => {
  for (const lang of LANGS) {
    it(`${lang}: \`lang\` is the resolved language and \`words\` are the ten moment words, templates`, () => {
      seedLive([live('1', ARS, CHE, [2, 1])]);
      const v = ambient(lang);
      expect(v.lang).toBe(lang);
      expect(v.words).toEqual(WORDS[lang]);
    });
  }

  it('the ten words in a fixed order: goal, ownGoal, ownGoalDetail, goalFor, goals, scoreUpdated, penalties, fullTime, win, draw', () => {
    seedLive([live('1', ARS, CHE, [2, 1])]);
    expect(Object.keys(ambient('es').words as Rec)).toEqual(['goal', 'ownGoal', 'ownGoalDetail', 'goalFor', 'goals', 'scoreUpdated', 'penalties', 'fullTime', 'win', 'draw']);
  });

  it('`lang` and `words` follow `competition` in the key order, on an empty cache too', () => {
    const keys = Object.keys(ambient('fr'));
    expect(keys.slice(keys.indexOf('competition'), keys.indexOf('competition') + 3)).toEqual(['competition', 'lang', 'words']);
    expect(keys).toEqual(['line', 'lineParts', 'idle', 'empty', 'context', 'live', 'finished', 'current', 'next', 'pick', 'competition', 'lang', 'words', 'degraded', 'source', 'updatedAt', 'staleAfter', 'disclaimer', 'attribution']);
  });

  it('the first-run object (nothing chosen) carries neither, in any language', () => {
    writes = [];
    cmdAmbient({ ...ctx('es'), cfg: cfg({ lang: 'es', selection: { kind: 'none' }, competition: '' }) });
    expect(printed()).toEqual({ competition: null, noCompetition: true, line: '⚽ claudinho follow' });
  });

  it('the `{ line, empty }` fallback (a refused value) carries neither, in any language', () => {
    writes = [];
    cmdAmbient({ ...ctx('es'), cfg: cfg({ lang: 'es', selection: { kind: 'refused', value: 'nope', aliases: ['premier-league'], chosenBy: 'env' }, competition: '' }) });
    expect(printed()).toEqual({ line: NOTHING_KNOWN_LINE, empty: true });
  });
});

describe("ambient --json: the line's tokens in lang", () => {
  for (const lang of LANGS) {
    it(`${lang}: the countdown is core's phrase, \`BOU vs BRE ${IN[lang]} 17m\`, one plain part`, () => {
      seedCountdown();
      const v = ambient(lang);
      expect(v.line).toBe(`BOU vs BRE ${IN[lang]} 17m`);
      expect(v.lineParts).toEqual([{ text: v.line }]);
      expect(v).toMatchObject({ idle: false, empty: false });
    });

    it(`${lang}: the syncing line says \`${SYNCING[lang]}\``, () => {
      seedSyncing();
      const v = ambient(lang);
      expect(v.line).toBe(`⚽ BOU vs BRE ${SYNCING[lang]}`);
      expect(v.lineParts).toEqual([{ text: v.line }]);
    });

    it(`${lang}: half-time in the live segment is status.ht, \`${HT[lang]}\`; the score strong`, () => {
      seedLive([live('1', ARS, CHE, [2, 1], { status: 'HT', minute: undefined })]);
      const v = ambient(lang);
      expect(v.line).toBe(`⚽ ARS 2–1 CHE ${HT[lang]}`);
      expect(joined(v)).toBe(v.line);
      expect((v.lineParts as Part[]).filter((p) => p.style === 'strong')).toEqual([{ text: '2–1', style: 'strong' }]);
    });

    it(`${lang}: a live match with no minute is status.live, \`${LIVE[lang]}\``, () => {
      seedLive([live('1', ARS, CHE, [2, 1], { minute: undefined })]);
      expect(ambient(lang).line).toBe(`⚽ ARS 2–1 CHE ${LIVE[lang]}`);
    });

    it(`${lang}: a minute is a minute, \`50'\``, () => {
      seedLive([live('1', ARS, CHE, [2, 1])]);
      expect(ambient(lang).line).toBe("⚽ ARS 2–1 CHE 50'");
    });
  }

  for (const lang of ['es', 'pt', 'fr'] as const) {
    it(`${lang}: the translated segments at a narrow --columns: the +N marker reserved, the width kept, the parts joined`, () => {
      seedLive([live('1', BOU, BRE, [0, 1], { minute: undefined }), live('2', ARS, CHE, [2, 1], { status: 'HT', minute: undefined }), live('3', BRE, BOU, [1, 1], { minute: undefined })]);
      for (const columns of [24, 30, 40]) {
        const v = ambient(lang, { columns });
        expect(String(v.line), `columns ${columns}`).toMatch(/ \+\d$/u);
        expect(displayWidth(String(v.line)), `columns ${columns}`).toBeLessThanOrEqual(columns);
        expect(joined(v), `columns ${columns}`).toBe(v.line);
      }
      // A width that holds one translated segment beside its marker shows it.
      const wide = ambient(lang, { columns: 40 });
      expect(String(wide.line)).toContain(lang === 'es' ? 'EN VIVO' : lang === 'pt' ? 'AO VIVO' : 'DIRECT');
    });

    it(`${lang}: \`+more\` (a list nobody could scan whole) stays English, its room reserved`, () => {
      seedLive([live('1', ARS, CHE, [2, 1]), ...Array.from({ length: 599 }, () => ({ status: 'LIVE', home: { code: 'AAA' }, away: { code: 'BBB' } }))]);
      const v = ambient(lang);
      expect(String(v.line)).toMatch(/ \+more$/u);
      const narrow = ambient(lang, { columns: 12 });
      expect(String(narrow.line)).toMatch(/\+more$/u);
      expect(joined(narrow)).toBe(narrow.line);
    });

    it(`${lang}: nothing known stays \`⚽ —\`, and \`empty\` says so`, () => {
      const v = ambient(lang);
      expect(v.line).toBe(NOTHING_KNOWN_LINE);
      expect(v).toMatchObject({ empty: true, idle: false });
    });

    it(`${lang}: the World Cup's sign-off stays English, and \`idle\` says so`, () => {
      const AUG = new Date('2026-08-01T12:00:00Z');
      const v = ambient(lang, {}, { competition: 'fifa.world' }, AUG);
      expect(v.line).toBe(TOURNAMENT_COMPLETE_LINE);
      expect(v).toMatchObject({ idle: true, empty: false });
    });
  }
});

describe('what stays English in every language', () => {
  for (const lang of ['es', 'pt', 'fr'] as const) {
    it(`${lang}: \`context\`, \`attribution\`, \`disclaimer\` and each record's line are the English ones`, () => {
      seedLive([live('1', ARS, CHE, [2, 1], { status: 'HT', minute: undefined }), live('2', BOU, BRE, [0, 0])]);
      const en = ambient('en');
      const v = ambient(lang);
      expect(v.context).toBe(en.context);
      expect(String(v.context)).toContain('half-time');
      expect(v.attribution).toBe('Live data: ESPN');
      expect(v.disclaimer).toBe(DISCLAIMER);
      const lines = (x: Rec) => (x.live as { items: Rec[] }).items.map((m) => [m.line, m.names]);
      expect(lines(v)).toEqual(lines(en));
      expect(lines(v)[0]?.[0]).toBe('Arsenal 2–1 Chelsea (half-time)');
    });

    it(`${lang}: \`claudinho prompt\` and \`claudinho hook\` print what they print in English`, () => {
      const surfaces = (l: Lang) => {
        writes = [];
        cmdPrompt(ctx(l));
        const prompt = writes.join('');
        writes = [];
        cmdHook(ctx(l));
        return { prompt, hook: writes.join('') };
      };
      seedCountdown();
      const countdown = surfaces(lang);
      expect(countdown).toEqual(surfaces('en'));
      expect(countdown.prompt.trim()).toBe('BOU vs BRE in 17m');
      seedSyncing();
      expect(surfaces(lang).prompt.trim()).toBe('⚽ BOU vs BRE live · syncing…');
      seedLive([live('1', ARS, CHE, [2, 1], { status: 'HT', minute: undefined }), live('2', BOU, BRE, [0, 0], { minute: undefined })]);
      const inPlay = surfaces(lang);
      expect(inPlay).toEqual(surfaces('en'));
      expect(inPlay.prompt).toContain('HT');
      expect(inPlay.prompt).toContain('LIVE');
    });
  }
});

/**
 * Through the built binary's own resolution (`--lang`, `CLAUDINHO_LANG`, `LANG`'s language part, else `en`; an
 * unsupported or empty value skipped), with the launch functions neutered by the release QA's preload (no refresher
 * starts) and a home of its own (no saved choice, no cache).
 */
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const DIST = join(ROOT, 'packages', 'cli', 'dist', 'index.js');
// A URL, not a path: Node on Windows refuses a bare `D:\\…` path for `--import` (ERR_UNSUPPORTED_ESM_URL_SCHEME).
const PRELOAD = pathToFileURL(join(ROOT, 'scripts', 'spawn-count.mjs')).href;
describe.skipIf(!existsSync(DIST))('ambient --json: `lang` as the CLI resolves it', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'claudinho-ambient-lang-bin-'));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));
  const run = (vars: Record<string, string>, ...args: string[]) => {
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: home, XDG_CACHE_HOME: join(home, 'cache'), XDG_CONFIG_HOME: join(home, 'config'), CLAUDINHO_FLAGS: '0', QA_SPAWN_LOG: join(home, 'spawns.log'), ...vars };
    const r = spawnSync(process.execPath, ['--import', PRELOAD, DIST, 'ambient', '--json', ...args], { env, encoding: 'utf8', input: '', timeout: 15_000 });
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(r.stdout) as Rec;
  };
  const selected = { CLAUDINHO_COMPETITION: 'eng.1' };
  const cases: Array<[string, Record<string, string>, string[], Lang]> = [
    ['--lang es', {}, ['--lang', 'es'], 'es'],
    ['--lang pt over LANG=fr_FR.UTF-8', { LANG: 'fr_FR.UTF-8' }, ['--lang', 'pt'], 'pt'],
    ['CLAUDINHO_LANG=es', { CLAUDINHO_LANG: 'es' }, [], 'es'],
    ['LANG=es_MX.UTF-8', { LANG: 'es_MX.UTF-8' }, [], 'es'],
    ['LANG=pt_BR.UTF-8', { LANG: 'pt_BR.UTF-8' }, [], 'pt'],
    ['CLAUDINHO_LANG=de with LANG=es_MX.UTF-8 (the first supported candidate)', { CLAUDINHO_LANG: 'de', LANG: 'es_MX.UTF-8' }, [], 'es'],
    ['CLAUDINHO_LANG empty with LANG=fr_FR.UTF-8 (an empty value skipped)', { CLAUDINHO_LANG: '', LANG: 'fr_FR.UTF-8' }, [], 'fr'],
    ['--lang de with LANG=fr_FR.UTF-8 (an unsupported flag skipped)', { LANG: 'fr_FR.UTF-8' }, ['--lang', 'de'], 'fr'],
    ['CLAUDINHO_LANG=ES, cased otherwise (the predicate is case-sensitive)', { CLAUDINHO_LANG: 'ES' }, [], 'en'],
    ['nothing set', {}, [], 'en'],
  ];
  for (const [label, vars, args, lang] of cases) {
    it(`${label}: lang ${lang}, words in ${lang}`, () => {
      const v = run({ ...selected, ...vars }, ...args);
      expect(v.lang).toBe(lang);
      expect(v.words).toEqual(WORDS[lang]);
      expect(v.line).toBe(NOTHING_KNOWN_LINE);
    });
  }

  it('the first-run object under a Spanish LANG: neither key', () => {
    const v = run({ LANG: 'es_MX.UTF-8' });
    expect(v).toEqual({ competition: null, noCompetition: true, line: '⚽ claudinho follow' });
  });

  it('the `{ line, empty }` fallback under a Spanish LANG: neither key', () => {
    const v = run({ LANG: 'es_MX.UTF-8', CLAUDINHO_COMPETITION: 'not a competition' });
    expect(v).toEqual({ line: NOTHING_KNOWN_LINE, empty: true });
  });
});
