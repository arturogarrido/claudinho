/**
 * 0.11 PR 2.6b — the schedule index: one small record per fixture, the same
 * constructor for a fixture just read and for a record read back from the
 * refresher's cache file.
 */
import { describe, expect, it } from 'vitest';
import { MAX_SCHEDULE_INDEX, parseCachedScheduleIndex, scheduleEntryOf, sealScheduleEntry } from '../src/trust/schedule';
import type { Match } from '../src/types';

const match = (over: Partial<Match> = {}): Match =>
  ({
    id: '760415',
    kickoff: '2026-10-10T14:00:00.000Z',
    status: 'SCHEDULED',
    stage: 'FRIENDLY',
    home: { code: 'AME', name: 'América', flag: '🏳️' },
    away: { code: 'GDL', name: 'Guadalajara', flag: '🏳️' },
    ...over,
  }) as Match;

describe('a schedule entry', () => {
  it('is a fixture’s id, its kickoff, and whether it has a live window', () => {
    expect(scheduleEntryOf(match())).toEqual({ id: '760415', kickoff: '2026-10-10T14:00:00.000Z', on: true });
    for (const status of ['SCHEDULED', 'LIVE', 'HT'] as const) expect(scheduleEntryOf(match({ status }))?.on, status).toBe(true);
    // A postponed or cancelled fixture is known, and opens no window. Nor does
    // one the provider says is FINISHED: nothing is left to poll for (found in
    // review: its window stayed open, and the statusline called it "live").
    for (const status of ['POSTPONED', 'CANCELLED', 'FT'] as const) expect(scheduleEntryOf(match({ status }))?.on, status).toBe(false);
  });

  it('a fixture without an id or an instant has no entry', () => {
    expect(scheduleEntryOf(match({ id: 'x y' }))).toBeUndefined();
    expect(scheduleEntryOf(match({ kickoff: 'soon' }))).toBeUndefined();
    expect(scheduleEntryOf(match({ kickoff: '2026-02-30T10:00:00.000Z' }))).toBeUndefined();
  });

  it('read back from a file it is the same record, by the same rule', () => {
    const entry = scheduleEntryOf(match());
    expect(parseCachedScheduleIndex(JSON.parse(JSON.stringify([entry])))).toEqual([entry]);
    // The kickoff is re-emitted in one form, not passed through.
    expect(sealScheduleEntry({ id: '1', kickoff: '2026-10-10T14:00Z', on: true })).toEqual({ id: '1', kickoff: '2026-10-10T14:00:00.000Z', on: true });
  });

  it('a record counts only if its id is an id, its kickoff an instant and `on` a boolean', () => {
    const good = { id: '1', kickoff: '2026-10-10T14:00:00.000Z', on: true };
    for (const bad of [
      null,
      'x',
      7,
      [],
      {},
      { ...good, id: 7 },
      { ...good, id: '../1' },
      { ...good, id: '1\u200b' },
      { ...good, kickoff: 'Sat Oct 10 2026 (comment)' },
      { ...good, kickoff: 1760104800000 },
      { ...good, kickoff: '2026-13-45T99:00:00.000Z' },
      { ...good, on: 'true' },
      { ...good, on: 1 },
      { id: '1', kickoff: good.kickoff },
    ]) {
      expect(sealScheduleEntry(bad), JSON.stringify(bad)).toBeUndefined();
    }
    // Nothing else is carried: a record is exactly these three fields.
    expect(sealScheduleEntry({ ...good, home: 'x', until: '2099-01-01T00:00:00.000Z' })).toEqual(good);
  });
});

describe('a stored index', () => {
  const entry = (i: number, kickoff = '2026-10-10T14:00:00.000Z') => ({ id: String(1000 + i), kickoff, on: true });

  it('is read whole or not at all: one record past the bound is no schedule, never a prefix', () => {
    expect(MAX_SCHEDULE_INDEX).toBe(256);
    expect(parseCachedScheduleIndex(Array.from({ length: 256 }, (_, i) => entry(i)))).toHaveLength(256);
    let walked = 0;
    const tooLong = Array.from({ length: 257 }, (_, i) => ({
      get id() {
        walked++;
        return String(1000 + i);
      },
      kickoff: '2026-10-10T14:00:00.000Z',
      on: true,
    }));
    expect(parseCachedScheduleIndex(tooLong)).toBeUndefined();
    // Rejected before its records are walked.
    expect(walked).toBe(0);
  });

  it('is not a list: no schedule', () => {
    for (const bad of [undefined, null, {}, 'x', 7]) expect(parseCachedScheduleIndex(bad), String(bad)).toBeUndefined();
    expect(parseCachedScheduleIndex([])).toEqual([]);
  });

  it('an unreadable record does not count, and does not take the readable ones with it', () => {
    expect(parseCachedScheduleIndex([entry(1), { id: 'x y' }, null, entry(2)])).toEqual([entry(1), entry(2)]);
  });

  it('is in kickoff order, and an id held twice counts once (the first)', () => {
    const late = entry(1, '2026-10-12T14:00:00.000Z');
    const early = entry(2, '2026-10-11T14:00:00.000Z');
    const again = { ...entry(1, '2026-10-20T14:00:00.000Z'), on: false };
    expect(parseCachedScheduleIndex([late, early, again])).toEqual([early, late]);
  });
});
