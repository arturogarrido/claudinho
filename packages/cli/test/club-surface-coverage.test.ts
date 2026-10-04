import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Match, ProviderAdapter } from '@claudinho/core';
import { EspnAdapter, FakeMarketProvider } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CacheState, writeState } from '../src/cache';

// `prompt` and `hook` fire a detached refresher when the cache says one is
// due; in a test worker that would start a real process (a vitest fork
// entry with `_refresh` as its argument), which the CI runner on Windows
// waited on until its limit. The spawn is someone else's test.
vi.mock('node:child_process', () => ({ spawn: vi.fn(() => ({ unref: vi.fn() })) }));
import { cmdBracket, cmdHook, cmdLive, cmdMarkets, cmdMatch, cmdNext, cmdPrompt, cmdShare, cmdTable, cmdToday, cmdVibe } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';
import { renderPrompt } from '../src/statusline';

/**
 * Club-surface coverage, first version (audit A03, CONTAINED): under a
 * competition other than the bundled World Cup, NO surface may leak the
 * World Cup skeleton. Since 0.11 (2.1c) `next` and `match <id>` read the
 * competition's own schedule ahead and `bracket` says a league season has none;
 * the market sidecar still says "not available for this competition yet".
 * Mirrors knockout-surface-coverage.test.ts. 0.11 (2.2) grows this into the
 * full club rendering test (no 🏳️, no nation rename, no "Friendly").
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
function cfg(over: Partial<CliConfig> = {}): CliConfig {
  return { lang: 'en', tz: 'UTC', json: false, color: false, source: 'espn', competition: 'eng.1', flavor: 'off', markets: false, ...over };
}
const ctx = (over: Partial<CliConfig> = {}) => ({
  cfg: cfg(over),
  t: makeT('en'),
  adapter,
  now: NOW,
  marketProvider: new FakeMarketProvider(),
});

const ORIG = process.env.CLAUDINHO_COMPETITION;
const outSpy = vi.spyOn(process.stdout, 'write');
let writes: string[] = [];
beforeEach(() => {
  process.env.CLAUDINHO_COMPETITION = 'eng.1';
  writes = [];
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
});
afterEach(() => {
  outSpy.mockReset();
  if (ORIG === undefined) delete process.env.CLAUDINHO_COMPETITION;
  else process.env.CLAUDINHO_COMPETITION = ORIG;
});
const text = () => writes.join('');
const WC = /Mexico|South Africa|Round of 32/;

describe('club surface coverage — no World Cup leakage off the bundle', () => {
  it('`today` shows the provider\'s fixture and none of the bundle', async () => {
    await cmdToday('2026-09-16', ctx());
    expect(text()).toContain('Bournemouth');
    expect(text()).not.toMatch(WC);
  });

  it('`today <World Cup date>` shows no World Cup fixture', async () => {
    await cmdToday('2026-06-11', ctx());
    expect(text()).not.toMatch(WC);
  });

  it('`next` reads this competition, never the World Cup: with its roster unread, a code it cannot place says so, not "no fixture"', async () => {
    await cmdNext('ARS', ctx());
    expect(text()).toContain('roster could not be read whole');
    expect(text()).not.toContain(NOTICE);
    expect(text()).not.toContain('No upcoming fixture');
    expect(text()).not.toMatch(WC);
  });

  it('`next --json` carries the roster verdict, not an outage', async () => {
    await cmdNext('ARS', ctx({ json: true }));
    const data = JSON.parse(text());
    expect(data).toMatchObject({ fixture: null, degraded: false, source: null, rosterIncomplete: true });
    expect('unsupported' in data).toBe(false);
  });

  it('`bracket` says a league season has none, and shows no World Cup topology', async () => {
    await cmdBracket(undefined, {}, ctx());
    expect(text()).toContain('This competition has no bracket.');
    expect(text()).not.toMatch(WC);
  });

  it('`match <World Cup id>` is never the World Cup opener: the read was not whole, and says so', async () => {
    await cmdMatch('760415', ctx());
    expect(text()).toContain('may be incomplete');
    expect(text()).not.toContain(NOTICE);
    expect(text()).not.toMatch(WC);
  });

  it('`markets next` says the feature is not available here', async () => {
    await cmdMarkets('next', 'ARS', ctx());
    expect(text()).toContain(NOTICE);
    expect(text()).not.toMatch(WC);
  });

  it('`share next`, `share bracket` and `share <World Cup id>` never paste the skeleton', async () => {
    const said = [
      [['next', 'ARS'], 'roster could not be read whole'],
      [['bracket', undefined], 'This competition has no bracket.'],
      [['760415', undefined], 'may be incomplete'],
    ] as const;
    for (const [args, sentence] of said) {
      writes = [];
      await cmdShare(args[0], args[1], {}, ctx());
      expect(text(), args[0]).toContain(sentence);
      expect(text(), args[0]).not.toContain(NOTICE);
      expect(text(), args[0]).not.toMatch(WC);
    }
  });

  it('`markets next --json` and `markets <World Cup id> --json` carry the marker', async () => {
    // Review P2 on #129: the text branches said "not available" while the JSON
    // branches emitted `complete:true, signal:null` — indistinguishable from a
    // successful empty result. Both selectors, since each has its own branch.
    for (const args of [['next', 'ARS'], ['760415', undefined]] as const) {
      writes = [];
      await cmdMarkets(args[0], args[1], ctx({ json: true }));
      expect(JSON.parse(text())).toMatchObject({ complete: true, signal: null, unsupported: true });
    }
  });

  it('`share next --json`, `share <World Cup id> --json` and `share bracket --json` carry what the snippet says', async () => {
    // The sibling of the market P2: the snippet text warns, the structured
    // half must say so too (the batch-1 `partial` lesson, same shape).
    const said = [
      [['next', 'ARS'], { degraded: false, source: null, rosterIncomplete: true }],
      [['760415', undefined], { degraded: false, source: null, partial: {} }],
      [['bracket', undefined], { degraded: false, source: null, inapplicable: true }],
    ] as const;
    for (const [args, keys] of said) {
      writes = [];
      await cmdShare(args[0], args[1], {}, ctx({ json: true }));
      const data = JSON.parse(text()) as { snippet: string };
      expect(data, args[0]).toMatchObject(keys);
      expect('unsupported' in data, args[0]).toBe(false);
      expect(data.snippet, args[0]).not.toMatch(WC);
    }
  });
});

describe('statusline off the bundle', () => {
  it('never counts down to a bundled World Cup fixture', () => {
    // A June 2026 clock, when the bundle had upcoming group games: with no
    // cached fixtures the hot path must fail closed, not read the skeleton.
    const cache: CacheState = {
      updatedAt: '2026-06-10T12:00:00.000Z',
      live: [],
      degraded: false,
      source: 'espn',
      competition: 'eng.1',
    };
    const line = renderPrompt(cache, { defaultCompetition: false, now: new Date('2026-06-10T12:00:00Z') });
    expect(line).toBe('⚽ —');
    expect(renderPrompt(cache, { defaultCompetition: false, team: 'MEX', now: new Date('2026-06-10T12:00:00Z') })).toBe('⚽ —');
  });

  it('never merges the bundle back in when the refresher cached fixtures', () => {
    // Two mechanisms cover the empty cache above (no fixtures → an empty
    // schedule), so that case cannot see the merge. WITH cached fixtures the
    // schedule is `mergeLive(bundle, cached)`: a bundle that is the World Cup
    // skeleton wins the countdown (the opener is sooner and resolved), while
    // the club tie, flagless until 0.11, renders as nothing. Off the bundle the
    // merge base must be empty: "⚽ —", never "🇲🇽 vs 🇿🇦 in 1d".
    const now = new Date('2026-06-10T12:00:00Z');
    const club: Match = { ...pl, kickoff: '2026-06-12T20:00:00.000Z', updatedAt: now.toISOString() };
    const cache: CacheState = {
      updatedAt: now.toISOString(),
      live: [],
      degraded: false,
      source: 'espn',
      competition: 'eng.1',
      fixtures: [club],
      fixturesUpdatedAt: now.toISOString(),
    };
    for (const team of [undefined, 'MEX']) {
      const line = renderPrompt(cache, { defaultCompetition: false, team, now });
      expect(line).toBe('⚽ —');
      expect(line).not.toMatch(WC);
    }
  });
});

// ---------------------------------------------------------------------------
// 0.11 · 2.2 + 2.4 — the club rendering test. The real adapter over a fake
// Premier League feed (the trust layer decides the flag and the stage), in two
// states, because `next` answers the earliest fixture not finished, in play
// included: LIVE (Arsenal vs Chelsea, 2–1 at 50') and SCHEDULED (Arsenal vs
// Leeds on Saturday, alone). Every surface: no 🏳️, no region flag, no
// `undefined`, no "Friendly" in four locales, the names as served, "League"
// where a stage prints, `stage: "REGULAR"` and no `flag` key in `--json`.
// ---------------------------------------------------------------------------

const STATS = ['gamesPlayed', 'wins', 'ties', 'losses', 'pointsFor', 'pointsAgainst', 'pointDifferential', 'points', 'rank'];
const CLUB_NOW = new Date('2026-10-04T14:50:00.000Z');
const SAT = '2026-10-10T11:30Z';
type Side = { id: string; abbr: string; name: string };
type Ev = { id: string; date: string; home: Side; away: Side; state?: 'pre' | 'in' | 'post'; slug?: string | null; score?: [string, string] };
const ARS: Side = { id: '359', abbr: 'ARS', name: 'Arsenal' };
const CHE: Side = { id: '363', abbr: 'CHE', name: 'Chelsea' };
const LEE: Side = { id: '357', abbr: 'LEE', name: 'Leeds United' };
const MONACO: Side = { id: '174', abbr: 'MON', name: 'Monaco' };
const S2026 = { year: 2026, displayName: '2026-27 English Premier League', startDate: '2026-08-01T04:00Z', endDate: '2027-05-30T03:59Z' };
function event(e: Ev, slug: string | null | undefined) {
  const state = e.state ?? 'pre';
  const type = state === 'in' ? { name: 'STATUS_IN_PROGRESS', state: 'in' } : state === 'post' ? { name: 'STATUS_FULL_TIME', state: 'post' } : { name: 'STATUS_SCHEDULED', state: 'pre' };
  const [hs, as] = e.score ?? ['2', '1'];
  const side = (s: Side, homeAway: string, score: string) => ({ homeAway, ...(state === 'pre' ? {} : { score }), team: { id: s.id, abbreviation: s.abbr, displayName: s.name } });
  return {
    id: e.id,
    date: e.date,
    season: slug === undefined ? {} : { slug },
    status: { type, displayClock: state === 'in' ? "50'" : undefined, period: state === 'in' ? 2 : 0 },
    competitions: [{ venue: { fullName: 'Emirates Stadium', address: { city: 'London' } }, competitors: [side(e.home, 'home', hs), side(e.away, 'away', as)] }],
  };
}
function table(sides: Side[]) {
  return { children: [{ name: '2026-27 English Premier League', standings: { entries: sides.map((s, i) => ({ team: { id: s.id, abbreviation: s.abbr, displayName: s.name }, stats: STATS.map((n) => ({ name: n, value: n === 'rank' ? i + 1 : 0 })) })) } }] };
}
const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const easternDay = (iso: string) => eastern.format(new Date(iso)).replace(/-/g, '');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** The real adapter over a fake feed: one league table with ids, the events filed by their US/Eastern day, the season's slug on each. */
function feed(competition: string, events: Ev[], slug: string | null | undefined = '2026-27-english-premier-league', standings: unknown = table([ARS, CHE, LEE])) {
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    if (url.includes('/standings')) return json(standings);
    const asked = new URL(url).searchParams.get('dates') ?? '';
    if (asked.includes('-')) return json({ code: 400 }, 400);
    const inBucket = (e: Ev) => (asked.length === 8 ? easternDay(e.date) === asked : asked.length === 6 ? easternDay(e.date).startsWith(asked) : false);
    return json({ leagues: [{ season: S2026 }], events: events.filter(inBucket).map((e) => event(e, e.slug === undefined ? slug : e.slug)) });
  }) as unknown as typeof fetch;
  return new EspnAdapter({ competition, fetchImpl, now: () => CLUB_NOW.getTime() }) as ProviderAdapter;
}
const LIVE_FEED = () => feed('eng.1', [{ id: '800000010', date: '2026-10-04T14:00Z', home: ARS, away: CHE, state: 'in' }]);
const SCHEDULED_FEED = () => feed('eng.1', [{ id: '800000011', date: SAT, home: ARS, away: LEE }]);
const clubCtx = (adapter: ProviderAdapter, over: Partial<CliConfig> = {}) => ({
  cfg: cfg({ competition: adapter.competition, ...over }),
  t: makeT(over.lang ?? 'en'),
  adapter,
  now: CLUB_NOW,
  marketProvider: new FakeMarketProvider(),
});
const LEAK = /🏳️|🇬🇧|🏴|undefined|Friendly|Amistoso|Amical|FRIENDLY/;
// Nothing in the flag's place, not even its space: a home flag's gap would be a
// row indented by three where rows indent by two, or a bullet or rank followed
// by two spaces; an away flag's gap is a double space before a separator.
const GAP = /\n {3,}[^\s│]|(^|\n)(•|\d+\.) {2}|\S {2}[·(—]/;
const noLeak = (t: string, label: string) => {
  expect(t, label).not.toMatch(LEAK);
  expect(t, label).not.toMatch(GAP);
};
const parsedOut = () => JSON.parse(text()) as Record<string, unknown>;
const noFlagKey = (team: unknown, label: string) => {
  expect(team, label).toBeTruthy();
  expect(team, label).not.toHaveProperty('flag');
};

describe('club rendering — the live state (Arsenal 2–1 Chelsea, 50\')', () => {
  it('`today`: the names and the score, nothing in the flag\'s place; `--json` has no flag key and the written stage', async () => {
    await cmdToday('2026-10-04', clubCtx(LIVE_FEED()));
    const t = text();
    expect(t).toContain('Arsenal');
    expect(t).toContain('Chelsea');
    expect(t).toContain('2–1');
    noLeak(t, 'today');
    writes = [];
    await cmdToday('2026-10-04', clubCtx(LIVE_FEED(), { json: true }));
    const j = parsedOut();
    const m = (j.matches as Array<Record<string, unknown>>)[0];
    expect(m?.stage).toBe('REGULAR');
    noFlagKey(m?.home, 'today --json home');
    noFlagKey(m?.away, 'today --json away');
    expect(m).not.toHaveProperty('stageLabel');
  });

  it('`today` in four locales never says "Friendly"', async () => {
    for (const lang of ['en', 'es', 'pt', 'fr']) {
      writes = [];
      await cmdToday('2026-10-04', clubCtx(LIVE_FEED(), { lang }));
      noLeak(text(), lang);
      expect(text(), lang).toContain('Arsenal');
    }
  });

  it('`live`: the same', async () => {
    await cmdLive(clubCtx(LIVE_FEED()));
    expect(text()).toContain('Arsenal');
    noLeak(text(), 'live');
    writes = [];
    await cmdLive(clubCtx(LIVE_FEED(), { json: true }));
    noFlagKey((parsedOut().matches as Array<Record<string, unknown>>)[0]?.home, 'live --json');
  });

  it('`next Arsenal`: the match in play, "League" as its stage, no countdown; "Liga" in Spanish', async () => {
    await cmdNext('Arsenal', clubCtx(LIVE_FEED()));
    const t = text();
    expect(t).toContain('Chelsea');
    expect(t).toContain('League');
    noLeak(t, 'next live');
    writes = [];
    await cmdNext('Arsenal', clubCtx(LIVE_FEED(), { lang: 'es' }));
    expect(text()).toContain('Liga');
    noLeak(text(), 'next live es');
    writes = [];
    await cmdNext('Arsenal', clubCtx(LIVE_FEED(), { json: true }));
    const j = parsedOut();
    expect((j.fixture as Record<string, unknown>).stage).toBe('REGULAR');
    noFlagKey((j.fixture as Record<string, unknown>).home, 'next --json');
    noFlagKey(j.team, 'next --json team');
  });

  it('`match <id>`: the header, the stage, the location, no dangling separator', async () => {
    await cmdMatch('800000010', clubCtx(LIVE_FEED()));
    const t = text();
    expect(t).toContain('Arsenal 2–1 Chelsea');
    expect(t).toContain('League · Emirates Stadium, London');
    noLeak(t, 'match');
    writes = [];
    await cmdMatch('800000010', clubCtx(LIVE_FEED(), { json: true }));
    const j = parsedOut();
    expect((j.match as Record<string, unknown>).stage).toBe('REGULAR');
    noFlagKey((j.match as Record<string, unknown>).home, 'match --json');
  });

  it('`share` (date, live, match) in both styles: nothing in the flag\'s place; the stage line says "League"', async () => {
    for (const style of ['social', 'compact']) {
      for (const [target, team] of [['2026-10-04', undefined], ['live', undefined], ['800000010', undefined]] as const) {
        writes = [];
        await cmdShare(target, team, { style }, clubCtx(LIVE_FEED()));
        const t = text();
        expect(t, `${target} ${style}`).toContain(style === 'social' ? 'Arsenal 2–1 Chelsea' : 'ARS 2–1 CHE');
        noLeak(t, `${target} ${style}`);
      }
    }
    writes = [];
    await cmdShare('800000010', undefined, { style: 'social' }, clubCtx(LIVE_FEED()));
    expect(text()).toContain('League');
    writes = [];
    await cmdShare('800000010', undefined, {}, clubCtx(LIVE_FEED(), { json: true }));
    const j = parsedOut();
    const shared = (j.matches as Array<Record<string, unknown>>)[0];
    expect(shared?.stage).toBe('REGULAR');
    noFlagKey(shared?.home, 'share --json');
    noLeak(j.snippet as string, 'share --json snippet');
  });

  it('`table` and `share table`: rows by name and code, nothing in the flag\'s place', async () => {
    await cmdTable(undefined, clubCtx(LIVE_FEED()));
    const t = text();
    expect(t).toContain('Arsenal');
    expect(t).toContain('Leeds United');
    noLeak(t, 'table');
    writes = [];
    await cmdTable(undefined, clubCtx(LIVE_FEED(), { json: true }));
    const j = parsedOut();
    const rows = (j.tables as Array<{ standings: Array<{ team: unknown }> }>)[0]?.standings;
    expect(rows?.length).toBe(3);
    for (const r of rows ?? []) noFlagKey(r.team, 'table --json row');
    writes = [];
    await cmdShare('table', undefined, {}, clubCtx(LIVE_FEED()));
    expect(text()).toContain('1. ARS');
    noLeak(text(), 'share table');
  });
});

describe('club rendering — the scheduled state (Arsenal vs Leeds, Saturday)', () => {
  it('`today <Saturday>`: the fixture by names, `vs` between them', async () => {
    await cmdToday('2026-10-10', clubCtx(SCHEDULED_FEED()));
    const t = text();
    expect(t).toContain('Arsenal');
    expect(t).toContain('Leeds United');
    expect(t).toMatch(/Arsenal\s+vs\s+Leeds United/);
    noLeak(t, 'today scheduled');
  });

  it('`next Arsenal`: the countdown branch, "League · <when>", no flag', async () => {
    await cmdNext('Arsenal', clubCtx(SCHEDULED_FEED()));
    const t = text();
    expect(t).toContain('Leeds United');
    expect(t).toMatch(/League · /);
    noLeak(t, 'next scheduled');
    writes = [];
    await cmdNext('Arsenal', clubCtx(SCHEDULED_FEED(), { lang: 'fr' }));
    expect(text()).toContain('Championnat');
    noLeak(text(), 'next scheduled fr');
  });

  it('`share next Arsenal` in both styles', async () => {
    await cmdShare('next', 'Arsenal', { style: 'social' }, clubCtx(SCHEDULED_FEED()));
    expect(text()).toContain('Arsenal vs Leeds United');
    expect(text()).toContain('League');
    noLeak(text(), 'share next social');
    writes = [];
    await cmdShare('next', 'Arsenal', { style: 'compact' }, clubCtx(SCHEDULED_FEED()));
    expect(text()).toContain('ARS vs LEE');
    noLeak(text(), 'share next compact');
  });

  it('a club named like a region gets no flag either (Monaco)', async () => {
    const f = feed('eng.1', [{ id: '800000012', date: SAT, home: MONACO, away: ARS }], '2026-27-english-premier-league', table([ARS, MONACO]));
    await cmdToday('2026-10-10', clubCtx(f));
    expect(text()).toContain('Monaco');
    expect(text()).not.toContain('🇲🇨');
    noLeak(text(), 'monaco');
  });
});

describe('club rendering — the stage grammar reaches the surfaces', () => {
  const PO = () => feed('uefa.champions', [{ id: '800000020', date: SAT, home: ARS, away: CHE }], 'knockout-round-playoffs', table([ARS, CHE]));
  const OTHER = () => feed('uefa.champions', [{ id: '800000021', date: SAT, home: ARS, away: CHE }], 'qualifying-final', table([ARS, CHE]));
  const NO_SLUG = () => feed('uefa.champions', [{ id: '800000022', date: SAT, home: ARS, away: CHE }], null, table([ARS, CHE]));

  it('a play-off round: "Play-offs" on today and next, `PO` in --json', async () => {
    await cmdToday('2026-10-10', clubCtx(PO()));
    expect(text()).toContain('Arsenal');
    noLeak(text(), 'po today');
    writes = [];
    await cmdNext('Arsenal', clubCtx(PO()));
    expect(text()).toContain('Play-offs');
    writes = [];
    await cmdNext('Arsenal', clubCtx(PO(), { lang: 'fr' }));
    expect(text()).toContain('Barrages');
    writes = [];
    await cmdToday('2026-10-10', clubCtx(PO(), { json: true }));
    expect((parsedOut().matches as Array<Record<string, unknown>>)[0]?.stage).toBe('PO');
  });

  it('an unknown round: the provider\'s words on next, match and the cards; `stageLabel` in --json', async () => {
    await cmdNext('Arsenal', clubCtx(OTHER()));
    expect(text()).toContain('Qualifying final');
    noLeak(text(), 'other next');
    writes = [];
    await cmdNext('Arsenal', clubCtx(OTHER(), { lang: 'es' }));
    expect(text()).toContain('Qualifying final');
    writes = [];
    await cmdMatch('800000021', clubCtx(OTHER()));
    expect(text()).toContain('Qualifying final · Emirates Stadium, London');
    writes = [];
    await cmdShare('800000021', undefined, { style: 'social' }, clubCtx(OTHER()));
    expect(text()).toContain('Qualifying final');
    writes = [];
    await cmdShare('next', 'Arsenal', { style: 'social' }, clubCtx(OTHER()));
    expect(text()).toContain('Qualifying final');
    writes = [];
    await cmdMatch('800000021', clubCtx(OTHER(), { json: true }));
    const m = parsedOut().match as Record<string, unknown>;
    expect(m.stage).toBe('OTHER');
    expect(m.stageLabel).toBe('Qualifying final');
    writes = [];
    await cmdToday('2026-10-10', clubCtx(OTHER(), { json: true }));
    expect((parsedOut().matches as Array<Record<string, unknown>>)[0]?.stageLabel).toBe('Qualifying final');
  });

  it('a record with no phase stated: no stage segment, no dangling separator, no "Group stage"', async () => {
    await cmdNext('Arsenal', clubCtx(NO_SLUG()));
    const t = text();
    expect(t).toContain('Chelsea');
    expect(t).not.toMatch(/Group/);
    expect(t).not.toMatch(/OTHER/);
    expect(t).not.toMatch(/(^|\n)\s*·|·\s*(\n|$)|·\s+·/);
    noLeak(t, 'no slug next');
    writes = [];
    await cmdMatch('800000022', clubCtx(NO_SLUG()));
    const mt = text();
    expect(mt).toContain('Emirates Stadium, London');
    expect(mt).not.toMatch(/Group/);
    expect(mt).not.toMatch(/(^|\n)\s*·|·\s*(\n|$)|·\s+·/);
    writes = [];
    await cmdShare('800000022', undefined, { style: 'social' }, clubCtx(NO_SLUG()));
    const card = text();
    expect(card).not.toMatch(/Group/);
    expect(card).not.toMatch(/(^|\n)\s*·|·\s*(\n|$)/);
    writes = [];
    await cmdMatch('800000022', clubCtx(NO_SLUG(), { json: true }));
    const m = parsedOut().match as Record<string, unknown>;
    expect(m.stage).toBe('OTHER');
    expect(m).not.toHaveProperty('stageLabel');
  });
});

describe('club rendering — the cache-only surfaces (statusline, hook, vibe)', () => {
  const live = (over: Partial<Match> = {}): Match => ({
    id: '800000010',
    stage: 'REGULAR',
    kickoff: new Date(CLUB_NOW.getTime() - 50 * 60_000).toISOString(),
    venue: 'Emirates Stadium',
    home: { code: 'ARS', name: 'Arsenal', id: 'espn:359' },
    away: { code: 'CHE', name: 'Chelsea', id: 'espn:363' },
    status: 'LIVE',
    minute: 50,
    score: { home: 2, away: 1 },
    updatedAt: CLUB_NOW.toISOString(),
    ...over,
  });
  const snapshot = (competition: string, matches: Match[], at = CLUB_NOW): CacheState => ({
    updatedAt: at.toISOString(),
    live: matches,
    degraded: false,
    source: 'espn',
    competition,
  });
  const albania = (): Match => live({
    home: { code: 'ALB', name: 'Albania', id: 'espn:2654' },
    away: { code: 'LVA', name: 'Latvia', id: 'espn:2578' },
    stage: 'LEAGUE',
  });

  it('the statusline renders a club match by codes in every mode', () => {
    const opts = { defaultCompetition: false, teamKind: 'club' as const, now: CLUB_NOW };
    const s = snapshot('eng.1', [live()]);
    expect(renderPrompt(s, opts)).toBe("⚽ ARS 2–1 CHE 50'");
    expect(renderPrompt(s, { ...opts, compact: false })).toBe("⚽ ARS 2–1 CHE 50'");
    expect(renderPrompt(s, { ...opts, flags: false })).toBe("⚽ ARS 2–1 CHE 50'");
    expect(renderPrompt(s, { ...opts, team: 'CHE' })).toBe("⚽ ARS 2–1 CHE 50'");
  });

  it('with no kind stated, off the bundle a side is a club (nothing is vouched for); on the bundle, a nation', () => {
    const s = snapshot('eng.1', [live()]);
    expect(renderPrompt(s, { defaultCompetition: false, now: CLUB_NOW })).toBe("⚽ ARS 2–1 CHE 50'");
    const mex = live({ home: { code: 'MEX', name: 'Mexico', id: 'espn:203' }, away: { code: 'RSA', name: 'South Africa', id: 'espn:467' }, stage: 'GROUP' });
    expect(renderPrompt(snapshot('fifa.world', [mex]), { defaultCompetition: true, now: CLUB_NOW })).toBe("⚽ 🇲🇽 2–1 🇿🇦 50'");
    expect(renderPrompt(snapshot('uefa.nations', [mex]), { defaultCompetition: false, now: CLUB_NOW })).toBe("⚽ MEX 2–1 RSA 50'");
  });

  it('a nation off the bundle keeps its flags on the statusline (the kind, not the bundle, decides)', () => {
    const opts = { defaultCompetition: false, teamKind: 'nation' as const, now: CLUB_NOW };
    const s = snapshot('uefa.nations', [albania()]);
    expect(renderPrompt(s, opts)).toBe("⚽ 🇦🇱 2–1 🇱🇻 50'");
    expect(renderPrompt(s, { ...opts, compact: false })).toBe("⚽ 🇦🇱 ALB 2–1 LVA 🇱🇻 50'");
    expect(renderPrompt(s, { ...opts, flags: false })).toBe("⚽ ALB 2–1 LVA 50'");
  });

  describe('through the commands, from a cache file (the call passes the kind)', () => {
    const ENV = ['XDG_CACHE_HOME', 'CLAUDINHO_TEAM', 'CLAUDINHO_COMPETITION', 'CLAUDINHO_FLAGS'] as const;
    const saved: Partial<Record<(typeof ENV)[number], string | undefined>> = {};
    let dir: string;
    beforeEach(() => {
      for (const k of ENV) saved[k] = process.env[k];
      dir = mkdtempSync(join(tmpdir(), 'claudinho-club-cov-'));
      process.env.XDG_CACHE_HOME = dir;
      delete process.env.CLAUDINHO_TEAM;
      delete process.env.CLAUDINHO_FLAGS;
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
      for (const k of ENV) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });
    // `prompt`, `hook` and `vibe` read the clock themselves: the snapshot is stamped now.
    const seed = (competition: string, matches: Match[]) => {
      process.env.CLAUDINHO_COMPETITION = competition;
      const at = new Date();
      writeState(snapshot(competition, matches.map((m) => ({ ...m, kickoff: new Date(at.getTime() - 50 * 60_000).toISOString(), updatedAt: at.toISOString() })), at));
    };
    const ctxOf = (competition: string, over: Partial<CliConfig> = {}) => ({ cfg: cfg({ competition, ...over }), t: makeT('en') });

    it('`hook`: the club line by names, nothing in the flag\'s place', () => {
      seed('eng.1', [live()]);
      cmdHook(ctxOf('eng.1'));
      expect(text()).toContain("Arsenal 2–1 Chelsea (50')");
      noLeak(text(), 'hook');
    });

    it('`hook` under a nations competition off the bundle: the flags (the kind reached the hook)', () => {
      seed('uefa.nations', [albania()]);
      cmdHook(ctxOf('uefa.nations'));
      expect(text()).toContain('🇦🇱 Albania 2–1 Latvia 🇱🇻');
    });

    it('`prompt`: the club line by codes; a nation off the bundle by flags', () => {
      seed('eng.1', [live()]);
      cmdPrompt(ctxOf('eng.1'));
      expect(text()).toContain("⚽ ARS 2–1 CHE 50'");
      noLeak(text(), 'prompt');
      writes = [];
      seed('uefa.nations', [albania()]);
      cmdPrompt(ctxOf('uefa.nations'));
      expect(text()).toContain("⚽ 🇦🇱 2–1 🇱🇻 50'");
    });

    it('`vibe`: the live segment by codes in text and `--json`; by flags for a nation off the bundle', () => {
      seed('eng.1', [live()]);
      cmdVibe(ctxOf('eng.1'));
      expect(text()).toContain("ARS 2–1 CHE 50'");
      noLeak(text(), 'vibe');
      writes = [];
      cmdVibe(ctxOf('eng.1', { json: true }));
      expect(parsedOut().live).toBe("ARS 2–1 CHE 50'");
      writes = [];
      seed('uefa.nations', [albania()]);
      cmdVibe(ctxOf('uefa.nations', { json: true }));
      expect(parsedOut().live).toBe("🇦🇱 2–1 🇱🇻 50'");
    });
  });
});
