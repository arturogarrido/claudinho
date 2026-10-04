/**
 * The selection on the CLI (0.11 · 2.5a): `--competition <alias|slug>` at the
 * edge, the mode line on every competition-answering text answer (never on
 * `--json`, never on `share`), the `competition` key in every `--json`, the
 * ambient commands containing a bad selection, `team` as the World Cup's
 * roster whatever the selection. The stderr drift warning is gone.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Match, ProviderAdapter } from '@claudinho/core';
import { FakeMarketProvider, t as coreT } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeState } from '../src/cache';
import { cmdBracket, cmdHook, cmdLive, cmdMatch, cmdNext, cmdPrompt, cmdShare, cmdTable, cmdTeam, cmdToday, cmdVibe, InputError } from '../src/commands';
import { type CliConfig, resolveConfig } from '../src/config';
import { makeT } from '../src/i18n';

vi.mock('node:child_process', () => ({ spawn: vi.fn(() => ({ unref: vi.fn() })) }));
import { spawn } from 'node:child_process';

const NOW = new Date('2026-10-04T12:00:00Z');
const fixture: Match = {
  id: '800000001',
  stage: 'REGULAR',
  kickoff: '2026-10-04T14:00:00.000Z',
  venue: 'Emirates Stadium',
  home: { code: 'ARS', name: 'Arsenal', id: 'espn:359' },
  away: { code: 'CHE', name: 'Chelsea', id: 'espn:363' },
  status: 'SCHEDULED',
  updatedAt: NOW.toISOString(),
};
const adapterFor = (competition: string): ProviderAdapter => ({
  name: 'espn',
  competition,
  capabilities: { push: false, latencyHintSec: 0 },
  async fetchByDate() {
    return [fixture];
  },
  async fetchLive() {
    return [];
  },
  async fetchWindow() {
    return [fixture];
  },
});
const ENV = ['CLAUDINHO_COMPETITION', 'XDG_CACHE_HOME', 'CLAUDINHO_TEAM'] as const;
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
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
const text = () => writes.join('');
const lines = () => text().split('\n');
/** A config as the edge builds it, with the selection it resolved. */
const cfgOf = (opts: { competition?: string; json?: boolean; lang?: string } = {}): CliConfig =>
  resolveConfig({ tz: 'UTC', color: false, source: 'espn', flavor: 'off', markets: false, ...opts });
const ctxOf = (cfg: CliConfig) => ({ cfg, t: makeT(cfg.lang), adapter: adapterFor(cfg.competition), now: NOW, marketProvider: new FakeMarketProvider() });

describe('the edge: resolveConfig', () => {
  it('the flag, by alias or slug; the environment; the default', () => {
    expect(resolveConfig({ competition: 'premier-league' })).toMatchObject({ competition: 'eng.1', selection: { kind: 'selected', slug: 'eng.1', alias: 'premier-league', chosenBy: 'flag' } });
    expect(resolveConfig({ competition: 'eng.1' })).toMatchObject({ competition: 'eng.1', selection: { chosenBy: 'flag' } });
    process.env.CLAUDINHO_COMPETITION = 'laliga';
    expect(resolveConfig({})).toMatchObject({ competition: 'esp.1', selection: { chosenBy: 'env', alias: 'laliga' } });
    process.env.CLAUDINHO_COMPETITION = 'fifa.friendly';
    expect(resolveConfig({})).toMatchObject({ competition: 'fifa.friendly', selection: { chosenBy: 'env', experimental: true } });
    delete process.env.CLAUDINHO_COMPETITION;
    expect(resolveConfig({})).toMatchObject({ competition: 'fifa.world', selection: { chosenBy: 'default', name: 'World Cup' } });
  });

  it('a value that is no alias and no slug is carried as refused, never as a competition', () => {
    const cfg = resolveConfig({ competition: 'foo' });
    expect(cfg.selection).toMatchObject({ kind: 'refused', value: 'foo' });
    expect(cfg.competition).toBe('');
    process.env.CLAUDINHO_COMPETITION = 'ENG.1';
    expect(resolveConfig({}).selection).toMatchObject({ kind: 'refused', value: 'ENG.1' });
  });

  it('the global option exists on the program', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/index.ts', import.meta.url)), 'utf8');
    expect(src).toMatch(/--competition <[a-z|]+>/);
  });
});

describe('an interactive command under a refused selection', () => {
  it('today, live, next, match, table, bracket, share: an input error naming the aliases, no request', async () => {
    const cfg = cfgOf({ competition: 'foo' });
    const calls: Array<() => Promise<void>> = [
      () => cmdToday('2026-10-04', ctxOf(cfg)),
      () => cmdLive(ctxOf(cfg)),
      () => cmdNext('Arsenal', ctxOf(cfg)),
      () => cmdMatch('800000001', ctxOf(cfg)),
      () => cmdTable(undefined, ctxOf(cfg)),
      () => cmdBracket(undefined, {}, ctxOf(cfg)),
      () => cmdShare('live', undefined, {}, ctxOf(cfg)),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toBeInstanceOf(InputError);
      await expect(call()).rejects.toThrow(/premier-league/);
      await expect(call()).rejects.toThrow(/foo/);
    }
  });
});

describe('the mode line', () => {
  it('after the header, on text: the name and the source', async () => {
    await cmdToday('2026-10-04', ctxOf(cfgOf({ competition: 'premier-league' })));
    const l = lines();
    const header = l.findIndex((x) => /Matches/.test(x));
    expect(header).toBeGreaterThan(-1);
    expect(l[header + 1]?.trim()).toBe('Premier League · from the command line');
    expect(errs.join('')).not.toMatch(/different competition than the bundled/);
  });

  it('from the environment; the default is the World Cup with no suffix; a raw slug: source, then experimental', async () => {
    process.env.CLAUDINHO_COMPETITION = 'eng.1';
    await cmdToday('2026-10-04', ctxOf(cfgOf()));
    expect(text()).toContain('Premier League · from the environment');
    expect(errs.join('')).toBe('');
    writes = [];
    delete process.env.CLAUDINHO_COMPETITION;
    await cmdToday('2026-10-04', ctxOf(cfgOf()));
    expect(text()).toMatch(/\n\s*World Cup\n/);
    expect(text()).not.toContain('World Cup ·');
    writes = [];
    await cmdToday('2026-10-04', ctxOf(cfgOf({ competition: 'fifa.friendly' })));
    expect(text()).toContain('fifa.friendly · from the command line · experimental');
  });

  it('in four locales', async () => {
    const expected: Record<string, string> = {
      en: 'Premier League · from the command line',
      es: 'Premier League · desde la línea de comandos',
      pt: 'Premier League · da linha de comando',
      fr: 'Premier League · depuis la ligne de commande',
    };
    for (const [lang, line] of Object.entries(expected)) {
      writes = [];
      await cmdToday('2026-10-04', ctxOf(cfgOf({ competition: 'premier-league', lang })));
      expect(text(), lang).toContain(line);
    }
  });

  it('on every competition-answering command: live, next, match, table, bracket', async () => {
    const cfg = cfgOf({ competition: 'premier-league' });
    const needle = 'Premier League · from the command line';
    for (const [label, call] of [
      ['live', () => cmdLive(ctxOf(cfg))],
      ['next', () => cmdNext('Arsenal', ctxOf(cfg))],
      ['match', () => cmdMatch('800000001', ctxOf(cfg))],
      ['table', () => cmdTable(undefined, ctxOf(cfg))],
      ['bracket', () => cmdBracket(undefined, {}, ctxOf(cfg))],
    ] as const) {
      writes = [];
      await call();
      expect(text(), label).toContain(needle);
    }
  });

  it('never on --json: the `competition` key is the structured form', async () => {
    await cmdToday('2026-10-04', ctxOf(cfgOf({ competition: 'premier-league', json: true })));
    const j = JSON.parse(text()) as Record<string, unknown>;
    expect(j.competition).toEqual({ slug: 'eng.1', alias: 'premier-league', name: 'Premier League', chosenBy: 'flag' });
    for (const [label, call] of [
      ['live', () => cmdLive(ctxOf(cfgOf({ competition: 'premier-league', json: true })))],
      ['next', () => cmdNext('Arsenal', ctxOf(cfgOf({ competition: 'premier-league', json: true })))],
      ['match', () => cmdMatch('800000001', ctxOf(cfgOf({ competition: 'premier-league', json: true })))],
      ['table', () => cmdTable(undefined, ctxOf(cfgOf({ competition: 'premier-league', json: true })))],
      ['bracket', () => cmdBracket(undefined, {}, ctxOf(cfgOf({ competition: 'premier-league', json: true })))],
      ['share', () => cmdShare('live', undefined, {}, ctxOf(cfgOf({ competition: 'premier-league', json: true })))],
    ] as const) {
      writes = [];
      await call();
      const parsed = JSON.parse(text()) as Record<string, unknown>;
      expect(parsed.competition, label).toEqual({ slug: 'eng.1', alias: 'premier-league', name: 'Premier League', chosenBy: 'flag' });
    }
    writes = [];
    await cmdToday('2026-10-04', ctxOf(cfgOf({ competition: 'fifa.friendly', json: true })));
    expect((JSON.parse(text()) as Record<string, unknown>).competition).toEqual({ slug: 'fifa.friendly', name: 'fifa.friendly', chosenBy: 'flag', experimental: true });
  });

  it('never on share: the card is the artifact, its title names the competition, its cue selects it', async () => {
    await cmdShare('live', undefined, {}, ctxOf(cfgOf({ competition: 'premier-league' })));
    expect(text()).not.toContain('from the command line');
    expect(lines().find((l) => l.trim() !== '')).toContain('Premier League');
    expect(text()).toContain('--competition premier-league');
    expect(text()).not.toContain('CLAUDINHO_COMPETITION');
    writes = [];
    await cmdShare('2026-10-04', undefined, {}, ctxOf(cfgOf()));
    expect(lines().find((l) => l.trim() !== '')).toContain('World Cup');
    expect(text()).toContain('--competition world-cup');
  });
});

describe('team: the World Cup\'s roster, whatever the selection', () => {
  it('under an explicit selection that is not the World Cup it is refused, naming where a team goes', () => {
    expect(() => cmdTeam('Mexico', ctxOf(cfgOf({ competition: 'premier-league' })))).toThrow(InputError);
    expect(() => cmdTeam('Mexico', ctxOf(cfgOf({ competition: 'premier-league' })))).toThrow(/next/);
    process.env.CLAUDINHO_COMPETITION = 'eng.1';
    expect(() => cmdTeam('Mexico', ctxOf(cfgOf()))).toThrow(InputError);
  });

  it('a nations competition named explicitly is refused too (the roster is one edition\'s nations), and the message assumes no club', () => {
    // The flag, then the environment; the message says where a TEAM's name goes, which under EURO is a nation's.
    expect(() => cmdTeam('France', ctxOf(cfgOf({ competition: 'euro' })))).toThrow(InputError);
    expect(() => cmdTeam('France', ctxOf(cfgOf({ competition: 'euro' })))).toThrow(/team's name goes straight to `next`/);
    expect(() => cmdTeam('France', ctxOf(cfgOf({ competition: 'euro' })))).not.toThrow(/club's name/);
    // The way back to the roster is named: the override, in every locale.
    expect(() => cmdTeam('France', ctxOf(cfgOf({ competition: 'euro' })))).toThrow(/--competition world-cup/);
    process.env.CLAUDINHO_COMPETITION = 'uefa.nations';
    expect(() => cmdTeam('France', ctxOf(cfgOf()))).toThrow(InputError);
    delete process.env.CLAUDINHO_COMPETITION;
    for (const lang of ['es', 'pt', 'fr']) {
      expect(() => cmdTeam('France', { cfg: cfgOf({ competition: 'euro', lang }), t: makeT(lang) }), lang).toThrow(/next/);
      expect(() => cmdTeam('France', { cfg: cfgOf({ competition: 'euro', lang }), t: makeT(lang) }), lang).toThrow(/--competition world-cup/);
    }
  });

  it('under the default, and under an explicit World Cup, it answers and names its roster with core\'s sentence', () => {
    cmdTeam('Mexico', ctxOf(cfgOf()));
    expect(text()).toContain('MEX');
    // ONE roster sentence for the CLI and MCP: core's `team.roster`, localized; printed before the answer.
    expect(text().split('\n').map((l) => l.trim()).filter(Boolean)[0]).toBe(coreT('en', 'team.roster'));
    expect(coreT('en', 'team.roster')).toBe('World Cup roster');
    writes = [];
    cmdTeam('Mexico', ctxOf(cfgOf({ competition: 'world-cup' })));
    expect(text()).toContain('MEX');
    writes = [];
    cmdTeam('Mexico', { cfg: cfgOf({ lang: 'fr' }), t: makeT('fr') });
    expect(text().split('\n').map((l) => l.trim()).filter(Boolean)[0]).toBe(coreT('fr', 'team.roster'));
    expect(coreT('fr', 'team.roster')).toMatch(/Coupe du monde/);
  });
});

describe('an injected adapter for another competition is refused before any read (the CLI\'s seam, the MCP seam\'s sibling)', () => {
  it('live, today and share: the body and the label never disagree', async () => {
    let reads = 0;
    const counting: ProviderAdapter = { ...adapterFor('eng.1'), async fetchByDate() { reads++; return []; }, async fetchLive() { reads++; return []; }, async fetchWindow() { reads++; return []; } };
    const cfg = cfgOf({ competition: 'serie-a' });
    const ctx = { cfg, t: makeT('en'), adapter: counting, now: NOW, marketProvider: new FakeMarketProvider() };
    await expect(cmdLive(ctx)).rejects.toThrow(/eng\.1/);
    await expect(cmdToday('2026-10-04', ctx)).rejects.toThrow(/ita\.1|serie-a/);
    await expect(cmdShare('live', undefined, {}, ctx)).rejects.toThrow(/eng\.1/);
    expect(reads).toBe(0);
    expect(text()).toBe('');
    // Under its own competition the same adapter answers.
    const own = { ...ctx, cfg: cfgOf({ competition: 'premier-league' }), t: makeT('en') };
    await cmdLive(own);
    expect(reads).toBeGreaterThan(0);
  });
});

describe('the ambient commands contain a bad selection', () => {
  it('prompt prints the empty line, hook prints nothing, vibe prints its line; none throws', () => {
    process.env.CLAUDINHO_COMPETITION = 'foo';
    const cfg = cfgOf();
    expect(cfg.selection.kind).toBe('refused');
    expect(() => cmdPrompt({ cfg, t: makeT('en') }, { cursor: undefined })).not.toThrow();
    expect(text()).toContain('⚽ —');
    writes = [];
    expect(() => cmdHook({ cfg, t: makeT('en') })).not.toThrow();
    expect(text()).toBe('');
    // A refused selection names no competition: nothing is refreshed for it.
    expect(spawn).not.toHaveBeenCalled();
    writes = [];
    expect(() => cmdVibe({ cfg, t: makeT('en') })).not.toThrow();
    expect(text()).toContain('#VibingLaVidaLoca');
  });

  it('a valid environment selection still renders the cached line (the kind by the written table)', () => {
    process.env.CLAUDINHO_COMPETITION = 'premier-league';
    const cfg = cfgOf();
    expect(cfg.competition).toBe('eng.1');
    const at = new Date();
    writeState({
      updatedAt: at.toISOString(),
      live: [{ ...fixture, status: 'LIVE', minute: 50, score: { home: 2, away: 1 }, kickoff: new Date(at.getTime() - 50 * 60_000).toISOString(), updatedAt: at.toISOString() }],
      degraded: false,
      source: 'espn',
      competition: 'eng.1',
    });
    cmdPrompt({ cfg, t: makeT('en') }, { cursor: undefined });
    expect(text()).toContain("⚽ ARS 2–1 CHE 50'");
  });
});
