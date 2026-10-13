/**
 * MCP `get_match`: the match's goals and cards. The text prints the same rows the CLI's `match` prints (core's
 * `timelineRows`), after the match line; `data.match.events` carries the sealed events (with their `side`), and the
 * output schema still holds strictly at the top level.
 */
import { EspnAdapter, type ProviderAdapter } from '@claudinho/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v3';
import { OUTPUT_SCHEMAS } from '../src/server';
import { toolGetMatch } from '../src/tools';

const NOW = new Date('2026-10-10T15:00:00.000Z');
const S2026 = { year: 2026, displayName: '2026-27 English Premier League', startDate: '2026-08-01T04:00Z', endDate: '2027-05-30T03:59Z' };
const NEW = { id: '361', abbreviation: 'NEW', displayName: 'Newcastle United' };
const BOU = { id: '349', abbreviation: 'BOU', displayName: 'AFC Bournemouth' };
const FLAGS = { scoringPlay: false, yellowCard: false, redCard: false, penaltyKick: false, ownGoal: false, shootout: false };
const det = (dv: string, team: { id: string }, flags: Partial<typeof FLAGS>, athlete?: { name: string; team: { id: string } }) => ({
  type: { id: '0', text: 'x' },
  clock: { value: 0, displayValue: dv },
  team: { id: team.id },
  scoreValue: 0,
  ...FLAGS,
  ...flags,
  ...(athlete ? { athletesInvolved: [{ id: '1', displayName: athlete.name, team: athlete.team }] } : {}),
});
const finished = {
  id: '401879286',
  date: '2026-10-10T11:30Z',
  season: { slug: 'regular-season' },
  status: { type: { name: 'STATUS_FULL_TIME', state: 'post', completed: true } },
  competitions: [
    {
      venue: { fullName: "St. James' Park", address: { city: 'Newcastle-upon-Tyne', country: 'England' } },
      competitors: [
        { id: NEW.id, homeAway: 'home', score: '1', team: NEW },
        { id: BOU.id, homeAway: 'away', score: '1', team: BOU },
      ],
      details: [
        det("9'", BOU, { scoringPlay: true }, { name: 'Marcus Tavernier', team: BOU }),
        det("37'", NEW, { scoringPlay: true }, { name: 'Harvey Barnes', team: NEW }),
        det("90'+4'", BOU, { yellowCard: true }, { name: 'Adam Smith', team: BOU }),
      ],
    },
  ],
};
const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const easternDay = (iso: string) => eastern.format(new Date(iso)).replace(/-/g, '');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const adapter = (): ProviderAdapter => {
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    if (url.includes('/standings')) return json({ name: 'x', season: { year: 2026 }, seasons: [{ year: 2016 }] });
    const asked = new URL(url).searchParams.get('dates') ?? '';
    if (asked.includes('-')) return json({ code: 400 }, 400);
    const day = easternDay(finished.date);
    const hit = asked.length === 8 ? day === asked : asked.length === 6 ? day.startsWith(asked) : false;
    return json({ leagues: [{ season: S2026 }], events: hit ? [finished] : [] });
  }) as unknown as typeof fetch;
  return new EspnAdapter({ competition: 'eng.1', fetchImpl, now: () => NOW.getTime() }) as ProviderAdapter;
};

describe('get_match: the timeline', () => {
  it('the text prints the rows after the match line', async () => {
    const r = await toolGetMatch({ id: '401879286', adapter: adapter(), now: NOW, competition: 'eng.1' });
    const rows = r.text.split('\n');
    const head = rows.findIndex((l) => l.includes('Newcastle United 1–1 AFC Bournemouth'));
    expect(head).toBeGreaterThanOrEqual(0);
    const rowsWanted = ["  9'     Goal         BOU  Marcus Tavernier", "  37'    Goal         NEW  Harvey Barnes", "  90+4'  Yellow card  BOU  Adam Smith"];
    const first = rows.indexOf(rowsWanted[0]!);
    expect(first).toBeGreaterThan(head);
    expect(rows.slice(first, first + 3)).toEqual(rowsWanted);
  });
  it('Spanish kind words in the text', async () => {
    const r = await toolGetMatch({ id: '401879286', adapter: adapter(), now: NOW, competition: 'eng.1', lang: 'es' });
    expect(r.text).toContain("  90+4'  Tarjeta amarilla  BOU  Adam Smith");
  });
  it('data.match.events carries the sealed events with their side; the schema holds', async () => {
    const r = await toolGetMatch({ id: '401879286', adapter: adapter(), now: NOW, competition: 'eng.1' });
    const m = (r.data as { match: { events?: unknown[] } }).match;
    expect(m.events).toEqual([
      { type: 'GOAL', minute: 9, side: 'away', teamCode: 'BOU', player: 'Marcus Tavernier' },
      { type: 'GOAL', minute: 37, side: 'home', teamCode: 'NEW', player: 'Harvey Barnes' },
      { type: 'YELLOW', minute: 90, added: 4, side: 'away', teamCode: 'BOU', player: 'Adam Smith' },
    ]);
    expect(() => z.object(OUTPUT_SCHEMAS.get_match).strict().parse(r.data)).not.toThrow();
  });
});
