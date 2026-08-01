/**
 * A market lookup must CONVERGE — re-asking a question whose answer cannot
 * change is a permanent cost with no benefit.
 *
 * The trust boundary distinguishes kinds of non-answer, and the line for
 * remembering one is whether we UNDERSTOOD the payload. A structural ambiguity
 * (two legs claiming the same team, an incoherent 1X2) is a conclusion drawn
 * from bytes we read successfully, and it is stable: the next fetch returns the
 * same bytes and the same ambiguity. Treating it as non-cacheable re-fetched
 * that fixture on every command forever — and under the default-on enrichment
 * deadline those doomed fixtures are retried first, consuming the whole budget
 * so the resolvable fixtures behind them never resolve.
 *
 * Measured, three consecutive runs against an unchanging feed:
 *   ambiguous not cacheable -> 6, 6, 6 requests   (never converges)
 *   ambiguous cacheable     -> 6, 0, 0 requests
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PolymarketProvider, cacheableKeys, resolvedValues } from '@claudinho/core';
import { readMarketCache, writeMarketCache } from '../src/marketCache';

// This test is ABOUT the cache, so it must own one. Left to the ambient
// XDG_CACHE_HOME it reads the developer's real `~/.cache/claudinho` — which
// already holds these ids after one run, so run 0 issues zero requests and the
// assertion inverts. It passed under an explicit XDG_CACHE_HOME and failed in
// the plain suite: an environment the test depends on has to be pinned BY the
// test, not by how it happened to be invoked.
let cacheDir: string;
let previous: string | undefined;
beforeAll(() => {
  previous = process.env.XDG_CACHE_HOME;
  cacheDir = mkdtempSync(join(tmpdir(), 'claudinho-converge-'));
  process.env.XDG_CACHE_HOME = cacheDir;
});
afterAll(() => {
  if (previous === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = previous;
  rmSync(cacheDir, { recursive: true, force: true });
});

const NOW = new Date('2026-06-11T15:00:00Z');

const fixture = (id: string): never =>
  ({
    id, stage: 'GROUP', group: 'A', kickoff: '2026-06-11T19:00Z', venue: 'V',
    home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
    away: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' },
    status: 'SCHEDULED', updatedAt: '2026-06-01T00:00Z',
  }) as never;

const leg = (token: string, title: string, yes: number) => ({
  id: `m-${token}`, slug: `mkt-${token}`, groupItemTitle: title,
  sportsMarketType: 'moneyline', outcomes: JSON.stringify(['Yes', 'No']),
  outcomePrices: JSON.stringify([String(yes), String(Number((1 - yes).toFixed(4)))]),
  liquidityNum: 120_000, active: true, closed: false, updatedAt: '2026-06-11T14:55:00Z',
});

const event = (markets: unknown[]) => ({
  id: '351715', slug: 'fifwc-mex-rsa-2026-06-11', title: 'Mexico vs. South Africa',
  startTime: '2026-06-11T19:00:00Z', active: true, closed: false,
  seriesSlug: 'soccer-fifwc', sport: { sport: 'fifwc' },
  updatedAt: '2026-06-11T14:55:00Z', markets,
});

/** Two legs claiming Mexico — ambiguous, and identical on every fetch. */
const AMBIGUOUS = [
  leg('mex', 'Mexico', 0.685), leg('draw', 'Draw', 0.205),
  leg('rsa', 'South Africa', 0.105), leg('mex2', 'Mexico', 0.4),
];

/** Drive the real read → fetch → write loop the CLI uses, N times. */
async function requestsPerRun(markets: unknown[], runs = 3): Promise<number[]> {
  const ids = ['760415', '760416', '760417'];
  let requests = 0;
  const fetchImpl = (async () => {
    requests++;
    return { ok: true, status: 200, statusText: 'OK', json: async () => [event(markets)] };
  }) as unknown as typeof fetch;

  const out: number[] = [];
  for (let run = 0; run < runs; run++) {
    requests = 0;
    const { checked } = readMarketCache('polymarket', 'fifa.world', NOW.getTime());
    const miss = ids.filter((id) => !checked.has(id)).map(fixture);
    if (miss.length > 0) {
      const provider = new PolymarketProvider({ fetchImpl, now: NOW });
      const batch = await provider.findSignals(miss as never, { deadlineMs: 60_000 });
      writeMarketCache(
        'polymarket', 'fifa.world',
        [...cacheableKeys(batch)], resolvedValues(batch), NOW.getTime(),
      );
    }
    out.push(requests);
  }
  return out;
}

describe('a stable non-answer is asked once, not forever', () => {
  it('stops re-fetching a fixture whose ambiguity cannot change', async () => {
    const runs = await requestsPerRun(AMBIGUOUS);
    expect(runs[0]).toBeGreaterThan(0); // it did ask, once
    expect(runs.slice(1)).toEqual([0, 0]); // and never again within the TTL
  }, 60_000);
});
