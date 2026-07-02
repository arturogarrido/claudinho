/**
 * Output-schema guard. Every MCP tool now advertises an `outputSchema` and
 * returns `structuredContent`; the SDK validates that content against the schema
 * on every call and rejects a mismatch (missing required key / wrong type). This
 * asserts each handler's `data` parses against the schema its tool advertises —
 * across BOTH the healthy and degraded shapes — so a shape drift is caught in CI,
 * not by a client seeing an "Output validation error".
 *
 * Top-level parse is `.strict()` (stricter than the SDK's strip) so the schema
 * must DECLARE every key a handler emits — otherwise structuredContent would
 * silently drop it. Nested domain objects (match/view/tables/signals) stay
 * passthrough on purpose, so this doesn't have to mirror every core field.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  allFixtures,
  FakeMarketProvider,
  type GroupStandings,
  type Match,
  type ProviderAdapter,
} from '@claudinho/core';
import {
  toolGetBracket,
  toolGetLive,
  toolGetMarketSignal,
  toolGetMatch,
  toolGetNextFixture,
  toolGetShareSnippet,
  toolGetStandings,
  toolGetTeam,
  toolGetToday,
} from '../src/tools';
import { OUTPUT_SCHEMAS } from '../src/server';

// In-tournament clock: keeps "now"-relative gates (market relevance, next
// fixture) deterministic forever, including after the tournament ends.
const TEST_NOW = new Date('2026-06-13T12:00:00Z');

function liveMatch(over: Partial<Match> = {}): Match {
  return {
    id: '760415',
    stage: 'GROUP',
    group: 'A',
    kickoff: '2026-06-11T19:00Z',
    venue: 'Estadio Banorte',
    city: 'Mexico City',
    country: 'Mexico',
    home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
    away: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' },
    status: 'LIVE',
    minute: 67,
    score: { home: 1, away: 0 },
    updatedAt: '2026-06-11T20:07Z',
    ...over,
  };
}

function fakeAdapter(opts: {
  live?: Match[];
  byDate?: Match[];
  window?: Match[];
  throws?: boolean;
  standings?: GroupStandings[];
}): ProviderAdapter {
  return {
    name: 'fake',
    capabilities: { push: false, latencyHintSec: 0 },
    async fetchByDate() {
      if (opts.throws) throw new Error('network down');
      return opts.byDate ?? [];
    },
    async fetchLive() {
      if (opts.throws) throw new Error('network down');
      return opts.live ?? [];
    },
    async fetchWindow() {
      if (opts.throws) throw new Error('network down');
      return opts.window ?? opts.live ?? opts.byDate ?? [];
    },
    ...(opts.standings
      ? {
          async fetchStandings() {
            if (opts.throws) throw new Error('network down');
            return opts.standings as GroupStandings[];
          },
        }
      : {}),
  };
}

const A_TABLE: GroupStandings = {
  group: 'A',
  rows: [
    { team: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' }, played: 1, won: 1, drawn: 0, lost: 0, goalsFor: 2, goalsAgainst: 0, goalDiff: 2, points: 3 },
    { team: { code: 'KOR', name: 'South Korea', flag: '🇰🇷' }, played: 1, won: 1, drawn: 0, lost: 0, goalsFor: 2, goalsAgainst: 1, goalDiff: 1, points: 3 },
  ],
};

const synth = () => new FakeMarketProvider({ synthesize: true, now: TEST_NOW });

/** A fixture still upcoming at TEST_NOW — its market read is relevant. */
const upcoming = (): Match =>
  allFixtures().find(
    (m) => m.status === 'SCHEDULED' && Date.parse(m.kickoff) > TEST_NOW.getTime(),
  )!;

/** Parse `data` against the tool's advertised schema; fail loud with details. */
function expectValid(tool: keyof typeof OUTPUT_SCHEMAS, data: unknown) {
  const res = z.object(OUTPUT_SCHEMAS[tool]).strict().safeParse(data);
  if (!res.success) {
    throw new Error(
      `${tool} data does not match its outputSchema:\n${JSON.stringify(res.error.issues, null, 2)}\n\nData:\n${JSON.stringify(data, null, 2)}`,
    );
  }
  expect(res.success).toBe(true);
}

describe('MCP tool output schemas', () => {
  it('OUTPUT_SCHEMAS covers exactly the nine tools', () => {
    expect(Object.keys(OUTPUT_SCHEMAS).sort()).toEqual(
      [
        'get_bracket',
        'get_live',
        'get_market_signal',
        'get_match',
        'get_next_fixture',
        'get_share_snippet',
        'get_standings',
        'get_team',
        'get_today',
      ].sort(),
    );
  });

  describe('get_today', () => {
    it('healthy (with matches + market signals)', async () => {
      const up = upcoming();
      const r = await toolGetToday({
        date: up.kickoff.slice(0, 10),
        adapter: fakeAdapter({ window: [up] }),
        marketProvider: synth(),
        now: TEST_NOW,
      });
      expectValid('get_today', r.data);
    });
    it('degraded (feed down)', async () => {
      const r = await toolGetToday({
        date: '2026-06-13',
        adapter: fakeAdapter({ throws: true }),
        marketProvider: synth(),
        now: TEST_NOW,
      });
      expectValid('get_today', r.data);
    });
  });

  describe('get_live', () => {
    it('healthy (a live match)', async () => {
      const r = await toolGetLive({ adapter: fakeAdapter({ live: [liveMatch()] }) });
      expectValid('get_live', r.data);
    });
    it('empty', async () => {
      const r = await toolGetLive({ adapter: fakeAdapter({ live: [] }) });
      expectValid('get_live', r.data);
    });
    it('degraded', async () => {
      const r = await toolGetLive({ adapter: fakeAdapter({ throws: true }) });
      expectValid('get_live', r.data);
    });
  });

  describe('get_match', () => {
    it('found (live, market-relevant)', async () => {
      const r = await toolGetMatch({
        id: '760415',
        adapter: fakeAdapter({ window: [liveMatch()] }),
        marketProvider: synth(),
        now: TEST_NOW,
      });
      expectValid('get_match', r.data);
    });
    it('not found', async () => {
      const r = await toolGetMatch({ id: 'nope', adapter: fakeAdapter({ window: [] }) });
      expectValid('get_match', r.data);
    });
    it('degraded', async () => {
      const r = await toolGetMatch({ id: '760415', adapter: fakeAdapter({ throws: true }) });
      expectValid('get_match', r.data);
    });
  });

  describe('get_standings', () => {
    it('one group (live)', async () => {
      const r = await toolGetStandings({ group: 'A', adapter: fakeAdapter({ standings: [A_TABLE] }) });
      expectValid('get_standings', r.data);
    });
    it('all groups (live)', async () => {
      const r = await toolGetStandings({ adapter: fakeAdapter({ standings: [A_TABLE] }) });
      expectValid('get_standings', r.data);
    });
    it('degraded roster (no standings feed)', async () => {
      const r = await toolGetStandings({ group: 'A', adapter: fakeAdapter({}) });
      expectValid('get_standings', r.data);
    });
    it('unknown group (empty)', async () => {
      const r = await toolGetStandings({ group: 'z', adapter: fakeAdapter({ standings: [A_TABLE] }) });
      expectValid('get_standings', r.data);
    });
  });

  describe('get_bracket', () => {
    it('resolved view', async () => {
      const r = await toolGetBracket({ adapter: fakeAdapter({ window: [] }), now: TEST_NOW });
      expectValid('get_bracket', r.data);
    });
    it('filtered stage', async () => {
      const r = await toolGetBracket({ stage: 'R32', adapter: fakeAdapter({ window: [] }), now: TEST_NOW });
      expectValid('get_bracket', r.data);
    });
    it('unknown stage (view: null)', async () => {
      const r = await toolGetBracket({ stage: 'ZZ', adapter: fakeAdapter({}) });
      expectValid('get_bracket', r.data);
    });
  });

  describe('get_next_fixture', () => {
    it('found (static group fixture)', async () => {
      const r = await toolGetNextFixture({
        team: upcoming().home.code,
        adapter: fakeAdapter({ window: [] }),
        now: TEST_NOW,
      });
      expectValid('get_next_fixture', r.data);
    });
    it('not found', async () => {
      const r = await toolGetNextFixture({ team: 'ZZZ', adapter: fakeAdapter({ window: [] }), now: TEST_NOW });
      expectValid('get_next_fixture', r.data);
    });
    it('degraded', async () => {
      const r = await toolGetNextFixture({ team: 'MEX', adapter: fakeAdapter({ throws: true }), now: TEST_NOW });
      expectValid('get_next_fixture', r.data);
    });
  });

  describe('get_market_signal', () => {
    it('by match id', async () => {
      const up = upcoming();
      const r = await toolGetMarketSignal({
        matchId: up.id,
        adapter: fakeAdapter({ window: [up] }),
        marketProvider: synth(),
        now: TEST_NOW,
      });
      expectValid('get_market_signal', r.data);
    });
    it('unknown match id (null signal)', async () => {
      const r = await toolGetMarketSignal({ matchId: 'nope', adapter: fakeAdapter({ window: [] }), marketProvider: synth() });
      expectValid('get_market_signal', r.data);
    });
    it("by team (next fixture)", async () => {
      const r = await toolGetMarketSignal({
        team: upcoming().home.code,
        adapter: fakeAdapter({ window: [] }),
        marketProvider: synth(),
        now: TEST_NOW,
      });
      expectValid('get_market_signal', r.data);
    });
    it('by date', async () => {
      const up = upcoming();
      const r = await toolGetMarketSignal({
        date: up.kickoff.slice(0, 10),
        adapter: fakeAdapter({ window: [up] }),
        marketProvider: synth(),
        now: TEST_NOW,
      });
      expectValid('get_market_signal', r.data);
    });
  });

  describe('get_share_snippet', () => {
    it('live', async () => {
      const r = await toolGetShareSnippet({ live: true, adapter: fakeAdapter({ live: [liveMatch()] }) });
      expectValid('get_share_snippet', r.data);
    });
    it('group standings (live)', async () => {
      const r = await toolGetShareSnippet({ group: 'A', adapter: fakeAdapter({ standings: [A_TABLE] }) });
      expectValid('get_share_snippet', r.data);
    });
    it('group standings (degraded roster)', async () => {
      const r = await toolGetShareSnippet({ group: 'A', adapter: fakeAdapter({}) });
      expectValid('get_share_snippet', r.data);
    });
    it('bracket', async () => {
      const r = await toolGetShareSnippet({ bracket: true, adapter: fakeAdapter({ window: [] }), now: TEST_NOW });
      expectValid('get_share_snippet', r.data);
    });
    it('bracket filtered stage', async () => {
      const r = await toolGetShareSnippet({ bracket: true, knockoutStage: 'R32', adapter: fakeAdapter({ window: [] }), now: TEST_NOW });
      expectValid('get_share_snippet', r.data);
    });
    it('bracket unknown stage (view: null)', async () => {
      const r = await toolGetShareSnippet({ bracket: true, knockoutStage: 'ZZ', adapter: fakeAdapter({}) });
      expectValid('get_share_snippet', r.data);
    });
    it('match by id', async () => {
      const r = await toolGetShareSnippet({
        matchId: '760415',
        adapter: fakeAdapter({ window: [liveMatch()] }),
        marketProvider: synth(),
        now: TEST_NOW,
      });
      expectValid('get_share_snippet', r.data);
    });
    it("team next fixture", async () => {
      const r = await toolGetShareSnippet({
        team: upcoming().home.code,
        adapter: fakeAdapter({ window: [] }),
        marketProvider: synth(),
        now: TEST_NOW,
      });
      expectValid('get_share_snippet', r.data);
    });
    it('today (date default)', async () => {
      const up = upcoming();
      const r = await toolGetShareSnippet({
        date: up.kickoff.slice(0, 10),
        adapter: fakeAdapter({ window: [up] }),
        marketProvider: synth(),
        now: TEST_NOW,
      });
      expectValid('get_share_snippet', r.data);
    });
  });

  describe('get_team', () => {
    it('exact code', () => expectValid('get_team', toolGetTeam({ query: 'MEX' }).data));
    it('exact name', () => expectValid('get_team', toolGetTeam({ query: 'Mexico' }).data));
    it('alias', () => expectValid('get_team', toolGetTeam({ query: 'Turkey' }).data));
    it('ambiguous (multiple candidates, team null)', () =>
      expectValid('get_team', toolGetTeam({ query: 'south' }).data));
    it('no match (empty)', () => expectValid('get_team', toolGetTeam({ query: 'zzz' }).data));
  });
});
