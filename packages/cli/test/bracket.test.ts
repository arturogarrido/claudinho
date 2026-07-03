import type { ProviderAdapter } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdBracket } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';

const downAdapter: ProviderAdapter = {
  name: 'fake',
  capabilities: { push: false, latencyHintSec: 0 },
  async fetchByDate() {
    throw new Error('down');
  },
  async fetchLive() {
    throw new Error('down');
  },
  async fetchWindow() {
    throw new Error('down');
  },
  async fetchStandings() {
    throw new Error('down');
  },
};

function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return { lang: 'en', tz: 'UTC', json: false, color: false, source: 'espn', flavor: 'off', markets: false, ...over };
}

const ctx = (adapter: ProviderAdapter) => ({ cfg: cfg(), t: makeT('en'), adapter });

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

describe('cmdBracket', () => {
  it('renders the knockout bracket offline with degraded notice', async () => {
    await cmdBracket(undefined, {}, ctx(downAdapter));
    const out = writes.join('');
    expect(out).toContain('Knockout bracket');
    expect(out).toContain('Round of 32');
    expect(out).toContain('Live scores unavailable');
    expect(out).not.toContain('Live data:');
  });

  it('renders localized bracket copy in Spanish', async () => {
    await cmdBracket(undefined, {}, {
      cfg: cfg({ lang: 'es' }),
      t: makeT('es'),
      adapter: downAdapter,
    });
    const out = writes.join('');
    expect(out).toContain('Cuadro de eliminatorias');
    expect(out).toContain('Dieciseisavos de final');
    expect(out).toContain('Marcadores en vivo no disponibles');
  });

  it('rejects an unknown stage filter', async () => {
    await expect(cmdBracket('ROUND64', {}, ctx(downAdapter))).rejects.toThrow(/Stage must be one of/);
  });
});
