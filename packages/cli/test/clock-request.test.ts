/**
 * A command whose context carries NO clock takes the adapter's read clock
 * (core's `clockOf`: the one a test injects, the wall clock in production)
 * for the read AND the rendering: one instant per request, the same rule as
 * the MCP tools' (`packages/mcp/test/countdown-clock.test.ts`). The adapter
 * clock below is Sep 20, 2026, a day every wall clock has left behind, so a
 * lookup or a countdown that reads the wall clock answers for the wrong span
 * on every day this file runs.
 */
import { EspnAdapter, FakeMarketProvider, type ProviderAdapter } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdMatch, cmdNext } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';
import { described } from './config-of';

const ADAPTER_CLOCK = new Date('2026-09-20T15:00:00.000Z');
const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const easternDay = (iso: string) => eastern.format(new Date(iso)).replace(/-/g, '');
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
type Ev = { id: string; date: string };
function feed(events: Ev[]): ProviderAdapter {
  const side = (homeAway: string, id: string, abbreviation: string, displayName: string) => ({ homeAway, score: '0', team: { id, abbreviation, displayName } });
  const event = (e: Ev) => ({
    id: e.id,
    date: e.date,
    season: { slug: 'regular-season' },
    status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
    competitions: [{ competitors: [side('home', '364', 'LIV', 'Liverpool'), side('away', '359', 'ARS', 'Arsenal')] }],
  });
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    if (url.includes('/standings')) return json({ name: 'x', season: { year: 2026 } });
    const asked = new URL(url).searchParams.get('dates') ?? '';
    const held = (e: Ev) => (asked.length === 8 ? easternDay(e.date) === asked : asked.length === 6 ? easternDay(e.date).startsWith(asked) : false);
    return json({ leagues: [{ season: { year: 2026, displayName: '2026-27 English Premier League' } }], events: events.filter(held).map(event) });
  }) as unknown as typeof fetch;
  return new EspnAdapter({ competition: 'eng.1', fetchImpl, now: () => ADAPTER_CLOCK.getTime() }) as ProviderAdapter;
}
const IN_SPAN: Ev = { id: '41', date: '2026-09-27T14:00:00Z' }; // Sep 20 15:00Z to Sep 27 14:00Z: six days and twenty-three hours
const cfg = (over: Partial<CliConfig> = {}): CliConfig => described({ lang: 'en', tz: 'UTC', json: false, color: false, source: 'espn', competition: 'eng.1', flavor: 'off', markets: false, ...over });
// No `now` on the context: the command takes the adapter's.
const ctx = (adapter: ProviderAdapter, over: Partial<CliConfig> = {}) => ({ cfg: cfg(over), t: makeT('en'), adapter, marketProvider: new FakeMarketProvider() });

const outSpy = vi.spyOn(process.stdout, 'write');
let writes: string[] = [];
const TEAM_ENV = process.env.CLAUDINHO_TEAM;
beforeEach(() => {
  writes = [];
  delete process.env.CLAUDINHO_TEAM; // the pin case asks for the pin: the environment must name no team
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
});
afterEach(() => {
  outSpy.mockReset();
  if (TEAM_ENV === undefined) delete process.env.CLAUDINHO_TEAM;
  else process.env.CLAUDINHO_TEAM = TEAM_ENV;
});
const text = () => writes.join('');

describe("a command whose context carries no clock takes the adapter's read clock", () => {
  it("next: the fixture is found in the adapter clock's span and its countdown counts from that clock", async () => {
    await cmdNext('Arsenal', ctx(feed([IN_SPAN])));
    expect(text()).toContain('Liverpool');
    expect(text()).toContain('in 6d23h');
  });

  it("next with no argument, the pinned team: the pin's branch takes the adapter's clock too", async () => {
    await cmdNext(undefined, ctx(feed([IN_SPAN]), { pin: { id: 'espn:359', code: 'ARS', name: 'Arsenal' } }));
    expect(text()).toContain('Liverpool');
    expect(text()).toContain('in 6d23h');
  });

  it("match <id>: the record is found in the adapter clock's span (the rule `match` kept all along)", async () => {
    await cmdMatch('41', ctx(feed([IN_SPAN])));
    expect(text()).toContain('Liverpool vs Arsenal');
  });
});
