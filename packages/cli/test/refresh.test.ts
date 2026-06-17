import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readState } from '../src/cache';
import { runRefresh, shouldRefresh } from '../src/refresh';

// A time well outside any World Cup window (tournament starts 2026-06-11).
const PRE_WC = new Date('2026-06-04T16:00:00Z').getTime();

let dir: string;
const ORIG = process.env.CLAUDINHO_COMPETITION;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claudinho-refresh-'));
  process.env.XDG_CACHE_HOME = dir; // empty cache → stale → would refresh if windowed
  delete process.env.CLAUDINHO_COMPETITION;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (ORIG === undefined) delete process.env.CLAUDINHO_COMPETITION;
  else process.env.CLAUDINHO_COMPETITION = ORIG;
});

describe('shouldRefresh — competition-aware live window', () => {
  it('does NOT refresh outside a World Cup window (default competition)', () => {
    // No CLAUDINHO_COMPETITION → gated on the static WC schedule, which has no
    // match on 2026-06-04, so we must not poll.
    expect(shouldRefresh(PRE_WC)).toBe(false);
  });

  it('DOES refresh for a non-default competition (e.g. friendlies)', () => {
    // The WC schedule can't describe friendly windows, so the gate is bypassed
    // and a stale cache is allowed to refresh.
    process.env.CLAUDINHO_COMPETITION = 'fifa.friendly';
    expect(shouldRefresh(PRE_WC)).toBe(true);
  });
});

// ESPN-shaped scoreboard: the in-play match kicked off at 04:00Z (the provider
// files it under its NEXT day bucket) plus an already-FT match from the default
// bucket. A no-date fetchLive() would return [] here; the windowed path must
// keep only the in-play match.
const SCOREBOARD = {
  day: { date: '2026-06-16' },
  events: [
    {
      id: '760431',
      date: '2026-06-17T04:00Z',
      name: 'Jordan at Austria',
      season: { year: 2026, slug: 'group-stage' },
      status: {
        type: { name: 'STATUS_IN_PROGRESS', state: 'in', completed: false },
        displayClock: "76'",
        period: 2,
      },
      competitions: [
        {
          venue: { fullName: 'Ernst-Happel-Stadion' },
          competitors: [
            { homeAway: 'home', score: '2', team: { abbreviation: 'AUT', displayName: 'Austria' } },
            { homeAway: 'away', score: '1', team: { abbreviation: 'JOR', displayName: 'Jordan' } },
          ],
        },
      ],
    },
    {
      id: '760415',
      date: '2026-06-16T19:00Z',
      name: 'Senegal at France',
      season: { year: 2026, slug: 'group-stage' },
      status: { type: { name: 'STATUS_FULL_TIME', state: 'post', completed: true } },
      competitions: [
        {
          venue: { fullName: 'MetLife Stadium' },
          competitors: [
            { homeAway: 'home', score: '3', team: { abbreviation: 'FRA', displayName: 'France' } },
            { homeAway: 'away', score: '1', team: { abbreviation: 'SEN', displayName: 'Senegal' } },
          ],
        },
      ],
    },
  ],
};

describe('runRefresh — windowed live detection (statusline regression)', () => {
  // During the AUT-JOR window. A bare fetchLive() (no-date bucket) returned [],
  // so the statusline cache read empty mid-match and showed a countdown. The
  // refresher must now window around `now` and persist the in-play match.
  const DURING = new Date('2026-06-17T05:00:00Z');

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => SCOREBOARD })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('persists the adjacent-bucket live match, not an empty list', async () => {
    await runRefresh({ now: DURING, source: 'espn' });
    const state = readState();
    expect(state?.degraded).toBe(false);
    // Only the in-play match — the FT one in the default bucket is filtered out.
    expect((state?.live ?? []).map((m) => m.id)).toEqual(['760431']);
    expect((state?.live ?? [])[0]?.status).toBe('LIVE');
  });
});
