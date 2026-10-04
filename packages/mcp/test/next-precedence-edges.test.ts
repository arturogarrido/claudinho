/**
 * `get_next_fixture` with no `team`, beside the precedence case in
 * `first-run.test.ts` (0.11 · 2.5b): an EMPTY server `CLAUDINHO_TEAM` is
 * absent (the pin answers), and one with nothing readable in it names no team
 * (a tool error that says so and what to do, never a query for nothing, never the pin).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attachFetchMeta, type Match, type ProviderAdapter } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toolGetNextFixture } from '../src/tools';

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
const adapter: ProviderAdapter = {
  name: 'espn',
  competition: 'eng.1',
  capabilities: { push: false, latencyHintSec: 0 },
  async fetchByDate() {
    return whole([fixture]);
  },
  async fetchLive() {
    return [];
  },
  async fetchWindow() {
    return whole([fixture]);
  },
};

let tmp: string;
const ENV = ['XDG_CONFIG_HOME', 'CLAUDINHO_COMPETITION', 'CLAUDINHO_TEAM'] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'claudinho-mcp-next-edges-'));
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.XDG_CONFIG_HOME = tmp;
  mkdirSync(join(tmp, 'claudinho'), { recursive: true });
  writeFileSync(
    join(tmp, 'claudinho', 'config.json'),
    JSON.stringify({ version: 1, competition: 'premier-league', team: { id: 'espn:359', code: 'ARS', name: 'Arsenal' } }),
  );
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(tmp, { recursive: true, force: true });
});

describe('the server CLAUDINHO_TEAM', () => {
  it('empty is absent: the pin answers', async () => {
    process.env.CLAUDINHO_TEAM = '';
    const r = await toolGetNextFixture({ adapter, now: NOW });
    expect((r.data as Record<string, unknown>).team).toMatchObject({ id: 'espn:359' });
    expect((r.data as Record<string, unknown>).fixture).toMatchObject({ id: '800000001' });
  });

  it('with nothing readable in it, it names no team: the tool error, never the pin', async () => {
    process.env.CLAUDINHO_TEAM = '\u200B';
    // Named as such (0.11 2.5b round 2): the server's value names no team; never "none pinned", never the pin.
    await expect(toolGetNextFixture({ adapter, now: NOW })).rejects.toThrow(/CLAUDINHO_TEAM names no team/);
  });
});
