/**
 * The next match day on MCP (part B2, A1): an empty `get_today` or `get_live`
 * off the bundled competition says the next day with a fixture that is on, or
 * the next kickoff ahead, in its text (no shell command: nothing in tool
 * output sends a user to a shell) and in `data` (`nextDay`, `nextKickoff` or
 * `horizon`, declared in the output schemas). Every other state answers as
 * before with no extra read; never under a cooldown; never while a match is
 * listed in play.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { EspnAdapter, type ProviderAdapter } from '@claudinho/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v3';
import { buildServer, INSTRUCTIONS, OUTPUT_SCHEMAS } from '../src/server';
import { toolGetLive, toolGetToday } from '../src/tools';

const NOW = new Date('2026-11-11T05:40:00.000Z');
const LA = 'America/Los_Angeles';
type Season = { year: number; displayName: string; startDate?: string; endDate?: string };
const S2026: Season = { year: 2026, displayName: '2026-27 English Premier League', startDate: '2026-08-01T04:00Z', endDate: '2027-05-30T03:59Z' };
const ENDED: Season = { year: 2024, displayName: '2024 European Championship', startDate: '2024-06-14T04:00Z', endDate: '2024-07-31T03:59Z' };
type Ev = { id: string; date: string; status?: 'pre' | 'in' | 'post' | 'postponed'; broken?: true };
const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const easternDay = (iso: string) => eastern.format(new Date(iso)).replace(/-/g, '');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const side = (id: string, abbr: string, name: string, homeAway: string) => ({ homeAway, score: '0', team: { id, abbreviation: abbr, displayName: name } });
function event(e: Ev) {
  const s = e.status ?? 'pre';
  const type =
    s === 'in' ? { name: 'STATUS_IN_PROGRESS', state: 'in' }
    : s === 'post' ? { name: 'STATUS_FULL_TIME', state: 'post' }
    : s === 'postponed' ? { name: 'STATUS_POSTPONED', state: 'post' }
    : { name: 'STATUS_SCHEDULED', state: 'pre' };
  return { id: e.id, date: e.date, season: { slug: 'regular-season' }, status: { type: e.broken ? { name: 'STATUS_NEW', state: 'limbo' } : type, displayClock: s === 'in' ? "55'" : undefined, period: s === 'in' ? 2 : 0 }, competitions: [{ competitors: [side('359', 'ARS', 'Arsenal', 'home'), side('363', 'CHE', 'Chelsea', 'away')] }] };
}
interface FeedOpts { season?: Season; fail?: (dates: string) => Response | undefined; competition?: string }
function feed(events: Ev[], opts: FeedOpts = {}) {
  const urls: string[] = [];
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    urls.push(url);
    const asked = new URL(url).searchParams.get('dates') ?? '';
    const failure = opts.fail?.(asked);
    if (failure) return failure;
    if (asked.includes('-')) return json({ code: 400 }, 400);
    const inBucket = (e: Ev) => (asked.length === 8 ? easternDay(e.date) === asked : asked.length === 6 ? easternDay(e.date).startsWith(asked) : false);
    return json({ leagues: [{ season: opts.season ?? S2026 }], events: events.filter(inBucket).map(event) });
  }) as unknown as typeof fetch;
  return { adapter: new EspnAdapter({ competition: opts.competition ?? 'eng.1', fetchImpl, now: () => NOW.getTime() }) as ProviderAdapter, urls };
}
const months = (urls: string[]) => urls.filter((u) => (new URL(u).searchParams.get('dates') ?? '').length === 6);
const BREAK: Ev[] = [
  { id: '9', date: '2026-11-09T20:00:00Z', status: 'post' },
  { id: '15', date: '2026-11-15T15:00:00Z', status: 'postponed' },
  { id: '21', date: '2026-11-21T12:30:00Z' },
  { id: '22', date: '2026-11-21T15:00:00Z' },
  { id: '23', date: '2026-11-21T17:30:00Z' },
  { id: '24', date: '2026-11-22T05:00:00Z' },
];
const competitionOf = (a: ProviderAdapter) => (a.competition === 'eng.1' ? 'premier-league' : a.competition === 'uefa.euro' ? 'euro' : 'world-cup');
const today = (a: ProviderAdapter, over: Record<string, unknown> = {}) => toolGetToday({ tz: LA, adapter: a, now: NOW, competition: competitionOf(a), ...over } as never);
const live = (a: ProviderAdapter, over: Record<string, unknown> = {}) => toolGetLive({ tz: LA, adapter: a, now: NOW, competition: competitionOf(a), ...over } as never);
const strict = (tool: 'get_today' | 'get_live', data: unknown) => {
  const res = z.object(OUTPUT_SCHEMAS[tool]).strict().safeParse(data);
  expect(res.success, JSON.stringify(res.success ? '' : res.error.issues)).toBe(true);
};
const POINTER_KEYS = ['nextDay', 'nextKickoff', 'horizon'];
const POINTER_WORDS = /Next match day|Next kickoff|Nothing scheduled in the next/;
const SHELL = /claudinho today|See them|See it|See that day/;
type Res = { text: string; data: Record<string, unknown> };

describe('get_today', () => {
  it('state a: the next match day in the text (no shell command) and in data; the schema holds', async () => {
    const { adapter, urls } = feed(BREAK);
    const r = (await today(adapter)) as unknown as Res;
    const t = r.text;
    expect(t).toContain('Next match day: Sat 2026-11-21, 4 matches.');
    expect(t.indexOf('No matches scheduled for this date.')).toBeGreaterThanOrEqual(0);
    expect(t.indexOf('No matches scheduled for this date.')).toBeLessThan(t.indexOf('Next match day'));
    expect(t).not.toMatch(SHELL);
    expect(r.data.nextDay).toEqual({ date: '2026-11-21', count: 4 });
    expect(r.data).not.toHaveProperty('horizon');
    strict('get_today', r.data);
    expect(months(urls)).toHaveLength(1);
  });

  it('in Spanish', async () => {
    const r = (await today(feed(BREAK).adapter, { lang: 'es' })) as unknown as Res;
    expect(r.text).toContain('Próximo día con partidos: sáb 2026-11-21, 4 partidos.');
  });

  it('state b: the horizon', async () => {
    const r = (await today(feed([{ id: '28', date: '2026-11-28T15:00:00Z' }]).adapter)) as unknown as Res;
    expect(r.text).toContain('Nothing scheduled in the next 14 days.');
    expect(r.data.horizon).toEqual({ days: 14 });
    expect(r.data).not.toHaveProperty('nextDay');
    strict('get_today', r.data);
  });

  for (const [label, events, opts] of [
    ['between editions', [], { season: ENDED, competition: 'uefa.euro' }],
    ['the provider unreachable', BREAK, { fail: () => json({}, 500) }],
    ['a read not whole', [...BREAK, { id: '31', date: '2026-11-11T02:00:00Z', broken: true }], {}],
    ['the bundled World Cup', [], { competition: 'fifa.world' }],
    ['a body that is not empty', [...BREAK, { id: '7', date: '2026-11-10T20:00:00Z' }], {}],
    ['the schedule ahead not whole', [...BREAK, { id: '30', date: '2026-11-19T15:00:00Z', broken: true }], {}],
  ] as Array<[string, Ev[], FeedOpts]>) {
    it(`${label}: as before, no pointer in text or data, and the schema holds`, async () => {
      const { adapter, urls } = feed(events, opts);
      const r = (await today(adapter)) as unknown as Res;
      expect(r.text).not.toMatch(POINTER_WORDS);
      for (const k of POINTER_KEYS) expect(r.data, k).not.toHaveProperty(k);
      strict('get_today', r.data);
      if (label !== 'the schedule ahead not whole') expect(months(urls)).toHaveLength(0);
    });
  }

  it('a cooldown armed after today\'s read: the schedule ahead is not asked', async () => {
    const { adapter, urls } = feed(BREAK);
    const read = adapter.fetchWindow?.bind(adapter);
    adapter.fetchWindow = async (...args: Parameters<NonNullable<ProviderAdapter['fetchWindow']>>) => {
      const got = await (read as NonNullable<typeof read>)(...args);
      adapter.armCooldown?.(NOW.getTime() + 300_000);
      return got;
    };
    const r = (await today(adapter)) as unknown as Res;
    expect(months(urls)).toHaveLength(0);
    expect(r.data).not.toHaveProperty('nextDay');
  });
});

describe('get_live: next is not now', () => {
  it('state a: the next kickoff ahead, with its countdown; no shell command', async () => {
    const r = (await live(feed(BREAK).adapter)) as unknown as Res;
    expect(r.text).toContain('Next kickoff: Sat 2026-11-21 04:30, in 10d6h.');
    expect(r.text).not.toMatch(SHELL);
    expect(r.data.nextKickoff).toBe('2026-11-21T12:30:00.000Z');
    strict('get_live', r.data);
  });

  it('the horizon', async () => {
    const r = (await live(feed([{ id: '28', date: '2026-11-28T15:00:00Z' }]).adapter)) as unknown as Res;
    expect(r.data.horizon).toEqual({ days: 14 });
    strict('get_live', r.data);
  });

  it('a match listed in play: no nextKickoff, no extra read', async () => {
    const { adapter, urls } = feed([...BREAK, { id: '6', date: '2026-11-11T05:00:00Z', status: 'in' }]);
    const r = (await live(adapter)) as unknown as Res;
    expect((r.data.matches as unknown[]).length).toBe(1);
    for (const k of POINTER_KEYS) expect(r.data, k).not.toHaveProperty(k);
    expect(r.text).not.toMatch(POINTER_WORDS);
    expect(months(urls)).toHaveLength(0);
  });

  it('degraded, a read not whole, the bundled World Cup: as before, no extra read, the schema holds', async () => {
    for (const [events, opts] of [
      [BREAK, { fail: () => json({}, 500) }],
      [[...BREAK, { id: '31', date: '2026-11-11T02:00:00Z', broken: true }], {}],
      [[], { competition: 'fifa.world' }],
    ] as Array<[Ev[], FeedOpts]>) {
      const { adapter, urls } = feed(events, opts);
      const r = (await live(adapter)) as unknown as Res;
      for (const k of POINTER_KEYS) expect(r.data, k).not.toHaveProperty(k);
      expect(months(urls)).toHaveLength(0);
      strict('get_live', r.data);
    }
  });
});

describe('what an agent reads about it', () => {
  it('the tool descriptions name the fields; the instructions say a next kickoff is never a match in play', async () => {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const server = buildServer();
    await server.connect(serverT);
    const client = new Client({ name: 'next-match-day', version: '0.0.0' });
    await client.connect(clientT);
    try {
      const { tools } = await client.listTools();
      expect(tools.find((t) => t.name === 'get_today')?.description ?? '').toContain('nextDay');
      expect(tools.find((t) => t.name === 'get_live')?.description ?? '').toContain('nextKickoff');
    } finally {
      await client.close();
      await server.close();
    }
    expect(INSTRUCTIONS).toContain('never a match in play now');
  });
});
