/**
 * 0.11 PR 2.1b — the two reads of a refresher cycle are independent at a
 * season turn (added by the coder beside the coordinator's turn cases in
 * `refresher-discovery.test.ts`).
 *
 * The live read composes across the turn and states no season; the knockout
 * read stays strict and states its own. A strict knockout read that succeeds
 * beside a mixed live read keeps its own season stamp (the snapshot's season
 * is the live response's, absent; the slice's is its own response's), and a
 * later live read whose days all state ANOTHER season drops that slice, by
 * the rule that was there before ("one season per snapshot").
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readState, writeState } from '../src/cache';
import { runRefresh } from '../src/refresh';

const SOURCE = 'espn';
const WC = 'fifa.world';
const MIN = 60_000;
/** Inside the bundle's live window and its knockout phase (the coordinator's case uses the same instant). */
const R32 = Date.parse('2026-06-28T19:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

type Season = { year: number; displayName: string };
const S2026: Season = { year: 2026, displayName: 'FIFA World Cup 2026' };
const S2027: Season = { year: 2027, displayName: 'FIFA World Cup 2027' };

/** One match in play, filed under its kickoff's US/Eastern day. */
const inPlay = (at: number) => ({
  id: '900002',
  date: iso(at),
  season: { slug: 'round-of-32' },
  status: { type: { name: 'STATUS_IN_PROGRESS', state: 'in' }, displayClock: "55'", period: 2 },
  competitions: [
    {
      competitors: [
        { homeAway: 'home', score: '1', team: { id: '227', abbreviation: 'AME', displayName: 'América' } },
        { homeAway: 'away', score: '0', team: { id: '219', abbreviation: 'GDL', displayName: 'Guadalajara' } },
      ],
    },
  ],
});
const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const easternDay = (ms: number) => eastern.format(new Date(ms)).replace(/-/g, '');
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

let season: (dates: string) => Season = () => S2026;
let asked: string[] = [];
let dir: string;
const ORIG = process.env.XDG_CACHE_HOME;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-turn-'));
  process.env.XDG_CACHE_HOME = dir;
  asked = [];
  season = () => S2026;
  vi.stubGlobal('fetch', async (input: unknown) => {
    const dates = new URL(String(input)).searchParams.get('dates') ?? '';
    asked.push(dates);
    const live = R32 - 30 * MIN;
    const inBucket = dates.length === 8 ? easternDay(live) === dates : easternDay(live).startsWith(dates);
    return json({ leagues: [{ season: season(dates) }], events: inBucket ? [inPlay(live)] : [] });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIG === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = ORIG;
  rmSync(dir, { recursive: true, force: true });
});

const refresh = (at: number) => runRefresh({ source: SOURCE, competition: WC, now: new Date(at), jitterMs: 0 });

describe('at a season turn the live read and the knockout read keep their own seasons (0.11 2.1b)', () => {
  it('a strict knockout read that succeeds beside a mixed live read keeps its stamp; a later unanimous live season drops it', async () => {
    writeState({ updatedAt: iso(R32 - MIN), live: [], degraded: false, source: SOURCE, competition: WC });
    // The knockout span's months state 2026; the live window's last day states 2027.
    season = (d) => (d === '20260629' ? S2027 : S2026);
    await refresh(R32);
    expect(asked.filter((d) => d.length === 6).sort()).toEqual(['202606', '202607']); // the knockout read was made
    expect(asked.filter((d) => d.length === 8)).toHaveLength(3); // and the live read
    const s = readState(SOURCE, WC);
    expect(s?.live.map((m) => m.id)).toEqual(['900002']);
    expect(s?.degraded).toBe(false);
    expect(s?.season).toBeUndefined(); // the live response stated two
    expect(s?.fixtures).toBeDefined();
    expect(s?.fixturesSeason).toMatchObject({ year: 2026 }); // the knockout response's own

    // A minute later every day of the live window states 2027: the snapshot's
    // season is 2027, and the slice that is known to be 2026 is dropped.
    asked = [];
    season = (d) => (d.length === 8 ? S2027 : S2026);
    await refresh(R32 + MIN);
    const after = readState(SOURCE, WC);
    expect(asked.filter((d) => d.length === 8)).toHaveLength(3);
    expect(after?.season).toMatchObject({ year: 2027 });
    expect(after?.fixtures).toBeUndefined();
    expect(after?.fixturesSeason).toBeUndefined();
  });
});
