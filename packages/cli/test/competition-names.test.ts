/**
 * A competition by its name or a short form on the CLI (part B, A2): the
 * flag, `CLAUDINHO_COMPETITION` and `follow` share core's one grammar; what is
 * saved is the slug, never the typed form, and `follow` names the alias once
 * when the person typed something else, so they learn it. A near miss is
 * refused with the nearest alias first, then the aliases, wrapped at the
 * terminal's width (80 when there is none); nothing is written. `follow
 * --list` shows each row's short forms in its text; its `--json` is
 * unchanged.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';
import { competitionValue, SUPPORTED } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdFollow, cmdLive, InputError } from '../src/commands';
import { resolveConfig } from '../src/config';
import { makeT } from '../src/i18n';
import { buildProgram } from '../src/program';

const NOW = new Date('2026-11-11T05:40:00.000Z');
let tmp: string;
let configFile: string;
const ENV = ['XDG_CONFIG_HOME', 'CLAUDINHO_COMPETITION', 'CLAUDINHO_TEAM'] as const;
const saved: Record<string, string | undefined> = {};
const outSpy = vi.spyOn(process.stdout, 'write');
let writes: string[] = [];
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'claudinho-names-'));
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.XDG_CONFIG_HOME = tmp;
  configFile = join(tmp, 'claudinho', 'config.json');
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
const read = () => JSON.parse(readFileSync(configFile, 'utf8')) as Record<string, unknown>;
const ctxOf = (over: { json?: boolean; lang?: string; competition?: string } = {}) => {
  const cfg = resolveConfig({ tz: 'UTC', color: false, source: 'espn', flavor: 'off', markets: false, ...over });
  return { cfg, t: makeT(cfg.lang), now: NOW };
};
async function refusalOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    expect(err).toBeInstanceOf(InputError);
    return (err as Error).message;
  }
  throw new Error('expected a refusal');
}

describe('follow by a name or a short form', () => {
  it('`follow epl` saves the slug, never the typed form, and names the alias once', async () => {
    await cmdFollow('epl', {}, ctxOf());
    expect(read()).toEqual({ version: 1, competition: 'eng.1' });
    expect(text()).toContain('Following: Premier League (premier-league)');
  });

  it('`follow "Premier League"` and `follow UCL` the same way', async () => {
    await cmdFollow('Premier League', {}, ctxOf());
    expect(read()).toEqual({ version: 1, competition: 'eng.1' });
    expect(text()).toContain('Following: Premier League (premier-league)');
    writes = [];
    await cmdFollow('UCL', {}, ctxOf());
    expect(read()).toEqual({ version: 1, competition: 'uefa.champions' });
    expect(text()).toContain('Following: Champions League (champions-league)');
  });

  it('the alias itself: the line as before, no alias in parentheses', async () => {
    await cmdFollow('premier-league', {}, ctxOf());
    expect(text()).toContain('Following: Premier League');
    expect(text()).not.toContain('(premier-league)');
  });

  it('in Spanish', async () => {
    await cmdFollow('epl', {}, ctxOf({ lang: 'es' }));
    expect(text()).toContain('Siguiendo: Premier League (premier-league)');
  });

  it('`follow premier` is refused with the nearest alias first, then the aliases; nothing written', async () => {
    const msg = await refusalOf(() => cmdFollow('premier', {}, ctxOf()));
    expect(msg.startsWith('Unknown competition "premier". Did you mean premier-league?\nAliases: world-cup, euro,')).toBe(true);
    expect(existsSync(configFile)).toBe(false);
  });

  it('a near miss under a saved choice leaves the saved choice as it was', async () => {
    await cmdFollow('laliga', {}, ctxOf());
    await refusalOf(() => cmdFollow('champions', {}, ctxOf()));
    expect(read()).toEqual({ version: 1, competition: 'esp.1' });
  });

  it('`follow mls`: no near alias, the list alone', async () => {
    const msg = await refusalOf(() => cmdFollow('mls', {}, ctxOf()));
    expect(msg.startsWith('Unknown competition "mls".\nAliases: ')).toBe(true);
    expect(msg).not.toContain('Did you mean');
  });

  it('the refusal is wrapped at 80 columns when the terminal states no width; every alias still in it', async () => {
    const msg = await refusalOf(() => cmdFollow('champions', {}, ctxOf()));
    for (const line of msg.split('\n')) expect(line.length, line).toBeLessThanOrEqual(80);
    const flat = msg.replace(/\n/g, ' ');
    for (const e of SUPPORTED) expect(flat).toContain(e.alias);
    expect(flat).toContain('Did you mean champions-league or concacaf-champions-cup?');
  });
});

describe('the flag and the environment take the same grammar', () => {
  it('`--competition "Premier League"`: the canonical selection, chosen by the flag', () => {
    const { cfg } = ctxOf({ competition: 'Premier League' });
    expect(cfg.selection).toMatchObject({ kind: 'selected', slug: 'eng.1', alias: 'premier-league', name: 'Premier League', chosenBy: 'flag' });
    expect(cfg.competition).toBe('eng.1');
  });

  it('`CLAUDINHO_COMPETITION=ucl`: the canonical selection, chosen by the environment', () => {
    process.env.CLAUDINHO_COMPETITION = 'ucl';
    const { cfg } = ctxOf();
    expect(cfg.selection).toMatchObject({ kind: 'selected', slug: 'uefa.champions', alias: 'champions-league', chosenBy: 'env' });
  });

  it('a near miss on the flag is refused before any request, suggestion first, wrapped', async () => {
    const msg = await refusalOf(() => cmdLive(ctxOf({ competition: 'premier' })));
    expect(msg.startsWith('Unknown competition "premier". Did you mean premier-league?')).toBe(true);
    for (const line of msg.split('\n')) expect(line.length, line).toBeLessThanOrEqual(80);
  });

  it('`follow` alone under a refused environment prints the suggestion with every line indented', async () => {
    process.env.CLAUDINHO_COMPETITION = 'premier';
    await cmdFollow(undefined, {}, ctxOf());
    const lines = text().split('\n');
    const at = lines.findIndex((l) => l.includes('Unknown competition "premier". Did you mean premier-league?'));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(lines[at]?.startsWith('  ')).toBe(true);
    expect(lines[at + 1]?.startsWith('  Aliases:')).toBe(true);
  });
});

describe('follow --list', () => {
  it('the text names each row\'s short forms beside its name, and nothing for a row with none', async () => {
    await cmdFollow(undefined, { list: true }, ctxOf());
    const out = text();
    expect(out).toMatch(/premier-league\s+· Premier League \(epl, pl\) ·/);
    expect(out).toMatch(/champions-league\s+· Champions League \(ucl, cl\) ·/);
    expect(out).toMatch(/copa-america\s+· Copa América ·/);
    expect(out).toMatch(/serie-a\s+· Serie A ·/);
  });

  it('`--json` is unchanged: the same keys per row, no short forms', async () => {
    await cmdFollow(undefined, { list: true }, ctxOf({ json: true }));
    const parsed = JSON.parse(text()) as { competitions: Array<Record<string, unknown>> };
    for (const row of parsed.competitions) expect(Object.keys(row)).toEqual(['slug', 'alias', 'name', 'teams', 'kind', 'capabilities']);
  });
});

describe('no competition key is a word the CLI already means', () => {
  it('no command name (hidden ones included) and not `off` resolves to a competition', () => {
    const names: string[] = [];
    const walk = (cmd: Command) => {
      for (const sub of cmd.commands) {
        names.push(sub.name(), ...sub.aliases());
        walk(sub);
      }
    };
    walk(buildProgram());
    expect(names).toContain('today');
    expect(names).toContain('bracket');
    for (const n of [...names, 'off', 'list']) expect(competitionValue(n), n).toBeUndefined();
  });
});
