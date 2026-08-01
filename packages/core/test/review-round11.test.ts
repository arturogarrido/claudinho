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
import { buildMarketSignal } from '../src/markets/normalize';
import { parseEspnEvents, parseEspnStandings } from '../src/trust/espn';
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
      stats: [{ name: 'points', value: 3 }],
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
