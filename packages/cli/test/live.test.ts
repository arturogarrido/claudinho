import type { Match, ProviderAdapter } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdLive } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';

/** Feed reachable, but nothing is in play. */
const okAdapter: ProviderAdapter = {
  name: 'espn',
  capabilities: { push: false, latencyHintSec: 0 },
  async fetchByDate(): Promise<Match[]> {
    return [];
  },
  async fetchLive(): Promise<Match[]> {
    return [];
  },
};

/** Feed down (e.g. a 403 from a sandboxed environment) → degraded. */
const downAdapter: ProviderAdapter = {
  name: 'espn',
  capabilities: { push: false, latencyHintSec: 0 },
  async fetchByDate(): Promise<Match[]> {
    throw new Error('ESPN 403');
  },
  async fetchLive(): Promise<Match[]> {
    throw new Error('ESPN 403');
  },
};

function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return { lang: 'en', tz: 'UTC', json: false, color: false, source: 'espn', flavor: 'off', ...over };
}
const ctx = (adapter: ProviderAdapter, over: Partial<CliConfig> = {}) => ({
  cfg: cfg(over),
  t: makeT('en'),
  adapter,
});

const outSpy = vi.spyOn(process.stdout, 'write');
let writes: string[] = [];
beforeEach(() => {
  writes = [];
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
});
afterEach(() => outSpy.mockReset());
const text = () => writes.join('');

describe('cmdLive — degraded honesty', () => {
  it('says the feed is down when degraded — NOT "no matches in play"', async () => {
    await cmdLive(ctx(downAdapter));
    expect(text()).toContain('Live scores unavailable');
    expect(text()).not.toContain('No matches in play');
  });

  it('says "no matches in play" when the feed is reachable but nothing is live', async () => {
    await cmdLive(ctx(okAdapter));
    expect(text()).toContain('No matches in play');
    expect(text()).not.toContain('Live scores unavailable');
  });

  it('JSON mode flags degraded with a null source (no provider served it)', async () => {
    await cmdLive(ctx(downAdapter, { json: true }));
    const d = JSON.parse(text()) as { degraded: boolean; source: string | null };
    expect(d.degraded).toBe(true);
    expect(d.source).toBeNull();
  });
});
