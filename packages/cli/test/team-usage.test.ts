/**
 * The usage sentence of the team-taking commands is TRUE in each state it is
 * said in (0.11 · 2.5b, review round 2): a team pinned for ANOTHER competition
 * is named as such, never "or pin one" as if none were; a CLAUDINHO_TEAM with
 * nothing readable in it is named as such (and is still the override: never
 * the pin); with neither, the three ways to give a team.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeMarketProvider, type ProviderAdapter } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdMarkets, cmdNext, cmdShare } from '../src/commands';
import { resolveConfig } from '../src/config';
import { makeT } from '../src/i18n';

let tmp: string;
const ENV = ['XDG_CONFIG_HOME', 'CLAUDINHO_COMPETITION', 'CLAUDINHO_TEAM'] as const;
const saved: Record<string, string | undefined> = {};
const outSpy = vi.spyOn(process.stdout, 'write');
let fetched = 0;
const laliga: ProviderAdapter = {
  name: 'espn',
  competition: 'esp.1',
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
  tmp = mkdtempSync(join(tmpdir(), 'claudinho-team-usage-'));
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.XDG_CONFIG_HOME = tmp;
  fetched = 0;
  outSpy.mockImplementation(() => true);
});
afterEach(() => {
  outSpy.mockReset();
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(tmp, { recursive: true, force: true });
});
const follow = (body: Record<string, unknown>) => {
  mkdirSync(join(tmp, 'claudinho'), { recursive: true });
  writeFileSync(join(tmp, 'claudinho', 'config.json'), JSON.stringify(body));
};
const ctxOf = (competition?: string) => {
  const cfg = resolveConfig({ tz: 'UTC', color: false, source: 'espn', flavor: 'off', markets: false, ...(competition ? { competition } : {}) });
  return { cfg, t: makeT('en'), adapter: laliga, now: new Date('2026-10-10T15:00:00Z'), marketProvider: new FakeMarketProvider() };
};
const commands: Array<[string, (c: ReturnType<typeof ctxOf>) => Promise<void>]> = [
  ['next', (c) => cmdNext(undefined, c)],
  ['share next', (c) => cmdShare('next', undefined, {}, c)],
  ['markets next', (c) => cmdMarkets('next', undefined, c)],
];

describe('the usage sentence', () => {
  it('a team pinned for another competition is named as such, never "or pin one"', async () => {
    follow({ version: 1, competition: 'premier-league', team: { id: 'espn:359', code: 'ARS', name: 'Arsenal' } });
    for (const [name, run] of commands) {
      const err = await run(ctxOf('laliga')).catch((e: Error) => e.message);
      expect(err, name).toMatch(/Usage/);
      expect(err, name).toMatch(/Arsenal/);
      expect(err, name).toMatch(/Premier League/);
      expect(err, name).not.toMatch(/pin one/);
    }
    expect(fetched).toBe(0);
  });

  it('a CLAUDINHO_TEAM with nothing readable in it is named as such, and is still the override: never the pin', async () => {
    follow({ version: 1, competition: 'laliga', team: { id: 'espn:83', code: 'BAR', name: 'Barcelona' } });
    process.env.CLAUDINHO_TEAM = '\u200B';
    for (const [name, run] of commands) {
      const err = await run(ctxOf()).catch((e: Error) => e.message);
      expect(err, name).toMatch(/CLAUDINHO_TEAM names no team/);
    }
    expect(fetched).toBe(0);
  });

  it('the environment\'s query is the value AS SET, resolved exactly as the argument would be (a leading blank refuses on both paths)', async () => {
    follow({ version: 1, competition: 'world-cup' });
    const asArgument = await cmdNext(' zzz', ctxOf('world-cup')).catch((e: Error) => e.message);
    process.env.CLAUDINHO_TEAM = ' zzz';
    const fromEnv = await cmdNext(undefined, ctxOf('world-cup')).catch((e: Error) => e.message);
    expect(fromEnv).toEqual(asArgument);
    expect(String(fromEnv)).toMatch(/No team found for " zzz"/);
    delete process.env.CLAUDINHO_TEAM;
  });

  it('with no pin at all: the three ways to give a team', async () => {
    follow({ version: 1, competition: 'laliga' });
    for (const [name, run] of commands) {
      const err = await run(ctxOf()).catch((e: Error) => e.message);
      expect(err, name).toMatch(/Usage.*or pin one/);
    }
  });
});
