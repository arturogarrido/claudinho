/**
 * The next match day (part B2, A1): an empty `today` or `live` off the
 * bundled competition points at the next local day with a fixture that is on
 * (not postponed, cancelled or finished), or the next kickoff ahead, from the
 * schedule ahead read WHOLE; nothing within the span it read is the horizon
 * sentence. Built once in core (`ahead.ts`, the sentences beside the horizon
 * sentences in `share/cards.ts`): the answer's own text and plain fields,
 * never a verdict, never a day it cannot vouch for. Counted in the viewer's
 * zone at the request's clock (a required parameter). The read is made only
 * when the gate says the body is empty and nothing else stands, and never
 * under a cooldown.
 */
import { describe, expect, it } from 'vitest';
import {
  type AheadRead,
  aheadFromEntries,
  dayPointer,
  EspnAdapter,
  livePointer,
  nextDayLines,
  nextKickoffLines,
  pointerExtras,
  pointerWanted,
  type ProviderAdapter,
  readAhead,
  type ScheduleEntry,
  todayCommand,
} from '../src';

const NOW = new Date('2026-11-11T05:40:00.000Z'); // Tue Nov 10 21:40 in Los Angeles, Wed Nov 11 14:40 in Tokyo
const LA = 'America/Los_Angeles';
const TOKYO = 'Asia/Tokyo';
const UTC = 'UTC';

type Ev = { id: string; date: string; status?: 'pre' | 'in' | 'post' | 'postponed' | 'cancelled'; broken?: true };
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
    : s === 'cancelled' ? { name: 'STATUS_CANCELED', state: 'post' }
    : { name: 'STATUS_SCHEDULED', state: 'pre' };
  return { id: e.id, date: e.date, season: { slug: 'regular-season' }, status: { type: e.broken ? { name: 'STATUS_NEW', state: 'limbo' } : type, period: s === 'in' ? 1 : 0 }, competitions: [{ competitors: [side('359', 'ARS', 'Arsenal', 'home'), side('363', 'CHE', 'Chelsea', 'away')] }] };
}
const SEASON = { year: 2026, displayName: '2026-27 English Premier League', startDate: '2026-08-01T04:00Z', endDate: '2027-05-30T03:59Z' };
function feed(events: Ev[], opts: { now?: Date; fail?: (dates: string) => Response | undefined } = {}) {
  const urls: string[] = [];
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    urls.push(url);
    const asked = new URL(url).searchParams.get('dates') ?? '';
    const failure = opts.fail?.(asked);
    if (failure) return failure;
    if (asked.includes('-')) return json({ code: 400 }, 400);
    const inBucket = (e: Ev) => (asked.length === 8 ? easternDay(e.date) === asked : asked.length === 6 ? easternDay(e.date).startsWith(asked) : false);
    return json({ leagues: [{ season: SEASON }], events: events.filter(inBucket).map(event) });
  }) as unknown as typeof fetch;
  const at = (opts.now ?? NOW).getTime();
  return { adapter: new EspnAdapter({ competition: 'eng.1', fetchImpl, now: () => at }) as ProviderAdapter, urls };
}
const months = (urls: string[]) => urls.filter((u) => (new URL(u).searchParams.get('dates') ?? '').length === 6);

/** The break: nothing until Saturday Nov 21, one postponed and one finished fixture before it. */
const BREAK: Ev[] = [
  { id: '9', date: '2026-11-09T20:00:00Z', status: 'post' },
  { id: '15', date: '2026-11-15T15:00:00Z', status: 'postponed' },
  { id: '16', date: '2026-11-16T15:00:00Z', status: 'cancelled' },
  { id: '21', date: '2026-11-21T12:30:00Z' }, // LA Sat 04:30 · UTC Sat 12:30 · Tokyo Sat 21:30
  { id: '22', date: '2026-11-21T15:00:00Z' }, // LA Sat 07:00 · UTC Sat · Tokyo Sun 00:00
  { id: '23', date: '2026-11-21T17:30:00Z' }, // LA Sat 09:30 · UTC Sat · Tokyo Sun 02:30
  { id: '24', date: '2026-11-22T05:00:00Z' }, // LA Sat 21:00 · UTC Sun · Tokyo Sun 14:00
];

async function aheadOf(events: Ev[], now = NOW): Promise<AheadRead> {
  const { adapter } = feed(events, { now });
  const read = await readAhead(adapter, now);
  if (!read) throw new Error('expected a whole read');
  return read;
}

describe('readAhead: the schedule ahead, read whole, or nothing', () => {
  it('one month request when the span is in one month; two when it crosses one', async () => {
    const one = feed(BREAK);
    expect(await readAhead(one.adapter, NOW)).toBeDefined();
    expect(months(one.urls)).toHaveLength(1);
    const later = new Date('2026-11-20T15:00:00.000Z');
    const two = feed(BREAK, { now: later });
    expect(await readAhead(two.adapter, later)).toBeDefined();
    expect(months(two.urls)).toHaveLength(2);
  });

  it('a cooldown in effect at the request\'s clock: no request, nothing', async () => {
    const { adapter, urls } = feed(BREAK);
    adapter.armCooldown?.(NOW.getTime() + 60_000);
    expect(await readAhead(adapter, NOW)).toBeUndefined();
    expect(urls).toHaveLength(0);
  });

  it('a failed read, a throttle, or a read that was not whole: nothing', async () => {
    expect(await readAhead(feed(BREAK, { fail: () => json({}, 500) }).adapter, NOW)).toBeUndefined();
    expect(await readAhead(feed(BREAK, { fail: () => json({}, 429) }).adapter, NOW)).toBeUndefined();
    // A record nobody can read leaves the month not whole.
    const broken = feed([...BREAK, { id: '30', date: '2026-11-19T15:00:00Z', broken: true }]);
    expect(await readAhead(broken.adapter, NOW)).toBeUndefined();
  });
});

describe('dayPointer: the next local day with a fixture that is on', () => {
  it('Los Angeles: Sat Nov 21, 4 fixtures (the postponed, cancelled and finished ones neither picked nor counted)', async () => {
    const ahead = await aheadOf(BREAK);
    expect(dayPointer(ahead, '2026-11-10', '2026-11-10', LA, NOW)).toEqual({ nextDay: { date: '2026-11-21', count: 4 } });
  });

  it('UTC: Sat Nov 21, 3; Tokyo: Sat Nov 21, 1 (the zone files every fixture)', async () => {
    const ahead = await aheadOf(BREAK);
    expect(dayPointer(ahead, '2026-11-11', '2026-11-11', UTC, NOW)).toEqual({ nextDay: { date: '2026-11-21', count: 3 } });
    expect(dayPointer(ahead, '2026-11-11', '2026-11-11', TOKYO, NOW)).toEqual({ nextDay: { date: '2026-11-21', count: 1 } });
  });

  it('a day other than today: the next day after it, never the day shown', async () => {
    const ahead = await aheadOf(BREAK);
    expect(dayPointer(ahead, '2026-11-14', '2026-11-10', LA, NOW)).toEqual({ nextDay: { date: '2026-11-21', count: 4 } });
    expect(dayPointer(ahead, '2026-11-21', '2026-11-10', LA, NOW)).toBeUndefined();
  });

  it('nothing on within the span: the horizon, for today only', async () => {
    const ahead = await aheadOf([{ id: '28', date: '2026-11-28T15:00:00Z' }]); // past the span's end (Nov 25)
    expect(dayPointer(ahead, '2026-11-10', '2026-11-10', LA, NOW)).toEqual({ horizon: { days: 14 } });
    expect(dayPointer(ahead, '2026-11-12', '2026-11-10', LA, NOW)).toBeUndefined();
  });

  it('a day that ends past the span: its date, no count; a day that starts past it: never named', async () => {
    // Nov 25 23:00Z: ET Nov 25 (the span's last day); LA Nov 25 ends after the span, UTC Nov 25 inside it.
    const ahead = await aheadOf([{ id: '25', date: '2026-11-25T23:00:00Z' }]);
    expect(dayPointer(ahead, '2026-11-10', '2026-11-10', LA, NOW)).toEqual({ nextDay: { date: '2026-11-25' } });
    expect(dayPointer(ahead, '2026-11-11', '2026-11-11', UTC, NOW)).toEqual({ nextDay: { date: '2026-11-25', count: 1 } });
    expect(dayPointer(ahead, '2026-11-11', '2026-11-11', TOKYO, NOW)).toEqual({ nextDay: { date: '2026-11-26' } });
  });

  it('a shown day before the span starts: nothing to vouch for', async () => {
    const ahead = await aheadOf(BREAK);
    expect(dayPointer(ahead, '2026-11-02', '2026-11-10', LA, NOW)).toBeUndefined();
  });
});

describe('livePointer: the next kickoff AHEAD, never a match now', () => {
  it('the earliest fixture that is on with a kickoff after now', async () => {
    const ahead = await aheadOf(BREAK);
    expect(livePointer(ahead, NOW)).toEqual({ nextKickoff: '2026-11-21T12:30:00.000Z' });
  });

  it('nothing on ahead within the span: the horizon', async () => {
    const ahead = await aheadOf([{ id: '9', date: '2026-11-09T20:00:00Z', status: 'post' }]);
    expect(livePointer(ahead, NOW)).toEqual({ horizon: { days: 14 } });
  });
});

describe('aheadFromEntries: the same rules over a stored index (the CLI\'s schedule slice)', () => {
  it('a slice written at the request\'s provider day reads as the fresh read does', async () => {
    const { adapter } = feed([]);
    const entries: ScheduleEntry[] = [
      { id: '15', kickoff: '2026-11-15T15:00:00.000Z', on: false },
      { id: '21', kickoff: '2026-11-21T12:30:00.000Z', on: true },
      { id: '22', kickoff: '2026-11-21T15:00:00.000Z', on: true },
    ];
    const ahead = aheadFromEntries(entries, adapter, new Date('2026-11-11T05:10:00.000Z'));
    expect(dayPointer(ahead, '2026-11-10', '2026-11-10', LA, NOW)).toEqual({ nextDay: { date: '2026-11-21', count: 2 } });
    expect(livePointer(ahead, NOW)).toEqual({ nextKickoff: '2026-11-21T12:30:00.000Z' });
  });
});

describe('pointerWanted: the gate asked before any extra read', () => {
  const whole = { degraded: false };
  it('an empty, whole, healthy body off the bundle: yes', () => {
    expect(pointerWanted(whole, 'eng.1', true)).toBe(true);
  });
  it('a body that is not empty, a failed read, a read not whole, a replacing verdict, the bundled competition: no', () => {
    expect(pointerWanted(whole, 'eng.1', false)).toBe(false);
    expect(pointerWanted({ ...whole, degraded: true }, 'eng.1', true)).toBe(false);
    expect(pointerWanted({ ...whole, partial: {} }, 'eng.1', true)).toBe(false);
    expect(pointerWanted({ ...whole, partial: { omitted: 2 } }, 'eng.1', true)).toBe(false);
    expect(pointerWanted({ ...whole, betweenEditions: { ended: '2024-07-30' } }, 'uefa.euro', true)).toBe(false);
    expect(pointerWanted(whole, 'fifa.world', true)).toBe(false);
  });
});

describe('the sentences: the answer\'s own text, four languages', () => {
  const cmd = 'claudinho today 2026-11-21 --competition premier-league';
  it('todayCommand repeats the flags that chose', () => {
    expect(cmd).toBe('claudinho today 2026-11-21 --competition premier-league');
    expect(todayCommand({})).toBe('claudinho today');
    expect(todayCommand({ date: '2026-11-21' })).toBe('claudinho today 2026-11-21');
    expect(todayCommand({ date: '2026-11-21', tz: 'Asia/Tokyo' })).toBe('claudinho today 2026-11-21 --tz Asia/Tokyo');
    expect(todayCommand({ competition: 'fifa.friendly', tz: 'UTC' })).toBe('claudinho today --competition fifa.friendly --tz UTC');
  });

  it('the next day, many and one, with and without the command', () => {
    expect(nextDayLines({ nextDay: { date: '2026-11-21', count: 7 } }, { lang: 'en', command: cmd })).toEqual([
      'Next match day: Sat 2026-11-21, 7 matches.',
      'See them: claudinho today 2026-11-21 --competition premier-league',
    ]);
    expect(nextDayLines({ nextDay: { date: '2026-11-21', count: 1 } }, { lang: 'en', command: 'claudinho today 2026-11-21' })).toEqual([
      'Next match day: Sat 2026-11-21, 1 match.',
      'See it: claudinho today 2026-11-21',
    ]);
    expect(nextDayLines({ nextDay: { date: '2026-11-25' } }, { lang: 'en', command: 'claudinho today 2026-11-25' })).toEqual([
      'Next match day: Wed 2026-11-25.',
      'See that day: claudinho today 2026-11-25',
    ]);
    expect(nextDayLines({ nextDay: { date: '2026-11-21', count: 7 } }, { lang: 'en' })).toEqual(['Next match day: Sat 2026-11-21, 7 matches.']);
    expect(nextDayLines({ horizon: { days: 14 } }, { lang: 'en', command: cmd })).toEqual(['Nothing scheduled in the next 14 days.']);
  });

  it('es, pt, fr', () => {
    expect(nextDayLines({ nextDay: { date: '2026-11-21', count: 7 } }, { lang: 'es', command: cmd })).toEqual([
      'Próximo día con partidos: sáb 2026-11-21, 7 partidos.',
      'Para verlos: claudinho today 2026-11-21 --competition premier-league',
    ]);
    expect(nextDayLines({ nextDay: { date: '2026-11-21', count: 1 } }, { lang: 'es', command: cmd })[0]).toBe('Próximo día con partidos: sáb 2026-11-21, 1 partido.');
    expect(nextDayLines({ nextDay: { date: '2026-11-21', count: 1 } }, { lang: 'es', command: cmd })[1]).toBe(`Para verlo: ${cmd}`);
    expect(nextDayLines({ nextDay: { date: '2026-11-21', count: 7 } }, { lang: 'pt', command: cmd })).toEqual([
      'Próximo dia com jogos: sáb. 2026-11-21, 7 jogos.',
      `Para vê-los: ${cmd}`,
    ]);
    expect(nextDayLines({ nextDay: { date: '2026-11-21', count: 1 } }, { lang: 'pt' })).toEqual(['Próximo dia com jogos: sáb. 2026-11-21, 1 jogo.']);
    expect(nextDayLines({ nextDay: { date: '2026-11-21', count: 7 } }, { lang: 'fr', command: cmd })).toEqual([
      'Prochain jour de matchs : sam. 2026-11-21, 7 matchs.',
      `Pour les voir : ${cmd}`,
    ]);
    expect(nextDayLines({ nextDay: { date: '2026-11-21', count: 1 } }, { lang: 'fr' })).toEqual(['Prochain jour de matchs : sam. 2026-11-21, 1 match.']);
    expect(nextDayLines({ horizon: { days: 14 } }, { lang: 'es' })).toEqual(['Nada programado en los próximos 14 días.']);
    expect(nextDayLines({ horizon: { days: 14 } }, { lang: 'pt' })).toEqual(['Nada marcado nos próximos 14 dias.']);
    expect(nextDayLines({ horizon: { days: 14 } }, { lang: 'fr' })).toEqual(['Rien de prévu dans les 14 prochains jours.']);
  });

  it('the next kickoff: the viewer\'s day and time, the countdown at the request\'s clock', () => {
    const p = { nextKickoff: '2026-11-21T12:30:00.000Z' } as const;
    expect(nextKickoffLines(p, { lang: 'en', tz: LA, now: NOW, command: cmd })).toEqual([
      'Next kickoff: Sat 2026-11-21 04:30, in 10d6h.',
      `See that day: ${cmd}`,
    ]);
    expect(nextKickoffLines(p, { lang: 'en', tz: TOKYO, now: NOW })).toEqual(['Next kickoff: Sat 2026-11-21 21:30, in 10d6h.']);
    expect(nextKickoffLines(p, { lang: 'es', tz: LA, now: NOW })).toEqual(['Próximo partido: sáb 2026-11-21 04:30, en 10d6h.']);
    expect(nextKickoffLines(p, { lang: 'pt', tz: LA, now: NOW })).toEqual(['Próximo jogo: sáb. 2026-11-21 04:30, em 10d6h.']);
    expect(nextKickoffLines(p, { lang: 'fr', tz: LA, now: NOW })).toEqual(['Prochain coup d’envoi : sam. 2026-11-21 04:30, dans 10d6h.']);
    // Later the same local day: "See that day" is today's command, with no date.
    expect(nextKickoffLines({ nextKickoff: '2026-11-11T07:50:00.000Z' }, { lang: 'en', tz: LA, now: NOW, command: 'claudinho today' })).toEqual([
      'Next kickoff: Tue 2026-11-10 23:50, in 2h10m.',
      'See that day: claudinho today',
    ]);
    expect(nextKickoffLines({ horizon: { days: 14 } }, { lang: 'en', tz: LA, now: NOW })).toEqual(['Nothing scheduled in the next 14 days.']);
  });

  it('pointerExtras: the plain fields every structured answer carries, and nothing without a pointer', () => {
    expect(pointerExtras({ nextDay: { date: '2026-11-21', count: 4 } })).toEqual({ nextDay: { date: '2026-11-21', count: 4 } });
    expect(pointerExtras({ nextDay: { date: '2026-11-25' } })).toEqual({ nextDay: { date: '2026-11-25' } });
    expect(pointerExtras({ nextKickoff: '2026-11-21T12:30:00.000Z' })).toEqual({ nextKickoff: '2026-11-21T12:30:00.000Z' });
    expect(pointerExtras({ horizon: { days: 14 } })).toEqual({ horizon: { days: 14 } });
    expect(pointerExtras(undefined)).toEqual({});
  });
});

/**
 * Round 1 on B2: "next is not now". When the schedule ahead itself holds a
 * match in play, or a fixture that is on inside its live window (kicked off,
 * still marked scheduled), the live list and the schedule disagree about now:
 * an empty `live` says nothing extra (no next kickoff, no horizon). The window
 * is the refresher's own rule (`LIVE_WINDOW_MS` from kickoff, whatever the
 * stage), not a copy: the CLI's slice test pins the two against each other.
 */
describe('livePointer: nothing extra while the schedule ahead may hold a match now', () => {
  const MIN = 60_000;
  const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();
  const read = (entries: ScheduleEntry[], inPlay = false): AheadRead => ({
    entries,
    from: '2026-11-10T05:00:00.000Z',
    to: '2026-11-26T05:00:00.000Z',
    inPlay,
  });
  const LATER: ScheduleEntry = { id: '21', kickoff: '2026-11-21T12:30:00.000Z', on: true };

  it('the read holds a match in play (a request crossing kickoff): no pointer', () => {
    expect(livePointer(read([{ id: '5', kickoff: at(3_000), on: true }, LATER], true), NOW)).toBeUndefined();
  });

  it('readAhead says so: a month response holding the match in progress', async () => {
    const { adapter } = feed([...BREAK, { id: '5', date: at(-30 * MIN), status: 'in' }]);
    const got = await readAhead(adapter, NOW);
    expect(got?.inPlay).toBe(true);
    expect(got && livePointer(got, NOW)).toBeUndefined();
    const calm = await readAhead(feed(BREAK).adapter, NOW);
    expect(calm?.inPlay).toBe(false);
  });

  it('a fixture that is on, kicked off and still scheduled, inside its window: no pointer, even with a later one', () => {
    expect(livePointer(read([{ id: '5', kickoff: at(-2 * MIN), on: true }, LATER]), NOW)).toBeUndefined();
    expect(livePointer(read([{ id: '5', kickoff: at(-139 * MIN), on: true }, LATER]), NOW)).toBeUndefined();
  });

  it('a kickoff exactly at now is a match now, never the next one', () => {
    expect(livePointer(read([{ id: '5', kickoff: at(0), on: true }, LATER]), NOW)).toBeUndefined();
  });

  it('one past its window, or one that is not on, does not withhold the pointer', () => {
    expect(livePointer(read([{ id: '5', kickoff: at(-141 * MIN), on: true }, LATER]), NOW)).toEqual({ nextKickoff: LATER.kickoff });
    expect(livePointer(read([{ id: '5', kickoff: at(-2 * MIN), on: false }, LATER]), NOW)).toEqual({ nextKickoff: LATER.kickoff });
    expect(livePointer(read([{ id: '5', kickoff: at(-141 * MIN), on: true }]), NOW)).toEqual({ horizon: { days: 14 } });
  });
});

describe('round 1 on B2: the gaps the mutants found', () => {
  it('the count leaves out a fixture that is not on, on the day it names', () => {
    const ahead: AheadRead = {
      entries: [
        { id: '21', kickoff: '2026-11-21T12:30:00.000Z', on: true },
        { id: '22', kickoff: '2026-11-21T15:00:00.000Z', on: false },
      ],
      from: '2026-11-10T05:00:00.000Z',
      to: '2026-11-26T05:00:00.000Z',
      inPlay: false,
    };
    expect(dayPointer(ahead, '2026-11-10', '2026-11-10', LA, NOW)).toEqual({ nextDay: { date: '2026-11-21', count: 1 } });
  });

  it('readAhead asks nothing under the adapter\'s cooldown, by its own guard (an adapter that would answer)', async () => {
    const { adapter } = feed(BREAK);
    let asked = 0;
    const plain: ProviderAdapter = {
      ...adapter,
      competition: adapter.competition,
      bucketDay: adapter.bucketDay?.bind(adapter),
      cooldownUntil: NOW.getTime() + 60_000,
      fetchWindow: async (...args: Parameters<NonNullable<ProviderAdapter['fetchWindow']>>) => {
        asked++;
        return (adapter.fetchWindow as NonNullable<ProviderAdapter['fetchWindow']>).call(adapter, ...args);
      },
    } as ProviderAdapter;
    expect(await readAhead(plain, NOW)).toBeUndefined();
    expect(asked).toBe(0);
  });
});
