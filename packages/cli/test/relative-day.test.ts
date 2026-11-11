/**
 * A day by name on the commands that take one (`today`, `share <date>`,
 * `markets <date>`), and the date a single match says when it is far
 * (`next`, `match <id>`). The request's clock is PINNED on the context (Tue Nov
 * 10, 2026, 9:40 PM in Los Angeles), and the adapter's clock is a different
 * day, so a day counted from either the wall clock or the adapter's clock is
 * red here.
 */
import { allFixtures, EspnAdapter, FakeMarketProvider, type Match, type ProviderAdapter } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cmdMarkets, cmdMatch, cmdNext, cmdShare, cmdToday, InputError } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';
import { described } from './config-of';

/** The request's clock: Tue Nov 10, 2026, 21:40 PST; Wed Nov 11, 05:40 UTC; Wed Nov 11, 14:40 in Tokyo. */
const NOW = new Date('2026-11-11T05:40:00.000Z');
/** The adapter's own clock, a week earlier: a day counted from it is wrong. */
const ADAPTER_CLOCK = new Date('2026-11-04T05:40:00.000Z');
const LA = 'America/Los_Angeles';

const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const easternDay = (iso: string) => eastern.format(new Date(iso)).replace(/-/g, '');
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
type Ev = { id: string; date: string; home: [string, string, string]; final?: boolean };

const WED: Ev = { id: '501', date: '2026-11-11T20:00:00Z', home: ['364', 'LIV', 'Liverpool'] }; // Wed 12:00 LA
const SAT: Ev = { id: '502', date: '2026-11-14T15:00:00Z', home: ['363', 'CHE', 'Chelsea'] }; // Sat Nov 14, 07:00 LA
const FAR: Ev = { id: '503', date: '2026-11-21T17:30:00Z', home: ['361', 'NEW', 'Newcastle United'] }; // Sat Nov 21, 09:30 LA
/** Tue Nov 17, 15:00 LA (7 calendar days); Tue Nov 17, 23:00 UTC (6 calendar days from Wed Nov 11). */
const ZONED: Ev = { id: '504', date: '2026-11-17T23:00:00Z', home: ['362', 'TOT', 'Tottenham Hotspur'] };
/** Played: Tue Nov 3, 12:00 LA, 7 calendar days back. */
const WEEK_AGO: Ev = { id: '505', date: '2026-11-03T20:00:00Z', home: ['367', 'BRE', 'Brentford'], final: true };

let fetches = 0;
/** An adapter that reaches nothing: every read fails, as offline. */
function offline(): ProviderAdapter {
  const fail = async (): Promise<never> => {
    throw new Error('offline');
  };
  return { name: 'espn', competition: 'fifa.world', capabilities: { push: false, latencyHintSec: 0 }, fetchByDate: fail, fetchLive: fail, fetchWindow: fail };
}
function feed(events: Ev[]): ProviderAdapter {
  const side = (homeAway: string, id: string, abbreviation: string, displayName: string) => ({ homeAway, score: '0', team: { id, abbreviation, displayName } });
  const event = (e: Ev) => ({
    id: e.id,
    date: e.date,
    season: { slug: 'regular-season' },
    status: e.final ? { type: { name: 'STATUS_FULL_TIME', state: 'post', completed: true } } : { type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
    competitions: [{ competitors: [side('home', ...e.home), side('away', '359', 'ARS', 'Arsenal')] }],
  });
  const fetchImpl = (async (input: unknown) => {
    fetches++;
    const url = String(input);
    if (url.includes('/standings')) return json({ name: 'x', season: { year: 2026 } });
    const asked = new URL(url).searchParams.get('dates') ?? '';
    const held = (e: Ev) => (asked.length === 8 ? easternDay(e.date) === asked : asked.length === 6 ? easternDay(e.date).startsWith(asked) : false);
    return json({ leagues: [{ season: { year: 2026, displayName: '2026-27 English Premier League' } }], events: events.filter(held).map(event) });
  }) as unknown as typeof fetch;
  return new EspnAdapter({ competition: 'eng.1', fetchImpl, now: () => ADAPTER_CLOCK.getTime() }) as ProviderAdapter;
}

const cfg = (over: Partial<CliConfig> = {}): CliConfig =>
  described({ lang: 'en', tz: LA, json: false, color: false, source: 'espn', competition: 'eng.1', flavor: 'off', markets: false, ...over });
const ctx = (adapter: ProviderAdapter, over: Partial<CliConfig> = {}) => ({
  cfg: cfg(over),
  t: makeT(over.lang ?? 'en'),
  adapter,
  marketProvider: new FakeMarketProvider(),
  now: NOW,
});

const outSpy = vi.spyOn(process.stdout, 'write');
let writes: string[] = [];
beforeEach(() => {
  writes = [];
  fetches = 0;
  outSpy.mockImplementation((c: unknown) => {
    writes.push(String(c));
    return true;
  });
});
afterEach(() => outSpy.mockReset());
const text = () => writes.join('');
const lines = () => text().split('\n');
const emitted = () => JSON.parse(text()) as Record<string, unknown>;

describe('today <day>: the day named, from the request clock, in the viewer zone', () => {
  it.each([
    [undefined, "Today's matches · Tue 2026-11-10"],
    ['today', "Today's matches · Tue 2026-11-10"],
    ['+0', "Today's matches · Tue 2026-11-10"],
    ['tue', "Today's matches · Tue 2026-11-10"],
    ['2026-11-10', "Today's matches · Tue 2026-11-10"],
    ['tomorrow', 'Matches · Wed 2026-11-11'],
    ['yesterday', 'Matches · Mon 2026-11-09'],
    ['wed', 'Matches · Wed 2026-11-11'],
    ['sat', 'Matches · Sat 2026-11-14'],
    ['Saturday', 'Matches · Sat 2026-11-14'],
    ['+11', 'Matches · Sat 2026-11-21'],
    ['2026-11-21', 'Matches · Sat 2026-11-21'],
  ])('today %s: %s', async (arg, header) => {
    await cmdToday(arg, ctx(feed([WED, SAT, FAR])));
    expect(lines()).toContain(header);
  });

  it("lists the day's own matches: tomorrow is Wednesday's, sat is Saturday's", async () => {
    await cmdToday('tomorrow', ctx(feed([WED, SAT, FAR])));
    expect(text()).toContain('Liverpool');
    expect(text()).not.toContain('Chelsea');
    writes = [];
    await cmdToday('sat', ctx(feed([WED, SAT, FAR])));
    expect(text()).toContain('Chelsea');
    expect(text()).not.toContain('Liverpool');
  });

  it('the same clock, another zone: tomorrow in Tokyo is Thursday', async () => {
    await cmdToday('tomorrow', ctx(feed([]), { tz: 'Asia/Tokyo' }));
    expect(lines()).toContain('Matches · Thu 2026-11-12');
    writes = [];
    await cmdToday('tomorrow', ctx(feed([]), { tz: 'UTC' }));
    expect(lines()).toContain('Matches · Thu 2026-11-12');
  });

  it("the header's weekday is the reader's language", async () => {
    for (const [lang, header] of [
      ['es', 'Partidos · mié 2026-11-11'],
      ['pt', 'Jogos · qua. 2026-11-11'],
      ['fr', 'Matchs · mer. 2026-11-11'],
    ] as const) {
      writes = [];
      await cmdToday('tomorrow', ctx(feed([]), { lang }));
      expect(lines(), lang).toContain(header);
    }
  });

  it('--json carries the day named in `date`, the shape unchanged', async () => {
    await cmdToday('sat', ctx(feed([WED, SAT, FAR]), { json: true }));
    const body = emitted();
    expect(body.date).toBe('2026-11-14');
    expect(Object.keys(body)).not.toContain('weekday');
  });

  it("a dated list keeps its rows: a match 10 days out reads 'Sat 09:30', no date", async () => {
    await cmdToday('2026-11-21', ctx(feed([FAR])));
    const row = lines().find((l) => l.includes('Newcastle United'));
    expect(row).toMatch(/Sat 09:30/);
    expect(row).not.toMatch(/Nov 21/);
  });
});

describe('an unreadable day is refused before any request, in the reader language', () => {
  it.each([
    ['en', 'Invalid date someday. Use YYYY-MM-DD, today, tomorrow, yesterday, a weekday (sat) or +N.'],
    ['es', 'Fecha inválida someday. Usa AAAA-MM-DD, today, tomorrow, yesterday, un día de la semana (sat) o +N.'],
    ['pt', 'Data inválida someday. Use AAAA-MM-DD, today, tomorrow, yesterday, um dia da semana (sat) ou +N.'],
    ['fr', 'Date invalide someday. Utilisez AAAA-MM-JJ, today, tomorrow, yesterday, un jour de la semaine (sat) ou +N.'],
  ] as const)('%s', async (lang, sentence) => {
    const run = cmdToday('someday', ctx(feed([WED]), { lang }));
    await expect(run).rejects.toBeInstanceOf(InputError);
    await expect(cmdToday('someday', ctx(feed([WED]), { lang }))).rejects.toThrow(sentence);
    expect(fetches).toBe(0);
  });

  it.each(['+100', '-1', 'tues', '2026-02-30'])('today %s is refused', async (arg) => {
    await expect(cmdToday(arg, ctx(feed([WED])))).rejects.toBeInstanceOf(InputError);
    expect(fetches).toBe(0);
  });
});

describe('share and markets take the same day forms', () => {
  it("share sat: Saturday's card", async () => {
    await cmdShare('sat', undefined, { hashtag: false, installLine: false }, ctx(feed([WED, SAT, FAR]), { json: true }));
    const body = emitted();
    expect(JSON.stringify(body)).toContain('Chelsea');
    expect(JSON.stringify(body)).not.toContain('Liverpool');
  });

  it("share tomorrow is not today's card", async () => {
    await cmdShare('tomorrow', undefined, { hashtag: false, installLine: false }, ctx(feed([WED])));
    expect(text()).toContain('Liverpool');
    expect(text()).not.toContain("Today's matches");
  });

  it.each(['2026-11-10', 'tue', '+0'])(
    'share %s (a typed day that is today): the run cue keeps the date, so the card replays on another day',
    async (arg) => {
      await cmdShare(arg, undefined, { hashtag: false }, ctx(feed([WED])));
      expect(text()).toContain('Try it: npx @claudinho/cli --competition premier-league today 2026-11-10');
      expect(text()).toContain('Matches · Nov 10');
    },
  );

  it("share with no day, or the word today: today's card and the plain cue", async () => {
    await cmdShare(undefined, undefined, { hashtag: false }, ctx(feed([WED])));
    expect(text()).toContain("Today's matches · Nov 10");
    expect(text()).toMatch(/Try it: npx @claudinho\/cli --competition premier-league today\n/);
    writes = [];
    await cmdShare('today', undefined, { hashtag: false }, ctx(feed([WED])));
    expect(text()).toMatch(/Try it: npx @claudinho\/cli --competition premier-league today\n/);
  });

  it('share with a word the grammar does not read is still a match id (the id branch), never a refusal', async () => {
    await expect(cmdShare('someday', undefined, { hashtag: false, installLine: false }, ctx(feed([WED])))).resolves.toBeUndefined();
  });

  it('markets +4 reads the day named (Saturday)', async () => {
    await cmdMarkets('+4', undefined, ctx(feed([WED, SAT, FAR]), { json: true }));
    expect(emitted().date).toBe('2026-11-14');
  });
});

describe('a single match more than 6 days away says its date, once', () => {
  it('next: the date on the match line; below it the stage and the countdown, no second kickoff', async () => {
    await cmdNext('Arsenal', ctx(feed([FAR])));
    const row = lines().find((l) => l.includes('Newcastle United'));
    expect(row).toContain('Sat, Nov 21, 09:30');
    expect(lines()).toContain('  League · in 10d11h');
    expect(text().match(/09:30/g)).toHaveLength(1);
  });

  it('next, a match tomorrow: the weekday and time on the match line, said once', async () => {
    await cmdNext('Arsenal', ctx(feed([WED])));
    const row = lines().find((l) => l.includes('Liverpool'));
    expect(row).toContain('Wed 12:00');
    expect(row).not.toContain('Nov');
    expect(lines()).toContain('  League · in 14h20m');
    expect(text().match(/12:00/g)).toHaveLength(1);
  });

  it('next in Spanish: the date in its own forms', async () => {
    await cmdNext('Arsenal', ctx(feed([FAR]), { lang: 'es' }));
    expect(text()).toContain('sáb, 21 nov, 09:30');
    expect(lines()).toContain('  Liga · en 10d11h');
  });

  it('match <id>: a far kickoff says its date, on the text and in --json lines', async () => {
    await cmdMatch('503', ctx(feed([FAR])));
    expect(text()).toContain('Kickoff Sat, Nov 21, 09:30');
    writes = [];
    await cmdMatch('503', ctx(feed([FAR]), { json: true }));
    expect((emitted().lines as string[]).join('\n')).toContain('Kickoff Sat, Nov 21, 09:30');
  });

  it("next: the days are counted in the viewer's zone (7 in Los Angeles, 6 in UTC, for the same instants)", async () => {
    await cmdNext('Arsenal', ctx(feed([ZONED])));
    expect(lines().find((l) => l.includes('Tottenham'))).toContain('Tue, Nov 17, 15:00');
    writes = [];
    await cmdNext('Arsenal', ctx(feed([ZONED]), { tz: 'UTC' }));
    const row = lines().find((l) => l.includes('Tottenham'));
    expect(row).toContain('Tue 23:00');
    expect(row).not.toContain('Nov 17');
  });

  it('match <id> (the World Cup, whose past matches it finds): 7 calendar days back says the date; 6 days back, the weekday and time', async () => {
    // The opening match, read from the bundle (the provider is unreachable here: the bundled record is shown).
    const opener = allFixtures()[0] as Match;
    const kickoff = new Date(opener.kickoff);
    const daysAfter = (n: number) => new Date(kickoff.getTime() + n * 86_400_000);
    const wc = (now: Date) => ({ ...ctx(offline(), { competition: 'fifa.world', tz: 'UTC' }), now });
    const label = new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }).format(kickoff);
    const short = new Intl.DateTimeFormat('en', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }).format(kickoff);
    await cmdMatch(opener.id, wc(daysAfter(7)));
    expect(text()).toContain(`Kickoff ${label}`);
    writes = [];
    await cmdMatch(opener.id, wc(daysAfter(6)));
    expect(text()).toContain(`Kickoff ${short}`);
    expect(text()).not.toContain(label);
  });

  it("today <date>: a past day's rows keep the weekday and time", async () => {
    await cmdToday('2026-11-03', ctx(feed([WEEK_AGO])));
    expect(lines()).toContain('Matches · Tue 2026-11-03');
    const row = lines().find((l) => l.includes('Brentford'));
    expect(row).toBeDefined();
    expect(row).not.toContain('Nov 3');
  });

  it('match <id>: a near kickoff keeps the weekday and time', async () => {
    await cmdMatch('501', ctx(feed([WED])));
    expect(text()).toContain('Kickoff Wed 12:00');
  });
});
