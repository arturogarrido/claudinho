/**
 * "There are none" and "we could not check" are different answers.
 *
 * `BatchResolution` carries `complete`, and every surface was collapsing it to
 * `resolvedValues` immediately — so a provider outage or an expired enrichment
 * deadline rendered as the confident "No reliable market signals", which is the
 * confidently-wrong output this project refuses everywhere else. The batch knew;
 * the caller threw the knowledge away.
 */
import { describe, expect, it } from 'vitest';
import { toolGetMarketSignal } from '../src/tools';
import type { MarketProvider } from '@claudinho/core';

const NOW = new Date('2026-06-11T15:00:00Z');
const provider = (complete: boolean): MarketProvider =>
  ({
    name: complete ? 'empty' : 'dead',
    findSignal: async () => undefined,
    findSignals: async () => ({ results: new Map(), complete }),
  }) as unknown as MarketProvider;

describe('an incomplete market read does not render as an empty one', () => {
  it('says the data was unavailable when the batch did not finish', async () => {
    const r = await toolGetMarketSignal({
      date: '2026-06-11', marketProvider: provider(false), now: NOW,
    } as never);
    expect(r.text).toContain('unavailable or incomplete');
    expect(r.text).not.toContain('No reliable market signals');
    expect((r.data as { complete: boolean }).complete).toBe(false);
  });

  it('says there are none when the batch DID finish and found none', async () => {
    const r = await toolGetMarketSignal({
      date: '2026-06-11', marketProvider: provider(true), now: NOW,
    } as never);
    expect(r.text).toContain('No reliable market signals');
    expect((r.data as { complete: boolean }).complete).toBe(true);
  });
});
