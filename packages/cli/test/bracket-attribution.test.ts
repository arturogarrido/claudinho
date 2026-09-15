import type { Match, ProviderAdapter } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdBracket } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';

/**
 * Review P2 on batch 1 (CLI surface): no window capability + a successful but
 * EMPTY standings read → "bracket structure only" with NO provider attribution,
 * in text and in --json.
 */
const adapter: ProviderAdapter = {
  name: 'espn',
  capabilities: { push: false, latencyHintSec: 0 },
  async fetchByDate(): Promise<Match[]> {
    return [];
  },
  async fetchLive(): Promise<Match[]> {
    return [];
  },
  async fetchStandings() {
    return [];
  },
};
function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return { lang: 'en', tz: 'UTC', json: false, color: false, source: 'espn', flavor: 'off', ...over };
}
const ctx = (over: Partial<CliConfig> = {}) => ({ cfg: cfg(over), t: makeT('en'), adapter });

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

describe('bracket — no window capability + empty standings', () => {
  it('text says structure only and names no provider', async () => {
    await cmdBracket(undefined, {}, ctx());
    expect(text()).toContain('bracket structure only');
    expect(text()).not.toMatch(/live data/i);
  });

  it('--json carries degraded:true and no source', async () => {
    await cmdBracket(undefined, {}, ctx({ json: true }));
    const d = JSON.parse(writes.join('')) as { degraded: boolean; source: string | null };
    expect(d.degraded).toBe(true);
    expect(d.source).toBeNull();
  });
});
