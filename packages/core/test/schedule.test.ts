import { describe, expect, it } from 'vitest';
import {
  fixturesByDate,
  fixturesInLiveWindow,
  isTournamentWindowOver,
  KNOCKOUT_EXTRA_TIME_MS,
  LIVE_WINDOW_MS,
  liveWindowMsFor,
  sanitizeBundledFixture,
  type Match,
  type Stage,
} from '../src/index';

function fx(id: string, kickoff: string): Match {
  return {
    id,
    stage: 'GROUP',
    group: 'D',
    kickoff,
    venue: 'X',
    home: { code: 'USA', name: 'United States', flag: '🇺🇸' },
    away: { code: 'PAR', name: 'Paraguay', flag: '🇵🇾' },
    status: 'SCHEDULED',
    updatedAt: '2026-06-01T00:00Z',
  };
}

function fxStage(id: string, kickoff: string, stage: Stage): Match {
  return { ...fx(id, kickoff), stage, group: stage === 'GROUP' ? 'D' : undefined };
}

// A kickoff at 01:00Z on the 13th is the evening of the 12th in the Americas.
const lateUtc = fx('late', '2026-06-13T01:00Z');
// A midday kickoff stays on the 13th everywhere in the Americas.
const midday = fx('mid', '2026-06-13T19:00Z');

describe('fixturesByDate — local-date grouping', () => {
  it('groups a late-UTC kickoff under the day the user actually sees (the bug)', () => {
    // America/Mexico_City (UTC-6): 01:00Z 13th → 19:00 on the 12th.
    expect(fixturesByDate('2026-06-12', [lateUtc, midday], 'America/Mexico_City').map((m) => m.id)).toEqual(['late']);
    expect(fixturesByDate('2026-06-13', [lateUtc, midday], 'America/Mexico_City').map((m) => m.id)).toEqual(['mid']);
  });

  it('groups by UTC date when tz is UTC', () => {
    expect(fixturesByDate('2026-06-13', [lateUtc, midday], 'UTC').map((m) => m.id)).toEqual(['late', 'mid']);
    expect(fixturesByDate('2026-06-12', [lateUtc, midday], 'UTC')).toEqual([]);
  });

  it('weekday/date stay consistent: a Friday-evening match is never under Saturday', () => {
    // Under the 13th (Saturday) in MX, only the genuinely-Saturday match appears.
    const sat = fixturesByDate('2026-06-13', [lateUtc, midday], 'America/Mexico_City');
    for (const m of sat) {
      const wd = new Date(m.kickoff).toLocaleString('en-US', {
        timeZone: 'America/Mexico_City',
        weekday: 'long',
      });
      expect(wd).toBe('Saturday');
    }
  });
});

describe('fixturesInLiveWindow — stage-aware window (extra time + penalties)', () => {
  const kickoff = '2026-07-19T19:00:00Z';
  const k = Date.parse(kickoff);
  const finalMatch = fxStage('final', kickoff, 'F');
  const groupMatch = fxStage('group', kickoff, 'GROUP');

  it('keeps a knockout tie in-window through extra time (the statusline-went-dark bug)', () => {
    // 150 min after kickoff: past the 140-min group window, inside the KO window.
    // Before the fix this returned [] for the final → refresher stopped, cache
    // went stale, statusline showed "⚽ —" while ET was still being played.
    const at150 = k + 150 * 60_000;
    expect(fixturesInLiveWindow(at150, [finalMatch]).map((m) => m.id)).toEqual(['final']);
    // A group match at the same offset has already fallen out (unchanged behavior).
    expect(fixturesInLiveWindow(at150, [groupMatch])).toEqual([]);
  });

  it('a knockout tie drops out only after ET + penalties (past ~kickoff + 200 min)', () => {
    const at210 = k + 210 * 60_000;
    expect(fixturesInLiveWindow(at210, [finalMatch])).toEqual([]);
  });

  it('both stages are in-window during regulation (kickoff + 100 min)', () => {
    const at100 = k + 100 * 60_000;
    expect(
      fixturesInLiveWindow(at100, [finalMatch, groupMatch])
        .map((m) => m.id)
        .sort(),
    ).toEqual(['final', 'group']);
  });

  it('liveWindowMsFor: 140 min for group/friendly, +extra time for every knockout stage', () => {
    expect(liveWindowMsFor(groupMatch)).toBe(LIVE_WINDOW_MS);
    expect(liveWindowMsFor(fxStage('fr', kickoff, 'FRIENDLY'))).toBe(LIVE_WINDOW_MS);
    for (const s of ['R32', 'R16', 'QF', 'SF', '3P', 'F'] as const) {
      expect(liveWindowMsFor(fxStage('x', kickoff, s))).toBe(LIVE_WINDOW_MS + KNOCKOUT_EXTRA_TIME_MS);
    }
  });
});

describe('isTournamentWindowOver — elapsed windows, global, fails closed', () => {
  const kickoff = '2026-07-19T19:00:00Z';
  const k = Date.parse(kickoff);
  const finalMatch = fxStage('final', kickoff, 'F');
  const groupMatch = fxStage('group', '2026-06-11T19:00:00Z', 'GROUP');

  it('false while the last fixture is still inside its knockout window', () => {
    // 150 min in: past the group window but the final can still be in ET/pens.
    expect(isTournamentWindowOver(k + 150 * 60_000, [groupMatch, finalMatch])).toBe(false);
  });

  it('true only once EVERY fixture window has closed (past ET + penalties)', () => {
    expect(isTournamentWindowOver(k + 210 * 60_000, [groupMatch, finalMatch])).toBe(true);
  });

  it('false mid-tournament even when earlier fixtures are done', () => {
    // The group game is long finished; the final has not kicked off yet. An
    // eliminated team has no next fixture either — that must NOT read "complete".
    expect(isTournamentWindowOver(k - 24 * 3600_000, [groupMatch, finalMatch])).toBe(false);
  });

  it('false on an empty schedule — "we know nothing" is not "it is over"', () => {
    expect(isTournamentWindowOver(k + 210 * 60_000, [])).toBe(false);
  });

  it('false when a kickoff is unparseable (cannot prove it is past)', () => {
    const bogus = { ...groupMatch, id: 'bogus', kickoff: 'not-a-date' };
    expect(isTournamentWindowOver(k + 210 * 60_000, [bogus, finalMatch])).toBe(false);
  });

  it('KNOWN LIMIT: it is a time predicate — a POSTPONED fixture still reads elapsed', () => {
    // Documents the boundary rather than pretending it does not exist. The
    // bundled schedule is a resultless skeleton (everything ships SCHEDULED),
    // so status cannot inform this; a postponed match whose original window has
    // passed counts as elapsed. Fine for the sign-off (its only caller) — make
    // this status-aware against the live overlay before reusing it for results.
    const postponed = { ...finalMatch, id: 'postponed', status: 'POSTPONED' as const };
    expect(isTournamentWindowOver(k + 210 * 60_000, [postponed])).toBe(true);
  });
});

describe('sanitizeBundledFixture', () => {
  it('strips live/final state so the bundled schedule stays resultless', () => {
    const raw: Match = {
      ...fx('live', '2026-06-13T19:00Z'),
      status: 'FT',
      score: { home: 2, away: 0 },
      minute: 90,
    };
    const clean = sanitizeBundledFixture(raw);
    expect(clean.status).toBe('SCHEDULED');
    expect(clean.score).toBeUndefined();
    expect(clean.minute).toBeUndefined();
    expect(clean.id).toBe(raw.id);
    expect(clean.home).toEqual(raw.home);
  });
});
