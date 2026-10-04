/**
 * 0.11 PR 2.6b — what a person sees on the statusline off the bundled
 * competition. It reads the cache and nothing else: the schedule slice's
 * display records for a countdown, the slice's gate for "live · syncing…".
 *
 * `⚽ —` is the line for "nothing known", not for "nothing is on".
 */
import type { Match } from '@claudinho/core';
import { describe, expect, it } from 'vitest';
import type { CacheState, ScheduleSlice } from '../src/cache';
import { renderHook } from '../src/hook';
import { type AmbientPick, renderPrompt } from '../src/statusline';

const NOW = Date.parse('2026-10-10T15:00:00.000Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const iso = (ms: number) => new Date(ms).toISOString();
const entry = (id: string, at: number, on = true) => ({ id, kickoff: iso(at), on });
const fixture = (id: string, at: number, home: [string, string], away: [string, string], status: Match['status'] = 'SCHEDULED'): Match =>
  ({
    id,
    stage: 'FRIENDLY',
    kickoff: iso(at),
    home: { code: home[0], name: home[1], flag: '🏳️' },
    away: { code: away[0], name: away[1], flag: '🏳️' },
    status,
    updatedAt: iso(NOW),
  }) as Match;
const nations = (id: string, at: number, status: Match['status'] = 'SCHEDULED') => fixture(id, at, ['ESP', 'Spain'], ['FRA', 'France'], status);
const clubs = (id: string, at: number, status: Match['status'] = 'SCHEDULED') => fixture(id, at, ['ARS', 'Arsenal'], ['LEE', 'Leeds United'], status);

/** A snapshot off the bundle. `liveAgo` is how long ago its live slice was read. */
const snapshot = (schedule: ScheduleSlice | undefined, over: Partial<CacheState> = {}, liveAgo = HOUR): CacheState => ({
  updatedAt: iso(NOW - liveAgo),
  live: [],
  degraded: false,
  source: 'espn',
  competition: 'uefa.nations',
  ...(schedule ? { schedule } : {}),
  ...over,
});
// The snapshot is a nations competition's (`uefa.nations`), so the kind the
// caller resolves is `nation` unless a case says its rows are clubs.
const line = (state: CacheState | undefined, opts: { pick?: AmbientPick; teamKind?: 'nation' | 'club' } = {}) =>
  renderPrompt(state, { defaultCompetition: false, teamKind: 'nation', now: new Date(NOW), ...opts });
const sched = (fixtures: Match[], over: Partial<ScheduleSlice> = {}): ScheduleSlice => ({
  index: fixtures.map((m) => entry(m.id, Date.parse(m.kickoff), m.status === 'SCHEDULED' || m.status === 'LIVE' || m.status === 'HT')),
  fixtures,
  attemptedAt: iso(NOW - 10 * MIN),
  updatedAt: iso(NOW - 10 * MIN),
  failures: 0,
  ...over,
});

describe('nothing known', () => {
  it('no cache, no schedule, or a discovery that keeps failing: `⚽ —`', () => {
    expect(line(undefined)).toBe('⚽ —');
    expect(line(snapshot(undefined))).toBe('⚽ —');
    expect(line(snapshot({ attemptedAt: iso(NOW - MIN), failures: 3 }))).toBe('⚽ —');
  });
});

describe('a fixture days or minutes away', () => {
  it('nations: a countdown from the schedule slice', () => {
    const state = snapshot(sched([nations('1', NOW + 52 * HOUR)]));
    expect(line(state)).toBe('🇪🇸 vs 🇫🇷 in 2d4h');
  });

  it('the earliest one that is still to be played; a postponed one is skipped', () => {
    const state = snapshot(sched([nations('0', NOW + HOUR, 'POSTPONED'), nations('1', NOW + 3 * HOUR), fixture('2', NOW + 5 * HOUR, ['GER', 'Germany'], ['ITA', 'Italy'])]));
    expect(line(state)).toBe('🇪🇸 vs 🇫🇷 in 3h0m');
  });

  it('clubs: a countdown by their codes (0.11 · 2.2: a club has no flag, and is a resolved side)', () => {
    expect(line(snapshot(sched([clubs('1', NOW + 52 * HOUR)])), { teamKind: 'club' })).toBe('ARS vs LEE in 2d4h');
    // Compact or not, flags on or off: the countdown token of a flagless side is its code.
    const state = snapshot(sched([clubs('1', NOW + 52 * HOUR)]));
    expect(renderPrompt(state, { defaultCompetition: false, teamKind: 'club', now: new Date(NOW), compact: false })).toBe('ARS vs LEE in 2d4h');
    expect(renderPrompt(state, { defaultCompetition: false, teamKind: 'club', now: new Date(NOW), flags: false })).toBe('ARS vs LEE in 2d4h');
  });

  it('a nation competition\'s rows read as clubs would lose their flags: the kind is the caller\'s to state', () => {
    expect(line(snapshot(sched([nations('1', NOW + 52 * HOUR)])), { teamKind: 'club' })).toBe('ESP vs FRA in 2d4h');
  });

  it('the knockout slice is the bundle’s: off the bundle it is not read for a countdown', () => {
    const state = snapshot(sched([]), { fixtures: [nations('1', NOW + 52 * HOUR)], fixturesUpdatedAt: iso(NOW) });
    expect(line(state)).toBe('⚽ —');
  });

  it('with a pick, that team’s next fixture first; a pick with none counts down to anyone’s (a preference, 0.11 2.5b)', () => {
    const state = snapshot(sched([nations('1', NOW + 3 * HOUR), fixture('2', NOW + 5 * HOUR, ['GER', 'Germany'], ['ITA', 'Italy'])]));
    expect(line(state, { pick: { code: 'ITA' } })).toBe('🇩🇪 vs 🇮🇹 in 5h0m');
    expect(line(state, { pick: { code: 'POR' } })).toBe('🇪🇸 vs 🇫🇷 in 3h0m');
  });
});

describe('the gate is open and live data is missing, stale or failed: "live · syncing…"', () => {
  const inWindow = sched([nations('1', NOW - 30 * MIN)]);

  it('a fixture in its window that resolves to nations: the matchup', () => {
    expect(line(snapshot(inWindow))).toBe('⚽ 🇪🇸 vs 🇫🇷 live · syncing…');
    expect(line(snapshot(inWindow, { degraded: true }, 5000))).toBe('⚽ 🇪🇸 vs 🇫🇷 live · syncing…');
  });

  it('a club fixture in its window: the matchup by codes, and the truth that a match is on', () => {
    expect(line(snapshot(sched([clubs('1', NOW - 30 * MIN)])), { teamKind: 'club' })).toBe('⚽ ARS vs LEE live · syncing…');
  });

  it('a fixture only the index knows (no full record at hand): the same', () => {
    expect(line(snapshot(sched([], { index: [entry('65', NOW - 30 * MIN)] })))).toBe('⚽ live · syncing…');
  });

  it('a continuation past the 140 minutes of the window: shown', () => {
    const state = snapshot(sched([nations('1', NOW - 170 * MIN)], { inPlayUntil: iso(NOW + 3 * HOUR) }));
    expect(line(state)).toBe('⚽ live · syncing…');
  });

  it('two fixtures in their windows: the first, and how many more', () => {
    const state = snapshot(sched([nations('1', NOW - 30 * MIN), fixture('2', NOW - 20 * MIN, ['GER', 'Germany'], ['ITA', 'Italy'])]));
    expect(line(state)).toBe('⚽ 🇪🇸 vs 🇫🇷 live · syncing… +1');
  });

  for (const off of ['POSTPONED', 'CANCELLED', 'FT'] as const) {
    it(`a ${off} fixture beside one that is on: the line is about the one that is on, and counts only it`, () => {
      // A finished record carries its score, as the cache would hold it (without one it is not a readable record at all).
      const other = { ...nations('0', NOW - 40 * MIN, off), ...(off === 'FT' ? { score: { home: 2, away: 1 } } : {}) } as Match;
      const state = snapshot(sched([other, fixture('2', NOW - 30 * MIN, ['GER', 'Germany'], ['ITA', 'Italy'])]));
      expect(line(state)).toBe('⚽ 🇩🇪 vs 🇮🇹 live · syncing…');
    });
  }

  it('a fixture the cache holds as FINISHED is not called live, alone or not', () => {
    // Found in review: the display record said full time and the line still read "live · syncing…".
    const over = { ...nations('1', NOW - 120 * MIN, 'FT'), score: { home: 2, away: 1 } } as Match;
    expect(line(snapshot(sched([over])))).toBe('⚽ —');
    expect(line(snapshot(sched([over, nations('2', NOW + 26 * HOUR)])))).toBe('🇪🇸 vs 🇫🇷 in 1d2h');
  });

  it('with a pick: syncing names the picked team’s fixture first, and a match on is syncing whoever is picked (a preference, 0.11 2.5b)', () => {
    expect(line(snapshot(inWindow), { pick: { code: 'FRA' } })).toBe('⚽ 🇪🇸 vs 🇫🇷 live · syncing…');
    expect(line(snapshot(inWindow), { pick: { code: 'ITA' } })).toBe('⚽ 🇪🇸 vs 🇫🇷 live · syncing…');
    const two = sched([nations('1', NOW - 30 * MIN), fixture('2', NOW - 10 * MIN, ['GER', 'Germany'], ['ITA', 'Italy'])]);
    expect(line(snapshot(two), { pick: { code: 'ITA' } })).toBe('⚽ 🇩🇪 vs 🇮🇹 live · syncing… +1');
  });

  it('NOT outside the gate', () => {
    expect(line(snapshot(sched([nations('1', NOW - 150 * MIN)])))).toBe('⚽ —');
    expect(line(snapshot(sched([nations('1', NOW + MIN)])))).toBe('🇪🇸 vs 🇫🇷 in 1m');
  });

  it('NOT for a probe: a probe is a question, not a reason to say a match is on', () => {
    expect(line(snapshot(sched([], { probe: true })))).toBe('⚽ —');
  });

  it('NOT for a postponed fixture, a continuation nobody believes, or a poisoned index', () => {
    expect(line(snapshot(sched([nations('1', NOW - 30 * MIN, 'POSTPONED')])))).toBe('⚽ —');
    expect(line(snapshot(sched([], { inPlayUntil: '2099-01-01T00:00:00.000Z' })))).toBe('⚽ —');
    const poisoned = { index: Array.from({ length: 257 }, (_, i) => entry(String(i + 1), NOW - MIN)), fixtures: [null, 7, { id: 'x' }], inPlayUntil: 'soon', probe: 'yes' };
    expect(line(snapshot(poisoned as unknown as ScheduleSlice))).toBe('⚽ —');
  });

  it('a FRESH, healthy live slice with nothing in play is trusted: the countdown, not "syncing"', () => {
    const state = snapshot(sched([nations('1', NOW - 30 * MIN), nations('2', NOW + 26 * HOUR)]), {}, 5000);
    expect(line(state)).toBe('🇪🇸 vs 🇫🇷 in 1d2h');
  });
});

describe('in play, and just finished', () => {
  const live: Match = { ...nations('1', NOW - 50 * MIN, 'LIVE'), minute: 50, score: { home: 2, away: 1 } } as Match;

  it('a fresh live slice: the score line, as on the bundle', () => {
    expect(line(snapshot(sched([nations('1', NOW - 50 * MIN)]), { live: [live] }, 5000))).toBe("⚽ 🇪🇸 2–1 🇫🇷 50'");
  });

  it('finished, nothing else in a window: the next countdown, or `⚽ —`', () => {
    const over = sched([nations('1', NOW - 150 * MIN, 'FT'), nations('2', NOW + 26 * HOUR)]);
    expect(line(snapshot(over, {}, 5000))).toBe('🇪🇸 vs 🇫🇷 in 1d2h');
    expect(line(snapshot(sched([nations('1', NOW - 150 * MIN, 'FT')]), {}, 5000))).toBe('⚽ —');
  });
});

describe('the hook says what it said: live scores when there are fresh ones, nothing otherwise', () => {
  it('silent in every state without a fresh match in play', () => {
    for (const state of [
      undefined,
      snapshot(undefined),
      snapshot(sched([nations('1', NOW + 52 * HOUR)])),
      snapshot(sched([nations('1', NOW - 30 * MIN)])),
      snapshot(sched([], { probe: true, inPlayUntil: iso(NOW + HOUR) })),
    ]) {
      expect(renderHook(state, { defaultCompetition: false, now: new Date(NOW) })).toBe('');
    }
  });
});
