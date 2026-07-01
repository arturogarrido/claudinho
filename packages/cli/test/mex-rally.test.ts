import type { Match, ProviderAdapter } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdNext, cmdToday } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';

const RALLY = '¿Y si sí?';
const NOW = new Date('2026-06-30T12:00:00Z');

function m(over: Partial<Match> = {}): Match {
  return {
    id: '760486',
    stage: 'R32',
    kickoff: '2026-07-01T01:00Z',
    venue: 'SoFi Stadium',
    home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
    away: { code: 'ECU', name: 'Ecuador', flag: '🇪🇨' },
    status: 'SCHEDULED',
    updatedAt: '2026-06-30T00:00Z',
    ...over,
  };
}
const notMex = m({
  id: '760488',
  home: { code: 'BRA', name: 'Brazil', flag: '🇧🇷' },
  away: { code: 'JPN', name: 'Japan', flag: '🇯🇵' },
});

function adapter(window: Match[]): ProviderAdapter {
  return {
    name: 'espn',
    capabilities: { push: false, latencyHintSec: 0 },
    async fetchByDate() {
      return window;
    },
    async fetchLive() {
      return [];
    },
    async fetchWindow() {
      return window;
    },
  };
}

function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return { lang: 'en', tz: 'UTC', json: false, color: false, source: 'espn', flavor: 'full', ...over };
}
const ctx = (window: Match[], over: Partial<CliConfig> = {}) => ({
  cfg: cfg(over),
  t: makeT(over.lang ?? 'en'),
  adapter: adapter(window),
  marketProvider: undefined,
  now: NOW,
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

describe('¿Y si sí? — Mexico rally cry on today/next', () => {
  it('today: shows it INLINE on the MEX match line, not a separate line (even in English)', async () => {
    await cmdToday('2026-07-01', ctx([m()], { lang: 'en' }));
    // It takes the flair slot: same line as the match, after the kickoff/status.
    const mexLine = text().split('\n').find((l) => l.includes('Mexico'));
    expect(mexLine).toContain(RALLY);
  });

  it('today: shows it exactly once, only for the MEX match', async () => {
    await cmdToday('2026-07-01', ctx([m(), notMex]));
    expect(text().split(RALLY).length - 1).toBe(1);
  });

  it('today: NOT shown when no MEX match is on the card', async () => {
    await cmdToday('2026-07-01', ctx([notMex]));
    expect(text()).not.toContain(RALLY);
  });

  it('today: suppressed by --flavor off', async () => {
    await cmdToday('2026-07-01', ctx([m()], { flavor: 'off' }));
    expect(text()).not.toContain(RALLY);
  });

  it('today: never in --json', async () => {
    await cmdToday('2026-07-01', ctx([m()], { json: true }));
    expect(text()).not.toContain('si sí');
  });

  it('next MEX: shows it', async () => {
    await cmdNext('MEX', ctx([m()]));
    expect(text()).toContain(RALLY);
  });

  it('next: not shown for a team whose fixture has no MEX', async () => {
    await cmdNext('BRA', ctx([notMex]));
    expect(text()).not.toContain(RALLY);
  });
});
