import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Match, ProviderAdapter } from '@claudinho/core';
import { cmdNext, cmdShare } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';

/** A confirmed R32 tie ESPN has filed over the bundled placeholder slot. */
function r32MexEcu(): Match {
  return {
    id: '760486',
    stage: 'R32',
    kickoff: '2026-06-30T18:00Z',
    venue: 'SoFi Stadium',
    home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
    away: { code: 'ECU', name: 'Ecuador', flag: '🇪🇨' },
    status: 'SCHEDULED',
    updatedAt: '2026-06-28T00:00Z',
  };
}

function windowAdapter(window: Match[], opts: { throws?: boolean } = {}): ProviderAdapter {
  return {
    name: 'espn',
    capabilities: { push: false, latencyHintSec: 0 },
    async fetchByDate() {
      if (opts.throws) throw new Error('down');
      return [];
    },
    async fetchLive() {
      if (opts.throws) throw new Error('down');
      return [];
    },
    async fetchWindow() {
      if (opts.throws) throw new Error('down');
      return window;
    },
  };
}

function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return {
    lang: 'en',
    tz: 'UTC',
    json: true,
    color: false,
    source: 'espn',
    flavor: 'off',
    markets: false,
    ...over,
  };
}

// Group stage is done on the knockout days, so a static lookup is blind.
const KNOCKOUT_NOW = new Date('2026-06-28T12:00:00Z');

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
const json = () => JSON.parse(writes.join(''));
const text = () => writes.join('');

describe('cmdNext — live-resolved knockout fixture', () => {
  it('resolves a confirmed R32 tie from the live overlay (--json)', async () => {
    await cmdNext('MEX', {
      cfg: cfg(),
      t: makeT('en'),
      adapter: windowAdapter([r32MexEcu()]),
      now: KNOCKOUT_NOW,
    });
    const data = json() as { team: string; fixture: Match | null; degraded: boolean; source: string | null };
    expect(data.team).toBe('MEX');
    expect(data.fixture?.away.code).toBe('ECU');
    expect(data.degraded).toBe(false);
    expect(data.source).toBe('espn'); // live overlay served it → attributed
  });

  it('renders the tie + provider attribution in text mode', async () => {
    await cmdNext('MEX', {
      cfg: cfg({ json: false }),
      t: makeT('en'),
      adapter: windowAdapter([r32MexEcu()]),
      now: KNOCKOUT_NOW,
    });
    const t = text();
    expect(t).toContain('Mexico');
    expect(t).toContain('Ecuador');
    expect(t).toContain('Round of 32');
    expect(t).toContain('Live data: ESPN');
  });

  it('fails closed on a feed outage: degraded, no invented pairing (--json)', async () => {
    await cmdNext('MEX', {
      cfg: cfg(),
      t: makeT('en'),
      adapter: windowAdapter([], { throws: true }),
      now: KNOCKOUT_NOW,
    });
    const data = json() as { fixture: Match | null; degraded: boolean };
    expect(data.degraded).toBe(true);
    expect(data.fixture).toBeNull();
  });

  it('feed outage reads as "couldn\'t reach the provider", not "no upcoming fixture" (text)', async () => {
    await cmdNext('MEX', {
      cfg: cfg({ json: false }),
      t: makeT('en'),
      adapter: windowAdapter([], { throws: true }),
      now: KNOCKOUT_NOW,
    });
    const t = text();
    expect(t).toContain("couldn't reach the data provider");
    expect(t).not.toContain('No upcoming fixture found');
  });
});

describe('cmdShare next — live-resolved knockout fixture', () => {
  it('pastes the resolved tie and attributes the provider (--json)', async () => {
    await cmdShare('next', 'MEX', {}, {
      cfg: cfg(),
      t: makeT('en'),
      adapter: windowAdapter([r32MexEcu()]),
      now: KNOCKOUT_NOW,
      marketProvider: undefined,
    });
    const data = json() as { kind: string; matches: Match[]; source: string | null };
    expect(data.kind).toBe('next');
    expect(data.matches[0]?.away.code).toBe('ECU');
    // Overlay resolved the tie ⇒ attribute the provider, parity with `next`.
    expect(data.source).toBe('espn');
  });

  it('feed outage: the pasted card never reads as "no fixture" (text)', async () => {
    await cmdShare('next', 'MEX', {}, {
      cfg: cfg({ json: false }),
      t: makeT('en'),
      adapter: windowAdapter([], { throws: true }),
      now: KNOCKOUT_NOW,
      marketProvider: undefined,
    });
    const t = text();
    expect(t).toContain("Couldn't reach the data provider");
    expect(t).not.toContain('Live data:'); // no attribution on degraded
  });
});
