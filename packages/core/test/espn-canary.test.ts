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
import { CANARY_COMPETITIONS, formatCanary, runCanary } from '../../../scripts/espn-canary.mjs';
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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

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

  it('a competition with no fixtures in the window and no table is still green', async () => {
    const r = await run((url) => json(url.includes('/standings') ? {} : { leagues: [{ season: SEASON }], events: [] }));
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
    expect(day?.detail).toMatch(/1 of 2/);
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
