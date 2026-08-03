/**
 * Mixed cache hits and fetch misses must retain both parts of the answer.
 * A cached signal is still useful, while an incomplete miss is still unknown;
 * collapsing either side loses information at the default-on surfaces.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Match, MarketProvider, MarketSignal } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { marketSignalsFor } from '../src/commands';
import { writeMarketCache } from '../src/marketCache';

const match = (id: string, home = 'MEX', away = 'RSA'): Match => ({
  id,
  stage: 'GROUP',
  group: 'A',
  kickoff: '2026-06-11T19:00:00.000Z',
  venue: 'Estadio Azteca',
  home: {
    code: home,
    name: home === 'MEX' ? 'Mexico' : 'Brazil',
    flag: home === 'MEX' ? '🇲🇽' : '🇧🇷',
  },
  away: {
    code: away,
    name: away === 'RSA' ? 'South Africa' : 'Morocco',
    flag: away === 'RSA' ? '🇿🇦' : '🇲🇦',
  },
  status: 'SCHEDULED',
  updatedAt: '2026-06-01T00:00:00.000Z',
});

function signalFor(m: Match, now: number): MarketSignal {
  const stamp = new Date(now).toISOString();
  return {
    matchId: m.id,
    source: 'polymarket',
    sourceMarketId: `market-${m.id}`,
    asOf: stamp,
    fetchedAt: stamp,
    outcomes: [
      { kind: 'home', teamCode: m.home.code, label: m.home.name, probability: 0.56 },
      { kind: 'draw', label: 'Draw', probability: 0.25 },
      { kind: 'away', teamCode: m.away.code, label: m.away.name, probability: 0.19 },
    ],
    favorite: {
      kind: 'home', teamCode: m.home.code, probability: 0.56, strength: 'slight',
    },
    stale: false,
    ambiguous: false,
  };
}

let cacheDir: string;
let oldCache: string | undefined;
let oldSource: string | undefined;
let oldCompetition: string | undefined;

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'claudinho-market-complete-'));
  oldCache = process.env.XDG_CACHE_HOME;
  oldSource = process.env.CLAUDINHO_MARKETS_SOURCE;
  oldCompetition = process.env.CLAUDINHO_COMPETITION;
  process.env.XDG_CACHE_HOME = cacheDir;
  process.env.CLAUDINHO_MARKETS_SOURCE = 'polymarket';
  process.env.CLAUDINHO_COMPETITION = 'fifa.world';
});

afterEach(() => {
  if (oldCache === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = oldCache;
  if (oldSource === undefined) delete process.env.CLAUDINHO_MARKETS_SOURCE;
  else process.env.CLAUDINHO_MARKETS_SOURCE = oldSource;
  if (oldCompetition === undefined) delete process.env.CLAUDINHO_COMPETITION;
  else process.env.CLAUDINHO_COMPETITION = oldCompetition;
  rmSync(cacheDir, { recursive: true, force: true });
});

describe('marketSignalsFor completeness through the production disk cache', () => {
  it('keeps a cached hit while propagating an incomplete miss', async () => {
    const hit = match('997101');
    const miss = match('997102', 'BRA', 'MAR');
    const now = Date.now();
    const cached = signalFor(hit, now);
    writeMarketCache(
      'polymarket',
      'fifa.world',
      [hit.id],
      new Map([[hit.id, cached]]),
      now,
    );

    let fetchedIds: string[] = [];
    const partial: MarketProvider = {
      name: 'partial',
      async findSignal() {
        return undefined;
      },
      async findSignals(matches) {
        fetchedIds = matches.map((m) => m.id);
        return { results: new Map(), complete: false };
      },
    };

    const result = await marketSignalsFor({} as never, [hit, miss], {}, () => partial);

    expect(fetchedIds).toEqual([miss.id]);
    expect(result.signals.get(hit.id)).toMatchObject({ matchId: hit.id, source: 'polymarket' });
    expect(result.signals.has(miss.id)).toBe(false);
    expect(result.complete).toBe(false);
  });
});
