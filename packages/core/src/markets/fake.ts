/**
 * A network-free MarketProvider for tests and local UX validation. Returns
 * explicitly-provided signals and (optionally) deterministically synthesizes
 * plausible-but-fake odds so every surface can be exercised without any live
 * API. Always labeled `source: 'fake'` so it can never masquerade as real data.
 */
import type { Match } from '../types';
import { buildMarketSignal } from './normalize';
import type {
  MarketOutcome,
  MarketProvider,
  MarketSignal,
  MarketSignalOptions,
} from './types';

export interface FakeMarketProviderOptions {
  /** Pre-built signals keyed by matchId; returned verbatim when present. */
  signals?: Record<string, MarketSignal>;
  /** When true, synthesize a deterministic signal for any unmapped match. */
  synthesize?: boolean;
  /** "Now" used when synthesizing timestamps (keeps tests deterministic). */
  now?: Date;
}

export class FakeMarketProvider implements MarketProvider {
  readonly name = 'fake';

  constructor(private readonly opts: FakeMarketProviderOptions = {}) {}

  async findSignal(
    match: Match,
    options?: MarketSignalOptions,
  ): Promise<MarketSignal | undefined> {
    const preset = this.opts.signals?.[match.id];
    if (preset) return preset;
    if (this.opts.synthesize) return this.synthesize(match, options);
    return undefined;
  }

  async findSignals(
    matches: Match[],
    options?: MarketSignalOptions,
  ): Promise<Map<string, MarketSignal>> {
    const out = new Map<string, MarketSignal>();
    for (const m of matches) {
      const s = await this.findSignal(m, options);
      if (s) out.set(m.id, s);
    }
    return out;
  }

  private synthesize(match: Match, options?: MarketSignalOptions): MarketSignal {
    const seed = hash(`${match.home.code}-${match.away.code}`);
    // Deterministic, obviously-synthetic spread. buildMarketSignal normalizes.
    const home = 0.3 + (seed % 33) / 100;
    const away = 0.18 + ((seed >> 3) % 23) / 100;
    const draw = Math.max(0.05, 1 - home - away);
    const outcomes: MarketOutcome[] = [
      { kind: 'home', teamCode: match.home.code, label: match.home.name, probability: home },
      { kind: 'draw', label: 'Draw', probability: draw },
      { kind: 'away', teamCode: match.away.code, label: match.away.name, probability: away },
    ];
    const now = this.opts.now ?? options?.now ?? new Date();
    const asOf = new Date(now.getTime() - 60_000).toISOString();
    return buildMarketSignal({
      match,
      source: 'fake',
      sourceMarketId: `fake-${match.id}`,
      asOf,
      fetchedAt: now.toISOString(),
      outcomes,
      liquidity: 50_000,
      now,
      maxAgeMs: options?.maxAgeMs,
    });
  }
}

/** Small deterministic string hash (uint32, mod 100000). */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 100000;
}
