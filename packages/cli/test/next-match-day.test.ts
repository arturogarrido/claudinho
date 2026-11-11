/**
 * The next match day on the CLI (part B2, A1): an empty `today` or `live` off
 * the bundled competition says the next local day with a fixture that is on,
 * its count and the command to see it (for `live`, the next kickoff and its
 * countdown), or the horizon when nothing is on in the span read; `--json`
 * carries `nextDay`, `nextKickoff` or `horizon` as plain fields. Every other
 * state prints what it printed before and makes no extra read. The read is the
 * cache's schedule slice when it is fresh (written on the request's provider
 * day, within the discovery TTL) and whole, else the schedule ahead, never under
 * a cooldown; a throttle it meets is persisted like any other read's, and it
 * never writes the slice.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { EspnAdapter, getScheduleAhead, type ProviderAdapter, selectedCompetition } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CACHE_VERSION, cacheDir, cachePath, readBackoffNote, readState, writeBackoffNote, writeState } from '../src/cache';
import { cmdLive, cmdToday } from '../src/commands';
import { type CliConfig, resolveConfig } from '../src/config';
import { applyDiscovery, scheduleGateOpen, scheduleView } from '../src/scheduleSlice';
import { makeT } from '../src/i18n';
import { described } from './config-of';

const NOW = new Date('2026-11-11T05:40:00.000Z'); // Tue Nov 10 21:40 in Los Angeles
const LA = 'America/Los_Angeles';
const TOKYO = 'Asia/Tokyo';
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
interface FeedOpts { season?: Season; fail?: (dates: string) => Response | undefined; competition?: string; now?: Date; month?: Ev[] }
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
    // A month asked can be served other records than the day reads (a status that moved between the two reads).
    const served = asked.length === 6 && opts.month ? opts.month : events;
    return json({ leagues: [{ season: opts.season ?? S2026 }], events: served.filter(inBucket).map(event) });
  }) as unknown as typeof fetch;
  const at = (opts.now ?? NOW).getTime();
  return { adapter: new EspnAdapter({ competition: opts.competition ?? 'eng.1', fetchImpl, now: () => at }) as ProviderAdapter, urls };
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

function ctxOf(adapter: ProviderAdapter, over: Partial<CliConfig> & { flag?: boolean } = {}) {
  const { flag = true, ...rest } = over;
  const competition = adapter.competition;
  const cfg = described({
    lang: 'en', tz: LA, json: false, color: false, source: 'espn', competition, flavor: 'off', markets: false,
    selection: selectedCompetition(competition, flag ? 'flag' : 'saved'),
    ...rest,
  } as CliConfig);
  return { cfg, t: makeT(cfg.lang), adapter, now: NOW, marketProvider: undefined };
}

const outSpy = vi.spyOn(process.stdout, 'write');
let writes: string[] = [];
beforeEach(() => {
  rmSync(cacheDir(), { recursive: true, force: true });
  writes = [];
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
});
afterEach(() => outSpy.mockReset());
const text = () => writes.join('');
const lines = () => text().split('\n').map((l) => l.trimEnd());
const parsed = () => JSON.parse(text()) as Record<string, unknown>;
/** The lines in this order, each right after the one before it. */
function consecutive(...want: string[]) {
  const all = lines();
  const at = all.indexOf(want[0] ?? '');
  expect(at, `${want[0]} in:\n${text()}`).toBeGreaterThanOrEqual(0);
  for (const [i, w] of want.entries()) expect(all[at + i], text()).toBe(w);
}
const POINTER_WORDS = /Next match day|Next kickoff|Nothing scheduled in the next|See them|See it|See that day/;
const POINTER_KEYS = ['nextDay', 'nextKickoff', 'horizon'];

describe('today: the next match day (state a)', () => {
  it('Los Angeles, chosen by the flag: the day, its count, the command that repeats the flag', async () => {
    const { adapter, urls } = feed(BREAK);
    await cmdToday(undefined, ctxOf(adapter));
    consecutive(
      '  No matches scheduled for this date.',
      '  Next match day: Sat 2026-11-21, 4 matches.',
      '  See them: claudinho today 2026-11-21 --competition premier-league',
    );
    expect(months(urls)).toHaveLength(1);
  });

  it('a saved choice: the command names no competition', async () => {
    const { adapter } = feed(BREAK);
    await cmdToday(undefined, ctxOf(adapter, { flag: false }));
    consecutive('  Next match day: Sat 2026-11-21, 4 matches.', '  See them: claudinho today 2026-11-21');
  });

  it('Tokyo, the zone given by the flag: one fixture that day, and the command repeats --tz', async () => {
    const { adapter } = feed(BREAK);
    await cmdToday(undefined, ctxOf(adapter, { tz: TOKYO, tzFromFlag: true }));
    consecutive(
      '  No matches scheduled for this date.',
      '  Next match day: Sat 2026-11-21, 1 match.',
      '  See it: claudinho today 2026-11-21 --competition premier-league --tz Asia/Tokyo',
    );
  });

  it('a zone from the environment, not the flag: no --tz in the command', async () => {
    const { adapter } = feed(BREAK);
    await cmdToday(undefined, ctxOf(adapter, { tz: TOKYO }));
    consecutive('  Next match day: Sat 2026-11-21, 1 match.', '  See it: claudinho today 2026-11-21 --competition premier-league');
  });

  it('resolveConfig says whether the flag set the zone', () => {
    const saved = process.env.CLAUDINHO_TZ;
    try {
      delete process.env.CLAUDINHO_TZ;
      expect(resolveConfig({ tz: TOKYO, color: false, source: 'espn', flavor: 'off', markets: false }).tzFromFlag).toBe(true);
      process.env.CLAUDINHO_TZ = TOKYO;
      expect(resolveConfig({ color: false, source: 'espn', flavor: 'off', markets: false }).tzFromFlag).not.toBe(true);
    } finally {
      if (saved === undefined) delete process.env.CLAUDINHO_TZ;
      else process.env.CLAUDINHO_TZ = saved;
    }
  });

  it('in Spanish', async () => {
    const { adapter } = feed(BREAK);
    await cmdToday(undefined, ctxOf(adapter, { lang: 'es' }));
    consecutive('  Próximo día con partidos: sáb 2026-11-21, 4 partidos.', '  Para verlos: claudinho today 2026-11-21 --competition premier-league');
  });

  it('another day asked: the next day after it', async () => {
    const { adapter } = feed(BREAK);
    await cmdToday('2026-11-14', ctxOf(adapter));
    consecutive('  Next match day: Sat 2026-11-21, 4 matches.', '  See them: claudinho today 2026-11-21 --competition premier-league');
  });

  it('--json: nextDay, a plain field beside the others, and no horizon', async () => {
    const { adapter } = feed(BREAK);
    await cmdToday(undefined, ctxOf(adapter, { json: true }));
    const out = parsed();
    expect(out.nextDay).toEqual({ date: '2026-11-21', count: 4 });
    expect(out).not.toHaveProperty('horizon');
    expect(out).not.toHaveProperty('partial');
    expect(out.degraded).toBe(false);
  });
});

describe('today: nothing within the span (state b)', () => {
  it('the horizon sentence after the empty one; --json carries horizon', async () => {
    const { adapter } = feed([{ id: '28', date: '2026-11-28T15:00:00Z' }]);
    await cmdToday(undefined, ctxOf(adapter));
    consecutive('  No matches scheduled for this date.', '  Nothing scheduled in the next 14 days.');
    expect(text()).not.toMatch(/See them|See it/);
    writes = [];
    await cmdToday(undefined, ctxOf(feed([{ id: '28', date: '2026-11-28T15:00:00Z' }]).adapter, { json: true }));
    expect(parsed().horizon).toEqual({ days: 14 });
    expect(parsed()).not.toHaveProperty('nextDay');
  });

  it('another day asked with nothing after it: no horizon (the sentence is about today)', async () => {
    const { adapter } = feed([{ id: '28', date: '2026-11-28T15:00:00Z' }]);
    await cmdToday('2026-11-14', ctxOf(adapter));
    expect(text()).not.toMatch(POINTER_WORDS);
  });
});

describe('today: every other state prints what it printed before, and makes no extra read', () => {
  async function noPointer(events: Ev[], opts: FeedOpts, over: Partial<CliConfig> & { flag?: boolean } = {}, date?: string) {
    for (const asJson of [false, true]) {
      writes = [];
      const { adapter, urls } = feed(events, opts);
      await cmdToday(date, ctxOf(adapter, { ...over, json: asJson }));
      expect(months(urls), text()).toHaveLength(0);
      if (asJson) for (const k of POINTER_KEYS) expect(parsed(), k).not.toHaveProperty(k);
      else expect(text()).not.toMatch(POINTER_WORDS);
    }
  }

  it('(e) between editions: the verdict stands', async () => {
    await noPointer([], { season: ENDED, competition: 'uefa.euro' });
    writes = [];
    await cmdToday(undefined, ctxOf(feed([], { season: ENDED, competition: 'uefa.euro' }).adapter));
    expect(text()).toContain('Between editions');
  });

  it('(d) the provider unreachable', async () => {
    await noPointer(BREAK, { fail: () => json({}, 500) });
  });

  it('(c) today not read whole: the "none read" sentence, no pointer', async () => {
    await noPointer([...BREAK, { id: '31', date: '2026-11-11T02:00:00Z', broken: true }], {});
    writes = [];
    await cmdToday(undefined, ctxOf(feed([...BREAK, { id: '31', date: '2026-11-11T02:00:00Z', broken: true }]).adapter));
    expect(text()).toContain('No fixture was read for 2026-11-10.');
  });

  it('(f) the bundled World Cup', async () => {
    await noPointer([], { competition: 'fifa.world' });
  });

  it('a body that is not empty', async () => {
    await noPointer([...BREAK, { id: '7', date: '2026-11-10T20:00:00Z' }], {});
  });

  it('(c2) the schedule ahead not whole: the empty sentence alone', async () => {
    const { adapter, urls } = feed([...BREAK, { id: '30', date: '2026-11-19T15:00:00Z', broken: true }]);
    await cmdToday(undefined, ctxOf(adapter));
    expect(months(urls)).toHaveLength(1);
    expect(text()).toContain('No matches scheduled for this date.');
    expect(text()).not.toMatch(POINTER_WORDS);
  });
});

describe('a day the schedule ahead cannot reach: no extra read', () => {
  it('a shown day whose next day starts before or after the span: no month request, no pointer', async () => {
    for (const day of ['2026-11-02', '2026-11-26', '2026-12-20']) {
      writes = [];
      const { adapter, urls } = feed([]);
      await cmdToday(day, ctxOf(adapter));
      expect(months(urls), day).toHaveLength(0);
      expect(text()).not.toMatch(POINTER_WORDS);
    }
  });
});

describe('the cost: the cache\'s slice when fresh and whole, else one read; never under a cooldown', () => {
  const iso = (ms: number) => new Date(ms).toISOString();
  const MIN = 60_000;
  /** A slice that says Nov 21 holds TWO fixtures (the feed says four), so a pointer from it is recognisable. */
  function seed(over: { updatedAt?: number; complete?: boolean } = {}) {
    const at = over.updatedAt ?? NOW.getTime() - 10 * MIN;
    writeState({
      version: CACHE_VERSION,
      updatedAt: iso(NOW.getTime() - 5 * MIN),
      live: [],
      degraded: false,
      source: 'espn',
      competition: 'eng.1',
      schedule: {
        index: [
          { id: '15', kickoff: '2026-11-15T15:00:00.000Z', on: false },
          { id: '21', kickoff: '2026-11-21T12:30:00.000Z', on: true },
          { id: '22', kickoff: '2026-11-21T15:00:00.000Z', on: true },
        ],
        fixtures: [],
        updatedAt: iso(at),
        attemptedAt: iso(at),
        failures: 0,
        complete: over.complete ?? true,
      },
    }, NOW.getTime());
  }

  it('a fresh, whole slice written on the request\'s provider day: no extra request; the slice is unchanged', async () => {
    seed();
    const before = readFileSync(cachePath('espn', 'eng.1'), 'utf8');
    const { adapter, urls } = feed(BREAK);
    await cmdToday(undefined, ctxOf(adapter));
    expect(months(urls)).toHaveLength(0);
    expect(text()).toContain('Next match day: Sat 2026-11-21, 2 matches.');
    expect(readFileSync(cachePath('espn', 'eng.1'), 'utf8')).toBe(before);
  });

  it('live reads the same slice', async () => {
    seed();
    const { adapter, urls } = feed(BREAK);
    await cmdLive(ctxOf(adapter));
    expect(months(urls)).toHaveLength(0);
    expect(text()).toContain('Next kickoff: Sat 2026-11-21 04:30, in 10d6h.');
  });

  for (const [label, over] of [
    ['older than the discovery TTL', { updatedAt: NOW.getTime() - 61 * MIN }],
    ['written on the provider day before (00:40 ET now, 23:50 ET then)', { updatedAt: Date.parse('2026-11-11T04:50:00.000Z') }],
    ['not whole', { complete: false }],
  ] as const) {
    it(`a slice ${label}: one read of the schedule ahead, and the slice is unchanged`, async () => {
      seed(over);
      const before = readFileSync(cachePath('espn', 'eng.1'), 'utf8');
      const { adapter, urls } = feed(BREAK);
      await cmdToday(undefined, ctxOf(adapter));
      expect(months(urls)).toHaveLength(1);
      expect(text()).toContain('Next match day: Sat 2026-11-21, 4 matches.');
      expect(readFileSync(cachePath('espn', 'eng.1'), 'utf8')).toBe(before);
    });
  }

  it('a cold cache: the read never writes a schedule slice', async () => {
    const { adapter } = feed(BREAK);
    await cmdToday(undefined, ctxOf(adapter));
    expect(readState('espn', 'eng.1')?.schedule).toBeUndefined();
  });

  it('a backoff in effect: no request at all, no pointer', async () => {
    writeBackoffNote('espn', 'eng.1', NOW.getTime() + 10 * MIN, NOW.getTime());
    const { adapter, urls } = feed(BREAK);
    await cmdToday(undefined, ctxOf(adapter));
    expect(urls).toHaveLength(0);
    expect(text()).not.toMatch(POINTER_WORDS);
  });

  it('a cooldown armed after today\'s read: the schedule ahead is not asked', async () => {
    const { adapter, urls } = feed(BREAK);
    const read = adapter.fetchWindow?.bind(adapter);
    adapter.fetchWindow = async (...args: Parameters<NonNullable<ProviderAdapter['fetchWindow']>>) => {
      const got = await (read as NonNullable<typeof read>)(...args);
      adapter.armCooldown?.(NOW.getTime() + 5 * MIN);
      return got;
    };
    await cmdToday(undefined, ctxOf(adapter));
    expect(months(urls)).toHaveLength(0);
    expect(text()).toContain('No matches scheduled for this date.');
    expect(text()).not.toMatch(POINTER_WORDS);
  });

  it('a throttle met by the extra read is persisted like any other read\'s, and no slice is written', async () => {
    const { adapter, urls } = feed(BREAK, { fail: (d) => (d.length === 6 ? json({}, 429) : undefined) });
    await cmdToday(undefined, ctxOf(adapter));
    expect(months(urls)).toHaveLength(1);
    expect(text()).toContain('No matches scheduled for this date.');
    expect(text()).not.toMatch(POINTER_WORDS);
    expect(readBackoffNote('espn', 'eng.1', NOW.getTime())).toBeGreaterThan(NOW.getTime());
    if (existsSync(cachePath('espn', 'eng.1'))) expect(readState('espn', 'eng.1')?.schedule).toBeUndefined();
  });
});

describe('live: the next kickoff, never a match now', () => {
  it('state a: the next kickoff, its countdown, the command for that day', async () => {
    const { adapter, urls } = feed(BREAK);
    await cmdLive(ctxOf(adapter));
    consecutive(
      '  No matches in play right now.',
      '  Next kickoff: Sat 2026-11-21 04:30, in 10d6h.',
      '  See that day: claudinho today 2026-11-21 --competition premier-league',
    );
    expect(months(urls)).toHaveLength(1);
  });

  it('a kickoff later the same local day: "See that day" is today\'s command, with no date', async () => {
    const { adapter } = feed([...BREAK, { id: '8', date: '2026-11-11T07:50:00Z' }]);
    await cmdLive(ctxOf(adapter));
    consecutive('  Next kickoff: Tue 2026-11-10 23:50, in 2h10m.', '  See that day: claudinho today --competition premier-league');
  });

  it('--json: nextKickoff, or the horizon', async () => {
    await cmdLive(ctxOf(feed(BREAK).adapter, { json: true }));
    expect(parsed().nextKickoff).toBe('2026-11-21T12:30:00.000Z');
    expect(parsed()).not.toHaveProperty('horizon');
    writes = [];
    await cmdLive(ctxOf(feed([{ id: '28', date: '2026-11-28T15:00:00Z' }]).adapter, { json: true }));
    expect(parsed().horizon).toEqual({ days: 14 });
    expect(parsed()).not.toHaveProperty('nextKickoff');
  });

  it('a match in play is listed, and nothing points ahead: no extra read, no nextKickoff', async () => {
    for (const asJson of [false, true]) {
      writes = [];
      const { adapter, urls } = feed([...BREAK, { id: '6', date: '2026-11-11T05:00:00Z', status: 'in' }]);
      await cmdLive(ctxOf(adapter, { json: asJson }));
      expect(months(urls)).toHaveLength(0);
      if (asJson) {
        expect((parsed().matches as unknown[]).length).toBe(1);
        expect(parsed()).not.toHaveProperty('nextKickoff');
      } else expect(text()).not.toMatch(POINTER_WORDS);
    }
  });

  it('the provider unreachable, a read not whole, the bundled World Cup: as before, no extra read', async () => {
    for (const [events, opts] of [
      [BREAK, { fail: () => json({}, 500) }],
      [[...BREAK, { id: '31', date: '2026-11-11T02:00:00Z', broken: true }], {}],
      [[], { competition: 'fifa.world' }],
    ] as Array<[Ev[], FeedOpts]>) {
      for (const asJson of [false, true]) {
        writes = [];
        const { adapter, urls } = feed(events, opts);
        await cmdLive(ctxOf(adapter, { json: asJson }));
        expect(months(urls)).toHaveLength(0);
        if (asJson) for (const k of POINTER_KEYS) expect(parsed(), k).not.toHaveProperty(k);
        else expect(text()).not.toMatch(POINTER_WORDS);
      }
    }
  });
});

/**
 * Round 1 on B2. Each case below was a reader's finding:
 *   - next is not now: the schedule ahead holding a match in play, or a
 *     fixture that is on inside its live window, says nothing extra (the
 *     window is the refresher's gate, pinned here against `scheduleGateOpen`);
 *   - the slice covers only what the refresher kept (it drops fixtures more
 *     than 6 hours old): a day it cannot vouch for is one fresh read, so the
 *     answer is the same warm or cold;
 *   - a slice whose index lost an entry when read back (malformed, a repeated
 *     id, one past the horizon) is not whole: one fresh read;
 *   - a backoff another process wrote after this command started stops the
 *     extra read;
 *   - the TTL alone (same provider day) makes a slice stale.
 */
describe('round 1 on B2', () => {
  const MIN = 60_000;
  const iso = (ms: number) => new Date(ms).toISOString();
  const ctxAt = (adapter: ProviderAdapter, now: Date, over: Partial<CliConfig> = {}) => ({ ...ctxOf(adapter, over), now });
  function seedSlice(schedule: Record<string, unknown>, now = NOW) {
    writeState({
      version: CACHE_VERSION,
      updatedAt: iso(now.getTime() - 5 * MIN),
      live: [],
      degraded: false,
      source: 'espn',
      competition: 'eng.1',
      schedule: { fixtures: [], failures: 0, complete: true, ...schedule },
    }, now.getTime());
  }
  const fresh = (now = NOW) => ({ updatedAt: iso(now.getTime() - 10 * MIN), attemptedAt: iso(now.getTime() - 10 * MIN) });
  /** Writes the note inside the day's read: another process's throttle, recorded after this command's adapter was armed. */
  function noteDuringTheDayRead(adapter: ProviderAdapter) {
    const read = adapter.fetchWindow?.bind(adapter) as NonNullable<ProviderAdapter['fetchWindow']>;
    adapter.fetchWindow = async (...args: Parameters<NonNullable<ProviderAdapter['fetchWindow']>>) => {
      const got = await read(...args);
      writeBackoffNote('espn', 'eng.1', NOW.getTime() + 5 * MIN, NOW.getTime());
      return got;
    };
  }

  describe('live: next is not now', () => {
    it('the month read holds the match in progress (a request crossing kickoff): no pointer, text and --json', async () => {
      const soon = iso(NOW.getTime() + 3_000);
      for (const asJson of [false, true]) {
        writes = [];
        const { adapter, urls } = feed([...BREAK, { id: '5', date: soon }], { month: [...BREAK, { id: '5', date: soon, status: 'in' }] });
        await cmdLive(ctxOf(adapter, { json: asJson }));
        expect(months(urls)).toHaveLength(1);
        if (asJson) for (const k of POINTER_KEYS) expect(parsed(), k).not.toHaveProperty(k);
        else {
          expect(text()).toContain('No matches in play right now.');
          expect(text()).not.toMatch(POINTER_WORDS);
        }
      }
    });

    it('a fixture kicked off and still scheduled, inside its window: no pointer; past its window: the next kickoff', async () => {
      const inside = feed([...BREAK, { id: '5', date: iso(NOW.getTime() - 2 * MIN) }]);
      await cmdLive(ctxOf(inside.adapter));
      expect(text()).not.toMatch(POINTER_WORDS);
      writes = [];
      const past = feed([...BREAK, { id: '5', date: iso(NOW.getTime() - 141 * MIN) }]);
      await cmdLive(ctxOf(past.adapter));
      expect(text()).toContain('Next kickoff: Sat 2026-11-21 04:30, in 10d6h.');
    });

    it('from the slice, the pointer is withheld exactly when the refresher\'s gate is open (one rule)', async () => {
      const LATER = { id: '21', kickoff: '2026-11-21T12:30:00.000Z', on: true };
      const cases: Array<[string, Record<string, unknown>]> = [];
      for (const m of [-200, -141, -140, -139, -1, 0, 1]) {
        cases.push([`on, kickoff ${m} min`, { index: [{ id: '5', kickoff: iso(NOW.getTime() + m * MIN), on: true }, LATER] }]);
      }
      cases.push(['not on, kickoff -2 min', { index: [{ id: '5', kickoff: iso(NOW.getTime() - 2 * MIN), on: false }, LATER] }]);
      cases.push(['a match seen in play, held', { index: [LATER], inPlayUntil: iso(NOW.getTime() + 30 * MIN) }]);
      for (const [label, slice] of cases) {
        rmSync(cacheDir(), { recursive: true, force: true });
        writes = [];
        seedSlice({ ...fresh(), ...slice });
        const view = scheduleView(readState('espn', 'eng.1')?.schedule, NOW.getTime());
        const gateOpen = scheduleGateOpen(view, NOW.getTime(), { probe: false });
        const { adapter, urls } = feed(BREAK);
        await cmdLive(ctxOf(adapter));
        expect(months(urls), label).toHaveLength(0);
        expect(/Next kickoff/.test(text()), `${label}: gate ${gateOpen}\n${text()}`).toBe(!gateOpen);
      }
    });
  });

  describe('the slice covers what the refresher kept', () => {
    // Two fixtures on Tue Nov 10 in Los Angeles; the refresher, writing at 05:30Z, keeps only the later one.
    const TUE: Ev[] = [
      { id: '41', date: '2026-11-10T20:00:00Z' },
      { id: '42', date: '2026-11-11T03:00:00Z' },
    ];
    async function seedFromRefresher() {
      const writeAt = new Date(NOW.getTime() - 10 * MIN);
      const { adapter } = feed(TUE, { now: writeAt });
      const answer = await getScheduleAhead(adapter, writeAt);
      const next = applyDiscovery({ index: undefined, fixtures: [], season: undefined }, answer, writeAt.getTime());
      if (!next) throw new Error('expected a discovery');
      expect(next.index.map((e) => e.id)).toEqual(['42']);
      seedSlice({ ...next, updatedAt: iso(writeAt.getTime()), attemptedAt: iso(writeAt.getTime()) });
    }

    it('an empty past day whose next day the slice no longer holds whole: one fresh read, the same answer as cold', async () => {
      const cold = feed(TUE);
      await cmdToday('2026-11-09', ctxOf(cold.adapter));
      const coldText = text();
      expect(coldText).toContain('Next match day: Tue 2026-11-10, 2 matches.');
      rmSync(cacheDir(), { recursive: true, force: true });
      writes = [];
      await seedFromRefresher();
      const warm = feed(TUE);
      await cmdToday('2026-11-09', ctxOf(warm.adapter));
      expect(months(warm.urls)).toHaveLength(1);
      expect(text()).toBe(coldText);
    });

    it('that fresh read stops at a backoff another process wrote meanwhile', async () => {
      await seedFromRefresher();
      const { adapter, urls } = feed(TUE);
      noteDuringTheDayRead(adapter);
      await cmdToday('2026-11-09', ctxOf(adapter));
      expect(months(urls)).toHaveLength(0);
      expect(text()).not.toMatch(POINTER_WORDS);
    });

    it('live, from the same slice (a kickoff ahead needs nothing the refresher dropped): no extra request', async () => {
      await seedFromRefresher();
      const { adapter, urls } = feed(TUE);
      await cmdLive(ctxOf(adapter));
      expect(months(urls)).toHaveLength(0);
      // Fixture 42 kicked off 160 minutes ago, past its window: nothing on ahead.
      expect(text()).toContain('Nothing scheduled in the next 14 days.');
    });
  });

  describe('a slice index that lost an entry when read back is not whole', () => {
    const GOOD = [
      { id: '21', kickoff: '2026-11-21T12:30:00.000Z', on: true },
      { id: '22', kickoff: '2026-11-21T15:00:00.000Z', on: true },
    ];
    for (const [label, index] of [
      ['a malformed record', [{ id: '20', kickoff: 'NOT A DATE', on: true }, ...GOOD]],
      ['a repeated id', [...GOOD, { id: '22', kickoff: '2026-11-20T15:00:00.000Z', on: true }]],
      ['an entry past the horizon', [...GOOD, { id: '90', kickoff: '2027-03-01T15:00:00.000Z', on: true }]],
    ] as const) {
      it(`${label}: one fresh read, its answer`, async () => {
        seedSlice({ ...fresh(), index });
        const { adapter, urls } = feed(BREAK);
        await cmdToday(undefined, ctxOf(adapter));
        expect(months(urls)).toHaveLength(1);
        expect(text()).toContain('Next match day: Sat 2026-11-21, 4 matches.');
      });
    }

    it('scheduleView says it, and nothing else of the view changes', () => {
      const now = NOW.getTime();
      const whole = scheduleView({ index: GOOD, ...fresh(), failures: 0, complete: true }, now);
      expect(whole.indexIntact).toBe(true);
      for (const index of [
        [{ id: '20', kickoff: 'NOT A DATE', on: true }, ...GOOD],
        [...GOOD, { id: '22', kickoff: '2026-11-20T15:00:00.000Z', on: true }],
        [...GOOD, { id: '90', kickoff: '2027-03-01T15:00:00.000Z', on: true }],
      ]) {
        const view = scheduleView({ index, ...fresh(), failures: 0, complete: true }, now);
        expect(view.indexIntact).toBe(false);
        expect(view.complete).toBe(true);
      }
      expect(scheduleView({ ...fresh(), complete: true }, now).indexIntact).toBe(false);
    });
  });

  it('a backoff another process wrote after this command started: the extra read is not made', async () => {
    for (const run of [cmdToday.bind(null, undefined), cmdLive]) {
      rmSync(cacheDir(), { recursive: true, force: true });
      writes = [];
      const { adapter, urls } = feed(BREAK);
      noteDuringTheDayRead(adapter);
      await run(ctxOf(adapter));
      expect(months(urls)).toHaveLength(0);
      expect(text()).toMatch(/No matches (scheduled for this date|in play right now)\./);
      expect(text()).not.toMatch(POINTER_WORDS);
    }
  });

  it('a slice stale by the TTL alone (written 61 minutes earlier, the same provider day): one fresh read', async () => {
    const now = new Date('2026-11-11T20:00:00.000Z');
    seedSlice({
      index: [{ id: '21', kickoff: '2026-11-21T12:30:00.000Z', on: true }],
      updatedAt: '2026-11-11T18:59:00.000Z',
      attemptedAt: '2026-11-11T18:59:00.000Z',
    }, now);
    const { adapter, urls } = feed(BREAK, { now });
    await cmdToday(undefined, ctxAt(adapter, now));
    expect(months(urls)).toHaveLength(1);
    expect(text()).toContain('Next match day: Sat 2026-11-21, 4 matches.');
  });
});
