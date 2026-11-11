/**
 * The day argument's ONE grammar (`today [date]`, `share <date>`, `markets
 * <date>`): what it reads with no clock (`parseDayArg`), the day it names from
 * the REQUEST's clock in the viewer's zone (`resolveDayArg`), and when a single
 * match's kickoff says its date (`kickoffLabel`). Every clock here is pinned;
 * none is the wall clock.
 */
import { describe, expect, it } from 'vitest';
import {
  allFixtures,
  calendarDaysUntil,
  DAY_WORDS,
  kickoffLabel,
  parseDayArg,
  resolveDayArg,
  weekdayShort,
} from '../src/index';

/** Tue Nov 10, 2026, 9:40 PM in Los Angeles; Wed Nov 11, 05:40 in UTC; Wed Nov 11, 14:40 in Tokyo. */
const NOW = new Date('2026-11-11T05:40:00.000Z');
const LA = 'America/Los_Angeles';
const TOKYO = 'Asia/Tokyo';

const day = (input: string, now: Date, tz: string): string | undefined => {
  const parsed = parseDayArg(input);
  return parsed ? resolveDayArg(parsed, now, tz) : undefined;
};

describe('parseDayArg: what the grammar reads, before any clock', () => {
  it.each([
    '2026-11-21',
    'today',
    'tomorrow',
    'yesterday',
    'sat',
    'saturday',
    'Sat',
    'SATURDAY',
    'sat.',
    'Tue.',
    'thu',
    'thursday',
    '+0',
    '+3',
    '+99',
  ])('reads %s', (input) => {
    expect(parseDayArg(input)).toBeDefined();
  });

  it.each([
    '',
    'someday',
    'next',
    'live',
    '-1',
    '+100',
    '+3a',
    '+',
    '3',
    'tues',
    'thurs',
    'sa',
    'sat..',
    ' sat',
    'mañana',
    'sáb',
    '2026-02-30',
    '2026-6-11',
    '13/06/2026',
  ])('refuses %j', (input) => {
    expect(parseDayArg(input)).toBeUndefined();
  });

  it('+99 is the last count it takes, and +0 is today', () => {
    expect(parseDayArg('+99')).toEqual({ offset: 99 });
    expect(parseDayArg('+100')).toBeUndefined();
    expect(parseDayArg('+0')).toEqual(parseDayArg('today'));
  });

  it('names its words: today, tomorrow, yesterday and the seven weekdays, short and full', () => {
    expect([...DAY_WORDS].sort()).toEqual(
      [
        'today',
        'tomorrow',
        'yesterday',
        'sun',
        'sunday',
        'mon',
        'monday',
        'tue',
        'tuesday',
        'wed',
        'wednesday',
        'thu',
        'thursday',
        'fri',
        'friday',
        'sat',
        'saturday',
      ].sort(),
    );
  });
});

describe("resolveDayArg: the day named, counted in the viewer's zone from the request's clock", () => {
  it.each([
    // input, zone, day
    ['2026-11-21', LA, '2026-11-21'],
    ['today', LA, '2026-11-10'],
    ['+0', LA, '2026-11-10'],
    ['tomorrow', LA, '2026-11-11'],
    ['+1', LA, '2026-11-11'],
    ['yesterday', LA, '2026-11-09'],
    ['tomorrow', 'UTC', '2026-11-12'],
    ['tomorrow', TOKYO, '2026-11-12'],
    ['yesterday', TOKYO, '2026-11-10'],
    ['+3', TOKYO, '2026-11-14'],
    ['+11', LA, '2026-11-21'],
    ['+99', LA, '2027-02-17'],
    // A weekday is the next such day, TODAY INCLUDED.
    ['tue', LA, '2026-11-10'],
    ['Tuesday.', LA, '2026-11-10'],
    ['tue', TOKYO, '2026-11-17'],
    ['wed', LA, '2026-11-11'],
    ['wed', TOKYO, '2026-11-11'],
    ['mon', LA, '2026-11-16'],
    ['sat', LA, '2026-11-14'],
    ['SATURDAY', 'UTC', '2026-11-14'],
    ['sat', TOKYO, '2026-11-14'],
  ])('%s in %s is %s', (input, tz, expected) => {
    expect(day(input, NOW, tz)).toBe(expected);
  });

  it('a 25-hour day (Los Angeles, Nov 1, 2026, 00:30 PDT): tomorrow, +1 and mon are Nov 2, never 24 hours later', () => {
    // 24 hours after 00:30 PDT on the fall-back day is 23:30 PST the SAME day.
    const fallBack = new Date('2026-11-01T07:30:00.000Z');
    expect(day('today', fallBack, LA)).toBe('2026-11-01');
    expect(day('tomorrow', fallBack, LA)).toBe('2026-11-02');
    expect(day('+1', fallBack, LA)).toBe('2026-11-02');
    expect(day('mon', fallBack, LA)).toBe('2026-11-02');
    expect(day('sun', fallBack, LA)).toBe('2026-11-01');
  });

  it('the eve of a 23-hour day (Los Angeles, Mar 7, 2026, 23:30 PST): tomorrow and +1 are Mar 8, never 24 hours later', () => {
    // 24 hours after 23:30 PST on Mar 7 is 00:30 PDT on Mar 9: the 23-hour day in between is skipped.
    const eve = new Date('2026-03-08T07:30:00.000Z');
    expect(day('today', eve, LA)).toBe('2026-03-07');
    expect(day('tomorrow', eve, LA)).toBe('2026-03-08');
    expect(day('+1', eve, LA)).toBe('2026-03-08');
    expect(day('+2', eve, LA)).toBe('2026-03-09');
  });

  it('a 23-hour day (Los Angeles, Mar 8, 2026): tomorrow from 23:30 PDT is Mar 9, and from 00:30 PST it is Mar 9 too', () => {
    expect(day('tomorrow', new Date('2026-03-09T06:30:00.000Z'), LA)).toBe('2026-03-09'); // Mar 8 23:30 PDT
    expect(day('+1', new Date('2026-03-08T08:30:00.000Z'), LA)).toBe('2026-03-09'); // Mar 8 00:30 PST
    expect(day('sun', new Date('2026-03-08T08:30:00.000Z'), LA)).toBe('2026-03-08');
  });

  it('the same clock names different days in different zones (the clock is the request\'s, the zone the viewer\'s)', () => {
    expect(day('today', NOW, LA)).toBe('2026-11-10');
    expect(day('today', NOW, 'UTC')).toBe('2026-11-11');
    expect(day('today', NOW, TOKYO)).toBe('2026-11-11');
  });
});

describe("weekdayShort: the header's weekday, in the reader's language", () => {
  it.each([
    ['en', 'Thu'],
    ['es', 'jue'],
    ['pt', 'qui.'],
    ['fr', 'jeu.'],
  ])('%s says %s for 2026-11-12', (locale, expected) => {
    expect(weekdayShort('2026-11-12', locale)).toBe(expected);
  });

  it('is the date\'s own weekday, whatever zone the process runs in', () => {
    expect(weekdayShort('2026-11-10', 'en')).toBe('Tue');
    expect(weekdayShort('2026-06-11', 'en')).toBe('Thu');
  });
});

describe('kickoffLabel: a single match says its date from 7 calendar days away', () => {
  it('counts calendar days in the viewer\'s zone, not hours', () => {
    // 6 days 20 hours away, but 7 calendar days in Los Angeles (Tue 21:40 to Tue 18:00 the next week).
    const sevenDays = '2026-11-18T02:00:00.000Z'; // Tue Nov 17, 18:00 PST; Wed Nov 18, 11:00 in Tokyo
    expect(calendarDaysUntil(sevenDays, NOW, LA)).toBe(7);
    expect(kickoffLabel(sevenDays, { tz: LA, locale: 'en', now: NOW })).toBe('Tue, Nov 17, 18:00');
    // The same instant is 7 days away in Tokyo too (Wed to Wed).
    expect(calendarDaysUntil(sevenDays, NOW, TOKYO)).toBe(7);
    expect(kickoffLabel(sevenDays, { tz: TOKYO, locale: 'en', now: NOW })).toBe('Wed, Nov 18, 11:00');
  });

  it('within 6 calendar days: the weekday and the time alone, even more than 6 days away in hours', () => {
    // Mon Nov 16, 23:30 PST: 6 days 1 hour 50 minutes away, 6 calendar days in Los Angeles.
    const sixDays = '2026-11-17T07:30:00.000Z';
    expect(calendarDaysUntil(sixDays, NOW, LA)).toBe(6);
    expect(kickoffLabel(sixDays, { tz: LA, locale: 'en', now: NOW })).toBe('Mon 23:30');
    // In UTC the same instant is Tue Nov 17, 6 calendar days after Wed Nov 11.
    expect(kickoffLabel(sixDays, { tz: 'UTC', locale: 'en', now: NOW })).toBe('Tue 07:30');
  });

  it('a far kickoff in every language, in its own forms', () => {
    const far = '2026-11-21T17:30:00.000Z'; // Sat Nov 21, 09:30 PST
    expect(kickoffLabel(far, { tz: LA, locale: 'en', now: NOW })).toBe('Sat, Nov 21, 09:30');
    expect(kickoffLabel(far, { tz: LA, locale: 'es', now: NOW })).toBe('sáb, 21 nov, 09:30');
    expect(kickoffLabel(far, { tz: LA, locale: 'pt', now: NOW })).toBe('sáb., 21 de nov., 09:30');
    expect(kickoffLabel(far, { tz: LA, locale: 'fr', now: NOW })).toBe('sam. 21 nov., 09:30');
  });

  it('counts the days in the viewer\'s zone: 7 days in Los Angeles is 6 in UTC for the same instants', () => {
    // Tue Nov 17, 15:00 PST; Tue Nov 17, 23:00 UTC. Today is Tue Nov 10 in Los Angeles, Wed Nov 11 in UTC.
    const kickoff = '2026-11-17T23:00:00.000Z';
    expect(calendarDaysUntil(kickoff, NOW, LA)).toBe(7);
    expect(calendarDaysUntil(kickoff, NOW, 'UTC')).toBe(6);
    expect(kickoffLabel(kickoff, { tz: LA, locale: 'en', now: NOW })).toBe('Tue, Nov 17, 15:00');
    expect(kickoffLabel(kickoff, { tz: 'UTC', locale: 'en', now: NOW })).toBe('Tue 23:00');
  });

  it('today and the past within 6 days: the weekday and the time', () => {
    expect(kickoffLabel('2026-11-11T07:50:00.000Z', { tz: LA, locale: 'en', now: NOW })).toBe('Tue 23:50');
    // Wed Nov 4, 12:00 PST: 6 calendar days back.
    expect(calendarDaysUntil('2026-11-04T20:00:00.000Z', NOW, LA)).toBe(-6);
    expect(kickoffLabel('2026-11-04T20:00:00.000Z', { tz: LA, locale: 'en', now: NOW })).toBe('Wed 12:00');
  });

  it('7 or more calendar days back: the date too (a past match is as ambiguous as a far one)', () => {
    // Tue Nov 3, 12:00 PST: 7 calendar days back, the same weekday as today.
    expect(calendarDaysUntil('2026-11-03T20:00:00.000Z', NOW, LA)).toBe(-7);
    expect(kickoffLabel('2026-11-03T20:00:00.000Z', { tz: LA, locale: 'en', now: NOW })).toBe('Tue, Nov 3, 12:00');
    expect(kickoffLabel('2026-11-01T17:00:00.000Z', { tz: LA, locale: 'en', now: NOW })).toBe('Sun, Nov 1, 09:00');
    expect(kickoffLabel('2026-11-01T17:00:00.000Z', { tz: LA, locale: 'es', now: NOW })).toBe('dom, 1 nov, 09:00');
  });

  it('an unreadable kickoff says the unknown time, never a guessed one', () => {
    expect(kickoffLabel('not a date', { tz: LA, locale: 'en', now: NOW })).toBe('—');
  });
});

describe('a day word never means anything else on a command that takes one', () => {
  it("no bundled World Cup team's code or name is a day word", () => {
    const words = new Set(DAY_WORDS);
    for (const m of allFixtures()) {
      for (const side of [m.home, m.away]) {
        expect(words.has(side.code.toLowerCase()), side.code).toBe(false);
        expect(words.has(side.name.toLowerCase()), side.name).toBe(false);
      }
    }
  });

  it("share's and markets' word targets (live, next, table, bracket) are not day words", () => {
    for (const target of ['live', 'next', 'table', 'bracket']) expect(parseDayArg(target), target).toBeUndefined();
  });
});
