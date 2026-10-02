/**
 * 0.11 PR 2.6b — the schedule slice of the refresher's cache, as rules.
 *
 * Off the bundled competition the refresher polled around the clock, because
 * nothing told it when a match could be in play. The schedule slice does: an
 * index of the fixtures ahead (from a discovery read, about once an hour), a
 * continuation for a match seen in play, and a probe after a discovery that
 * failed. This file pins the rules as pure functions; `refresher-discovery`
 * pins the cycle that uses them.
 */
import type { Match, ScheduleAheadResult, ScheduleEntry } from '@claudinho/core';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyDiscovery,
  DISCOVERY_RETRY_MS,
  DISCOVERY_TTL_MS,
  discoveryDue,
  IN_PLAY_HOLD_MS,
  raiseInPlay,
  RELEVANT_BACK_MS,
  SCHEDULE_DISPLAY_MAX,
  SCHEDULE_HORIZON_MS,
  scheduleGateOpen,
  scheduleView,
} from '../src/scheduleSlice';

const NOW = Date.parse('2026-10-10T15:00:00.000Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const entry = (id: string, offsetMs: number, on = true): ScheduleEntry => ({ id, kickoff: at(offsetMs), on });
const match = (id: string, offsetMs: number, status: Match['status'] = 'SCHEDULED'): Match =>
  ({
    id,
    kickoff: at(offsetMs),
    status,
    stage: 'FRIENDLY',
    home: { code: 'AME', name: 'América', flag: '🏳️', id: 'espn:227' },
    away: { code: 'GDL', name: 'Guadalajara', flag: '🏳️', id: 'espn:219' },
  }) as Match;
const S2026 = { year: 2026, label: '2026-27 Liga MX' };
const S2025 = { year: 2025, label: '2025-26 Liga MX' };
const answer = (fixtures: Match[], over: Partial<ScheduleAheadResult> = {}): ScheduleAheadResult => ({
  fixtures,
  degraded: false,
  season: S2026,
  complete: true,
  ...over,
});
const ids = (xs: readonly { id: string }[] | undefined) => (xs ?? []).map((x) => x.id);

describe('what is read back from the file is believed only within bounds', () => {
  it('no slice: no schedule, discovery never attempted, nothing in play, no probe', () => {
    for (const raw of [undefined, null, 'x', 7, []]) {
      const v = scheduleView(raw, NOW);
      expect(v, String(raw)).toEqual({ index: undefined, attemptAgeMs: Infinity, attemptedAt: undefined, updatedAt: undefined, complete: false, failures: 0, inPlayUntil: undefined, probe: false, season: undefined });
    }
  });

  it('a healthy slice is read as written', () => {
    const v = scheduleView(
      {
        index: [entry('1', HOUR), entry('2', 2 * HOUR, false)],
        fixtures: [match('1', HOUR)],
        updatedAt: at(-10 * MIN),
        attemptedAt: at(-10 * MIN),
        failures: 0,
        season: S2026,
        complete: true,
        inPlayUntil: at(2 * HOUR),
        probe: true,
      },
      NOW,
    );
    expect(v.index).toEqual([entry('1', HOUR), entry('2', 2 * HOUR, false)]);
    expect(v.attemptAgeMs).toBe(10 * MIN);
    expect(v.attemptedAt).toBe(at(-10 * MIN));
    expect(v.updatedAt).toBe(at(-10 * MIN));
    expect(v.complete).toBe(true);
    expect(v.failures).toBe(0);
    expect(v.inPlayUntil).toBe(NOW + 2 * HOUR);
    expect(v.probe).toBe(true);
    expect(v.season).toMatchObject({ year: 2026 });
  });

  it('an index of 257 is no schedule; the stamps beside it are still read (discovery is paced, not silenced, not looped)', () => {
    const v = scheduleView({ index: Array.from({ length: 257 }, (_, i) => entry(String(i + 1), HOUR)), attemptedAt: at(-MIN), failures: 2 }, NOW);
    expect(v.index).toBeUndefined();
    expect(v.attemptAgeMs).toBe(MIN);
    expect(v.failures).toBe(2);
  });

  it('a stamp in the future is "never": a bad `attemptedAt` makes discovery due, not silent for years', () => {
    const v = scheduleView({ index: [], attemptedAt: '2099-01-01T00:00:00.000Z', failures: 0 }, NOW);
    expect(v.attemptAgeMs).toBe(Infinity);
    expect(discoveryDue(v)).toBe(true);
  });

  it('the stamps are carried only when they can be trusted, re-emitted in one form; `complete` only when it is `true`', () => {
    const v = scheduleView({ index: [], attemptedAt: '2099-01-01T00:00:00.000Z', updatedAt: 'yesterday', complete: 'yes' }, NOW);
    expect(v).toMatchObject({ attemptedAt: undefined, updatedAt: undefined, complete: false });
    const short = scheduleView({ index: [], attemptedAt: '2026-10-10T14:50:00Z', updatedAt: '2026-10-10T14:50:00Z' }, NOW);
    expect(short).toMatchObject({ attemptedAt: '2026-10-10T14:50:00.000Z', updatedAt: '2026-10-10T14:50:00.000Z' });
  });

  it('`inPlayUntil` is believed only while it is ahead and at most six hours ahead', () => {
    const until = (value: unknown) => scheduleView({ index: [], inPlayUntil: value }, NOW).inPlayUntil;
    expect(until(at(IN_PLAY_HOLD_MS))).toBe(NOW + IN_PLAY_HOLD_MS);
    expect(until(at(IN_PLAY_HOLD_MS + 1000))).toBeUndefined();
    expect(until('2099-01-01T00:00:00.000Z')).toBeUndefined();
    expect(until(at(-1000))).toBeUndefined();
    expect(until('soon')).toBeUndefined();
    expect(until(NOW + HOUR)).toBeUndefined();
  });

  it('`failures` is a small whole number, or it is zero', () => {
    const failures = (value: unknown) => scheduleView({ index: [], failures: value }, NOW).failures;
    expect(failures(3)).toBe(3);
    for (const bad of [-1, 1.5, '3', null, Number.NaN, 1e9]) expect(failures(bad), String(bad)).toBe(bad === 1e9 ? 32 : 0);
  });

  it('an index entry beyond the span discovery reads is not believed', () => {
    // Found in review: a forged, well-formed index was bounded only by its
    // length (256 windows of 140 minutes: 25 days of an open gate while
    // discoveries stay incomplete, because a union keeps what it did not read).
    // Discovery reads 14 provider days ahead; nothing it stores is further out.
    expect(SCHEDULE_HORIZON_MS).toBe(16 * 24 * HOUR);
    const inside = entry('1', SCHEDULE_HORIZON_MS - MIN);
    const beyond = entry('2', SCHEDULE_HORIZON_MS + MIN);
    expect(scheduleView({ index: [entry('0', HOUR), inside, beyond] }, NOW).index).toEqual([entry('0', HOUR), inside]);
    // And a union does not carry one either.
    const prev = { index: [entry('0', HOUR), beyond], fixtures: [], season: S2026 };
    const r = applyDiscovery(prev, answer([match('3', 2 * HOUR)], { complete: false, mentioned: ['3'] }), NOW);
    expect(ids(r?.index)).toEqual(['0', '3']);
  });

  it('`probe` is true only when it is `true`', () => {
    expect(scheduleView({ index: [], probe: 'yes' }, NOW).probe).toBe(false);
    expect(scheduleView({ index: [], probe: 1 }, NOW).probe).toBe(false);
    expect(scheduleView({ index: [], probe: true }, NOW).probe).toBe(true);
  });
});

describe('when discovery is due: every row is anchored on the latest ATTEMPT', () => {
  const view = (attemptAgo: number | undefined, failures = 0) =>
    scheduleView({ index: [], ...(attemptAgo === undefined ? {} : { attemptedAt: at(-attemptAgo) }), failures }, NOW);

  it('never attempted: now', () => {
    expect(discoveryDue(view(undefined))).toBe(true);
  });

  it('after a success: 60 minutes after the attempt, not before', () => {
    expect(DISCOVERY_TTL_MS).toBe(60 * MIN);
    expect(discoveryDue(view(59 * MIN))).toBe(false);
    expect(discoveryDue(view(60 * MIN))).toBe(true);
  });

  it('after the n-th consecutive failure: 5 minutes x 2^(n-1), at most 60', () => {
    expect(DISCOVERY_RETRY_MS).toBe(5 * MIN);
    // Bounded: if the cap ever goes, this must FAIL, not count minutes for ever.
    const waits = [1, 2, 3, 4, 5, 6, 30].map((n) => {
      let wait = 0;
      while (wait <= 61 && !discoveryDue(view(wait * MIN, n))) wait++;
      return wait;
    });
    expect(waits).toEqual([5, 10, 20, 40, 60, 60, 60]);
  });
});

describe('the gate: open only when a match can be in play', () => {
  const view = (slice: Record<string, unknown>) => scheduleView({ index: [], ...slice }, NOW);
  const open = (slice: Record<string, unknown>, probe = true) => scheduleGateOpen(view(slice), NOW, { probe });

  it('closed with no schedule, an empty one, or fixtures that are not now', () => {
    expect(scheduleGateOpen(scheduleView(undefined, NOW), NOW, { probe: true })).toBe(false);
    expect(open({})).toBe(false);
    expect(open({ index: [entry('1', MIN), entry('2', -141 * MIN)] })).toBe(false);
  });

  it('open from kickoff until 140 minutes after it, for a fixture that is on', () => {
    expect(open({ index: [entry('1', 0)] })).toBe(true);
    expect(open({ index: [entry('1', -139 * MIN)] })).toBe(true);
    expect(open({ index: [entry('1', -140 * MIN)] })).toBe(false);
    expect(open({ index: [entry('1', 1000)] })).toBe(false);
  });

  it('a postponed or cancelled fixture opens nothing', () => {
    expect(open({ index: [entry('1', -10 * MIN, false)] })).toBe(false);
  });

  it('a continuation keeps it open after the window, until it ends', () => {
    expect(open({ index: [entry('1', -200 * MIN)], inPlayUntil: at(MIN) })).toBe(true);
    expect(open({ index: [entry('1', -200 * MIN)], inPlayUntil: at(-MIN) })).toBe(false);
    expect(open({ inPlayUntil: '2099-01-01T00:00:00.000Z' })).toBe(false);
  });

  it('a probe opens it for the refresher and the triggers, and is not a reason to SAY a match is on', () => {
    expect(open({ probe: true }, true)).toBe(true);
    expect(open({ probe: true }, false)).toBe(false);
  });

  it('a poisoned index opens nothing and throws nothing', () => {
    expect(open({ index: [null, { id: 'x' }, { id: '1', kickoff: 'now', on: true }, { id: '2', kickoff: at(0), on: 'yes' }] })).toBe(false);
    expect(open({ index: Array.from({ length: 257 }, (_, i) => entry(String(i + 1), 0)) })).toBe(false);
  });
});

describe('a match seen in play raises the continuation to its kickoff + 6 hours; an observation never lowers it', () => {
  it('raises from nothing', () => {
    expect(raiseInPlay(undefined, [match('1', -30 * MIN, 'LIVE')], NOW)).toBe(NOW - 30 * MIN + IN_PLAY_HOLD_MS);
    expect(raiseInPlay(undefined, [match('1', -30 * MIN, 'HT')], NOW)).toBe(NOW - 30 * MIN + IN_PLAY_HOLD_MS);
  });

  it('only a match IN PLAY counts', () => {
    for (const status of ['SCHEDULED', 'FT', 'POSTPONED', 'CANCELLED'] as const) {
      expect(raiseInPlay(undefined, [match('1', -30 * MIN, status)], NOW), status).toBeUndefined();
    }
  });

  it('keeps what it was when that is later (a read that holds only an earlier match does not shorten it)', () => {
    const was = NOW + 5 * HOUR;
    expect(raiseInPlay(was, [match('1', -3 * HOUR, 'LIVE')], NOW)).toBe(was);
    expect(raiseInPlay(was, [], NOW)).toBe(was);
  });

  it('a match the provider leaves in play for ever stops counting six hours after kickoff', () => {
    expect(raiseInPlay(undefined, [match('1', -IN_PLAY_HOLD_MS, 'LIVE')], NOW)).toBeUndefined();
    expect(raiseInPlay(undefined, [match('1', -IN_PLAY_HOLD_MS + MIN, 'LIVE')], NOW)).toBe(NOW + MIN);
  });

  it('a kickoff in the future on a match "in play" cannot stretch it past six hours from now', () => {
    expect(raiseInPlay(undefined, [match('1', 3 * HOUR, 'LIVE')], NOW)).toBe(NOW + IN_PLAY_HOLD_MS);
  });

  it('what it was is dropped once it has passed', () => {
    expect(raiseInPlay(NOW - 1000, [], NOW)).toBeUndefined();
  });
});

describe('what a discovery answer does to the slice', () => {
  const none = { index: undefined, fixtures: [] as Match[], season: undefined };
  // `null` is "no season": a default parameter would replace an explicit `undefined`.
  const stored = (index: ScheduleEntry[], season: typeof S2026 | null = S2026, fixtures: Match[] = []) => ({ index, fixtures, season: season ?? undefined });

  it('"relevant" is a kickoff no earlier than six hours ago: the match in play is exactly what must not be lost', () => {
    expect(RELEVANT_BACK_MS).toBe(6 * HOUR);
    const r = applyDiscovery(none, answer([match('1', -7 * HOUR, 'FT'), match('2', -5 * HOUR, 'LIVE'), match('3', HOUR), match('4', 2 * HOUR, 'POSTPONED')]), NOW);
    expect(r?.index).toEqual([entry('2', -5 * HOUR), entry('3', HOUR), entry('4', 2 * HOUR, false)]);
    expect(ids(r?.fixtures)).toEqual(['2', '3', '4']);
    expect(r?.season).toMatchObject({ year: 2026 });
    expect(r?.complete).toBe(true);
  });

  it('a failed discovery changes nothing', () => {
    expect(applyDiscovery(stored([entry('1', HOUR)]), { fixtures: [], degraded: true }, NOW)).toBeUndefined();
  });

  it('a complete answer replaces the slice, whatever was at stake', () => {
    const r = applyDiscovery(stored([entry('1', HOUR), entry('9', 3 * HOUR)]), answer([match('1', 2 * HOUR)]), NOW);
    expect(r?.index).toEqual([entry('1', 2 * HOUR)]);
  });

  it('a complete EMPTY answer is an answer: the slice is empty', () => {
    const r = applyDiscovery(stored([entry('1', HOUR)]), answer([]), NOW);
    expect(r).toMatchObject({ index: [], fixtures: [], complete: true });
  });

  describe('an incomplete answer', () => {
    it('with nothing at stake is stored, with or without a season', () => {
      for (const season of [S2026, undefined]) {
        for (const prev of [none, stored([entry('0', -7 * HOUR)], null)]) {
          const r = applyDiscovery(prev, answer([match('1', HOUR)], { complete: false, mentioned: ['1'], season }), NOW);
          expect(r?.index, String(season?.year)).toEqual([entry('1', HOUR)]);
          expect(r?.complete).toBe(false);
        }
      }
    });

    it('of the SAME season is a union by id: what it did not READ stays, including the match in play', () => {
      const prev = stored([entry('1', -HOUR), entry('2', HOUR), entry('3', 2 * HOUR), entry('4', 3 * HOUR)], S2026, [match('1', -HOUR, 'LIVE'), match('2', HOUR)]);
      // The answer read 3 (now postponed) and 4 (moved beyond the span: read, set aside); it did not read 1 or 2.
      const r = applyDiscovery(prev, answer([match('3', 2 * HOUR, 'POSTPONED'), match('5', 4 * HOUR)], { complete: false, mentioned: ['3', '4', '5'] }), NOW);
      expect(r?.index).toEqual([entry('1', -HOUR), entry('2', HOUR), entry('3', 2 * HOUR, false), entry('5', 4 * HOUR)]);
      // Full records: the answer's, and the ones carried for what was kept.
      expect(ids(r?.fixtures)).toEqual(['1', '2', '3', '5']);
      expect(r?.complete).toBe(false);
    });

    it('"was it read?" is asked of `mentioned`; without that list, of the fixtures the answer returns', () => {
      const prev = stored([entry('1', HOUR), entry('2', 2 * HOUR)]);
      const r = applyDiscovery(prev, answer([match('2', 3 * HOUR)], { complete: false }), NOW);
      expect(r?.index).toEqual([entry('1', HOUR), entry('2', 3 * HOUR)]);
    });

    it('a kept record that is no longer relevant is not carried', () => {
      const prev = stored([entry('0', -7 * HOUR), entry('1', HOUR)]);
      const r = applyDiscovery(prev, answer([match('2', 2 * HOUR)], { complete: false, mentioned: ['2'] }), NOW);
      expect(ids(r?.index)).toEqual(['1', '2']);
    });

    it('with a season unknown on either side: a union all the same (an incomplete answer never deletes what it did not read, and what it read is taken)', () => {
      // Found while fixing the season of a two-month answer. For the sixteen
      // days a span touches two seasons EVERY answer states none, so this row
      // is an ordinary state, not a provider that forgot its season. It used
      // to be a failed discovery: the slice stood as it was, so a fixture the
      // answer DID read (a kickoff that moved, a tie whose teams were set)
      // was not taken while anything else lay ahead. Entries are bounded in
      // time on both sides, so nothing of another season is carried for long.
      const incomplete = { complete: false, mentioned: ['2'] };
      const noneBefore = applyDiscovery(stored([entry('1', HOUR)], null), answer([match('2', 2 * HOUR)], incomplete), NOW);
      expect(ids(noneBefore?.index)).toEqual(['1', '2']);
      expect(noneBefore?.season).toMatchObject({ year: 2026 });
      expect(noneBefore?.complete).toBe(false);
      const noneNow = applyDiscovery(stored([entry('1', HOUR)]), answer([match('2', 2 * HOUR)], { ...incomplete, season: undefined }), NOW);
      expect(ids(noneNow?.index)).toEqual(['1', '2']);
      expect(noneNow?.season).toBeUndefined();
      // What the answer read replaces what the slice held for it: a kickoff that moved.
      const moved = applyDiscovery(stored([entry('1', HOUR), entry('2', 5 * HOUR)], null), answer([match('2', 2 * HOUR)], incomplete), NOW);
      expect(moved?.index).toEqual([entry('1', HOUR), entry('2', 2 * HOUR)]);
    });

    it('known to be ANOTHER season replaces the slice', () => {
      const r = applyDiscovery(stored([entry('1', HOUR)], S2025), answer([match('2', HOUR)], { complete: false, mentioned: ['2'] }), NOW);
      expect(ids(r?.index)).toEqual(['2']);
      expect(r?.season).toMatchObject({ year: 2026 });
    });
  });

  describe('the index holds EVERY relevant fixture or it does not exist', () => {
    const many = (n: number, from = 1) => Array.from({ length: n }, (_, i) => match(String(from + i), HOUR + i * MIN));

    it('256 fit; an answer with 257 is a failed discovery, not a list cut at 256', () => {
      expect(applyDiscovery(none, answer(many(256)), NOW)?.index).toHaveLength(256);
      expect(applyDiscovery(none, answer(many(257)), NOW)).toBeUndefined();
    });

    it('a UNION with 257 is a failed discovery too', () => {
      const prev = stored(many(200).map((m) => entry(m.id, Date.parse(m.kickoff) - NOW)));
      const r = applyDiscovery(prev, answer(many(57, 1000), { complete: false, mentioned: many(57, 1000).map((m) => m.id) }), NOW);
      expect(r).toBeUndefined();
    });

    it('the display list is the 64 earliest with a full record at hand; the 65th is in the index all the same', () => {
      const r = applyDiscovery(none, answer(many(70)), NOW);
      expect(r?.index).toHaveLength(70);
      expect(r?.fixtures).toHaveLength(SCHEDULE_DISPLAY_MAX);
      expect(ids(r?.fixtures)[63]).toBe('64');
      // A second, incomplete discovery that read none of them: the 65th stays in the index
      // (it is the index that is merged, not the display list), with no full record to show.
      const prev = { index: r?.index, fixtures: r?.fixtures ?? [], season: S2026 };
      const again = applyDiscovery(prev, answer([], { complete: false, mentioned: [] }), NOW);
      expect(again?.index).toHaveLength(70);
      expect(ids(again?.index)).toContain('65');
      expect(again?.fixtures).toHaveLength(SCHEDULE_DISPLAY_MAX);
      expect(ids(again?.fixtures)).not.toContain('65');
    });
  });
});

describe('one reader', () => {
  it('no CLI source reads a field of the stored slice directly, except its display records', () => {
    // The slice is input. Everything in it but the display records is believed
    // through `scheduleView`; the display records are sealed by `sealFixtures`.
    // A direct read (`state.schedule.attemptedAt`) is a second reader with no
    // bounds: found in review as a comment that claimed there was none.
    const dir = new URL('../src/', import.meta.url);
    const direct: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'scheduleSlice.ts')) {
      const source = readFileSync(new URL(file, dir), 'utf8');
      for (const m of source.matchAll(/\.schedule\??\.(\w+)/g)) {
        if (m[1] !== 'fixtures') direct.push(`${file}: .schedule.${m[1]}`);
      }
    }
    expect(direct).toEqual([]);
  });
});
