/**
 * WHICH kind of "no signal" this was — and therefore whether it may be
 * remembered.
 *
 * A negative market result is written to a cache with a TTL, so recording the
 * wrong kind is not a cosmetic mistake: it suppresses the refetch that would
 * have produced a real signal, for as long as the entry lives. Before this,
 * `checked: boolean` collapsed five situations into two, and four of them
 * landed on the cacheable side by default:
 *
 *   - two markets claiming the same team          (ambiguous)
 *   - two outcome legs that are the same market   (ambiguous)
 *   - probabilities that do not form a 1X2        (ambiguous)
 *   - a signal that does not map onto the fixture (ambiguous)
 *
 * Each was filed as the provider's answer "this fixture has no market". Each is
 * really a statement about US.
 */
import { describe, expect, it } from 'vitest';
import { PolymarketProvider } from '../src/index';
import type { Match } from '../src/index';
import { cacheableKeys, selectOne } from '../src/trust';

const NOW = new Date('2026-06-11T15:00:00Z');
const SLUG = 'fifwc-mex-rsa-2026-06-11';

function match(over: Partial<Match> = {}): Match {
  return {
    id: '760415',
    stage: 'GROUP',
    group: 'A',
    kickoff: '2026-06-11T19:00Z',
    venue: 'Estadio Banorte',
    home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
    away: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' },
    status: 'SCHEDULED',
    updatedAt: '2026-06-01T00:00Z',
    ...over,
  };
}

function market(token: string, groupItemTitle: string, yes: number, over: Record<string, unknown> = {}) {
  return {
    id: `m-${token}`,
    slug: `mkt-${token}`,
    groupItemTitle,
    sportsMarketType: 'moneyline',
    outcomes: JSON.stringify(['Yes', 'No']),
    outcomePrices: JSON.stringify([String(yes), String(Number((1 - yes).toFixed(4)))]),
    liquidityNum: 120000,
    active: true,
    closed: false,
    updatedAt: '2026-06-11T14:55:00Z',
    ...over,
  };
}

const LEGS = [
  market('mex', 'Mexico', 0.685),
  market('draw', 'Draw (regular time)', 0.205),
  market('rsa', 'South Africa', 0.105),
];

function event(over: Record<string, unknown> = {}, markets?: unknown[]) {
  return {
    id: '351715',
    slug: SLUG,
    title: 'Mexico vs. South Africa',
    startTime: '2026-06-11T19:00:00Z',
    active: true,
    closed: false,
    seriesSlug: 'soccer-fifwc',
    sport: { sport: 'fifwc' },
    updatedAt: '2026-06-11T14:55:00Z',
    markets: markets ?? LEGS,
    ...over,
  };
}

const serving = (body: unknown, status = 200): typeof fetch =>
  (async () => ({
    ok: status < 400,
    status,
    statusText: 'OK',
    json: async () => body,
  })) as unknown as typeof fetch;

const provider = (fetchImpl: typeof fetch) => new PolymarketProvider({ fetchImpl, now: NOW });

/** Resolve one fixture and report only what the cache is allowed to keep. */
async function verdict(fetchImpl: typeof fetch, m = match()) {
  const batch = await provider(fetchImpl).findSignals([m]);
  const r = batch.results.get(m.id);
  return {
    kind: r?.kind,
    cacheable: cacheableKeys(batch).has(m.id),
    complete: batch.complete,
  };
}

describe('a payload we could not resolve is never filed as "no market"', () => {
  it('two markets claiming the same team is AMBIGUOUS, not a negative result', async () => {
    const twoMexico = [...LEGS, market('mex2', 'Mexico', 0.4)];
    const v = await verdict(serving([event({}, twoMexico)]));
    expect(v.kind).toBe('ambiguous');
    expect(v.cacheable).toBe(false);
  });

  it('two outcome legs that are the same market is AMBIGUOUS', async () => {
    // ONE market that both selectors reach by different routes: its slug token
    // is `mex` (so it is Mexico's leg by slug) and its title is 'South Africa'
    // (so it is RSA's leg by title). Neither selector is itself ambiguous —
    // each finds exactly one — so this can only be caught after selection.
    const collapsed = [market('mex', 'South Africa', 0.5), market('draw', 'Draw', 0.2)];
    const v = await verdict(serving([event({}, collapsed)]));
    expect(v.kind).toBe('ambiguous');
    expect(v.cacheable).toBe(false);
  });

  it('probabilities that do not form a 1X2 are AMBIGUOUS — we grabbed the wrong markets', async () => {
    const incoherent = [
      market('mex', 'Mexico', 0.9),
      market('draw', 'Draw', 0.9),
      market('rsa', 'South Africa', 0.9),
    ];
    const v = await verdict(serving([event({}, incoherent)]));
    expect(v.kind).toBe('ambiguous');
    expect(v.cacheable).toBe(false);
  });

  it('an unreadable leg is MALFORMED — a fact about the payload, not the fixture', async () => {
    const broken = [
      market('mex', 'Mexico', 0.685, { outcomePrices: JSON.stringify(['high', 'low']) }),
      market('draw', 'Draw', 0.205),
      market('rsa', 'South Africa', 0.105),
    ];
    const v = await verdict(serving([event({}, broken)]));
    expect(v.kind).toBe('malformed');
    expect(v.cacheable).toBe(false);
  });

  it('one slug returning two events is AMBIGUOUS', async () => {
    const v = await verdict(serving([event(), event({ id: '2' })]));
    expect(v.kind).toBe('ambiguous');
    expect(v.cacheable).toBe(false);
  });

  it('a provider error is MALFORMED, and the batch is not complete', async () => {
    const v = await verdict(serving(null, 500));
    expect(v.cacheable).toBe(false);
    expect(v.complete).toBe(false);
  });
});

describe('a real answer about the fixture IS remembered', () => {
  it('a usable market resolves and is cacheable', async () => {
    const v = await verdict(serving([event()]));
    expect(v.kind).toBe('valid');
    expect(v.cacheable).toBe(true);
    expect(v.complete).toBe(true);
  });

  it('no such event (empty array) is a DEFINITIVE none', async () => {
    const v = await verdict(serving([]));
    expect(v.kind).toBe('definitive-none');
    expect(v.cacheable).toBe(true);
  });

  it('404 is a DEFINITIVE none', async () => {
    const v = await verdict(serving(null, 404));
    expect(v.kind).toBe('definitive-none');
    expect(v.cacheable).toBe(true);
  });

  it('an event that is closed, or for another competition, is a DEFINITIVE none', async () => {
    for (const over of [{ closed: true }, { seriesSlug: 'nba', sport: { sport: 'nba' } }]) {
      const v = await verdict(serving([event(over)]));
      expect(v.kind, JSON.stringify(over)).toBe('definitive-none');
      expect(v.cacheable).toBe(true);
    }
  });

  it('an event carrying no leg for a team is a DEFINITIVE none', async () => {
    const v = await verdict(serving([event({}, [market('draw', 'Draw', 0.2)])]));
    expect(v.kind).toBe('definitive-none');
    expect(v.cacheable).toBe(true);
  });
});

describe('an expired deadline is an unasked question', () => {
  it('records UNRESOLVED, marks the batch incomplete, and caches nothing', async () => {
    const p = provider(serving([event()]));
    const batch = await p.findSignals([match(), match({ id: 'b' })], { deadlineMs: 0 });
    expect(batch.complete).toBe(false);
    expect(cacheableKeys(batch).size).toBe(0);
    expect([...batch.results.values()].every((r) => r.kind === 'unresolved')).toBe(true);
  });
});

describe('selectOne', () => {
  it('answers none / one / ambiguous and never picks a winner', () => {
    expect(selectOne([]).kind).toBe('none');
    expect(selectOne(['a'])).toEqual({ kind: 'one', value: 'a' });
    expect(selectOne(['a', 'b'])).toEqual({ kind: 'ambiguous', count: 2 });
  });
});
