/**
 * The ESPN canary (`scripts/espn-canary.mjs`) — 0.11 PR 2.C.
 *
 * The feed is undocumented and changes without notice. On Oct 2 2026 it began
 * rejecting every date-RANGE scoreboard request (HTTP 400) while single days
 * kept working; every windowed read degraded, and it was found by accident. The
 * canary asks the real feed, once a day, the same questions the product asks —
 * through the adapter, so it cannot drift from the shapes the adapter uses —
 * and says which KIND of problem it met:
 *
 *   rejected     the provider refused the request FORM            → red
 *   changed      a 2xx payload broke an invariant a parser needs  → red
 *   blocked      403/429: this runner is throttled or blocked     → neutral
 *   unreachable  network error, timeout, 5xx                      → neutral
 *
 * No network here: every case injects a fetch.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  adapterTablesProblem,
  CANARY_COMPETITIONS,
  CANARY_QUESTIONS,

  canaryWarnings,
  formatCanary,
  runCanary,
  STANDING_STATS,
} from '../../../scripts/espn-canary.mjs';
import * as core from '../src';

const NOW = new Date('2026-10-10T12:00:00Z');

const SEASON = {
  year: 2026,
  startDate: '2026-06-01T04:00Z',
  endDate: '2027-06-01T03:59Z',
  displayName: '2026-27 English Premier League',
};
function event(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    date: '2026-10-10T11:30Z',
    season: { slug: 'regular-season' },
    status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
    competitions: [
      {
        competitors: [
          { homeAway: 'home', team: { id: '359', abbreviation: 'ARS', displayName: 'Arsenal' } },
          { homeAway: 'away', team: { id: '363', abbreviation: 'CHE', displayName: 'Chelsea' } },
        ],
      },
    ],
    ...over,
  };
}
const STATS = ['gamesPlayed', 'wins', 'ties', 'losses', 'pointsFor', 'pointsAgainst', 'pointDifferential', 'points', 'rank'];
function standings(over: (entry: Record<string, unknown>) => Record<string, unknown> = (e) => e) {
  const entry = (id: string, abbr: string, name: string, rank: number) =>
    over({
      team: { id, abbreviation: abbr, displayName: name },
      stats: STATS.map((n) => ({ name: n, value: n === 'rank' ? rank : 0 })),
    });
  return {
    children: [
      {
        name: '2026-27 English Premier League',
        standings: { entries: [entry('359', 'ARS', 'Arsenal', 1), entry('363', 'CHE', 'Chelsea', 2)] },
      },
    ],
  };
}
/**
 * The provider files a fixture under its kickoff's US/Eastern day, and answers
 * one day (`dates=YYYYMMDD`), one month (`dates=YYYYMM`) or its default bucket.
 * A feed that answers every request with the same events would put one fixture
 * in every part of a window.
 */
const eastern = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const providerDay = (iso: string) => eastern.format(new Date(iso)).replace(/-/g, '');
const asked = (url: string) => new URL(url).searchParams.get('dates') ?? '';
function filed<T extends { date: string }>(url: string, events: T[]): T[] {
  const dates = asked(url);
  if (dates === '') return events;
  return events.filter((e) => (dates.length === 8 ? providerDay(e.date) === dates : providerDay(e.date).startsWith(dates)));
}
/** A scoreboard answer to `url`: the events that belong in it. */
const scoreboard = (url: string, events = [event('401878761')]) => ({ leagues: [{ season: SEASON }], events: filed(url, events) });

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

type Handler = (url: string) => Response | Promise<Response>;
/** A fetch double that records what was asked. */
function feed(handler: Handler) {
  const urls: string[] = [];
  const fetchImpl = (async (input: unknown) => {
    const url = String(input);
    urls.push(url);
    return handler(url);
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
}
/** Twelve lettered groups of one team each: a healthy answer for any grouped competition. */
const groupStandings = (letters = 'ABCDEFGHIJKL'.split('')) => ({
  children: letters.map((g, i) => ({
    name: `Group ${g}`,
    standings: {
      entries: [
        {
          team: { id: String(200 + i), abbreviation: `T${g}X`, displayName: `Team ${g}` },
          stats: STATS.map((n) => ({ name: n, value: n === 'rank' ? 1 : 0 })),
        },
      ],
    },
  })),
});
/** A healthy standings answer for the competition a URL asks about: its own shape. */
function standingsOf(url: string) {
  const slug = /\/soccer\/([^/]+)\/standings/.exec(url)?.[1] ?? '';
  const shape = core.STANDINGS_SHAPE[slug];
  // What a competition with no table answers: its seasons, and no table list.
  if (shape === 'none') return { name: 'Concacaf Champions Cup', season: { year: 2026 }, seasons: [{ year: 2016 }] };
  return shape === 'league' ? standings() : groupStandings();
}
const healthy: Handler = (url) => json(url.includes('/standings') ? standingsOf(url) : scoreboard(url));

const run = (handler: Handler, competitions = ['eng.1']) => {
  const f = feed(handler);
  return runCanary({ core, competitions, fetchImpl: f.fetchImpl, now: NOW, pauseMs: 0 }).then((result) => ({
    ...result,
    urls: f.urls,
  }));
};
const verdicts = (r: { rows: Array<{ request: string; verdict: string }> }) =>
  Object.fromEntries(r.rows.map((row) => [row.request, row.verdict]));

describe('a healthy feed', () => {
  it('asks the four questions the product asks, per competition, and is green', async () => {
    const r = await run(healthy, ['eng.1', 'uefa.nations']);
    expect(r.red).toBe(false);
    expect(r.rows).toHaveLength(8);
    expect(r.rows.map((row) => `${row.competition}:${row.request}:${row.verdict}`)).toEqual([
      'eng.1:live:ok',
      'eng.1:day:ok',
      'eng.1:window:ok',
      'eng.1:standings:ok',
      'uefa.nations:live:ok',
      'uefa.nations:day:ok',
      'uefa.nations:window:ok',
      'uefa.nations:standings:ok',
    ]);
  });

  it('uses the adapter’s own request shapes, for the competition it was given', async () => {
    const r = await run(healthy);
    expect(r.urls).toHaveLength(6);
    for (const u of r.urls) expect(u).toContain('/soccer/eng.1/');
    // bare bucket · one day · a three-day window, a day at a time · the standings endpoint
    expect(r.urls.filter((u) => u.includes('/scoreboard') && !u.includes('dates='))).toHaveLength(1);
    expect(r.urls.filter((u) => /dates=20261010(&|$)/.test(u))).toHaveLength(2); // the day, and the window's middle day
    expect(r.urls.filter((u) => /dates=20261009(&|$)/.test(u))).toHaveLength(1);
    expect(r.urls.filter((u) => /dates=20261011(&|$)/.test(u))).toHaveLength(1);
    expect(r.urls.filter((u) => u.includes('/standings'))).toHaveLength(1);
    // The form the provider refuses is never asked.
    expect(r.urls.some((u) => /dates=\d+-\d+/.test(u))).toBe(false);
    expect(r.rows.map((row) => row.requests)).toEqual([1, 1, 3, 1]);
  });

  it('a competition with no fixtures in the window is still green', async () => {
    const r = await run((url) => json(url.includes('/standings') ? standings() : { leagues: [{ season: SEASON }], events: [] }));
    expect(r.red).toBe(false);
  });
});

describe('the provider refuses a request form', () => {
  // The body of the rejection recorded on Oct 2 2026 (then: every date range).
  const REFUSED = () => json({ code: 400, message: 'Failed to get events endpoint.' }, 400);
  const DAY_REJECTED: Handler = (url) => (/dates=\d{8}(&|$)/.test(url) ? REFUSED() : healthy(url));

  it('is red, and says which request and why', async () => {
    const r = await run(DAY_REJECTED);
    expect(r.red).toBe(true);
    expect(verdicts(r)).toEqual({ live: 'ok', day: 'rejected', window: 'rejected', standings: 'ok' });
    const row = r.rows.find((x) => x.request === 'day');
    expect(row?.detail).toContain('400');
    expect(row?.detail).toContain('Failed to get events endpoint.');
    expect(row?.url).toMatch(/dates=20261010/);
  });

  it('the form refused on Oct 2 2026 (a date range) is no longer asked, so refusing it turns nothing red', async () => {
    const r = await run((url) => (/dates=\d+-\d+/.test(url) ? REFUSED() : healthy(url)), ['eng.1', 'uefa.nations']);
    expect(r.red).toBe(false);
    expect(new Set(r.rows.map((row) => row.verdict))).toEqual(new Set(['ok']));
  });

  it('a window is judged on every request it takes, not on the first', async () => {
    // The first day answers; the third is refused.
    const third = await run((url) => (/dates=20261011(&|$)/.test(url) ? REFUSED() : healthy(url)));
    expect(verdicts(third)).toEqual({ live: 'ok', day: 'ok', window: 'rejected', standings: 'ok' });
    expect(third.rows.find((x) => x.request === 'window')?.detail).toMatch(/20261011, 1 of 3 requests/);
    // The first day answers; the second is not JSON.
    const second = await run((url) =>
      /dates=20261009(&|$)/.test(url) ? new Response('<html>maintenance</html>', { status: 200 }) : healthy(url),
    );
    expect(verdicts(second).window).toBe('changed');
  });

  it('a 404 on a slug is a rejection too', async () => {
    const r = await run((url) => (url.includes('/standings') ? json({}, 404) : healthy(url)));
    expect(r.red).toBe(true);
    expect(verdicts(r).standings).toBe('rejected');
  });
});

describe('a blocked or unreachable feed is not a broken feed', () => {
  it('403 and 429 are neutral, and the adapter’s cooldown stops further requests', async () => {
    for (const status of [403, 429]) {
      const r = await run(() => json({}, status));
      expect(r.red, `status ${status}`).toBe(false);
      expect(new Set(r.rows.map((row) => row.verdict))).toEqual(new Set(['blocked']));
      // One refusal, then nothing: the canary must not hammer a provider that said stop.
      expect(r.urls).toHaveLength(1);
    }
  });

  it('a network failure and a 5xx are neutral, and reported as unreachable', async () => {
    const down = await run(() => {
      throw new TypeError('fetch failed');
    });
    expect(down.red).toBe(false);
    expect(new Set(down.rows.map((row) => row.verdict))).toEqual(new Set(['unreachable']));

    const flaky = await run(() => json({ error: 'upstream' }, 503));
    expect(flaky.red).toBe(false);
    expect(new Set(flaky.rows.map((row) => row.verdict))).toEqual(new Set(['unreachable']));
  });
});

describe('a 2xx payload that no longer fits the parsers', () => {
  const scoreboardCase = async (body: unknown) => {
    const r = await run((url) => json(url.includes('/standings') ? standings() : body));
    return { r, day: r.rows.find((x) => x.request === 'day') };
  };

  it('the events list is gone', async () => {
    const { r, day } = await scoreboardCase({ leagues: [{ season: SEASON }], events: 'none' });
    expect(r.red).toBe(true);
    expect(day?.verdict).toBe('changed');
  });

  it('an event the adapter refuses is counted, not skipped', async () => {
    const { r, day } = await scoreboardCase({
      leagues: [{ season: SEASON }],
      events: [event('1'), event('2', { status: { type: { name: 'STATUS_SOMETHING_NEW', state: 'limbo' } } })],
    });
    expect(r.red).toBe(true);
    expect(day?.verdict).toBe('changed');
    expect(day?.detail).toMatch(/2 sent, 1 read/);
  });

  it('a team arrives without the id identity rests on', async () => {
    const noId = event('1');
    (noId.competitions[0]?.competitors[0]?.team as { id?: string }).id = undefined;
    const { r, day } = await scoreboardCase({ leagues: [{ season: SEASON }], events: [noId] });
    expect(r.red).toBe(true);
    expect(day?.verdict).toBe('changed');
    expect(day?.detail).toMatch(/id/);
  });

  it('the response no longer states a readable season', async () => {
    const { r, day } = await scoreboardCase({ leagues: [{ season: { year: '2026' } }], events: [event('1')] });
    expect(r.red).toBe(true);
    expect(day?.verdict).toBe('changed');
    expect(day?.detail).toMatch(/season/);
  });

  it('a standings row loses a statistic the table parser reads, or its team id', async () => {
    const missingStat = await run((url) =>
      json(
        url.includes('/standings')
          ? standings((e) => ({ ...e, stats: (e.stats as Array<{ name: string }>).filter((s) => s.name !== 'points') }))
          : scoreboard(url),
      ),
    );
    expect(missingStat.red).toBe(true);
    expect(verdicts(missingStat).standings).toBe('changed');
    expect(missingStat.rows.find((x) => x.request === 'standings')?.detail).toMatch(/points/);

    const missingId = await run((url) =>
      json(
        url.includes('/standings')
          ? standings((e) => {
              // Only the id goes: each row keeps its own team, so the product's
              // parser (to which an id is optional) reads the table whole and
              // the raw check is the only thing that can see this.
              const { id: _id, ...team } = e.team as { id: string; abbreviation: string; displayName: string };
              return { ...e, team };
            })
          : scoreboard(url),
      ),
    );
    expect(missingId.red).toBe(true);
    expect(verdicts(missingId).standings).toBe('changed');
    expect(missingId.rows.find((x) => x.request === 'standings')?.detail).toBe('Arsenal has no team id');
  });

  it('a body that is not JSON at all', async () => {
    const r = await run(() => new Response('<html>maintenance</html>', { status: 200 }));
    expect(r.red).toBe(true);
    expect(new Set(r.rows.map((row) => row.verdict))).toEqual(new Set(['changed']));
  });
});

/** A body that fails as soon as it is read: the headers arrived, the payload never does. */
const brokenBody = (status: number, headers: Record<string, string> = {}) =>
  new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('socket hang up'));
      },
    }),
    { status, headers },
  );

describe('found in review: the status is known from the headers', () => {
  it('a refused request whose body never arrives is still a refused request', async () => {
    const r = await run((url) => (/dates=20261011(&|$)/.test(url) ? brokenBody(400) : healthy(url)));
    expect(verdicts(r).window).toBe('rejected');
    expect(r.red).toBe(true);
    expect(r.rows.find((x) => x.request === 'window')?.detail).toContain('400');
  });

  it('a throttle whose body never arrives still reaches the adapter, which stops asking', async () => {
    for (const status of [403, 429]) {
      const r = await run(() => brokenBody(status));
      expect(new Set(r.rows.map((row) => row.verdict)), `status ${status}`).toEqual(new Set(['blocked']));
      expect(r.urls, `status ${status}`).toHaveLength(1);
      expect(r.red).toBe(false);
    }
  });

  it('a served response whose body fails midway is an outage, not a changed feed', async () => {
    const r = await run((url) => (/dates=20261010(&|$)/.test(url) ? brokenBody(200) : healthy(url)));
    expect(verdicts(r).day).toBe('unreachable');
    expect(verdicts(r).window).toBe('unreachable');
    expect(r.red).toBe(false);
  });
});

describe('found in review: a throttle is the provider speaking to the runner, not to one competition', () => {
  it('stops the whole run: one request, and every later row says it was not asked', async () => {
    for (const status of [403, 429]) {
      const r = await run(() => json({}, status, { 'retry-after': '300' }), ['eng.1', 'esp.1', 'ita.1']);
      expect(r.urls, `status ${status}`).toHaveLength(1);
      expect(r.rows).toHaveLength(12);
      expect(new Set(r.rows.map((row) => row.verdict))).toEqual(new Set(['blocked']));
      expect(r.rows.at(-1)?.detail).toMatch(/not asked/);
      expect(r.red).toBe(false);
    }
  });

  it('a throttle in the middle of the run keeps what was learned before it', async () => {
    const r = await run((url) => (url.includes('/esp.1/') ? json({}, 429) : healthy(url)), ['eng.1', 'esp.1', 'ita.1']);
    expect(r.rows.slice(0, 4).map((row) => row.verdict)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(r.rows.slice(4).every((row) => row.verdict === 'blocked')).toBe(true);
    expect(r.urls).toHaveLength(7); // six for the first competition, one for the second
  });
});

describe('a window takes several requests: each is judged, and the provider is believed on the first "stop"', () => {
  it('a throttle on a later part of a window is a block, and ends the run', async () => {
    const r = await run((url) => (/dates=20261011(&|$)/.test(url) ? json({}, 429) : healthy(url)), ['eng.1', 'esp.1']);
    expect(r.rows.slice(0, 4).map((row) => `${row.request}:${row.verdict}`)).toEqual([
      'live:ok',
      'day:ok',
      'window:blocked',
      'standings:blocked',
    ]);
    expect(r.rows.slice(4).every((row) => row.verdict === 'blocked' && row.requests === 0)).toBe(true);
    // Its three parts had gone together; nothing after them is asked.
    expect(r.urls).toHaveLength(5);
    expect(r.red).toBe(false);
  });

  it('a team without an id in a LATER part of a window is red: every part is read, not the first', async () => {
    // The parser accepts a team with no id (the id is optional there), so the
    // result is complete; only the check on what was sent can see it.
    const noId = event('8', { date: '2026-10-11T15:00Z' });
    (noId.competitions[0]?.competitors[0]?.team as { id?: string }).id = undefined;
    const r = await run((url) => json(url.includes('/standings') ? standings() : scoreboard(url, [event('401878761'), noId])));
    expect(verdicts(r).day).toBe('ok');
    expect(verdicts(r).window).toBe('changed');
    expect(r.rows.find((x) => x.request === 'window')?.detail).toMatch(/without an id/);
  });

  it('a fixture filed under a day it does not kick off on, by the adapter’s rule, is red', async () => {
    // 01:00 UTC on the 11th is the 10th for the provider. A feed that files it
    // under its UTC date has stopped filing days the way the adapter assumes.
    const late = event('7', { date: '2026-10-11T01:00Z' });
    const byUtc = (url: string) => {
      const dates = asked(url);
      const events = dates.length === 8 ? [late].filter((e) => e.date.slice(0, 10).replace(/-/g, '') === dates) : [late];
      return json(url.includes('/standings') ? standings() : { leagues: [{ season: SEASON }], events });
    };
    const r = await run(byUtc);
    expect(verdicts(r).window).toBe('changed');
    expect(r.rows.find((x) => x.request === 'window')?.detail).toMatch(/filed under 20261011 kicks off on provider day 20261010/);
    // Filed the provider's way, the same fixture is fine.
    const fine = await run((url) => json(url.includes('/standings') ? standings() : scoreboard(url, [late])));
    expect(verdicts(fine).window).toBe('ok');
  });

  it('and so is a fixture a month’s response holds that is not of that month', async () => {
    // The knockout span is asked a month at a time; June's answer holding a
    // July fixture means the month form no longer means a provider month.
    const july = event('760517', { date: '2026-07-19T19:00Z', season: { slug: 'final' } });
    const r = await run(
      (url) =>
        json(
          url.includes('/standings')
            ? standings()
            : asked(url) === '202606'
              ? { leagues: [{ season: SEASON }], events: [july] }
              : scoreboard(url, []),
        ),
      ['fifa.world'],
    );
    expect(verdicts(r).knockout).toBe('changed');
    expect(r.rows.find((x) => x.request === 'knockout')?.detail).toMatch(/filed under 202606 kicks off on provider day 20260719/);
  });
});

describe('found in review: a part that could not be seen does not hide a part that was seen to be wrong', () => {
  // One verdict was picked for the question, "blocked" before "rejected" and
  // "unreachable" before "changed": a defect the canary had in its hands went
  // unreported, and the run stayed green, whenever a sibling request was
  // throttled or down. The window here is Oct 9 to 11 (three requests).
  const windowRow = (r: { rows: Array<{ request: string; verdict: string; detail: string }> }) => r.rows.find((x) => x.request === 'window');

  it('a refused form beside a throttled part is red, and the run still stops asking', async () => {
    const r = await run(
      (url) =>
        /dates=20261009(&|$)/.test(url)
          ? json({ code: 400, message: 'Failed to get events endpoint.' }, 400)
          : /dates=20261011(&|$)/.test(url)
            ? json({}, 429)
            : healthy(url),
      ['eng.1', 'esp.1'],
    );
    expect(windowRow(r)?.verdict).toBe('rejected');
    expect(windowRow(r)?.detail).toMatch(/HTTP 400/);
    expect(windowRow(r)?.detail).toMatch(/blocked/);
    expect(r.red).toBe(true);
    // The throttle is still believed: nothing after the window is asked.
    expect(r.urls).toHaveLength(5);
    expect(r.rows.slice(3).every((row) => row.verdict === 'blocked' && row.requests === 0)).toBe(true);
  });

  it('a body that is not JSON beside a part that was down is red', async () => {
    const r = await run((url) =>
      /dates=20261009(&|$)/.test(url)
        ? new Response('<html>', { status: 200 })
        : /dates=20261011(&|$)/.test(url)
          ? json({}, 503)
          : healthy(url),
    );
    expect(windowRow(r)?.verdict).toBe('changed');
    expect(windowRow(r)?.detail).toMatch(/not JSON/);
    expect(windowRow(r)?.detail).toMatch(/unreachable/);
    expect(r.red).toBe(true);
  });

  it('a part that WAS read is still checked when a sibling was down: a team without an id', async () => {
    const noId = event('8', { date: '2026-10-09T15:00Z' });
    (noId.competitions[0]?.competitors[0]?.team as { id?: string }).id = undefined;
    const r = await run((url) =>
      /dates=20261011(&|$)/.test(url) ? json({}, 503) : json(url.includes('/standings') ? standings() : scoreboard(url, [event('401878761'), noId])),
    );
    expect(windowRow(r)?.verdict).toBe('changed');
    expect(windowRow(r)?.detail).toMatch(/without an id/);
    expect(windowRow(r)?.detail).toMatch(/unreachable/);
  });

  it('and a served part with no `events` list', async () => {
    const r = await run((url) =>
      /dates=20261011(&|$)/.test(url) ? json({}, 503) : /dates=20261009(&|$)/.test(url) ? json({ leagues: [{ season: SEASON }] }) : healthy(url),
    );
    expect(windowRow(r)?.verdict).toBe('changed');
    expect(windowRow(r)?.detail).toMatch(/no `events` list/);
  });

  it('and so is how it files a day', async () => {
    // Filed under the 9th, kicking off on the provider's 10th.
    const misfiled = { leagues: [{ season: SEASON }], events: [event('7', { date: '2026-10-10T15:00Z' })] };
    const r = await run((url) =>
      /dates=20261011(&|$)/.test(url) ? json({}, 429) : /dates=20261009(&|$)/.test(url) ? json(misfiled) : healthy(url),
    );
    expect(windowRow(r)?.verdict).toBe('changed');
    expect(windowRow(r)?.detail).toMatch(/filed under 20261009 kicks off on provider day 20261010/);
    expect(r.red).toBe(true);
  });

  describe('what was served is put to the product’s own parser, like a whole answer is (round 2)', () => {
    // The first fix read the served parts raw (envelope, team ids, filing). A
    // record the parser REFUSES passed all three, so it went unreported
    // whenever a sibling request was down or throttled.
    const on9 = (over: Record<string, unknown>) => event('9', { date: '2026-10-09T15:00Z', ...over });
    const withOct9 = (first: unknown, last: Response) => (url: string) =>
      /dates=20261011(&|$)/.test(url)
        ? last
        : /dates=20261009(&|$)/.test(url)
          ? json({ leagues: [{ season: SEASON }], events: [first] })
          : healthy(url);

    for (const [what, last] of [
      ['down', () => json({}, 503)],
      ['throttled', () => json({}, 429)],
    ] as const) {
      it(`a record with a status the parser does not know, beside a part that was ${what}`, async () => {
        const r = await run(withOct9(on9({ status: { type: { name: 'STATUS_SOMETHING_NEW', state: 'limbo' } } }), last()));
        expect(windowRow(r)?.verdict).toBe('changed');
        expect(windowRow(r)?.detail).toMatch(/could not read every event/);
        expect(r.red).toBe(true);
      });
    }

    it('a record with an empty id, beside a part that was down', async () => {
      const r = await run(withOct9(on9({ id: '' }), json({}, 503)));
      expect(windowRow(r)?.verdict).toBe('changed');
      expect(r.red).toBe(true);
    });

    it('one fixture in two served parts, beside a part that was down', async () => {
      // Each copy is filed under the day it kicks off on, so only the window's
      // own rule (one fixture, one part) can see it.
      const twice = (url: string) =>
        /dates=20261011(&|$)/.test(url)
          ? json({}, 503)
          : /dates=20261009(&|$)/.test(url)
            ? json({ leagues: [{ season: SEASON }], events: [event('5', { date: '2026-10-09T15:00Z' })] })
            : /dates=20261010(&|$)/.test(url)
              ? json({ leagues: [{ season: SEASON }], events: [event('5', { date: '2026-10-10T15:00Z' })] })
              : healthy(url);
      const r = await run(twice);
      expect(windowRow(r)?.verdict).toBe('changed');
      expect(windowRow(r)?.detail).toMatch(/could not read every event/);
    });

    it('a served part that filled its limit, beside a part that was down', async () => {
      // (This case used to be "parts that state two seasons"; since 0.11 2.1b
      // that is a normal answer for the window the live read asks: below.)
      const full = (url: string) =>
        /dates=20261011(&|$)/.test(url)
          ? json({}, 503)
          : /dates=20261009(&|$)/.test(url)
            ? json({
                leagues: [{ season: SEASON }],
                events: Array.from({ length: 300 }, (_, i) => event(String(500000 + i), { date: '2026-10-09T15:00Z' })),
              })
            : healthy(url);
      const r = await run(full);
      expect(windowRow(r)?.verdict).toBe('changed');
      expect(windowRow(r)?.detail).toMatch(/filled its limit/);
      expect(r.red).toBe(true);
    });

    it('asks the provider nothing more to do so', async () => {
      const r = await run(withOct9(on9({ id: '' }), json({}, 503)));
      // live, day, the window's three, standings: the same six as a healthy run.
      expect(r.urls).toHaveLength(6);
    });
  });

  it('nothing wrong in what was seen: the part that could not be seen decides, and the row is neutral', async () => {
    const down = await run((url) => (/dates=20261011(&|$)/.test(url) ? json({}, 503) : healthy(url)));
    expect(windowRow(down)?.verdict).toBe('unreachable');
    expect(down.red).toBe(false);
  });
});

describe('found in review: the default scoreboard is checked like the dated ones', () => {
  // `fetchLive` keeps only matches in play, so a refused or id-less SCHEDULED
  // event on the default scoreboard used to disappear before any check ran.
  const onDefault = (events: unknown[]): Handler => (url) =>
    url.includes('/scoreboard') && !url.includes('dates=')
      ? json({ leagues: [{ season: SEASON }], events })
      : healthy(url);

  it('an event the parser refuses there is red', async () => {
    const r = await run(
      onDefault([event('1'), event('2', { status: { type: { name: 'STATUS_SOMETHING_NEW', state: 'limbo' } } })]),
    );
    expect(verdicts(r)).toEqual({ live: 'changed', day: 'ok', window: 'ok', standings: 'ok' });
  });

  it('a scheduled event there whose team has no id is red', async () => {
    const noId = event('1');
    (noId.competitions[0]?.competitors[1]?.team as { id?: string }).id = undefined;
    const r = await run(onDefault([noId]));
    expect(verdicts(r).live).toBe('changed');
    expect(r.rows.find((x) => x.request === 'live')?.detail).toMatch(/id/);
  });
});

describe('found in review: a refused record cannot hide behind a sibling', () => {
  it('two records under one id, saying different things, are not one healthy record', async () => {
    const r = await run((url) =>
      json(
        url.includes('/standings')
          ? standings()
          : { leagues: [{ season: SEASON }], events: [event('1'), event('1', { date: '2026-10-11T11:30Z' })] },
      ),
    );
    expect(verdicts(r).day).toBe('changed');
    expect(r.rows.find((x) => x.request === 'day')?.detail).toMatch(/2 sent, 1 read/);
  });

  it('the adapter says so itself: completeness rides on the result', async () => {
    const adapterFor = (events: unknown[]) =>
      new core.EspnAdapter({
        competition: 'eng.1',
        enrichGroups: false,
        fetchImpl: (async () => json({ leagues: [{ season: SEASON }], events })) as unknown as typeof fetch,
      });
    const whole = await adapterFor([event('1'), event('2')]).fetchByDate('2026-10-10');
    expect(core.fetchMeta(whole)?.complete).toBe(true);
    const refused = await adapterFor([
      event('1'),
      event('2', { status: { type: { name: 'STATUS_SOMETHING_NEW', state: 'limbo' } } }),
    ]).fetchByDate('2026-10-10');
    expect(refused).toHaveLength(1);
    expect(core.fetchMeta(refused)?.complete).toBe(false);
    // The live question filters to matches in play; the verdict is the whole response's.
    const live = await adapterFor([
      event('1'),
      event('2', { status: { type: { name: 'STATUS_SOMETHING_NEW', state: 'limbo' } } }),
    ]).fetchLive();
    expect(live).toHaveLength(0);
    expect(core.fetchMeta(live)?.complete).toBe(false);
  });
});

describe('found in review: every table shape, every row, every value', () => {
  const standingsCase = async (body: unknown) => {
    const r = await run((url) => json(url.includes('/standings') ? body : scoreboard(url)));
    return { verdict: verdicts(r).standings, detail: r.rows.find((x) => x.request === 'standings')?.detail ?? '' };
  };
  const row = (over: Record<string, unknown> = {}) => ({
    team: { id: '359', abbreviation: 'ARS', displayName: 'Arsenal' },
    stats: STATS.map((n) => ({ name: n, value: n === 'rank' ? 1 : 0 })),
    ...over,
  });
  const table = (entries: unknown) => ({ children: [{ name: 'Group A', standings: { entries } }] });

  it('a nested shape (groups under a phase) is red: its rows are well formed, and the product reads none of it', async () => {
    // It used to be green as "a shape the table parser does not read yet". No
    // shape is excused now: every competition with a table must be read whole.
    const nested = { children: [{ name: 'League Phase', children: [{ name: 'Group A', standings: { entries: [row()] } }] }] };
    expect(await standingsCase(nested)).toEqual({ verdict: 'changed', detail: 'the adapter could not read the tables' });
  });

  it('a row in a nested table is checked like any other', async () => {
    const nested = {
      children: [{ name: 'League Phase', children: [{ name: 'Group A', standings: { entries: [row({ team: { displayName: 'Arsenal' } })] } }] }],
    };
    expect((await standingsCase(nested)).verdict).toBe('changed');
  });

  it('a table whose rows are not a list is red, not "no table"', async () => {
    expect((await standingsCase(table({ 0: row() }))).verdict).toBe('changed');
    expect((await standingsCase({ children: { 0: {} } })).verdict).toBe('changed');
  });

  it('and it is red beside a healthy sibling too: a readable table does not excuse an unreadable one', async () => {
    const good = { name: 'Group A', standings: { entries: [row()] } };
    const badRows = await standingsCase({ children: [good, { name: 'Group B', standings: { entries: { 0: row() } } }] });
    expect(badRows).toEqual({ verdict: 'changed', detail: 'a table has no `entries` list' });
    const badChildren = await standingsCase({ children: [{ ...good, children: { 0: {} } }] });
    expect(badChildren).toEqual({ verdict: 'changed', detail: '`children` is not a list' });
  });

  it('a row without statistics is red, not skipped', async () => {
    const { verdict, detail } = await standingsCase(table([row({ stats: undefined })]));
    expect(verdict).toBe('changed');
    expect(detail).toMatch(/Arsenal/);
  });

  it('a statistic that is not a number is red', async () => {
    // The product's parser refuses such a row too, so the VERDICT is red either
    // way; what the raw check owns is the diagnosis, and that is what is pinned.
    const strings = row({ stats: STATS.map((n) => ({ name: n, displayValue: '0' })) });
    expect(await standingsCase(table([strings]))).toEqual({ verdict: 'changed', detail: 'Arsenal: the statistic gamesPlayed is not a number' });
    const text = row({ stats: STATS.map((n) => ({ name: n, value: '0' })) });
    expect(await standingsCase(table([text]))).toEqual({ verdict: 'changed', detail: 'Arsenal: the statistic gamesPlayed is not a number' });
  });

  it('a statistic stated twice is red', async () => {
    const twice = row({ stats: [...STATS.map((n) => ({ name: n, value: n === 'rank' ? 1 : 0 })), { name: 'points', value: 3 }] });
    const { verdict, detail } = await standingsCase(table([twice]));
    expect(verdict).toBe('changed');
    expect(detail).toMatch(/points/);
  });

  it('the statistics the canary requires are the ones the table parser requires', () => {
    // The list in the script is a copy of the parser's needs. Pinned both ways,
    // through the real parser: each one is needed, and no other one is.
    expect([...STANDING_STATS].sort()).toEqual([...STATS].sort());
    const groupA = (stats: string[]) => ({
      children: [
        {
          name: 'Group A',
          standings: {
            entries: [
              { team: { id: '203', abbreviation: 'MEX', displayName: 'Mexico' }, stats: stats.map((n) => ({ name: n, value: n === 'rank' ? 1 : 0 })) },
            ],
          },
        },
      ],
    });
    const rows = (payload: unknown) => core.parseStandings(payload).flatMap((t) => t.rows).length;
    expect(rows(groupA([...STANDING_STATS]))).toBe(1);
    for (const gone of STANDING_STATS) {
      expect(rows(groupA(STANDING_STATS.filter((n) => n !== gone))), gone).toBe(0);
    }
  });
});

describe('found in review: absence is a finding, and the product’s own parser is asked where it claims the tables', () => {
  const GROUPS = 'ABCDEFGHIJKL'.split('');
  /** A World Cup shaped payload: one table per lettered group, one team each. */
  const wcStandings = (groups = GROUPS, over: (row: Record<string, unknown>, group: string) => Record<string, unknown> = (r) => r) => ({
    children: groups.map((g, i) => ({
      name: `Group ${g}`,
      standings: {
        entries: [
          over(
            {
              team: { id: String(200 + i), abbreviation: `T${g}X`, displayName: `Team ${g}` },
              stats: STATS.map((n) => ({ name: n, value: n === 'rank' ? 1 : 0 })),
            },
            g,
          ),
        ],
      },
    })),
  });
  const wc = async (body: unknown) => {
    const r = await run((url) => json(url.includes('/standings') ? body : scoreboard(url)), ['fifa.world']);
    return r.rows.find((x) => x.request === 'standings');
  };

  it('a payload with no table rows is red for a competition that serves a table', async () => {
    for (const body of [{}, { children: [] }, { children: [{ name: 'Group A', standings: { entries: [] } }] }]) {
      const r = await run((url) => json(url.includes('/standings') ? body : scoreboard(url)));
      expect(verdicts(r).standings, JSON.stringify(body)).toBe('changed');
    }
  });

  it('and expected of a knockout-only competition, which is the only kind excused', async () => {
    // What the Concacaf Champions Cup's standings endpoint answers (Oct 2 2026).
    const seasonsOnly = { name: 'Concacaf Champions Cup', season: { year: 2026 }, seasons: [{ year: 2016 }] };
    const none = Object.keys(core.STANDINGS_SHAPE).filter((c) => core.STANDINGS_SHAPE[c] === 'none');
    expect(none).toEqual(['concacaf.champions']);
    for (const competition of CANARY_COMPETITIONS) {
      const r = await run((url) => json(url.includes('/standings') ? seasonsOnly : scoreboard(url)), [competition]);
      expect(verdicts(r).standings, competition).toBe(none.includes(competition) ? 'ok' : 'changed');
    }
  });

  it('"no table" is an expectation the feed is checked against, not an exemption', async () => {
    const champions = async (body: unknown) => {
      const r = await run((url) => json(url.includes('/standings') ? body : scoreboard(url)), ['concacaf.champions']);
      return r.rows.find((x) => x.request === 'standings');
    };
    // The day it serves a table, in any shape, a person decides what that means.
    expect(await champions(standings())).toMatchObject({ verdict: 'changed', detail: '2 row(s) in 1 table(s), where no table was expected' });
    expect((await champions(groupStandings(['A', 'B'])))?.verdict).toBe('changed');
    // And "no rows" is healthy only when the product's own reader took the answer for an empty one:
    // the competition's own document, with no table list or an empty one.
    const doc = { name: 'Concacaf Champions Cup', season: { year: 2026 } };
    expect((await champions({ ...doc, children: [] }))?.verdict).toBe('ok');
    expect((await champions({ children: [] }))?.verdict).toBe('changed'); // not the competition's document
    expect((await champions({ code: 404, message: 'Not Found' }))?.verdict).toBe('changed');
    expect((await champions({ name: 'Error', code: 404, message: 'not found' }))?.verdict).toBe('changed'); // a name is not the document
    // Nor is an error that happens to carry a season (found in review: it was green).
    expect((await champions({ name: 'Error', season: { year: 2026 }, code: 500, message: 'standings unavailable' }))?.verdict).toBe('changed');
    expect((await champions({ ...doc, children: [{ name: 'Group A', standings: { entries: [] } }] }))?.verdict).toBe('changed');
    expect((await champions({ ...doc, children: 'x' }))?.verdict).toBe('changed');
  });

  it('the shape of every competition the canary watches is written down in core, and the canary reads it there', () => {
    // A league serves one table; one competition has none; the rest are groups.
    for (const c of Object.keys(core.STANDINGS_SHAPE)) expect(CANARY_COMPETITIONS, c).toContain(c);
    expect(CANARY_COMPETITIONS.filter((c) => core.STANDINGS_SHAPE[c] === 'league').sort()).toEqual(
      ['eng.1', 'esp.1', 'ger.1', 'ita.1', 'mex.1', 'uefa.champions'].sort(),
    );
  });

  describe('found in review (round 2): the product’s parser is asked wherever it reads the tables, not only for the bundle', () => {
    const groupsCase = async (competition: string, body: unknown) => {
      const r = await run((url) => json(url.includes('/standings') ? body : scoreboard(url)), [competition]);
      return r.rows.find((x) => x.request === 'standings');
    };
    const badRow = (id: string, name: string, rank: number) => ({
      team: { id, abbreviation: 'BAD', displayName: name },
      // One win, no points: all there, all numbers, and refused by the parser.
      stats: STATS.map((n) => ({ name: n, value: n === 'wins' || n === 'gamesPlayed' ? 1 : n === 'rank' ? rank : 0 })),
    });

    it('a cup the parser reads: whole is green', async () => {
      const row = await groupsCase('concacaf.gold', wcStandings(['A', 'B', 'C', 'D']));
      expect(row).toMatchObject({ verdict: 'ok', detail: '4 row(s) in 4 table(s)' });
    });

    it('a cup the parser reads: a refused row is red though the group is still served', async () => {
      const body = wcStandings(['A', 'B', 'C', 'D']);
      body.children[1]?.standings.entries.push(badRow('298', 'Team B2', 2));
      const row = await groupsCase('concacaf.gold', body);
      expect(row?.verdict).toBe('changed');
      expect(row?.detail).toBe('the adapter could not read every row of Group B');
    });

    it('a cup the parser reads: when it can read none of it, that is red, not "a shape it does not read"', async () => {
      const body = wcStandings(['A', 'B'], (_row, g) => badRow(g === 'A' ? '297' : '298', `Team ${g}`, 1));
      const row = await groupsCase('concacaf.gold', body);
      expect(row?.verdict).toBe('changed');
      expect(row?.detail).toMatch(/could not read the tables/);
    });

    it('any other competition: tables the adapter DID read must be whole too', async () => {
      const body = wcStandings(['A']);
      body.children[0]?.standings.entries.push(badRow('298', 'Team A2', 2));
      expect((await groupsCase('uefa.nations', body))?.verdict).toBe('changed');
    });

    it('groups under a league are read as what they are: two leagues’ Group A are two tables', async () => {
      // The Concacaf Nations League's shape on the real feed (Oct 2 2026). The
      // parser used to take "League A, Group A" for group A and drop League
      // B's: this row was red ("2 sent, 1 read") until the tables were keyed.
      const body = wcStandings(['A', 'B']);
      const names = ['League A, Group A', 'League B, Group A'];
      body.children.forEach((child, i) => {
        child.name = names[i] as string;
      });
      expect(await groupsCase('concacaf.nations.league', body)).toMatchObject({ verdict: 'ok', detail: '2 row(s) in 2 table(s)' });
    });

    it('a league table is read, and the row says so plainly', async () => {
      expect(await groupsCase('eng.1', standings())).toMatchObject({ verdict: 'ok', detail: '2 row(s) in 1 table(s)' });
    });

    it('a league that serves two tables is red: the product reads neither', async () => {
      const two = standings();
      two.children.push({ ...two.children[0], name: '2026 Torneo Clausura' } as (typeof two.children)[number]);
      expect(await groupsCase('mex.1', two)).toMatchObject({ verdict: 'changed', detail: 'the adapter could not read the tables' });
    });

    it('a table that is partial is named by its key when it is not a lettered group', async () => {
      const body = standings();
      body.children[0]?.standings.entries.push(badRow('298', 'Third', 3));
      expect((await groupsCase('eng.1', body))?.detail).toBe('the adapter could not read every row of table LEAGUE');
    });
  });

  it('the bundled competition’s twelve groups, all read, are green', async () => {
    const row = await wc(wcStandings());
    expect(row?.verdict).toBe('ok');
    expect(row?.detail).toBe('12 row(s) in 12 table(s)');
  });

  it('a group the adapter expects and does not get is red, though every row sent is well formed', async () => {
    const row = await wc(wcStandings(GROUPS.filter((g) => g !== 'L')));
    expect(row?.verdict).toBe('changed');
    expect(row?.detail).toMatch(/\bL\b/);
  });

  it('a whole table the product’s parser refuses is red, though every expected group survives', async () => {
    // Found in review (round 2): a second, contradictory Group A is dropped by
    // the parser. The twelve survivors are all there and none is partial; only
    // the parser's own account says something was left out.
    const second = wcStandings(['A']).children[0];
    (second?.standings.entries[0]?.team as { id: string }).id = '298';
    const duplicate = wcStandings();
    duplicate.children.push(second as (typeof duplicate.children)[number]);
    // A key two children claim belongs to neither: eleven tables are read.
    expect(core.parseStandings(duplicate)).toHaveLength(11);
    expect((await wc(duplicate))?.verdict).toBe('changed');

    const unknownName = wcStandings();
    unknownName.children.push({ ...(second as (typeof duplicate.children)[number]), name: 'Second Phase' });
    expect((await wc(unknownName))?.verdict).toBe('changed');

    // A table with a readable name that the bundled competition does not
    // expect (a numbered group among the World Cup's twelve) is not read
    // either: the adapter hands the parser its expected keys, and a child
    // outside them is a child that did not become a table.
    const extra = wcStandings();
    extra.children.push({ ...(second as (typeof duplicate.children)[number]), name: 'Group A1' });
    expect(core.parseStandings(extra)).toHaveLength(13); // read with no expectation
    expect(await wc(extra)).toMatchObject({ verdict: 'changed', detail: 'the adapter could not read every table (13 sent, 12 read)' });
    // A table at the ROOT beside the groups is a table the product does not read.
    const atRoot = {
      ...wcStandings(),
      standings: { entries: [{ team: { id: '999', abbreviation: 'ZZZ', displayName: 'Root' }, stats: STATS.map((n) => ({ name: n, value: n === 'rank' ? 1 : 0 })) }] },
    };
    expect(await wc(atRoot)).toMatchObject({ verdict: 'changed', detail: 'the adapter could not read every table (13 sent, 12 read)' });
  });

  it('the adapter says so itself: a standings result states whether every table and row was read', async () => {
    const adapterFor = (body: unknown) =>
      new core.EspnAdapter({ competition: 'fifa.world', fetchImpl: (async () => json(body)) as unknown as typeof fetch });
    expect(core.fetchMeta(await adapterFor(wcStandings()).fetchStandings())?.complete).toBe(true);
    const second = wcStandings(['A']).children[0];
    const duplicate = wcStandings();
    duplicate.children.push(second as (typeof duplicate.children)[number]);
    expect(core.fetchMeta(await adapterFor(duplicate).fetchStandings())?.complete).toBe(false);
  });

  it('only "complete, no partial table, nothing missing" is healthy: every other combination is a problem', () => {
    // The three questions are independent; this is every way they can combine.
    const whole = [{ group: 'A' }, { group: 'B' }];
    const withPartial = [{ group: 'A', partial: { omitted: 1 } }, { group: 'B' }];
    for (const complete of [true, false, undefined]) {
      for (const tables of [whole, withPartial]) {
        for (const expected of [['A', 'B'], ['A', 'B', 'C'], []]) {
          const problem = adapterTablesProblem({ complete, tables, expected, sent: 3 });
          const healthy = complete === true && tables === whole && !expected.includes('C');
          expect(problem === undefined, JSON.stringify({ complete, partial: tables !== whole, expected })).toBe(healthy);
        }
      }
    }
    // And each names its own cause, the most specific first.
    expect(adapterTablesProblem({ complete: false, tables: withPartial, expected: ['A', 'B', 'C'], sent: 3 })).toMatch(/every row of Group A/);
    expect(adapterTablesProblem({ complete: false, tables: whole, expected: ['A', 'B', 'C'], sent: 3 })).toMatch(/every table \(3 sent, 2 read\)/);
    expect(adapterTablesProblem({ complete: true, tables: whole, expected: ['A', 'B', 'C'], sent: 3 })).toMatch(/expects group\(s\) C/);
  });

  it('a row the parser leaves out is red even when it calls the batch complete', async () => {
    // Found in review (round 3), in my round 2 change: I had folded the partial
    // check into the completeness check. A row with an id and no readable name
    // is "not a team" to the parser: it is left out, its table is marked
    // partial, and the batch still reports complete. Two verdicts, asked
    // separately.
    const body = wcStandings();
    body.children[0]?.standings.entries.push({
      team: { id: '999' } as { id: string; abbreviation: string; displayName: string },
      stats: STATS.map((n) => ({ name: n, value: n === 'rank' ? 2 : 0 })),
    });
    const adapter = new core.EspnAdapter({
      competition: 'fifa.world',
      fetchImpl: (async () => json(body)) as unknown as typeof fetch,
    });
    const tables = await adapter.fetchStandings();
    expect(core.fetchMeta(tables)?.complete).toBe(true);
    expect(tables.find((t) => t.group === 'A')?.partial).toEqual({ omitted: 1 });
    const row = await wc(body);
    expect(row?.verdict).toBe('changed');
    expect(row?.detail).toBe('the adapter could not read every row of Group A');
  });

  it('a row the product’s parser refuses is red, though its statistics are all there', async () => {
    // Group C gets a second team with one win and no points: every statistic
    // present and numeric, the group still there, and a table the product
    // would mark partial.
    const body = wcStandings();
    body.children[2]?.standings.entries.push({
      team: { id: '299', abbreviation: 'TCY', displayName: 'Team C2' },
      stats: STATS.map((n) => ({ name: n, value: n === 'wins' || n === 'gamesPlayed' ? 1 : n === 'rank' ? 2 : 0 })),
    });
    const tables = core.parseStandings(body);
    expect(tables.find((t) => t.group === 'C')?.partial).toEqual({ omitted: 1 });
    const row = await wc(body);
    expect(row?.verdict).toBe('changed');
    expect(row?.detail).toBe('the adapter could not read every row of Group C');
  });
});

describe('found in review: it asks every request form the adapter has, with the spans the product uses', () => {
  it('the bundled competition is also asked for its knockout span, the one the bracket and the countdown read', async () => {
    const r = await run(healthy, ['fifa.world']);
    expect(r.rows.map((row) => row.request)).toEqual(['live', 'day', 'window', 'knockout', 'standings']);
    const span = core.knockoutWindow();
    expect(span).not.toBeNull();
    // A month at a time: June and July hold it.
    expect(r.rows.find((x) => x.request === 'knockout')?.requests).toBe(2);
    expect(r.urls.filter((u) => /dates=20260[67](&|$)/.test(u))).toHaveLength(2);
    expect(r.urls.some((u) => /dates=\d+-\d+/.test(u))).toBe(false);
  });

  it('a competition with no bundled bracket is not asked for one', async () => {
    const r = await run(healthy);
    expect(r.rows.map((row) => row.request)).toEqual(['live', 'day', 'window', 'standings']);
  });

  it('a provider that serves days and refuses a month is red', async () => {
    const r = await run(
      (url) =>
        /dates=\d{6}(&|$)/.test(url)
          ? json({ code: 400, message: 'Failed to get events endpoint.' }, 400)
          : healthy(url),
      ['fifa.world'],
    );
    expect(verdicts(r).window).toBe('ok');
    expect(verdicts(r).knockout).toBe('rejected');
    expect(r.red).toBe(true);
  });

  it('no fetch method of the adapter goes unasked', () => {
    // A request form added to the adapter (0.11 adds at least one) must be
    // asked here, or listed below with the reason it is covered.
    const COVERED_ELSEWHERE: Record<string, string> = {
      fetchGroupMap: 'the standings request, asked through fetchStandings',
      fetchScoreboard: 'private: the scoreboard questions all go through it',
    };
    const onAdapter = Object.getOwnPropertyNames(core.EspnAdapter.prototype).filter((n) => n.startsWith('fetch'));
    const asked = new Set(CANARY_QUESTIONS.map((q) => q.method));
    expect(onAdapter.filter((n) => !asked.has(n) && !(n in COVERED_ELSEWHERE))).toEqual([]);
    for (const q of CANARY_QUESTIONS) expect(onAdapter, q.method).toContain(q.method);
  });
});

describe('found in review: a run that could not see says so', () => {
  it('blocked and unreachable rows are a warning for the person, not a green silence', async () => {
    const blocked = await run(() => json({}, 429), ['eng.1', 'esp.1']);
    expect(canaryWarnings(blocked)).toEqual(['8 of 8 questions were not answered (8 blocked, 0 unreachable): the canary saw nothing of those']);
    const fine = await run(healthy);
    expect(canaryWarnings(fine)).toEqual([]);
  });
});

describe('found in review (round 2): an error body cannot hold the run', () => {
  // The first fix read a CLONE of every body. A clone's two branches only finish
  // cancelling together, and the adapter never reads an error body: once the
  // canary's branch passed its limit, its cancel waited forever on the other.
  const big = (bytes: number) => JSON.stringify({ message: 'x'.repeat(bytes) });

  it('a large error body: the run completes and the status decides', { timeout: 2000 }, async () => {
    const body = big(70 * 1024);
    const r = await run((url) =>
      /dates=20261011(&|$)/.test(url)
        ? new Response(body, { status: 400, headers: { 'content-length': String(Buffer.byteLength(body)) } })
        : healthy(url),
    );
    expect(verdicts(r)).toEqual({ live: 'ok', day: 'ok', window: 'rejected', standings: 'ok' });
  });

  it('a large throttle body, with no declared length: one request, the run stops', { timeout: 2000 }, async () => {
    const r = await run(() => new Response(big(128 * 1024), { status: 429 }), ['eng.1', 'esp.1']);
    expect(r.urls).toHaveLength(1);
    expect(new Set(r.rows.map((row) => row.verdict))).toEqual(new Set(['blocked']));
  });

  it('an error body that never ends is abandoned at a deadline, and the next question is asked', { timeout: 2000 }, async () => {
    const stalled = () => new Response(new ReadableStream<Uint8Array>({ pull() {} }), { status: 400 });
    const f = feed((url) => (/dates=20261011(&|$)/.test(url) ? stalled() : healthy(url)));
    const r = await runCanary({ core, competitions: ['eng.1'], fetchImpl: f.fetchImpl, now: NOW, pauseMs: 0, bodyDeadlineMs: 20 });
    expect(verdicts(r)).toEqual({ live: 'ok', day: 'ok', window: 'rejected', standings: 'ok' });
  });
});

describe('found in review: the canary reads no more than the adapter would', () => {
  it('an oversized body is cancelled at the adapter’s limit, and reported', async () => {
    const CHUNK = 256 * 1024;
    let pulled = 0;
    let cancelled = false;
    const endless = () =>
      new Response(
        new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              if (pulled >= 64 * 1024 * 1024) return controller.close();
              pulled += CHUNK;
              controller.enqueue(new Uint8Array(CHUNK).fill(0x20));
            },
            cancel() {
              cancelled = true;
            },
          },
          { highWaterMark: 0 },
        ),
        { status: 200 },
      );
    // Served once, to the `day` question (the window asks for the same day later).
    let served = false;
    const r = await run((url) => {
      if (served || !/dates=20261010(&|$)/.test(url)) return healthy(url);
      served = true;
      return endless();
    });
    expect(core.MAX_RESPONSE_BYTES).toBe(5 * 1024 * 1024);
    expect(cancelled).toBe(true);
    // The bound is on the bytes taken from the provider, whoever is reading.
    expect(pulled).toBeLessThanOrEqual(core.MAX_RESPONSE_BYTES + 4 * CHUNK);
    expect(verdicts(r).day).toBe('changed');
    expect(r.rows.find((x) => x.request === 'day')?.detail).toMatch(/larger/);
  });
});

describe('what it watches and how it reports', () => {
  it('watches the 0.11 competitions', () => {
    expect([...CANARY_COMPETITIONS].sort()).toEqual(
      [
        'eng.1',
        'esp.1',
        'ita.1',
        'ger.1',
        'mex.1',
        'uefa.champions',
        'concacaf.champions',
        'fifa.cwc',
        'conmebol.libertadores',
        'conmebol.america',
        'concacaf.gold',
        'uefa.euro',
        'fifa.world',
        'uefa.nations',
        'concacaf.nations.league',
      ].sort(),
    );
  });

  it('the report names every red row and states the totals', async () => {
    const r = await run((url) =>
      /dates=\d{8}(&|$)/.test(url) ? json({ code: 400, message: 'Failed to get events endpoint.' }, 400) : healthy(url),
    );
    const text = formatCanary(r);
    expect(text).toMatch(/eng\.1\s+day\s+REJECTED/);
    expect(text).toMatch(/eng\.1\s+window\s+REJECTED/);
    expect(text).toMatch(/2 red/);
    expect(text).toMatch(/2 ok/);
  });

  it('scripts are checked out with LF on every platform', () => {
    // This test imports the script, and on a Windows checkout (CRLF) the test
    // transform has failed on it twice: a `#!` line it did not strip, and then
    // a STALL (no test file ever finished; the job ran to its 20-minute limit)
    // on line comments that contain quote characters. Node itself runs either
    // form. Reproduced by converting the file to CRLF; LF does not stall. The
    // rule below takes the difference away instead of policing comments.
    const attributes = readFileSync(fileURLToPath(new URL('../../../.gitattributes', import.meta.url)), 'utf8');
    expect(attributes).toMatch(/^scripts\/\*\* text eol=lf$/m);
    const script = readFileSync(fileURLToPath(new URL('../../../scripts/espn-canary.mjs', import.meta.url)), 'utf8');
    expect(script.includes('\r\n')).toBe(false);
  });

  it('the script has no shebang line', () => {
    // This test imports the script. Under vitest a module is wrapped before it
    // runs, so a `#!` line is only valid if the transform strips it, and on a
    // Windows checkout (CRLF) it does not: the suite failed there with
    // "Invalid or unexpected token". It is run as `node scripts/espn-canary.mjs`.
    const script = readFileSync(fileURLToPath(new URL('../../../scripts/espn-canary.mjs', import.meta.url)), 'utf8');
    expect(script.startsWith('#!')).toBe(false);
  });

  it('the workflow is scheduled, manual, unbadged, and never gates a pull request', () => {
    const workflow = readFileSync(
      fileURLToPath(new URL('../../../.github/workflows/espn-canary.yml', import.meta.url)),
      'utf8',
    );
    expect(workflow).toMatch(/^\s*schedule:/m);
    expect(workflow).toMatch(/^\s*workflow_dispatch:/m);
    expect(workflow).not.toMatch(/pull_request/);
    expect(workflow).not.toMatch(/^\s*push:/m);
    expect(workflow).toContain('node scripts/espn-canary.mjs');
    // Third-party actions pinned by commit SHA, like ci.yml.
    for (const uses of workflow.match(/uses:\s*\S+/g) ?? []) {
      expect(uses, uses).toMatch(/@[0-9a-f]{40}$/);
    }
    const readme = readFileSync(fileURLToPath(new URL('../../../README.md', import.meta.url)), 'utf8');
    expect(readme).not.toMatch(/espn-canary\.yml\/badge/);
  });
});


describe('the window across a season turn (0.11 2.1b): the canary asks it the way the live read does', () => {
  // Measured Oct 3 2026: a day response states the season of the DATE asked and
  // each competition turns on its own date (June 1 for `eng.1`). The live read
  // composes across the turn (no season, both seasons stated); every other
  // window keeps refusing. A healthy turn day must not be red.
  const windowRow = (r: { rows: Array<{ request: string; verdict: string; detail: string }> }) => r.rows.find((x) => x.request === 'window');
  const other = { ...SEASON, year: 2027, displayName: '2027-28 English Premier League' };
  const turn = (url: string) => (/dates=20261011(&|$)/.test(url) ? json({ leagues: [{ season: other }], events: [] }) : healthy(url));

  it('two healthy parts stating two seasons: ok, and the detail names both years', async () => {
    const r = await run(turn);
    expect(windowRow(r)?.verdict).toBe('ok');
    expect(windowRow(r)?.detail).toMatch(/2026/);
    expect(windowRow(r)?.detail).toMatch(/2027/);
    expect(r.red).toBe(false);
  });

  it('the same beside a part that was down: unreachable, not red', async () => {
    const r = await run((url) => (/dates=20261010(&|$)/.test(url) ? json({}, 503) : turn(url)));
    expect(windowRow(r)?.verdict).toBe('unreachable');
    expect(r.red).toBe(false);
  });

  it('parts that state no season at all: changed, as before', async () => {
    const r = await run((url) => (url.includes('/standings') ? healthy(url) : json({ leagues: [{}], events: filed(url, [event('401878761')]) })));
    expect(windowRow(r)?.verdict).toBe('changed');
    expect(windowRow(r)?.detail).toMatch(/no readable season/);
    expect(r.red).toBe(true);
  });
});
