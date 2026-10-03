/**
 * 0.11 PR 2.1d — the paths the surface tests do not reach.
 *
 * `marketFixtureForTeam` makes its second read (the candidate's own day) only
 * when a fixture of the team is inside its live window; the verdict of the
 * answer is then the two reads' together, on every return. And the day's
 * attribution rule (`dayAttribution`) and the "none read" bodies, at their
 * edges: an empty display, a whole read, a read that says nothing of what it
 * served, a degraded one, a day that merged the bundled schedule.
 */
import { describe, expect, it } from 'vitest';
import { EspnAdapter } from '../src/adapters/espn';
import { attachFetchMeta } from '../src/adapters/meta';
import type { ProviderAdapter } from '../src/adapters/types';
import { marketFixtureForTeam } from '../src/live';
import { allFixtures } from '../src/schedule';
import { dateNoneRead, dayAttribution, liveNoneRead, marketsNoneRead, unservedSentence } from '../src/share/cards';
import type { Match } from '../src/types';

const WC_SEASON = { year: 2026, startDate: '2026-06-11T04:00Z', endDate: '2026-12-31T04:59Z', displayName: '2026 FIFA World Cup' };
type Side = { id: string; abbr: string; name: string };
type Ev = { id: string; date: string; home: Side; away: Side; state?: 'pre' | 'in' | 'post'; raw?: Record<string, unknown> };
function event(e: Ev) {
  const state = e.state ?? 'pre';
  const type = state === 'in' ? { name: 'STATUS_IN_PROGRESS', state: 'in' } : state === 'post' ? { name: 'STATUS_FULL_TIME', state: 'post' } : { name: 'STATUS_SCHEDULED', state: 'pre' };
  const side = (s: Side, homeAway: string, score: string) => ({ homeAway, score, team: { id: s.id, abbreviation: s.abbr, displayName: s.name } });
  return { id: e.id, date: e.date, season: { slug: 'final' }, status: { type, displayClock: state === 'in' ? "55'" : undefined, period: state === 'in' ? 2 : 0 }, competitions: [{ competitors: [side(e.home, 'home', '1'), side(e.away, 'away', '0')] }], ...e.raw };
}
/** The refused shape: a status the parser does not know. */
const REFUSED = { status: { type: { name: 'STATUS_NEW', state: 'limbo' } } };
const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const easternDay = (iso: string) => eastern.format(new Date(iso)).replace(/-/g, '');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function feed(events: Ev[], fail?: (dates: string) => Response | undefined) {
  const asked: string[] = [];
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    if (url.includes('/standings')) return json({});
    const dates = new URL(url).searchParams.get('dates') ?? '';
    asked.push(dates);
    const failure = fail?.(dates);
    if (failure) return failure;
    const inBucket = (e: Ev) => (dates.length === 8 ? easternDay(e.date) === dates : dates.length === 6 ? easternDay(e.date).startsWith(dates) : false);
    return json({ leagues: [{ season: WC_SEASON }], events: events.filter(inBucket).map(event) });
  }) as unknown as typeof fetch;
  return { adapter: new EspnAdapter({ competition: 'fifa.world', enrichGroups: false, fetchImpl }) as ProviderAdapter, asked };
}
const CAN: Side = { id: '206', abbr: 'CAN', name: 'Canada' };
const BIH: Side = { id: '2452', abbr: 'BIH', name: 'Bosnia and Herzegovina' };
const FINAL: Ev = { id: '760517', date: '2026-07-19T19:00Z', home: { id: '164', abbr: 'ESP', name: 'Spain' }, away: { id: '202', abbr: 'ARG', name: 'Argentina' } };
const BROKEN: Ev = { id: '760516', date: '2026-07-18T19:00Z', home: CAN, away: BIH, raw: REFUSED };
/** Half an hour into the final: the final is the team's in-window candidate, refreshed from its own day. */
const IN_FINAL = new Date('2026-07-19T19:30:00Z');

describe('the market fixture read: the two reads together, on every return (0.11 2.1d)', () => {
  it('the retained candidate: the window and its own day each counted the same refused record, summed over the responses', async () => {
    const f = feed([FINAL, BROKEN]);
    const r = await marketFixtureForTeam(f.adapter, 'ESP', IN_FINAL);
    expect(r.match?.id).toBe('760517');
    expect(r.degraded).toBe(false);
    expect(f.asked).toEqual(['202606', '202607', '20260718', '20260719', '20260720']);
    // A count over the responses, like the window's own: the record both reads refused counts in each (an upper bound).
    expect(r.partial).toEqual({ omitted: 2 });
  });

  it('a finished candidate falling through: the answer it falls to still carries both accounts', async () => {
    const f = feed([{ ...FINAL, state: 'post' }, BROKEN]);
    const r = await marketFixtureForTeam(f.adapter, 'ESP', IN_FINAL);
    expect(r.match).toBeUndefined(); // the final was the team's last
    expect(r.partial).toEqual({ omitted: 2 });
  });

  it('a window that was not whole, then a refresh that FAILED: the window\'s account, and the failure\'s `degraded`', async () => {
    const f = feed([FINAL, BROKEN], (d) => (d.length === 8 ? json({}, 503) : undefined));
    const r = await marketFixtureForTeam(f.adapter, 'ESP', IN_FINAL);
    expect(r.match?.id).toBe('760517');
    expect(r.degraded).toBe(true);
    expect(r.partial).toEqual({ omitted: 1 });
  });

  it('a refused record only in the candidate\'s own day: that read\'s count alone', async () => {
    const f = feed([FINAL], (d) => (d === '20260718' ? json({ leagues: [{ season: WC_SEASON }], events: [event(BROKEN)] }) : undefined));
    // The day's only record is refused; the window holds the final on another day, so it is not refused whole.
    const r = await marketFixtureForTeam(f.adapter, 'ESP', IN_FINAL);
    expect(r.match?.id).toBe('760517');
    expect(r.partial).toEqual({ omitted: 1 });
  });

  it('a count one read did not know: the verdict stands with no count', async () => {
    const base = allFixtures().find((m) => m.id === '760517') as Match;
    const final: Match = { ...base, home: { code: 'ESP', name: 'Spain', flag: '\u{1F1EA}\u{1F1F8}' }, away: { code: 'ARG', name: 'Argentina', flag: '\u{1F1E6}\u{1F1F7}' } };
    const adapter: ProviderAdapter = {
      name: 'espn',
      competition: 'fifa.world',
      capabilities: { push: false, latencyHintSec: 0 },
      async fetchByDate() { return []; },
      async fetchLive() { return []; },
      // The knockout window says it was not whole, with no count; the day refresh counts one.
      async fetchWindow(start: string) {
        return start === '20260628' ? attachFetchMeta([final], { complete: false }) : attachFetchMeta([final], { complete: false, omitted: 1 });
      },
    };
    const r = await marketFixtureForTeam(adapter, 'ESP', IN_FINAL);
    expect(r.match?.id).toBe('760517');
    expect(r.partial).toEqual({});
  });

  it('both reads whole, or an adapter that says nothing: no key', async () => {
    expect((await marketFixtureForTeam(feed([FINAL]).adapter, 'ESP', IN_FINAL)).partial).toBeUndefined();
    const base = allFixtures().find((m) => m.id === '760517') as Match;
    const final: Match = { ...base, home: { code: 'ESP', name: 'Spain', flag: '\u{1F1EA}\u{1F1F8}' }, away: { code: 'ARG', name: 'Argentina', flag: '\u{1F1E6}\u{1F1F7}' } };
    const silent: ProviderAdapter = {
      name: 'espn',
      competition: 'fifa.world',
      capabilities: { push: false, latencyHintSec: 0 },
      async fetchByDate() { return []; },
      async fetchLive() { return []; },
      async fetchWindow() { return [final]; },
    };
    const r = await marketFixtureForTeam(silent, 'ESP', IN_FINAL);
    expect(r.match?.id).toBe('760517');
    expect('partial' in r).toBe(false);
  });
});

describe('the day\'s attribution and the "none read" bodies, at their edges (0.11 2.1d)', () => {
  const opener = allFixtures().find((m) => m.id === '760415') as Match;
  const second = allFixtures().find((m) => m.id === '760414') as Match;
  const partial = { partial: { omitted: 1 } };

  it('a whole read, a degraded one, and a read that does not say what it served change nothing', () => {
    expect(dayAttribution({ served: [] }, [opener], 'en')).toEqual({ attributed: true });
    expect(dayAttribution({ degraded: true }, [opener], 'en')).toEqual({ attributed: true });
    expect(dayAttribution({ ...partial }, [opener], 'en')).toEqual({ attributed: true });
  });

  it('a read that was not whole: every shown fixture served, some, none; and an empty display keeps the line', () => {
    expect(dayAttribution({ ...partial, served: ['760415', '760414'] }, [opener, second], 'en')).toEqual({ attributed: true });
    expect(dayAttribution({ ...partial, served: ['760414'] }, [opener, second], 'en')).toEqual({
      attributed: true,
      unserved: '1 fixture shown from the bundled schedule; its live state is unconfirmed.',
    });
    expect(dayAttribution({ ...partial, served: [] }, [opener, second], 'en')).toEqual({
      attributed: false,
      unserved: unservedSentence(2, 'en'),
    });
    expect(unservedSentence(2, 'en')).toBe('2 fixtures shown from the bundled schedule; their live state is unconfirmed.');
    // Nothing shown attributes nothing to anyone: the line stays as it was.
    expect(dayAttribution({ ...partial, served: [] }, [], 'en')).toEqual({ attributed: true });
    // Localized like the verdict beside it.
    expect(dayAttribution({ ...partial, served: [] }, [opener], 'pt').unserved).toBe(unservedSentence(1, 'pt'));
  });

  it('"none read" is said only for a read that was not whole, not degraded; a day only where it merged no bundled schedule', () => {
    expect(liveNoneRead({ ...partial }, 'en')).toBe('No match in play was read.');
    expect(liveNoneRead({}, 'en')).toBeUndefined();
    expect(liveNoneRead({ ...partial, degraded: true }, 'en')).toBeUndefined();
    expect(dateNoneRead({ ...partial }, '2026-10-17', 'en')).toBe('No fixture was read for 2026-10-17.');
    expect(dateNoneRead({ ...partial, skeleton: true }, '2026-06-11', 'en')).toBeUndefined();
    expect(dateNoneRead({}, '2026-10-17', 'en')).toBeUndefined();
    // Market copy: English on every locale (the approved bank), so it takes no language.
    expect(marketsNoneRead({ ...partial, skeleton: true }, '2026-06-11')).toBe('No market signal among the fixtures read for 2026-06-11.');
    expect(marketsNoneRead({}, '2026-06-11')).toBeUndefined();
  });
});
