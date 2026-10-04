/**
 * 0.11 PR 2.6b — off the bundle, a display record the provider says is
 * FINISHED is named nowhere on the statusline: not as live, and not as the
 * next match. Under a real clock a finished match never has a kickoff ahead;
 * the cache is a file, and the countdown is the other place a record is named.
 */
import type { Match } from '@claudinho/core';
import { describe, expect, it } from 'vitest';
import type { CacheState, ScheduleSlice } from '../src/cache';
import { renderPrompt } from '../src/statusline';

const NOW = Date.parse('2026-10-10T15:00:00.000Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const iso = (ms: number) => new Date(ms).toISOString();
const fixture = (id: string, at: number, home: [string, string], away: [string, string], status: Match['status'] = 'SCHEDULED'): Match =>
  ({
    id,
    stage: 'FRIENDLY',
    kickoff: iso(at),
    home: { code: home[0], name: home[1], flag: '\u{1F3F3}\u{FE0F}' },
    away: { code: away[0], name: away[1], flag: '\u{1F3F3}\u{FE0F}' },
    status,
    ...(status === 'FT' ? { score: { home: 2, away: 1 } } : {}),
    updatedAt: iso(NOW),
  }) as Match;
const snapshot = (fixtures: Match[]): CacheState => ({
  updatedAt: iso(NOW - 5000),
  live: [],
  degraded: false,
  source: 'espn',
  competition: 'uefa.nations',
  schedule: {
    index: fixtures.map((m) => ({ id: m.id, kickoff: m.kickoff, on: m.status !== 'FT' })),
    fixtures,
    attemptedAt: iso(NOW - 10 * MIN),
    updatedAt: iso(NOW - 10 * MIN),
    failures: 0,
  } as ScheduleSlice,
});
// The snapshot is a nations competition's (`uefa.nations`): the caller states
// that kind, as `cmdPrompt` does from the competition (0.11 · 2.2).
const line = (state: CacheState, opts: { team?: string } = {}) =>
  renderPrompt(state, { defaultCompetition: false, teamKind: 'nation', now: new Date(NOW), ...opts });

describe('a finished record is not counted down to', () => {
  const finishedAhead = fixture('1', NOW + HOUR, ['ESP', 'Spain'], ['FRA', 'France'], 'FT');
  const next = fixture('2', NOW + 3 * HOUR, ['GER', 'Germany'], ['ITA', 'Italy']);

  it('with nothing else: nothing to count down to', () => {
    expect(line(snapshot([finishedAhead]))).toBe('⚽ —');
  });

  it('beside a fixture still to be played: the countdown is to that one', () => {
    // The flags are generated from the nation (Germany, Italy), never read from the file.
    expect(line(snapshot([finishedAhead, next]))).toBe('\u{1F1E9}\u{1F1EA} vs \u{1F1EE}\u{1F1F9} in 3h0m');
  });

  it('with a team filter: not that team’s next match either', () => {
    expect(line(snapshot([finishedAhead, next]), { team: 'ESP' })).toBe('⚽ —');
  });
});
