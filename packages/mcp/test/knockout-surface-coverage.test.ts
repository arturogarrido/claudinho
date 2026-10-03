/**
 * CROSS-SURFACE COVERAGE GUARD (MCP) — twin of
 * packages/cli/test/knockout-surface-coverage.test.ts. See that file's header for
 * the full rationale: the recurring bug is a team-facing surface reading the
 * resultless static skeleton (knockout slots are 🏳️ placeholders) instead of the
 * live overlay. This pins ONE fake resolved knockout fixture (Mexico vs Ecuador,
 * R32) and asserts EVERY team-facing MCP tool renders the real nations.
 *
 * If you add a team-facing MCP tool, add it here. See
 * `.cursor/rules/surface-parity.mdc` and AGENTS.md "Knockout surfaces live-resolve".
 */
import { describe, expect, it } from 'vitest';
import { attachFetchMeta, FakeMarketProvider, type Match, type ProviderAdapter } from '@claudinho/core';
import { z } from 'zod/v3';
import { OUTPUT_SCHEMAS, toContent } from '../src/server';
import {
  toolGetBracket,
  toolGetMarketSignal,
  toolGetNextFixture,
  toolGetShareSnippet,
} from '../src/tools';

const RESOLVED_R32_ID = '760486'; // bundle: "Group A 2nd" vs "Group B 2nd" (both 🏳️)
function r32MexEcu(): Match {
  return {
    id: RESOLVED_R32_ID,
    stage: 'R32',
    kickoff: '2026-06-30T18:00Z',
    venue: 'SoFi Stadium',
    home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
    away: { code: 'ECU', name: 'Ecuador', flag: '🇪🇨' },
    status: 'SCHEDULED',
    updatedAt: '2026-06-28T00:00Z',
  };
}

const overlayAdapter: ProviderAdapter = {
  name: 'espn',
  competition: 'fifa.world',
  capabilities: { push: false, latencyHintSec: 0 },
  async fetchByDate() {
    return [];
  },
  async fetchLive() {
    return [];
  },
  async fetchWindow() {
    return [r32MexEcu()];
  },
};

const PLACEHOLDER_FLAG = '🏳️';
const KNOCKOUT_NOW = new Date('2026-06-28T12:00:00Z'); // group stage done

describe('knockout surface coverage — every team-facing MCP tool live-resolves', () => {
  it('get_next_fixture shows the resolved opponent, not the placeholder', async () => {
    const r = await toolGetNextFixture({ team: 'MEX', now: KNOCKOUT_NOW, adapter: overlayAdapter });
    expect(r.text).toContain('Ecuador');
    expect(r.text).not.toContain(PLACEHOLDER_FLAG);
    expect((r.data as { fixture: Match | null }).fixture?.away.code).toBe('ECU');
  });

  it('get_share_snippet { team } shows the resolved opponent', async () => {
    const r = await toolGetShareSnippet({ team: 'MEX', now: KNOCKOUT_NOW, adapter: overlayAdapter });
    expect(r.text).toContain('Ecuador');
    expect(r.text).not.toContain(PLACEHOLDER_FLAG);
  });

  it('get_bracket renders the resolved tie in its slot', async () => {
    const r = await toolGetBracket({ stage: 'R32', now: KNOCKOUT_NOW, adapter: overlayAdapter });
    expect(r.text).toContain('Mexico');
    expect(r.text).toContain('Ecuador');
  });

  it('get_share_snippet { bracket } renders the resolved tie in its slot', async () => {
    const r = await toolGetShareSnippet({
      bracket: true,
      knockoutStage: 'R32',
      now: KNOCKOUT_NOW,
      adapter: overlayAdapter,
    });
    expect(r.text).toContain('Mexico');
    expect(r.text).toContain('Ecuador');
  });

  it('get_market_signal { team } resolves the opponent, not the placeholder', async () => {
    // marketFixtureForTeam must live-resolve the KO tie (offline fake provider
    // keeps the market fetch off the network — we only assert nation resolution).
    const r = await toolGetMarketSignal({
      team: 'MEX',
      now: KNOCKOUT_NOW,
      adapter: overlayAdapter,
      marketProvider: new FakeMarketProvider(),
    });
    expect(r.text).toContain('Mexico');
    expect(r.text).toContain('Ecuador');
    expect(r.text).not.toContain(PLACEHOLDER_FLAG);
    expect((r.data as { matchId: string | null }).matchId).toBe(RESOLVED_R32_ID);
  });
});

describe('a knockout window that was not whole says so beside what it holds (0.11 2.1b, ledger D1)', () => {
  // The CLI twin is in packages/cli/test/knockout-surface-coverage.test.ts.
  // Here: `data` carries `partial: { omitted }`, the text carries ONE sentence
  // BEFORE the body (a cut at a length drops the end), and the ties that were
  // read still render.
  const SENTENCE = 'Fixture data may be incomplete (1 provider record omitted).';
  const UNCOUNTED = 'Fixture data may be incomplete.';
  const partialAdapter = (meta: { complete?: boolean; omitted?: number } | undefined): ProviderAdapter => ({
    ...overlayAdapter,
    async fetchWindow() {
      const window = [r32MexEcu()];
      return meta ? attachFetchMeta(window, meta) : window;
    },
  });
  const partial = partialAdapter({ complete: false, omitted: 1 });

  it('get_next_fixture: the fixture and the sentence for a team whose tie was read; no fixture and the sentence for one whose tie was not', async () => {
    const mex = await toolGetNextFixture({ team: 'MEX', now: KNOCKOUT_NOW, adapter: partial });
    expect(mex.text).toContain('Ecuador');
    expect(mex.text).toContain(SENTENCE);
    expect(mex.text.indexOf(SENTENCE)).toBeLessThan(mex.text.indexOf('Ecuador'));
    expect(mex.data).toMatchObject({ partial: { omitted: 1 } });
    expect((mex.data as { fixture: Match | null }).fixture?.id).toBe(RESOLVED_R32_ID);
    const arg = await toolGetNextFixture({ team: 'ARG', now: KNOCKOUT_NOW, adapter: partial });
    expect(arg.text).toContain(SENTENCE);
    expect(arg.text).not.toContain(PLACEHOLDER_FLAG);
    expect(arg.data).toMatchObject({ fixture: null, partial: { omitted: 1 } });
  });

  it('get_bracket: the tree with the tie that was read, the sentence before it, the key in data, the source kept', async () => {
    const r = await toolGetBracket({ stage: 'R32', now: KNOCKOUT_NOW, adapter: partial });
    expect(r.text).toContain('Mexico');
    expect(r.text).toContain('Ecuador');
    expect(r.text).toContain(SENTENCE);
    expect(r.text.indexOf(SENTENCE)).toBeLessThan(r.text.indexOf('Mexico'));
    expect(r.data).toMatchObject({ partial: { omitted: 1 }, source: 'espn' });
    // Through the response bound: a cut keeps the sentence (it is before the body) and the footer.
    const sent = toContent({ ...r, text: `${r.text}${'\n'.repeat(40_000)}` }).content[0]?.text ?? '';
    expect(sent).toContain(SENTENCE);
  });

  it('get_share_snippet { team } and { bracket }: the card carries the sentence beside its body, and the key in data', async () => {
    const next = await toolGetShareSnippet({ team: 'MEX', now: KNOCKOUT_NOW, adapter: partial });
    expect(next.text).toContain('Ecuador');
    expect(next.text).toContain(SENTENCE);
    expect(next.data).toMatchObject({ partial: { omitted: 1 } });
    const none = await toolGetShareSnippet({ team: 'ARG', now: KNOCKOUT_NOW, adapter: partial });
    expect(none.text).toContain(SENTENCE);
    expect(none.data).toMatchObject({ partial: { omitted: 1 } });
    const bracket = await toolGetShareSnippet({ bracket: true, knockoutStage: 'R32', now: KNOCKOUT_NOW, adapter: partial });
    expect(bracket.text).toContain('Mexico');
    expect(bracket.text).toContain(SENTENCE);
    expect(bracket.data).toMatchObject({ partial: { omitted: 1 } });
  });

  it('a verdict without a count, and no verdict at all', async () => {
    const uncounted = await toolGetNextFixture({ team: 'MEX', now: KNOCKOUT_NOW, adapter: partialAdapter({ complete: false }) });
    expect(uncounted.text).toContain(UNCOUNTED);
    expect(uncounted.data).toMatchObject({ partial: {} });
    for (const meta of [undefined, { complete: true, omitted: 0 }]) {
      const r = await toolGetNextFixture({ team: 'MEX', now: KNOCKOUT_NOW, adapter: partialAdapter(meta) });
      expect(r.text, JSON.stringify(meta)).not.toContain('incomplete');
      expect(r.data, JSON.stringify(meta)).not.toHaveProperty('partial');
    }
  });

  it('every handler’s data, partial included, still fits its declared output schema', async () => {
    for (const [name, r] of [
      ['get_next_fixture', await toolGetNextFixture({ team: 'MEX', now: KNOCKOUT_NOW, adapter: partial })],
      ['get_bracket', await toolGetBracket({ stage: 'R32', now: KNOCKOUT_NOW, adapter: partial })],
      ['get_share_snippet', await toolGetShareSnippet({ team: 'MEX', now: KNOCKOUT_NOW, adapter: partial })],
    ] as const) {
      const res = z.object(OUTPUT_SCHEMAS[name as keyof typeof OUTPUT_SCHEMAS]).strict().safeParse(r.data);
      expect(res.success, `${name}: ${res.success ? '' : JSON.stringify(res.error.issues)}`).toBe(true);
    }
  });

  it('the declared schema states the count’s grammar (a positive integer, or absent), which is what a client is told', async () => {
    // The handler never emits anything else (core believes a count only as a
    // positive integer); the schema is the contract a client reads, so it says so.
    const r = await toolGetNextFixture({ team: 'MEX', now: KNOCKOUT_NOW, adapter: partial });
    const data = r.data as Record<string, unknown>;
    const schema = z.object(OUTPUT_SCHEMAS.get_next_fixture).strict();
    expect(schema.safeParse({ ...data, partial: {} }).success).toBe(true);
    for (const omitted of [0, -1, 1.5, Number.NaN, '1']) {
      expect(schema.safeParse({ ...data, partial: { omitted } }).success, String(omitted)).toBe(false);
    }
  });
});
