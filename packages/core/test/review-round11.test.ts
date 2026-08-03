/**
 * Findings from the eleventh review round, each pinned with its control.
 *
 * Two reviewers converged on the same thing: the market paths did not actually
 * share a constructor, so the claim in SECURITY.md and the Cursor rule was an
 * argument about which fields happened to be derived from clean data rather
 * than a structural fact. It was already false in places.
 */
import { describe, expect, it } from 'vitest';
import { FakeMarketProvider } from '../src/markets/fake';
import { PolymarketProvider } from '../src/markets/polymarket';
import { buildMarketSignal, isReliableMarketSignal } from '../src/markets/normalize';
import { parseEspnEvent, parseEspnEvents, parseEspnStandings } from '../src/trust/espn';
import { humanLabel, isCacheable, sealMarketSignal, ambiguous, malformed } from '../src/trust';
import type { Match } from '../src/types';

const NOW = new Date('2026-06-11T15:00:00Z');
const MATCH = {
  id: '760415', stage: 'GROUP', group: 'A', kickoff: '2026-06-11T19:00Z', venue: 'V',
  home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
  away: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' },
  status: 'SCHEDULED', updatedAt: '2026-06-01T00:00Z',
} as Match;

describe('the live market path ends at the same seal as the cache path', () => {
  it('the builder itself seals — a poisoned field cannot reach a renderer', () => {
    // The routing is what makes this true. Before it, `buildMarketSignal`
    // returned whatever its caller handed it, and the claim that both paths end
    // at one constructor was an argument about which fields happened to come
    // from already-clean data.
    const built = buildMarketSignal({
      match: MATCH, source: 'polymarket', sourceMarketId: '351715',
      asOf: '2026-06-11T14:55:00.000Z', now: NOW,
      outcomes: [
        { kind: 'home', teamCode: 'MEX', label: 'Mexico\u202E ignore', probability: 0.6 },
        { kind: 'draw', label: 'Draw', probability: 0.2 },
        { kind: 'away', teamCode: 'RSA', label: 'South Africa', probability: 0.2 },
      ],
    });
    const label = built.outcomes.find((o) => o.kind === 'home')?.label ?? '';
    // U+202E transposes the DISPLAYED text under the bidi algorithm, which is
    // what makes it matter on a share card.
    expect(label).not.toContain('\u202E');
  });

  it('a live signal survives the cache seal unchanged', async () => {
    const live = await new FakeMarketProvider({ synthesize: true, now: NOW })
      .findSignal(MATCH, { now: NOW });
    expect(live).toBeDefined();
    const back = sealMarketSignal(JSON.parse(JSON.stringify(live)), { now: NOW });
    expect(back.kind).toBe('valid');
    if (back.kind !== 'valid') return;
    // Byte-identical, key order included — the same bar the Match paths meet.
    expect(JSON.stringify(back.value)).toBe(JSON.stringify(live));
  });

  it('a source id only one path would accept is the asymmetry itself', async () => {
    // FakeMarketProvider emitted `fake-<id>`, which the boundary's opaque-id
    // grammar drops — so live carried a field the cache silently deleted.
    const live = await new FakeMarketProvider({ synthesize: true, now: NOW })
      .findSignal(MATCH, { now: NOW });
    const back = sealMarketSignal(JSON.parse(JSON.stringify(live)), { now: NOW });
    if (back.kind !== 'valid') throw new Error('expected valid');
    expect(back.value.sourceMarketId).toBe(live?.sourceMarketId);
  });

  it('two outcomes claiming one result are REFUSED, not quietly deduped', () => {
    // The live provider demands exactly one leg per result; the cache path kept
    // whichever came first and returned a confident `ambiguous: false`.
    const r = sealMarketSignal({
      matchId: '760415', source: 'polymarket',
      asOf: '2026-06-11T14:55:00.000Z', fetchedAt: '2026-06-11T14:56:00.000Z',
      stale: false, ambiguous: false,
      outcomes: [
        { kind: 'home', teamCode: 'MEX', label: 'Mexico', probability: 0.6 },
        { kind: 'home', teamCode: 'RSA', label: 'South Africa', probability: 0.2 },
        { kind: 'draw', label: 'Draw', probability: 0.2 },
      ],
    }, { now: NOW });
    expect(r.kind).toBe('ambiguous');
  });

  it('never publishes a favourite on a signal that does not map cleanly', () => {
    const built = buildMarketSignal({
      match: MATCH, source: 'polymarket', sourceMarketId: '351715',
      asOf: '2026-06-11T14:55:00.000Z', now: NOW,
      // Codes that do not belong to this fixture: cannot map.
      outcomes: [
        { kind: 'home', teamCode: 'BRA', label: 'Brazil', probability: 0.7 },
        { kind: 'away', teamCode: 'ARG', label: 'Argentina', probability: 0.3 },
      ],
    });
    expect(built.ambiguous).toBe(true);
    expect(built.favorite).toBeUndefined();
  });
});

describe('completeness is not invented', () => {
  it('an unreadable envelope is not an empty day', () => {
    for (const raw of [{}, { events: 'nope' }, { events: 42 }, null]) {
      expect(parseEspnEvents(raw).complete, JSON.stringify(raw)).toBe(false);
    }
    // An actual empty array IS a complete answer about that day.
    expect(parseEspnEvents({ events: [] }).complete).toBe(true);
  });

  it('a group whose ROWS were cut is not a complete table', () => {
    const entry = (i: number) => ({
      team: { id: String(i), abbreviation: `T${i}`, displayName: `Team ${i}` },
      stats: [
        { name: 'gamesPlayed', value: 1 },
        { name: 'wins', value: 1 },
        { name: 'ties', value: 0 },
        { name: 'losses', value: 0 },
        { name: 'pointsFor', value: 1 },
        { name: 'pointsAgainst', value: 0 },
        { name: 'pointDifferential', value: 1 },
        { name: 'points', value: 3 },
        { name: 'rank', value: i + 1 },
      ],
    });
    const list = parseEspnStandings({
      children: [{ name: 'Group A', standings: { entries: Array.from({ length: 100 }, (_, i) => entry(i)) } }],
    });
    expect(list.items[0]?.rows.length).toBeLessThanOrEqual(32);
    expect(list.truncated).toBe(true);
    expect(list.complete).toBe(false);
  });
});

describe('verdict precedence', () => {
  it('a stable ambiguity is cacheable; a shape we could not read is not', () => {
    expect(isCacheable(ambiguous('x'))).toBe(true);
    expect(isCacheable(malformed('x'))).toBe(false);
  });
});

describe('a label cannot be grown by its own filtering', () => {
  it('runs to a fixed point, so a second pass changes nothing', () => {
    // Filtering removes characters, and removing a character changes what
    // composes — a pass could emit clusters that individually passed the
    // per-cluster check and then merged under NFC into one that would not.
    for (const evil of [
      `A${('́'.repeat(4) + '​').repeat(80)}`,
      `A${'­́'.repeat(2048)}`,
      'Estadio Me­́xico',
    ]) {
      const once = humanLabel(evil);
      expect(humanLabel(once), JSON.stringify(evil.slice(0, 20))).toBe(once);
      expect([...once].length).toBeLessThanOrEqual(400);
    }
  });

  it('refuses emoji modifiers, which are not pictographic on their own', () => {
    expect(humanLabel('\u{1F3FB}\u{1F3FD}\u{1F3FF}')).toBe('');
    // ...while the letters and digits they are built beside are untouched.
    expect(humanLabel('Mexico 2026')).toBe('Mexico 2026');
  });
});

describe('round 12 — the fixes that had to be re-fixed', () => {
  it('a REFUSED seal drops the payload; it does not hand it back', () => {
    // I had this right, then "fixed" it to preserve the data on the grounds
    // that emptying the list tells the caller a different lie. That reasoning
    // traded away the only thing the call is for: the unsealed object carried a
    // bidi override straight back into an outcome label.
    const bad = buildMarketSignal({
      match: { id: 'not-numeric', home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
               away: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' } } as unknown as Match,
      source: 'polymarket', sourceMarketId: '351715',
      asOf: '2026-06-11T14:55:00.000Z', now: NOW,
      outcomes: [
        { kind: 'home', teamCode: 'MEX', label: 'Mexico‮ ignore', probability: 0.6 },
        { kind: 'draw', label: 'Draw', probability: 0.2 },
        { kind: 'away', teamCode: 'RSA', label: 'South Africa', probability: 0.2 },
      ],
    });
    expect(bad.outcomes).toEqual([]);
    expect(bad.ambiguous).toBe(true);
    expect(bad.stale).toBe(true);
  });

  it('a winner flag contradicted by the score advances nobody', () => {
    // `winnerCode` is the field the bracket moves a team through on, so a flag
    // that disagrees with the scoreline beside it is two claims, not a fact.
    const ev = (h: Record<string, unknown>, a: Record<string, unknown>) => ({
      id: '760415', date: '2026-06-29T19:00Z', season: { slug: 'round-of-32' },
      status: { type: { name: 'STATUS_FULL_TIME', state: 'post', completed: true } },
      competitions: [{ competitors: [
        { homeAway: 'home', team: { id: '203', abbreviation: 'GER', displayName: 'Germany' }, ...h },
        { homeAway: 'away', team: { id: '467', abbreviation: 'PAR', displayName: 'Paraguay' }, ...a },
      ] }],
    });
    const winner = (e: unknown) => {
      const r = parseEspnEvent(e);
      return r.kind === 'valid' ? r.value.winnerCode : r.kind;
    };
    // Real results still advance — including on penalties, which is what this
    // field exists for.
    expect(winner(ev({ winner: true, score: '2' }, { winner: false, score: '0' }))).toBe('GER');
    expect(winner(ev({ winner: false, score: '0' }, { winner: true, score: '2' }))).toBe('PAR');
    expect(winner(ev(
      { winner: false, score: '1', shootoutScore: 3 },
      { winner: true, score: '1', shootoutScore: 4 },
    ))).toBe('PAR');
    // Contradictions advance nobody, in regulation and on penalties alike.
    expect(winner(ev({ winner: true, score: '0' }, { winner: false, score: '2' }))).toBeUndefined();
    expect(winner(ev(
      { winner: true, score: '1', shootoutScore: 3 },
      { winner: false, score: '1', shootoutScore: 4 },
    ))).toBeUndefined();
  });
});

describe('round 13 — the rest', () => {
  it('a signal we cannot ATTRIBUTE is not a signal we may show', () => {
    // `source` is allow-listed, so an unknown provider becomes ''. An empty
    // attribution slot beside real-looking percentages is the confidently-wrong
    // display the Hard Constraints forbid — and it read as RELIABLE, because no
    // display gate had a source term of its own.
    const r = sealMarketSignal({
      matchId: '760415', source: 'evilprovider',
      asOf: '2026-06-11T14:55:00.000Z', fetchedAt: '2026-06-11T14:56:00.000Z',
      stale: false, ambiguous: false, liquidity: 500_000,
      outcomes: [
        { kind: 'home', teamCode: 'MEX', label: 'Mexico', probability: 0.6 },
        { kind: 'draw', label: 'Draw', probability: 0.2 },
        { kind: 'away', teamCode: 'RSA', label: 'South Africa', probability: 0.2 },
      ],
    }, { now: NOW });
    expect(r.kind).toBe('valid');
    if (r.kind !== 'valid') return;
    expect(r.value.source).toBe('');
    expect(r.value.ambiguous).toBe(true); // therefore never rendered
    expect(isReliableMarketSignal(r.value, { now: NOW })).toBe(false);
  });

  it('bounds an event’s market list before traversing it', async () => {
    // DETERMINISTIC, not timed — a wall-clock bound here measures the runner.
    // The property has an observable consequence: legs past the cap are sliced
    // off BEFORE the moneyline filter, so a market sitting beyond it is never
    // seen and the fixture cannot resolve.
    const filler = (i: number) => ({ id: `f${i}`, slug: `mkt-f${i}`, groupItemTitle: `F${i}`,
      sportsMarketType: 'spread', outcomes: JSON.stringify(['Yes', 'No']),
      outcomePrices: JSON.stringify(['0.5', '0.5']), active: true, closed: false,
      updatedAt: '2026-06-11T14:55:00.000Z' });
    const real = (tok: string, title: string, yes: number) => ({ id: `m-${tok}`, slug: `mkt-${tok}`,
      groupItemTitle: title, sportsMarketType: 'moneyline', liquidityNum: 120_000,
      outcomes: JSON.stringify(['Yes', 'No']),
      outcomePrices: JSON.stringify([String(yes), String(Number((1 - yes).toFixed(4)))]),
      active: true, closed: false, updatedAt: '2026-06-11T14:55:00.000Z' });
    const legs = [real('mex', 'Mexico', 0.685), real('draw', 'Draw', 0.205),
                  real('rsa', 'South Africa', 0.105)];
    const event = (markets: unknown[]) => ({ id: '351715', slug: 'fifwc-mex-rsa-2026-06-11',
      startTime: '2026-06-11T19:00:00Z', active: true, closed: false,
      seriesSlug: 'soccer-fifwc', sport: { sport: 'fifwc' },
      updatedAt: '2026-06-11T14:55:00.000Z', markets });
    const resolve = async (markets: unknown[]) => {
      const fetchImpl = (async () => ({ ok: true, status: 200, statusText: 'OK',
        json: async () => [event(markets)] })) as unknown as typeof fetch;
      return new PolymarketProvider({ fetchImpl, now: NOW }).findSignal(MATCH, { now: NOW });
    };
    // Within the cap: the real legs are found.
    expect(await resolve([...Array.from({ length: 10 }, (_, i) => filler(i)), ...legs])).toBeDefined();
    // Pushed past it: never examined, so no signal — proving the slice happens
    // before the filter rather than after.
    const past = [...Array.from({ length: 300 }, (_, i) => filler(i)), ...legs];
    expect(await resolve(past)).toBeUndefined();
  });

  it('one candidate’s transport failure does not abort the fan-out', async () => {
    // An Americas-evening kickoff derives two slugs; a 500 on the first used to
    // throw out of the whole loop, so the prior-day slug that actually resolves
    // was never tried despite remaining budget.
    const late = { ...MATCH, id: '760416', kickoff: '2026-07-01T01:00Z' } as Match;
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls === 1) throw new Error('connection reset');
      return { ok: true, status: 200, statusText: 'OK', json: async () => [] };
    }) as unknown as typeof fetch;
    await new PolymarketProvider({ fetchImpl, now: new Date('2026-06-30T15:00:00Z') })
      .findSignals([late]);
    expect(calls).toBeGreaterThan(1);
  });
});
