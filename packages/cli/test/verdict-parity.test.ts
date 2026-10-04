/**
 * 0.11 PR 2.0b — a verdict in a command's text is in its `--json` too, on every
 * command that can state one.
 *
 * The same table as the MCP server's `verdict-parity.test.ts`. A mutation pass
 * showed three of these emit sites had no test that could see them
 * (`bracket --json`, `match --json`, the `markets <id>` text): the verdict was
 * forwarded there, and nothing would have failed had it stopped.
 */
import type { Match, ProviderAdapter } from '@claudinho/core';
import { FakeMarketProvider } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdBracket, cmdMarkets, cmdMatch, cmdNext, cmdShare } from '../src/commands';
import type { CliConfig } from '../src/config';
import { described } from './config-of';
import { makeT } from '../src/i18n';

const NOW = new Date('2026-09-15T00:00:00Z');
const NOTICE: Record<string, string> = {
  en: 'Not available for this competition yet.',
  es: 'Aún no disponible para esta competición.',
};

function adapter(competition: string): ProviderAdapter {
  return {
    name: 'espn',
    competition,
    capabilities: { push: false, latencyHintSec: 0 },
    async fetchByDate(): Promise<Match[]> {
      return [];
    },
    async fetchLive(): Promise<Match[]> {
      return [];
    },
    async fetchWindow(): Promise<Match[]> {
      return [];
    },
  };
}
function ctx(competition: string, over: Partial<CliConfig> = {}) {
  const lang = over.lang ?? 'en';
  const cfg: CliConfig = described({
    lang,
    tz: 'UTC',
    json: false,
    color: false,
    source: 'espn',
    competition,
    flavor: 'off',
    markets: false,
    ...over,
  });
  return { cfg, t: makeT(lang), adapter: adapter(competition), now: NOW, marketProvider: new FakeMarketProvider() };
}
type Ctx = ReturnType<typeof ctx>;

const ORIG = process.env.CLAUDINHO_COMPETITION;
const outSpy = vi.spyOn(process.stdout, 'write');
let writes: string[] = [];
beforeEach(() => {
  writes = [];
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
});
afterEach(() => {
  outSpy.mockReset();
  if (ORIG === undefined) delete process.env.CLAUDINHO_COMPETITION;
  else process.env.CLAUDINHO_COMPETITION = ORIG;
});
const text = () => writes.join('');

// 760415 is a bundled World Cup id: under another competition it must read as
// "not available", never as the World Cup opener. Since 0.11 (2.1c) `next`,
// `match <id>` and their share cards read the competition's own schedule ahead
// off the bundle, and a league season like `eng.1` says it has NO bracket
// (`off-bundle-surfaces.test.ts` pins those answers, text and --json); the
// bracket stays "not available yet" where a competition may have one (`ger.1`).
const CASES: [label: string, competition: string, run: (c: Ctx) => Promise<void>][] = [
  ['bracket', 'ger.1', (c) => cmdBracket(undefined, {}, c)],
  ['markets next <team>', 'eng.1', (c) => cmdMarkets('next', 'ARS', c)],
  ['markets <id>', 'eng.1', (c) => cmdMarkets('760415', undefined, c)],
  ['share bracket', 'ger.1', (c) => cmdShare('bracket', undefined, {}, c)],
];

describe('off the bundle: every command says "not available" in text AND in --json', () => {
  beforeEach(() => {
    process.env.CLAUDINHO_COMPETITION = 'eng.1';
  });

  it.each(CASES)('%s: the text says it', async (_label, competition, run) => {
    await run(ctx(competition));
    expect(text()).toContain(NOTICE.en);
  });

  it.each(CASES)('%s: the text says it in the reader’s language', async (_label, competition, run) => {
    await run(ctx(competition, { lang: 'es' }));
    expect(text()).toContain(NOTICE.es);
  });

  it.each(CASES)('%s: --json carries `unsupported: true` at the top level', async (_label, competition, run) => {
    await run(ctx(competition, { json: true }));
    expect(JSON.parse(text()).unsupported).toBe(true);
  });
});

describe('found in review: `markets <date>` off the markets’ scope', () => {
  beforeEach(() => {
    process.env.CLAUDINHO_COMPETITION = 'eng.1';
  });

  it('says it in --json too, like the by-team and by-id reads', async () => {
    await cmdMarkets('2026-10-01', undefined, ctx('eng.1', { json: true }));
    expect(JSON.parse(text()).unsupported).toBe(true);
    writes = [];
    await cmdMarkets('2026-10-01', undefined, ctx('eng.1'));
    expect(text()).toContain('Market signals cover the World Cup only');
  });

  it('and invents nothing where markets are read', async () => {
    await cmdMarkets('2026-10-01', undefined, ctx('fifa.world', { json: true }));
    expect('unsupported' in JSON.parse(text())).toBe(false);
  });

  it('nor where signals WERE shown: the demo source reads any competition, and text and --json must agree', async () => {
    const fixture: Match = {
      id: '800000001',
      stage: 'FRIENDLY',
      kickoff: '2026-10-01T19:00:00.000Z',
      venue: 'Emirates Stadium',
      home: { code: 'ARS', name: 'Arsenal', flag: '🏳️' },
      away: { code: 'CHE', name: 'Chelsea', flag: '🏳️' },
      status: 'SCHEDULED',
      updatedAt: NOW.toISOString(),
    };
    const withFixture: ProviderAdapter = { ...adapter('eng.1'), fetchByDate: async () => [fixture], fetchWindow: async () => [fixture] };
    const demo = (json: boolean) => ({
      ...ctx('eng.1', { json, markets: true }),
      adapter: withFixture,
      marketProvider: new FakeMarketProvider({ synthesize: true }),
    });
    await cmdMarkets('2026-10-01', undefined, demo(true));
    const data = JSON.parse(text());
    expect(Object.keys(data.marketSignals)).toEqual(['800000001']);
    expect('unsupported' in data).toBe(false);
    writes = [];
    await cmdMarkets('2026-10-01', undefined, demo(false));
    expect(text()).not.toContain('cover the World Cup only');
  });
});

describe('found in review: `share <date>` during an outage', () => {
  const down = (competition: string): ProviderAdapter => ({
    ...adapter(competition),
    async fetchByDate(): Promise<Match[]> {
      throw new Error('down');
    },
    async fetchWindow(): Promise<Match[]> {
      throw new Error('down');
    },
  });

  it('off the bundle the card says it could not ask, not that nothing is scheduled', async () => {
    process.env.CLAUDINHO_COMPETITION = 'eng.1';
    await cmdShare('2026-10-01', undefined, {}, { ...ctx('eng.1'), adapter: down('eng.1') });
    expect(text()).toContain("Couldn't reach the data provider");
    expect(text()).not.toContain('No matches scheduled');
  });

  it('on the bundle the schedule is known without the provider', async () => {
    delete process.env.CLAUDINHO_COMPETITION;
    await cmdShare('2026-10-01', undefined, {}, { ...ctx('fifa.world'), adapter: down('fifa.world') });
    expect(text()).toContain('No matches scheduled for Oct 1.');
  });
});

describe('on the bundle: no command invents the verdict', () => {
  beforeEach(() => {
    delete process.env.CLAUDINHO_COMPETITION;
  });

  // ZZZ is no World Cup team and 1 is no fixture id: honest empties, not verdicts.
  const EMPTY: [label: string, run: (c: Ctx) => Promise<void>][] = [
    ['match <id>', (c) => cmdMatch('1', c)],
    ['bracket', (c) => cmdBracket(undefined, {}, c)],
    ['markets <id>', (c) => cmdMarkets('1', undefined, c)],
    ['share <id>', (c) => cmdShare('1', undefined, {}, c)],
    ['share bracket', (c) => cmdShare('bracket', undefined, {}, c)],
    ['next <team>', (c) => cmdNext('MEX', c)],
    ['markets next <team>', (c) => cmdMarkets('next', 'MEX', c)],
    ['share next <team>', (c) => cmdShare('next', 'MEX', {}, c)],
  ];

  it.each(EMPTY)('%s: no `unsupported` key in --json, no notice in text', async (_label, run) => {
    await run(ctx('fifa.world', { json: true }));
    expect('unsupported' in JSON.parse(text())).toBe(false);
    writes = [];
    await run(ctx('fifa.world'));
    expect(text()).not.toContain(NOTICE.en);
  });
});
