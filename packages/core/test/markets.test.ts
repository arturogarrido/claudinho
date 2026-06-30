import { describe, expect, it } from 'vitest';
import {
  buildMarketSignal,
  deriveFavorite,
  FakeMarketProvider,
  favoriteStrength,
  getMarketSignal,
  getMarketSignals,
  hasSaneDistribution,
  isReliableMarketSignal,
  isStaleSignal,
  type Match,
  type MarketOutcome,
  type MarketProvider,
  type MarketSignal,
  mapsCleanly,
  marketBlock,
  marketFavoriteText,
  marketLine,
  marketProbabilityText,
  marketSignalRendersFor,
  normalizeOutcomes,
} from '../src/index';

const NOW = new Date('2026-06-11T15:00:00Z');

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

function hda(h: number, d: number, a: number): MarketOutcome[] {
  return [
    { kind: 'home', teamCode: 'MEX', label: 'Mexico', probability: h },
    { kind: 'draw', label: 'Draw', probability: d },
    { kind: 'away', teamCode: 'RSA', label: 'South Africa', probability: a },
  ];
}

type BuildOver = Partial<Parameters<typeof buildMarketSignal>[0]>;

function build(outcomes: MarketOutcome[], over: BuildOver = {}): MarketSignal {
  return buildMarketSignal({
    match: match(),
    source: 'polymarket',
    asOf: '2026-06-11T14:55:00Z',
    outcomes,
    liquidity: 50_000,
    now: NOW,
    ...over,
  });
}

describe('normalizeOutcomes', () => {
  it('removes vig so positive probabilities sum to ~1', () => {
    const out = normalizeOutcomes(hda(0.6, 0.27, 0.21)); // sum 1.08
    const sum = out.reduce((s, o) => s + o.probability, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('is scale-agnostic (handles a 0..100 input)', () => {
    const out = normalizeOutcomes(hda(56, 25, 19));
    expect(out[0]?.probability).toBeCloseTo(0.56, 6);
    expect(out[1]?.probability).toBeCloseTo(0.25, 6);
    expect(out[2]?.probability).toBeCloseTo(0.19, 6);
  });

  it('collapses to zero when nothing is priced', () => {
    const out = normalizeOutcomes(hda(0, 0, 0));
    expect(out.every((o) => o.probability === 0)).toBe(true);
  });
});

describe('favoriteStrength / deriveFavorite', () => {
  it('buckets by threshold', () => {
    expect(favoriteStrength(0.7)).toBe('clear');
    expect(favoriteStrength(0.65)).toBe('clear');
    expect(favoriteStrength(0.64)).toBe('slight');
    expect(favoriteStrength(0.52)).toBe('slight');
    expect(favoriteStrength(0.519)).toBe('close');
  });

  it('picks the top home/draw/away outcome', () => {
    const fav = deriveFavorite(normalizeOutcomes(hda(0.56, 0.25, 0.19)));
    expect(fav).toMatchObject({ kind: 'home', teamCode: 'MEX', strength: 'slight' });
  });

  it('reports a draw-led market', () => {
    const fav = deriveFavorite(normalizeOutcomes(hda(0.25, 0.55, 0.2)));
    expect(fav?.kind).toBe('draw');
  });
});

describe('mapsCleanly / ambiguity', () => {
  it('accepts a clean three-way group market', () => {
    expect(mapsCleanly(match(), normalizeOutcomes(hda(0.56, 0.25, 0.19)))).toBe(true);
  });

  it('rejects a group market with no draw', () => {
    const twoWay: MarketOutcome[] = [
      { kind: 'home', teamCode: 'MEX', label: 'Mexico', probability: 0.6 },
      { kind: 'away', teamCode: 'RSA', label: 'South Africa', probability: 0.4 },
    ];
    expect(mapsCleanly(match(), twoWay)).toBe(false);
    expect(build(twoWay).ambiguous).toBe(true);
    expect(build(twoWay).favorite).toBeUndefined();
  });

  it('allows a two-way knockout market', () => {
    const ko = match({ stage: 'R16', group: undefined });
    const twoWay: MarketOutcome[] = [
      { kind: 'home', teamCode: 'MEX', label: 'Mexico', probability: 0.6 },
      { kind: 'away', teamCode: 'RSA', label: 'South Africa', probability: 0.4 },
    ];
    const sig = build(twoWay, { match: ko });
    expect(sig.ambiguous).toBe(false);
    expect(sig.favorite?.kind).toBe('home');
  });

  it('rejects mismatched team codes', () => {
    const wrong = hda(0.56, 0.25, 0.19);
    wrong[0] = { ...wrong[0]!, teamCode: 'BRA' };
    expect(mapsCleanly(match(), wrong)).toBe(false);
  });

  it('rejects markets with an "other" outcome (e.g. to-advance)', () => {
    const withOther: MarketOutcome[] = [
      ...hda(0.5, 0.25, 0.2),
      { kind: 'other', label: 'To advance', probability: 0.05 },
    ];
    expect(mapsCleanly(match(), withOther)).toBe(false);
    expect(build(withOther).ambiguous).toBe(true);
  });
});

describe('marketSignalRendersFor (re-check a cached signal vs the rendered fixture)', () => {
  const sig = build(hda(0.56, 0.25, 0.19)); // matchId 760415, MEX/RSA outcomes

  it('renders for the fixture it was built for', () => {
    expect(marketSignalRendersFor(match(), sig)).toBe(true);
  });

  it('does NOT render against a degraded placeholder (same id, unresolved teams)', () => {
    // The bundle KO slot keeps the id but degrades to placeholder codes/flags —
    // a cached MEX/RSA signal must not print "Group A Winner 56% · …".
    const placeholder = match({
      stage: 'R32',
      group: undefined,
      home: { code: '1A', name: 'Group A Winner', flag: '🏳️' },
      away: { code: '2B', name: 'Group B Runner-up', flag: '🏳️' },
    });
    expect(marketSignalRendersFor(placeholder, sig)).toBe(false);
  });

  it('does NOT render when the signal is for a different match id', () => {
    expect(marketSignalRendersFor(match({ id: '999999' }), sig)).toBe(false);
  });
});

describe('staleness', () => {
  it('is fresh within the window and stale beyond it', () => {
    expect(isStaleSignal(build(hda(0.56, 0.25, 0.19)), { now: NOW })).toBe(false);
    const old = build(hda(0.56, 0.25, 0.19), { asOf: '2026-06-11T14:30:00Z' });
    expect(isStaleSignal(old, { now: NOW })).toBe(true);
    expect(old.stale).toBe(true);
  });

  it('honors a custom maxAgeMs', () => {
    const sig = build(hda(0.56, 0.25, 0.19));
    expect(isStaleSignal(sig, { now: NOW, maxAgeMs: 60_000 })).toBe(true);
  });

  it('treats an unparseable timestamp as stale', () => {
    const sig = build(hda(0.56, 0.25, 0.19), { asOf: 'not-a-date' });
    expect(sig.stale).toBe(true);
  });
});

describe('isReliableMarketSignal', () => {
  const fresh = () => build(hda(0.56, 0.25, 0.19));

  it('passes a fresh, clean, liquid signal', () => {
    expect(isReliableMarketSignal(fresh(), { now: NOW })).toBe(true);
  });

  it('fails on stale, ambiguous, or favorite-less signals', () => {
    expect(isReliableMarketSignal(fresh(), { now: NOW, maxAgeMs: 1 })).toBe(false);
    const ambiguous = build(hda(0.56, 0.25, 0.19), { ambiguous: true });
    expect(isReliableMarketSignal(ambiguous, { now: NOW })).toBe(false);
  });

  it('gates on a liquidity floor when one is set', () => {
    expect(isReliableMarketSignal(fresh(), { now: NOW, minLiquidity: 100_000 })).toBe(false);
    expect(isReliableMarketSignal(fresh(), { now: NOW, minLiquidity: 10_000 })).toBe(true);
    const noLiq = build(hda(0.56, 0.25, 0.19), { liquidity: undefined });
    expect(isReliableMarketSignal(noLiq, { now: NOW, minLiquidity: 10_000 })).toBe(false);
  });

  it('can be bypassed with includeUnreliable', () => {
    const ambiguous = build(hda(0.56, 0.25, 0.19), { ambiguous: true });
    expect(isReliableMarketSignal(ambiguous, { now: NOW, includeUnreliable: true })).toBe(true);
  });
});

describe('hasSaneDistribution', () => {
  it('accepts a normalized distribution and rejects a single outcome', () => {
    expect(hasSaneDistribution(normalizeOutcomes(hda(0.56, 0.25, 0.19)))).toBe(true);
    expect(hasSaneDistribution([{ kind: 'home', label: 'X', probability: 1 }])).toBe(false);
  });
});

describe('copy bank', () => {
  it('uses approved, non-betting language for the favorite read', () => {
    expect(marketFavoriteText(build(hda(0.7, 0.18, 0.12)), match())).toBe(
      'Prediction markets favor Mexico.',
    );
    expect(marketFavoriteText(build(hda(0.56, 0.25, 0.19)), match())).toBe(
      'Prediction markets slightly favor Mexico.',
    );
    expect(marketFavoriteText(build(hda(0.5, 0.28, 0.22)), match())).toBe(
      'Prediction markets see this match as close.',
    );
    expect(marketFavoriteText(build(hda(0.25, 0.55, 0.2)), match())).toBe(
      'Prediction markets see a draw as the top outcome.',
    );
  });

  it('renders whole-number percentages in reading order', () => {
    expect(marketProbabilityText(build(hda(0.56, 0.25, 0.19)), match())).toBe(
      'Mexico 56% · Draw 25% · South Africa 19%',
    );
  });

  it('marketLine carries the source and the informational-only caveat', () => {
    const line = marketLine(build(hda(0.56, 0.25, 0.19)), match());
    expect(line).toContain('Polymarket');
    expect(line).toContain('informational only');
    expect(line).not.toMatch(/\b(bet|wager|value|edge|lock)\b/i);
  });

  it('marketBlock attributes, timestamps, and flags staleness', () => {
    const block = marketBlock(build(hda(0.56, 0.25, 0.19)), match());
    expect(block.join('\n')).toContain('updated 14:55 UTC');
    expect(block.join('\n')).toContain('informational only');
    const staleBlock = marketBlock(
      build(hda(0.56, 0.25, 0.19), { asOf: '2026-06-11T14:00:00Z' }),
      match(),
    );
    expect(staleBlock[0]).toMatch(/stale/i);
  });
});

describe('FakeMarketProvider', () => {
  it('returns a preset signal verbatim', async () => {
    const preset = build(hda(0.56, 0.25, 0.19));
    const p = new FakeMarketProvider({ signals: { '760415': preset } });
    expect(await p.findSignal(match())).toBe(preset);
  });

  it('returns undefined for an unmapped match without synthesize', async () => {
    const p = new FakeMarketProvider();
    expect(await p.findSignal(match())).toBeUndefined();
  });

  it('synthesizes a deterministic, clean signal', async () => {
    const p = new FakeMarketProvider({ synthesize: true, now: NOW });
    const a = await p.findSignal(match());
    const b = await p.findSignal(match());
    expect(a?.source).toBe('fake');
    expect(a?.ambiguous).toBe(false);
    expect(a?.favorite).toBeDefined();
    expect(a?.outcomes).toEqual(b?.outcomes);
    const sum = (a?.outcomes ?? []).reduce((s, o) => s + o.probability, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('findSignals returns signals + the checked set', async () => {
    const p = new FakeMarketProvider({ synthesize: true, now: NOW });
    const { signals, checked } = await p.findSignals([match(), match({ id: 'zzz' })]);
    expect(signals.size).toBe(2);
    expect(signals.get('760415')?.matchId).toBe('760415');
    expect(checked.has('760415')).toBe(true);
  });
});

describe('graceful degradation', () => {
  const boom: MarketProvider = {
    name: 'boom',
    findSignal: async () => {
      throw new Error('provider down');
    },
    findSignals: async () => {
      throw new Error('provider down');
    },
  };

  it('getMarketSignal swallows errors → undefined', async () => {
    expect(await getMarketSignal(boom, match())).toBeUndefined();
  });

  it('getMarketSignals swallows errors → empty result (nothing checked)', async () => {
    const { signals, checked } = await getMarketSignals(boom, [match()]);
    expect(signals.size).toBe(0);
    expect(checked.size).toBe(0); // error → not checked → not negative-cached
  });
});
