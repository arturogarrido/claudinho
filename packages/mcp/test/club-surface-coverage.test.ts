import type { Match, ProviderAdapter } from '@claudinho/core';
import { EspnAdapter, FakeMarketProvider } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod/v3';
import { OUTPUT_SCHEMAS } from '../src/server';
import {
  standingsResourceText,
  toolGetBracket,
  toolGetLive,
  toolGetMarketSignal,
  toolGetMatch,
  toolGetNextFixture,
  toolGetShareSnippet,
  toolGetStandings,
  toolGetToday,
} from '../src/tools';

/**
 * Club-surface coverage, MCP half (audit A03, CONTAINED): off the bundle no
 * tool reads the World Cup skeleton. Since 0.11 (2.1c) `get_next_fixture` and
 * `get_match` read the competition's own schedule ahead, and `get_bracket`
 * says a league season has none (`inapplicable`, top level and inside `view`);
 * the market tool still says "not available for this competition yet" (see
 * verdict-parity.test.ts, which owns that contract). Mirrors
 * knockout-surface-coverage.test.ts.
 *
 * The adapter below states nothing about its answers (no metadata) and has no
 * standings: every read of it is "not whole", which is what it is answered as.
 */
const NOW = new Date('2026-09-16T12:00:00Z');
const NOTICE = 'Not available for this competition yet.';
const pl: Match = {
  id: '800000001',
  stage: 'REGULAR',
  kickoff: '2026-09-16T14:00:00.000Z',
  venue: 'Vitality Stadium',
  home: { code: 'BOU', name: 'Bournemouth', id: 'espn:349' },
  away: { code: 'BRE', name: 'Brentford', id: 'espn:337' },
  status: 'SCHEDULED',
  updatedAt: NOW.toISOString(),
};
const adapter: ProviderAdapter = {
  name: 'espn',
  competition: 'eng.1',
  capabilities: { push: false, latencyHintSec: 0 },
  async fetchByDate() {
    return [pl];
  },
  async fetchLive() {
    return [];
  },
  async fetchWindow() {
    return [pl];
  },
};
const WC = /Mexico|South Africa|Round of 32/;
const ORIG = process.env.CLAUDINHO_COMPETITION;
beforeEach(() => {
  process.env.CLAUDINHO_COMPETITION = 'eng.1';
});
afterEach(() => {
  if (ORIG === undefined) delete process.env.CLAUDINHO_COMPETITION;
  else process.env.CLAUDINHO_COMPETITION = ORIG;
});

describe('club surface coverage (MCP) — no World Cup leakage off the bundle', () => {
  it('get_today on a World Cup date shows no World Cup fixture', async () => {
    const r = await toolGetToday({ date: '2026-06-11', adapter, now: NOW });
    expect(r.text).not.toMatch(WC);
  });

  it('get_next_fixture and get_match read this competition, never the World Cup; get_market_signal is not available here', async () => {
    const next = await toolGetNextFixture({ team: 'ARS', adapter, now: NOW });
    expect(next.text).toContain('roster could not be read whole');
    expect(next.text).not.toContain(NOTICE);
    expect(next.data).toMatchObject({ fixture: null, degraded: false, rosterIncomplete: true });
    const match = await toolGetMatch({ id: '760415', adapter, now: NOW });
    expect(match.text).toContain('may be incomplete');
    expect(match.text).not.toContain(NOTICE);
    expect(match.text).not.toMatch(WC);
    expect(() => z.object(OUTPUT_SCHEMAS.get_match).strict().parse(match.data)).not.toThrow();
    const market = await toolGetMarketSignal({ team: 'ARS', adapter, marketProvider: new FakeMarketProvider(), now: NOW });
    expect(market.text).toContain(NOTICE);
  });

  it('get_bracket says a league season has none, in text and in the view; the schema still accepts it', async () => {
    const r = await toolGetBracket({ adapter });
    expect(r.text).toContain('This competition has no bracket.');
    expect(r.text).not.toMatch(WC);
    const data = r.data as { view: { stages: unknown[]; inapplicable?: boolean }; source: string | null; inapplicable?: boolean };
    expect(data.view.stages).toEqual([]);
    expect(data.view.inapplicable).toBe(true);
    expect(data.inapplicable).toBe(true);
    expect(data.source).toBeNull();
    expect(() => z.object(OUTPUT_SCHEMAS.get_bracket).strict().parse(r.data)).not.toThrow();
  });

  it('get_share_snippet for next, bracket and a World Cup id never pastes the skeleton', async () => {
    const said = [
      [{ team: 'ARS' }, 'roster could not be read whole'],
      [{ bracket: true }, 'This competition has no bracket.'],
      [{ matchId: '760415' }, 'may be incomplete'],
    ] as const;
    for (const [args, sentence] of said) {
      const r = await toolGetShareSnippet({ ...args, adapter, marketProvider: new FakeMarketProvider(), now: NOW });
      expect(r.text, JSON.stringify(args)).toContain(sentence);
      expect(r.text, JSON.stringify(args)).not.toContain(NOTICE);
      expect(r.text, JSON.stringify(args)).not.toMatch(WC);
    }
  });
});

// ---------------------------------------------------------------------------
// 0.11 · 2.2 + 2.4 — the club rendering test, MCP half. The real adapter over
// a fake Premier League feed in two states (live: Arsenal 2–1 Chelsea at 50';
// scheduled: Arsenal vs Leeds on Saturday, alone). Every tool's text and data:
// no 🏳️, no region flag, no `undefined`, no "Friendly", the names as served,
// "League" where a stage prints, `stage: "REGULAR"`, no `flag` key; the
// stage grammar's PO and OTHER through the tools; `stageLabel` declared.
// ---------------------------------------------------------------------------

const STATS = ['gamesPlayed', 'wins', 'ties', 'losses', 'pointsFor', 'pointsAgainst', 'pointDifferential', 'points', 'rank'];
const CLUB_NOW = new Date('2026-10-04T14:50:00.000Z');
const SAT = '2026-10-10T11:30Z';
type Side = { id: string; abbr: string; name: string };
type Ev = { id: string; date: string; home: Side; away: Side; state?: 'pre' | 'in' | 'post' };
const ARS: Side = { id: '359', abbr: 'ARS', name: 'Arsenal' };
const CHE: Side = { id: '363', abbr: 'CHE', name: 'Chelsea' };
const LEE: Side = { id: '357', abbr: 'LEE', name: 'Leeds United' };
const S2026 = { year: 2026, displayName: '2026-27 English Premier League', startDate: '2026-08-01T04:00Z', endDate: '2027-05-30T03:59Z' };
function event(e: Ev, slug: string | null) {
  const state = e.state ?? 'pre';
  const type = state === 'in' ? { name: 'STATUS_IN_PROGRESS', state: 'in' } : { name: 'STATUS_SCHEDULED', state: 'pre' };
  const side = (s: Side, homeAway: string, score: string) => ({ homeAway, ...(state === 'pre' ? {} : { score }), team: { id: s.id, abbreviation: s.abbr, displayName: s.name } });
  return {
    id: e.id,
    date: e.date,
    season: { slug },
    status: { type, displayClock: state === 'in' ? "50'" : undefined, period: state === 'in' ? 2 : 0 },
    competitions: [{ venue: { fullName: 'Emirates Stadium', address: { city: 'London' } }, competitors: [side(e.home, 'home', '2'), side(e.away, 'away', '1')] }],
  };
}
function table(sides: Side[]) {
  return { children: [{ name: '2026-27 English Premier League', standings: { entries: sides.map((s, i) => ({ team: { id: s.id, abbreviation: s.abbr, displayName: s.name }, stats: STATS.map((n) => ({ name: n, value: n === 'rank' ? i + 1 : 0 })) })) } }] };
}
const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const easternDay = (iso: string) => eastern.format(new Date(iso)).replace(/-/g, '');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function feed(competition: string, events: Ev[], slug: string | null = '2026-27-english-premier-league', standings: unknown = table([ARS, CHE, LEE])) {
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    if (url.includes('/standings')) return json(standings);
    const asked = new URL(url).searchParams.get('dates') ?? '';
    if (asked.includes('-')) return json({ code: 400 }, 400);
    const inBucket = (e: Ev) => (asked.length === 8 ? easternDay(e.date) === asked : asked.length === 6 ? easternDay(e.date).startsWith(asked) : false);
    return json({ leagues: [{ season: S2026 }], events: events.filter(inBucket).map((e) => event(e, slug)) });
  }) as unknown as typeof fetch;
  return new EspnAdapter({ competition, fetchImpl, now: () => CLUB_NOW.getTime() }) as ProviderAdapter;
}
const LIVE_FEED = () => feed('eng.1', [{ id: '800000010', date: '2026-10-04T14:00Z', home: ARS, away: CHE, state: 'in' }]);
const SCHEDULED_FEED = () => feed('eng.1', [{ id: '800000011', date: SAT, home: ARS, away: LEE }]);
const LEAK = /🏳️|🇬🇧|🏴|undefined|Friendly|Amistoso|Amical|FRIENDLY/;
// Nothing in the flag's place, not even its space: a home flag's gap would be a
// bullet followed by two spaces or a line starting with one; an away flag's gap
// a double space before a separator.
const GAP = /(^|\n)(•|\d+\.) {2}\S|(^|\n) {1,2}\S|\S {2}[·(—]/;
const noLeak = (t: string, label: string) => {
  expect(t, label).not.toMatch(LEAK);
  expect(t, label).not.toMatch(GAP);
};
const noFlagKey = (team: unknown, label: string) => {
  expect(team, label).toBeTruthy();
  expect(team, label).not.toHaveProperty('flag');
};
const strict = (tool: keyof typeof OUTPUT_SCHEMAS, data: unknown) => expect(() => z.object(OUTPUT_SCHEMAS[tool]).strict().parse(data)).not.toThrow();
type Rec = Record<string, unknown>;

describe('club rendering (MCP) — the live state', () => {
  it('get_today: text by names and score; data with the written stage and no flag key', async () => {
    const r = await toolGetToday({ date: '2026-10-04', adapter: LIVE_FEED(), now: CLUB_NOW });
    expect(r.text).toContain('Arsenal 2–1 Chelsea');
    expect(r.text).toContain('League');
    noLeak(r.text, 'get_today');
    const m = ((r.data as Rec).matches as Rec[])[0];
    expect(m?.stage).toBe('REGULAR');
    noFlagKey(m?.home, 'get_today home');
    noFlagKey(m?.away, 'get_today away');
    strict('get_today', r.data);
  });

  it('get_today in four languages never says "Friendly"', async () => {
    for (const lang of ['en', 'es', 'pt', 'fr']) {
      const r = await toolGetToday({ date: '2026-10-04', adapter: LIVE_FEED(), now: CLUB_NOW, lang });
      noLeak(r.text, lang);
      expect(r.text, lang).toContain('Arsenal');
    }
  });

  it('get_live: the same', async () => {
    const r = await toolGetLive({ adapter: LIVE_FEED(), now: CLUB_NOW });
    expect(r.text).toContain('Arsenal 2–1 Chelsea');
    noLeak(r.text, 'get_live');
    noFlagKey(((r.data as Rec).matches as Rec[])[0]?.home, 'get_live');
    strict('get_live', r.data);
  });

  it('get_next_fixture: the match in play; get_match: the record, its stage and location joined cleanly', async () => {
    const next = await toolGetNextFixture({ team: 'Arsenal', adapter: LIVE_FEED(), now: CLUB_NOW });
    expect(next.text).toContain('Chelsea');
    noLeak(next.text, 'get_next_fixture');
    const nd = next.data as Rec;
    expect((nd.fixture as Rec).stage).toBe('REGULAR');
    noFlagKey((nd.fixture as Rec).home, 'get_next_fixture home');
    noFlagKey(nd.team, 'get_next_fixture team');
    strict('get_next_fixture', next.data);
    const match = await toolGetMatch({ id: '800000010', adapter: LIVE_FEED(), now: CLUB_NOW });
    expect(match.text).toContain('Arsenal 2–1 Chelsea');
    expect(match.text).toContain('League · Emirates Stadium, London');
    noLeak(match.text, 'get_match');
    noFlagKey(((match.data as Rec).match as Rec).home, 'get_match');
    strict('get_match', match.data);
  });

  it('get_share_snippet (date, live, match) in both styles', async () => {
    for (const style of ['social', 'compact'] as const) {
      for (const args of [{ date: '2026-10-04' }, { live: true }, { matchId: '800000010' }]) {
        const r = await toolGetShareSnippet({ ...args, style, adapter: LIVE_FEED(), marketProvider: new FakeMarketProvider(), now: CLUB_NOW });
        expect(r.text, `${JSON.stringify(args)} ${style}`).toContain(style === 'social' ? 'Arsenal 2–1 Chelsea' : 'ARS 2–1 CHE');
        noLeak(r.text, `${JSON.stringify(args)} ${style}`);
        const d = r.data as Rec;
        noLeak(d.snippet as string, 'snippet');
        for (const m of (d.matches as Rec[]) ?? []) noFlagKey(m.home, 'share data');
        strict('get_share_snippet', r.data);
      }
    }
  });

  it('get_standings, get_share_snippet { group } and the standings:// resource: rows by name and code, nothing in the flag\'s place', async () => {
    const r = await toolGetStandings({ adapter: LIVE_FEED() });
    expect(r.text).toContain('Arsenal');
    noLeak(r.text, 'get_standings');
    const tables = (r.data as Rec).tables as Array<{ standings: Array<{ team: unknown }> }>;
    expect(tables[0]?.standings).toHaveLength(3);
    for (const row of tables[0]?.standings ?? []) noFlagKey(row.team, 'get_standings row');
    strict('get_standings', r.data);
    const card = await toolGetShareSnippet({ group: 'LEAGUE', adapter: LIVE_FEED(), marketProvider: new FakeMarketProvider(), now: CLUB_NOW });
    expect(card.text).toContain('1. ARS');
    noLeak(card.text, 'share group');
    const resource = await standingsResourceText('LEAGUE', LIVE_FEED());
    expect(resource).toContain('Arsenal');
    noLeak(resource, 'standings://LEAGUE');
  });
});

describe('club rendering (MCP) — the scheduled state', () => {
  it('get_next_fixture: the countdown, "League"; get_share_snippet { team } in both styles', async () => {
    const next = await toolGetNextFixture({ team: 'Arsenal', adapter: SCHEDULED_FEED(), now: CLUB_NOW });
    expect(next.text).toContain('Leeds United');
    expect(next.text).toContain('League');
    noLeak(next.text, 'get_next_fixture scheduled');
    for (const style of ['social', 'compact'] as const) {
      const r = await toolGetShareSnippet({ team: 'Arsenal', style, adapter: SCHEDULED_FEED(), marketProvider: new FakeMarketProvider(), now: CLUB_NOW });
      expect(r.text, style).toContain(style === 'social' ? 'Arsenal vs Leeds United' : 'ARS vs LEE');
      noLeak(r.text, style);
    }
  });
});

describe('club rendering (MCP) — the stage grammar reaches the tools', () => {
  const PO = () => feed('uefa.champions', [{ id: '800000020', date: SAT, home: ARS, away: CHE }], 'knockout-round-playoffs', table([ARS, CHE]));
  const OTHER = () => feed('uefa.champions', [{ id: '800000021', date: SAT, home: ARS, away: CHE }], 'qualifying-final', table([ARS, CHE]));
  const NO_SLUG = () => feed('uefa.champions', [{ id: '800000022', date: SAT, home: ARS, away: CHE }], null, table([ARS, CHE]));

  it('a play-off round: "Play-offs" and `PO`', async () => {
    const r = await toolGetToday({ date: '2026-10-10', adapter: PO(), now: CLUB_NOW });
    expect(r.text).toContain('Play-offs');
    expect(((r.data as Rec).matches as Rec[])[0]?.stage).toBe('PO');
    noLeak(r.text, 'po');
  });

  it('an unknown round: the provider\'s words in text, `stage: "OTHER"` and `stageLabel` in data, on today, match, next and the cards', async () => {
    const today = await toolGetToday({ date: '2026-10-10', adapter: OTHER(), now: CLUB_NOW });
    expect(today.text).toContain('Qualifying final');
    const tm = ((today.data as Rec).matches as Rec[])[0];
    expect(tm?.stage).toBe('OTHER');
    expect(tm?.stageLabel).toBe('Qualifying final');
    strict('get_today', today.data);
    const match = await toolGetMatch({ id: '800000021', adapter: OTHER(), now: CLUB_NOW });
    expect(match.text).toContain('Qualifying final · Emirates Stadium, London');
    expect(((match.data as Rec).match as Rec).stageLabel).toBe('Qualifying final');
    strict('get_match', match.data);
    const next = await toolGetNextFixture({ team: 'Arsenal', adapter: OTHER(), now: CLUB_NOW });
    expect(next.text).toContain('Qualifying final');
    expect(((next.data as Rec).fixture as Rec).stageLabel).toBe('Qualifying final');
    strict('get_next_fixture', next.data);
    const card = await toolGetShareSnippet({ matchId: '800000021', adapter: OTHER(), marketProvider: new FakeMarketProvider(), now: CLUB_NOW });
    expect(card.text).toContain('Qualifying final');
    strict('get_share_snippet', card.data);
  });

  it('a record with no phase stated: no stage segment, no dangling separator, no "Group stage"; `stage: "OTHER"` without a label', async () => {
    const match = await toolGetMatch({ id: '800000022', adapter: NO_SLUG(), now: CLUB_NOW });
    expect(match.text).toContain('Emirates Stadium, London');
    expect(match.text).not.toMatch(/Group/);
    expect(match.text).not.toMatch(/OTHER/);
    expect(match.text).not.toMatch(/·\s*·|·\s*(\n|$)|(^|\n)\s*·/);
    const m = (match.data as Rec).match as Rec;
    expect(m.stage).toBe('OTHER');
    expect(m).not.toHaveProperty('stageLabel');
    const today = await toolGetToday({ date: '2026-10-10', adapter: NO_SLUG(), now: CLUB_NOW });
    expect(today.text).not.toMatch(/Group/);
    expect(today.text).not.toMatch(/·\s*·|·\s*(\n|$)/);
    const card = await toolGetShareSnippet({ matchId: '800000022', adapter: NO_SLUG(), marketProvider: new FakeMarketProvider(), now: CLUB_NOW });
    expect(card.text).not.toMatch(/Group/);
    expect(card.text).not.toMatch(/·\s*(\n|$)|(^|\n)\s*·/);
  });

  it('the carried label is declared on the match shapes: a client is told the key exists', () => {
    for (const tool of ['get_today', 'get_live', 'get_match', 'get_next_fixture', 'get_share_snippet'] as const) {
      const shape = OUTPUT_SCHEMAS[tool] as Record<string, z.ZodTypeAny>;
      const matchShape = (shape.matches ?? shape.match ?? shape.fixture) as z.ZodTypeAny;
      expect(matchShape, tool).toBeTruthy();
      const described = JSON.stringify(unwrapKeys(matchShape));
      expect(described, tool).toContain('stageLabel');
    }
  });
});

/** The object keys a (possibly wrapped) zod schema declares. */
function unwrapKeys(schema: z.ZodTypeAny): string[] {
  let s: z.ZodTypeAny = schema;
  for (;;) {
    const d = s._def as { typeName?: string; innerType?: z.ZodTypeAny; type?: z.ZodTypeAny; schema?: z.ZodTypeAny };
    if (d.typeName === 'ZodObject') return Object.keys((s as z.ZodObject<z.ZodRawShape>).shape);
    const inner = d.innerType ?? d.type ?? d.schema;
    if (!inner) return [];
    s = inner;
  }
}
