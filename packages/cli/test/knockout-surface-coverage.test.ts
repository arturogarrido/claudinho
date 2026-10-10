/**
 * CROSS-SURFACE COVERAGE GUARD — the structural defense against Claudinho's most
 * recurring bug class: a team-facing surface reading the resultless static
 * skeleton instead of the live overlay. The bundled knockout slots are
 * placeholders (codes like 2A/2B, flag 🏳️), so any surface that doesn't reach
 * the live overlay is SILENTLY blind to a confirmed knockout tie — no crash, no
 * wrong data, just a stale placeholder. That single bug shipped as v0.8.2
 * (seeds), v0.8.6 (third-place), and v0.8.7 (next fixture) — three hotfixes, one
 * root cause in three different surfaces.
 *
 * This test pins ONE fake resolved knockout fixture (Mexico vs Ecuador, R32) and
 * asserts EVERY team-facing CLI surface renders the real nations — never the
 * placeholder. If you add a new surface, add it here; if an existing surface
 * stops live-resolving, this fails. See `.cursor/rules/surface-parity.mdc` and
 * AGENTS.md "Knockout surfaces live-resolve".
 *
 * The statusline can't live-fetch (hot path, <150ms, cache-only), so it
 * live-resolves INDIRECTLY: the refresher caches resolved knockout fixtures and
 * the statusline reads them, failing closed to "⚽ —" (never a placeholder leak)
 * when the cache lacks the pairing. Both contracts are asserted at the bottom.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachFetchMeta, FakeMarketProvider, type Match, type ProviderAdapter } from '@claudinho/core';
import { cmdBracket, cmdMarkets, cmdNext, cmdShare } from '../src/commands';
import type { CliConfig } from '../src/config';
import { described } from './config-of';
import { makeT } from '../src/i18n';
import type { CacheState } from '../src/cache';
import { ambientView } from '../src/ambient';
import { renderPrompt } from '../src/statusline';

// A confirmed R32 tie ESPN has filed over the bundled placeholder slot 760486
// (in the bundle: "Group A 2nd" vs "Group B 2nd", both 🏳️). The overlay carries
// the real nations; a surface that reads the skeleton would still show 🏳️.
const RESOLVED_R32_ID = '760486';
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

/** Adapter that serves the resolved knockout fixture on the window fetch. */
function overlayAdapter(window: Match[]): ProviderAdapter {
  return {
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
      return window;
    },
  };
}

const PLACEHOLDER_FLAG = '🏳️';
// Group stage is over on R32 day, so a static lookup is blind — only the overlay
// carries the pairing.
const KNOCKOUT_NOW = new Date('2026-06-28T12:00:00Z');

function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return described({
    lang: 'en',
    tz: 'UTC',
    json: false,
    color: false,
    source: 'espn',
    competition: 'fifa.world',
    flavor: 'off',
    markets: false,
    ...over,
  });
}
const ctx = () => ({
  cfg: cfg(),
  t: makeT('en'),
  adapter: overlayAdapter([r32MexEcu()]),
  now: KNOCKOUT_NOW,
  marketProvider: undefined,
});

const outSpy = vi.spyOn(process.stdout, 'write');
let writes: string[] = [];
beforeEach(() => {
  writes = [];
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
});
afterEach(() => outSpy.mockReset());
const text = () => writes.join('');

describe('knockout surface coverage — every team-facing CLI surface live-resolves', () => {
  it('`next <team>` shows the resolved opponent, not the placeholder', async () => {
    await cmdNext('MEX', ctx());
    const t = text();
    expect(t).toContain('Ecuador'); // resolved from the overlay
    expect(t).not.toContain(PLACEHOLDER_FLAG);
  });

  it('`share next <team>` shows the resolved opponent, not the placeholder', async () => {
    await cmdShare('next', 'MEX', {}, ctx());
    const t = text();
    expect(t).toContain('Ecuador');
    expect(t).not.toContain(PLACEHOLDER_FLAG);
  });

  it('`bracket` renders the resolved tie in its slot', async () => {
    await cmdBracket('R32', {}, ctx());
    const t = text();
    expect(t).toContain('Mexico');
    expect(t).toContain('Ecuador');
  });

  it('`share bracket` renders the resolved tie in its slot', async () => {
    await cmdShare('bracket', 'R32', {}, ctx());
    const t = text();
    expect(t).toContain('Mexico');
    expect(t).toContain('Ecuador');
  });

  it('`markets next <team>` resolves the opponent, not the placeholder', async () => {
    // marketFixtureForTeam must live-resolve the KO tie (offline fake provider
    // keeps the market fetch off the network — we only assert nation resolution).
    await cmdMarkets('next', 'MEX', { ...ctx(), marketProvider: new FakeMarketProvider() });
    const t = text();
    expect(t).toContain('Mexico');
    expect(t).toContain('Ecuador');
    expect(t).not.toContain(PLACEHOLDER_FLAG);
  });
});

describe('statusline hot-path contract — live-resolve from cache, else fail closed', () => {
  // The statusline NEVER fetches on the hot path; it reads the cache the
  // refresher fills. When the cache carries the resolved knockout fixture it
  // shows it (real flags); when it doesn't, it fails closed to `⚽ —` — never a
  // 🏳️ placeholder leak.
  const baseCache = (over: Partial<CacheState> = {}): CacheState => ({
    updatedAt: KNOCKOUT_NOW.toISOString(),
    live: [],
    degraded: false,
    source: 'espn',
    competition: 'fifa.world',
    ...over,
  });

  it('shows the resolved tie (real flags) when the refresher cached it', () => {
    const cache = baseCache({ fixtures: [r32MexEcu()], fixturesUpdatedAt: KNOCKOUT_NOW.toISOString() });
    const line = renderPrompt(cache, { pick: { code: 'MEX' }, now: KNOCKOUT_NOW });
    expect(line).toContain('🇲🇽'); // resolved home
    expect(line).toContain('🇪🇨'); // resolved away
    expect(line).not.toContain(PLACEHOLDER_FLAG);
  });

  it('the ambient view counts down to the resolved tie by name, and to nothing when the cache lacks it', () => {
    const cache = baseCache({ fixtures: [r32MexEcu()], fixturesUpdatedAt: KNOCKOUT_NOW.toISOString() });
    const v = ambientView(cache, { pick: { code: 'MEX' }, now: KNOCKOUT_NOW });
    expect(v.next?.home.name).toBe('Mexico');
    expect(v.next?.away.name).toBe('Ecuador');
    expect(JSON.stringify(v)).not.toContain(PLACEHOLDER_FLAG);
    expect(ambientView(baseCache(), { pick: { code: 'MEX' }, now: KNOCKOUT_NOW }).next).toBeNull();
  });

  it('fails closed to "⚽ —" (no 🏳️ leak) when the cache lacks the fixture', () => {
    const line = renderPrompt(baseCache(), { pick: { code: 'MEX' }, now: KNOCKOUT_NOW });
    expect(line).toBe('⚽ —');
    expect(renderPrompt(baseCache(), { now: KNOCKOUT_NOW })).toBe('⚽ —'); // no-team too
  });
});

describe('a knockout window that was not whole says so beside what it holds (0.11 2.1b, ledger D1)', () => {
  // The provider sent a record the parser could not read, beside the readable
  // tie. The statusline keeps a tie its cache held (the #139 rule) and says
  // nothing; the interactive surfaces read only this answer, and used to say
  // nothing either: two surfaces disagreed and neither said why. Now every
  // interactive surface qualifies its answer with ONE sentence, beside what
  // was read, never instead of it, and carries the verdict in its structured
  // output. `next` for a team whose tie was the refused record has no fixture
  // (the bundle's placeholder carries slot codes, not the team's) and the
  // sentence: absence never means elimination.
  const SENTENCE = 'Fixture data may be incomplete (1 provider record omitted).';
  const UNCOUNTED = 'Fixture data may be incomplete.';
  const partialAdapter = (meta: { complete?: boolean; omitted?: number } | undefined): ProviderAdapter => ({
    ...overlayAdapter([]),
    async fetchWindow() {
      const window = [r32MexEcu()];
      return meta ? attachFetchMeta(window, meta) : window;
    },
  });
  const partialCtx = (over: Partial<CliConfig> = {}, meta: { complete?: boolean; omitted?: number } | undefined = { complete: false, omitted: 1 }) => ({
    ...ctx(),
    cfg: cfg(over),
    adapter: partialAdapter(meta),
  });

  it('`next <team>` for the team of the readable tie: the fixture AND the sentence, said before it; `--json` carries both', async () => {
    await cmdNext('MEX', partialCtx());
    const t = text();
    expect(t).toContain('Ecuador');
    expect(t).toContain(SENTENCE);
    expect(t.indexOf(SENTENCE)).toBeLessThan(t.indexOf('Ecuador'));
    writes = [];
    await cmdNext('MEX', partialCtx({ json: true }));
    const out = JSON.parse(text()) as { fixture: { id: string } | null; partial?: unknown };
    expect(out.fixture?.id).toBe(RESOLVED_R32_ID);
    expect(out.partial).toEqual({ omitted: 1 });
  });

  it('`next <team>` for a team whose tie was the refused record: no fixture, the sentence, no elimination', async () => {
    await cmdNext('ARG', partialCtx());
    expect(text()).toContain(SENTENCE);
    expect(text()).not.toContain(PLACEHOLDER_FLAG);
    expect(text().toLowerCase()).not.toContain('eliminated');
    writes = [];
    await cmdNext('ARG', partialCtx({ json: true }));
    expect(JSON.parse(text())).toMatchObject({ fixture: null, partial: { omitted: 1 } });
  });

  it('`bracket`: the tree with the tie that was read, and the sentence before it; `--json` carries the verdict', async () => {
    await cmdBracket('R32', {}, partialCtx());
    const t = text();
    expect(t).toContain('Mexico');
    expect(t).toContain('Ecuador');
    expect(t).toContain(SENTENCE);
    expect(t.indexOf(SENTENCE)).toBeLessThan(t.indexOf('Mexico'));
    writes = [];
    await cmdBracket('R32', {}, partialCtx({ json: true }));
    expect(JSON.parse(text())).toMatchObject({ partial: { omitted: 1 } });
  });

  it('`share next` and `share bracket`: the card carries the sentence beside a populated body, and the key in `--json`', async () => {
    await cmdShare('next', 'MEX', {}, partialCtx());
    expect(text()).toContain('Ecuador');
    expect(text()).toContain(SENTENCE);
    writes = [];
    await cmdShare('next', 'ARG', {}, partialCtx());
    expect(text()).toContain(SENTENCE); // the empty card, with the note
    writes = [];
    await cmdShare('bracket', 'R32', {}, partialCtx());
    expect(text()).toContain('Mexico');
    expect(text()).toContain(SENTENCE);
    for (const [kind, arg] of [
      ['next', 'MEX'],
      ['bracket', 'R32'],
    ] as const) {
      writes = [];
      await cmdShare(kind, arg, {}, partialCtx({ json: true }));
      expect(JSON.parse(text()), kind).toMatchObject({ partial: { omitted: 1 } });
    }
  });

  it('an adapter that says the answer is not whole without a count: the uncounted sentence and `partial: {}`', async () => {
    await cmdNext('MEX', partialCtx({}, { complete: false }));
    expect(text()).toContain(UNCOUNTED);
    expect(text()).not.toContain('omitted)');
    writes = [];
    await cmdNext('MEX', partialCtx({ json: true }, { complete: false }));
    expect(JSON.parse(text())).toMatchObject({ partial: {} });
  });

  it('an adapter that says nothing about its answer, or says it is whole: no sentence, no key (as today)', async () => {
    // The adapter is passed directly: `partialCtx({}, undefined)` would take
    // the helper's DEFAULT (a partial answer), because a default parameter
    // replaces an explicit `undefined`.
    for (const meta of [undefined, { complete: true, omitted: 0 }]) {
      writes = [];
      await cmdNext('MEX', { ...partialCtx({}), adapter: partialAdapter(meta) });
      expect(text(), JSON.stringify(meta)).toContain('Ecuador');
      expect(text(), JSON.stringify(meta)).not.toContain('incomplete');
      writes = [];
      await cmdNext('MEX', { ...partialCtx({ json: true }), adapter: partialAdapter(meta) });
      expect(JSON.parse(text()), JSON.stringify(meta)).not.toHaveProperty('partial');
    }
  });

  it('the sentence is localized, and the count is in every language', async () => {
    for (const lang of ['es', 'pt', 'fr']) {
      writes = [];
      await cmdNext('MEX', partialCtx({ lang }));
      const t = text();
      expect(t, lang).not.toContain(SENTENCE);
      expect(t, lang).toMatch(/\b1\b/);
      expect(t, lang).toContain('Ecuador');
    }
  });
});
