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
const healthyScoreboard = { leagues: [{ season: SEASON }], events: [event('401878761')] };

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
const healthy: Handler = (url) => json(url.includes('/standings') ? standings() : healthyScoreboard);

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
    expect(r.urls).toHaveLength(4);
    for (const u of r.urls) expect(u).toContain('/soccer/eng.1/');
    // bare bucket · one day · a three-day window · the standings endpoint
    expect(r.urls.filter((u) => u.includes('/scoreboard') && !u.includes('dates='))).toHaveLength(1);
    expect(r.urls.filter((u) => /dates=20261010(&|$)/.test(u))).toHaveLength(1);
    expect(r.urls.filter((u) => /dates=20261009-20261011(&|$)/.test(u))).toHaveLength(1);
    expect(r.urls.filter((u) => u.includes('/standings'))).toHaveLength(1);
  });

  it('a competition with no fixtures in the window is still green', async () => {
    const r = await run((url) => json(url.includes('/standings') ? standings() : { leagues: [{ season: SEASON }], events: [] }));
    expect(r.red).toBe(false);
  });
});

describe('the provider refuses a request form', () => {
  // The recorded rejection of Oct 2 2026: ranges only, with this body.
  const RANGE_REJECTED: Handler = (url) =>
    /dates=\d{8}-\d{8}/.test(url)
      ? json({ code: 400, message: 'Failed to get events endpoint.' }, 400)
      : healthy(url);

  it('is red, and says which request and why', async () => {
    const r = await run(RANGE_REJECTED);
    expect(r.red).toBe(true);
    expect(verdicts(r)).toEqual({ live: 'ok', day: 'ok', window: 'rejected', standings: 'ok' });
    const row = r.rows.find((x) => x.request === 'window');
    expect(row?.detail).toContain('400');
    expect(row?.url).toMatch(/dates=20261009-20261011/);
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
          : healthyScoreboard,
      ),
    );
    expect(missingStat.red).toBe(true);
    expect(verdicts(missingStat).standings).toBe('changed');
    expect(missingStat.rows.find((x) => x.request === 'standings')?.detail).toMatch(/points/);

    const missingId = await run((url) =>
      json(
        url.includes('/standings')
          ? standings((e) => ({ ...e, team: { abbreviation: 'ARS', displayName: 'Arsenal' } }))
          : healthyScoreboard,
      ),
    );
    expect(missingId.red).toBe(true);
    expect(verdicts(missingId).standings).toBe('changed');
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
    const r = await run((url) => (/dates=\d{8}-\d{8}/.test(url) ? brokenBody(400) : healthy(url)));
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
    const r = await run((url) => (url.includes('dates=20261010') && !url.includes('-') ? brokenBody(200) : healthy(url)));
    expect(verdicts(r).day).toBe('unreachable');
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
    expect(r.urls).toHaveLength(5);
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
    const r = await run((url) => json(url.includes('/standings') ? body : healthyScoreboard));
    return { verdict: verdicts(r).standings, detail: r.rows.find((x) => x.request === 'standings')?.detail ?? '' };
  };
  const row = (over: Record<string, unknown> = {}) => ({
    team: { id: '359', abbreviation: 'ARS', displayName: 'Arsenal' },
    stats: STATS.map((n) => ({ name: n, value: n === 'rank' ? 1 : 0 })),
    ...over,
  });
  const table = (entries: unknown) => ({ children: [{ name: 'Group A', standings: { entries } }] });

  it('a healthy nested shape (groups under a phase) is green, and its rows are counted', async () => {
    const nested = { children: [{ name: 'League Phase', children: [{ name: 'Group A', standings: { entries: [row()] } }] }] };
    expect(await standingsCase(nested)).toEqual({ verdict: 'ok', detail: '1 row(s) in 1 table(s)' });
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

  it('a row without statistics is red, not skipped', async () => {
    const { verdict, detail } = await standingsCase(table([row({ stats: undefined })]));
    expect(verdict).toBe('changed');
    expect(detail).toMatch(/Arsenal/);
  });

  it('a statistic that is not a number is red', async () => {
    const strings = row({ stats: STATS.map((n) => ({ name: n, displayValue: '0' })) });
    expect((await standingsCase(table([strings]))).verdict).toBe('changed');
    const text = row({ stats: STATS.map((n) => ({ name: n, value: '0' })) });
    expect((await standingsCase(table([text]))).verdict).toBe('changed');
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
    const r = await run((url) => json(url.includes('/standings') ? body : healthyScoreboard), ['fifa.world']);
    return r.rows.find((x) => x.request === 'standings');
  };

  it('a payload with no table at all is red: every competition serves one today', async () => {
    for (const body of [{}, { children: [] }, { children: [{ name: 'Group A', standings: { entries: [] } }] }]) {
      const r = await run((url) => json(url.includes('/standings') ? body : healthyScoreboard));
      expect(verdicts(r).standings, JSON.stringify(body)).toBe('changed');
    }
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

  it('a row the product’s parser refuses is red, though its statistics are all there', async () => {
    // One win and no points: every statistic present and numeric, and a table
    // the product would mark partial.
    const row = await wc(
      wcStandings(GROUPS, (r, g) =>
        g === 'C'
          ? {
              ...r,
              stats: STATS.map((n) => ({ name: n, value: n === 'rank' || n === 'wins' || n === 'gamesPlayed' ? 1 : 0 })),
            }
          : r,
      ),
    );
    expect(row?.verdict).toBe('changed');
    expect(row?.detail).toMatch(/Group C|\bC\b/);
  });
});

describe('found in review: it asks every request form the adapter has, with the spans the product uses', () => {
  it('the bundled competition is also asked for its knockout span, the one the bracket and the countdown read', async () => {
    const r = await run(healthy, ['fifa.world']);
    expect(r.rows.map((row) => row.request)).toEqual(['live', 'day', 'window', 'knockout', 'standings']);
    const span = core.knockoutWindow();
    expect(span).not.toBeNull();
    expect(r.rows.find((x) => x.request === 'knockout')?.url).toContain(`dates=${span?.start}-${span?.end}`);
  });

  it('a competition with no bundled bracket is not asked for one', async () => {
    const r = await run(healthy);
    expect(r.rows.map((row) => row.request)).toEqual(['live', 'day', 'window', 'standings']);
  });

  it('a provider that accepts a three-day range and refuses the long one is red', async () => {
    const span = core.knockoutWindow();
    const r = await run(
      (url) =>
        url.includes(`dates=${span?.start}-${span?.end}`)
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
    expect(canaryWarnings(blocked)).toEqual(['8 of 8 requests were not answered (8 blocked, 0 unreachable): the canary saw nothing of those']);
    const fine = await run(healthy);
    expect(canaryWarnings(fine)).toEqual([]);
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
    const r = await run((url) => (url.includes('dates=20261010') && !url.includes('-') ? endless() : healthy(url)));
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
      /dates=\d{8}-\d{8}/.test(url) ? json({ code: 400, message: 'Failed to get events endpoint.' }, 400) : healthy(url),
    );
    const text = formatCanary(r);
    expect(text).toMatch(/eng\.1\s+window\s+REJECTED/);
    expect(text).toMatch(/1 red/);
    expect(text).toMatch(/3 ok/);
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
