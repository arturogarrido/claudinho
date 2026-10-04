/**
 * The pin on MCP, two edges a reader found (0.11 · 2.5b, review): the no-team
 * sentence is TRUE in each state it is said in (a pin that exists for another
 * competition is named as such, an unreadable server `CLAUDINHO_TEAM` is named
 * as such; "none pinned" only when none is), and the config file is read ONCE
 * per request, never cached across requests (a `follow` between two calls is
 * seen by the next), counted, not inferred from call sites.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attachFetchMeta, type Match, type ProviderAdapter } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The config reader counted: the module as it is, its reader wrapped.
vi.mock('@claudinho/core', async (importOriginal) => {
  const core = await importOriginal<typeof import('@claudinho/core')>();
  return { ...core, readUserConfig: vi.fn(core.readUserConfig) };
});
const { readUserConfig } = await import('@claudinho/core');
const { toolGetNextFixture, toolGetToday, toolGetLive } = await import('../src/tools');

const NOW = new Date('2026-10-10T15:00:00Z');
const fixture: Match = {
  id: '800000001',
  stage: 'REGULAR',
  kickoff: '2026-10-11T14:00:00.000Z',
  venue: 'Emirates Stadium',
  home: { code: 'AFC', name: 'Arsenal FC', id: 'espn:359' },
  away: { code: 'CHE', name: 'Chelsea', id: 'espn:363' },
  status: 'SCHEDULED',
  updatedAt: NOW.toISOString(),
};
const whole = (ms: Match[]) => attachFetchMeta(ms, { complete: true, omitted: 0, seasons: [] });
const adapterFor = (competition: string): ProviderAdapter => ({
  name: 'espn',
  competition,
  capabilities: { push: false, latencyHintSec: 0 },
  async fetchByDate() {
    return whole([fixture]);
  },
  async fetchLive() {
    return whole([]);
  },
  async fetchWindow() {
    return whole([fixture]);
  },
});
type Rec = Record<string, unknown>;

let tmp: string;
const ENV = ['XDG_CONFIG_HOME', 'CLAUDINHO_COMPETITION', 'CLAUDINHO_TEAM'] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'claudinho-mcp-pin-'));
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.XDG_CONFIG_HOME = tmp;
  vi.mocked(readUserConfig).mockClear();
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(tmp, { recursive: true, force: true });
});
const follow = (competition: string, team?: Rec) => {
  mkdirSync(join(tmp, 'claudinho'), { recursive: true });
  writeFileSync(join(tmp, 'claudinho', 'config.json'), JSON.stringify({ version: 1, competition, ...(team ? { team } : {}) }));
};

describe('the no-team sentence is true in each state', () => {
  it('a pin that exists for ANOTHER competition is named as such, not "none pinned"', async () => {
    follow('premier-league', { id: 'espn:359', code: 'ARS', name: 'Arsenal' });
    const err = await toolGetNextFixture({ competition: 'laliga', adapter: adapterFor('esp.1'), now: NOW }).catch((e: Error) => e.message);
    expect(err).toMatch(/Premier League/);
    expect(err).toMatch(/Arsenal/);
    expect(err).not.toMatch(/none pinned/);
  });

  it('an unreadable server CLAUDINHO_TEAM is named as such', async () => {
    follow('premier-league', { id: 'espn:359', code: 'ARS', name: 'Arsenal' });
    process.env.CLAUDINHO_TEAM = '​';
    const err = await toolGetNextFixture({ adapter: adapterFor('eng.1'), now: NOW }).catch((e: Error) => e.message);
    expect(err).toMatch(/CLAUDINHO_TEAM/);
    expect(err).not.toMatch(/none pinned/);
    delete process.env.CLAUDINHO_TEAM;
  });

  it('with no pin at all, "none pinned" is said', async () => {
    follow('premier-league');
    const err = await toolGetNextFixture({ adapter: adapterFor('eng.1'), now: NOW }).catch((e: Error) => e.message);
    expect(err).toMatch(/none pinned|no team pinned/i);
  });
});

describe('the config is read once per request', () => {
  it('one read per tool call, however many helpers ask; two calls read twice; a follow between them is seen', async () => {
    follow('premier-league', { id: 'espn:359', code: 'ARS', name: 'Arsenal' });
    vi.mocked(readUserConfig).mockClear();
    await toolGetNextFixture({ adapter: adapterFor('eng.1'), now: NOW });
    expect(readUserConfig).toHaveBeenCalledTimes(1);
    await toolGetToday({ date: '2026-10-11', adapter: adapterFor('eng.1'), now: NOW });
    expect(readUserConfig).toHaveBeenCalledTimes(2);
    follow('laliga');
    const r = await toolGetLive({ adapter: adapterFor('esp.1'), now: NOW });
    expect((r.data as Rec).competition).toMatchObject({ slug: 'esp.1', chosenBy: 'saved' });
    expect(readUserConfig).toHaveBeenCalledTimes(3);
  });
});
