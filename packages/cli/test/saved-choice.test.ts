/**
 * The saved choice on every surface (0.11 · 2.5b, D2): with the file present
 * and no environment, every surface answers that competition (the mode line
 * names it with no source suffix; the statusline reads the cache keyed by it;
 * the hook too); with the environment set as well, the environment wins and
 * the mode line says so. The hot path reads the file through the one bounded
 * reader (pinned by `cache-reads.test.ts`: no read by path) and stays under
 * its budget (the latency script, not this file).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Match, ProviderAdapter } from '@claudinho/core';
import { attachFetchMeta, FakeMarketProvider } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeState } from '../src/cache';
vi.mock('node:child_process', () => ({ spawn: vi.fn(() => ({ unref: vi.fn() })) }));
import { cmdHook, cmdLive, cmdPrompt, cmdToday } from '../src/commands';
import { resolveConfig } from '../src/config';
import { makeT } from '../src/i18n';

const NOW = new Date('2026-10-10T15:00:00.000Z');
const live = (): Match => ({
  id: '800000001',
  stage: 'REGULAR',
  kickoff: '2026-10-10T14:20:00.000Z',
  venue: 'Emirates Stadium',
  home: { code: 'ARS', name: 'Arsenal', id: 'espn:359' },
  away: { code: 'CHE', name: 'Chelsea', id: 'espn:363' },
  status: 'LIVE',
  minute: 40,
  score: { home: 2, away: 1 },
  updatedAt: NOW.toISOString(),
});
const adapterFor = (competition: string): ProviderAdapter => ({
  name: 'espn',
  competition,
  capabilities: { push: false, latencyHintSec: 0 },
  async fetchByDate() {
    return attachFetchMeta([live()], { complete: true, omitted: 0, seasons: [] });
  },
  async fetchLive() {
    return attachFetchMeta([live()], { complete: true, omitted: 0, seasons: [] });
  },
  async fetchWindow() {
    return attachFetchMeta([live()], { complete: true, omitted: 0, seasons: [] });
  },
});

let tmp: string;
const ENV = ['XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'CLAUDINHO_COMPETITION', 'CLAUDINHO_TEAM'] as const;
const saved: Record<string, string | undefined> = {};
const outSpy = vi.spyOn(process.stdout, 'write');
let writes: string[] = [];
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'claudinho-saved-'));
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.XDG_CONFIG_HOME = join(tmp, 'config');
  process.env.XDG_CACHE_HOME = join(tmp, 'cache');
  mkdirSync(join(tmp, 'config', 'claudinho'), { recursive: true });
  writeFileSync(join(tmp, 'config', 'claudinho', 'config.json'), JSON.stringify({ version: 1, competition: 'premier-league' }));
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
const ctxOf = (over: { json?: boolean } = {}) => {
  const cfg = resolveConfig({ tz: 'UTC', color: false, source: 'espn', flavor: 'off', markets: false, ...over });
  return { cfg, t: makeT('en'), adapter: adapterFor(cfg.competition), now: NOW, marketProvider: new FakeMarketProvider() };
};

describe('with the file and no environment', () => {
  it('`today` and `live` answer the saved competition, the mode line names it with no suffix, `--json` says saved', async () => {
    await cmdToday('2026-10-10', ctxOf());
    expect(text().split('\n').map((l) => l.trim()).filter(Boolean)[1]).toBe('Premier League');
    expect(text()).toContain('Arsenal');
    writes = [];
    await cmdLive(ctxOf({ json: true }));
    expect(JSON.parse(text()).competition).toEqual({ slug: 'eng.1', alias: 'premier-league', name: 'Premier League', chosenBy: 'saved' });
  });

  it('the statusline and the hook read the cache keyed by the saved competition', () => {
    writeState({ updatedAt: NOW.toISOString(), live: [live()], degraded: false, source: 'espn', competition: 'eng.1' }, NOW.getTime());
    cmdPrompt(ctxOf(), { cursor: undefined });
    expect(text()).toMatch(/ARS 2–1 CHE/);
    writes = [];
    cmdHook(ctxOf());
    expect(text()).toContain('Arsenal');
  });
});

describe('with the environment set too', () => {
  it('the environment wins and the mode line says so; the file is not what answers', async () => {
    process.env.CLAUDINHO_COMPETITION = 'laliga';
    const ctx = ctxOf();
    expect(ctx.cfg.selection).toMatchObject({ slug: 'esp.1', chosenBy: 'env' });
    await cmdToday('2026-10-10', ctx);
    expect(text().split('\n').map((l) => l.trim()).filter(Boolean)[1]).toBe('LALIGA · from the environment');
  });
});
