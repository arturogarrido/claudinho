import { describe, expect, it } from 'vitest';
import { countdown, formatDate, formatKickoff, localDate } from '../src/time';

describe('countdown', () => {
  const now = new Date('2026-06-11T12:00:00Z');

  it('formats days+hours', () => {
    expect(countdown('2026-06-13T16:00:00Z', now)).toBe('2d4h');
  });
  it('formats hours+minutes', () => {
    expect(countdown('2026-06-11T14:10:00Z', now)).toBe('2h10m');
  });
  it('formats minutes only', () => {
    expect(countdown('2026-06-11T12:45:00Z', now)).toBe('45m');
  });
  it('says "now" for past/zero', () => {
    expect(countdown('2026-06-11T11:00:00Z', now)).toBe('now');
  });
});

describe('formatKickoff', () => {
  it('renders in the requested timezone', () => {
    const s = formatKickoff('2026-06-11T19:00:00Z', { tz: 'UTC', locale: 'en' });
    expect(s).toMatch(/19/);
  });
  it('shifts with timezone', () => {
    const s = formatKickoff('2026-06-11T19:00:00Z', { tz: 'America/Mexico_City', locale: 'en' });
    // Mexico City is UTC-6 in June -> 13:00
    expect(s).toMatch(/13/);
  });
  it('falls back to English for a malformed locale instead of throwing (RangeError)', () => {
    const iso = '2026-06-11T19:00:00Z';
    expect(() => formatKickoff(iso, { tz: 'UTC', locale: '%%%' })).not.toThrow();
    expect(formatKickoff(iso, { tz: 'UTC', locale: '%%%' })).toBe(
      formatKickoff(iso, { tz: 'UTC', locale: 'en' }),
    );
  });
  it('includes month and day when date is set', () => {
    const s = formatKickoff('2026-07-04T17:00:00Z', { tz: 'UTC', locale: 'en', date: true });
    expect(s).toMatch(/Jul/);
    expect(s).toMatch(/4/);
    expect(s).toMatch(/17/);
  });
});

describe('formatDate', () => {
  // 23:30Z on Jun 29 is already 08:30 on Jun 30 in Tokyo (UTC+9): the market headers date a fixture by this.
  const iso = '2026-06-29T23:30:00Z';
  it('renders the short calendar date in the requested timezone', () => {
    expect(formatDate(iso, { tz: 'UTC', locale: 'en' })).toBe('Jun 29');
    expect(formatDate(iso, { tz: 'Asia/Tokyo', locale: 'en' })).toBe('Jun 30');
  });
  it('renders it in the requested language', () => {
    const es = formatDate(iso, { tz: 'UTC', locale: 'es' });
    expect(es).toBe('29 jun');
    expect(es).not.toBe(formatDate(iso, { tz: 'UTC', locale: 'en' }));
  });
  it('says the unknown-time dash for a date it cannot parse, never a guessed one', () => {
    expect(formatDate('not a date', { tz: 'UTC', locale: 'en' })).toBe('—');
  });
});

describe('localDate', () => {
  it('returns the calendar date in the target zone', () => {
    // 01:00Z on the 12th is still the 11th in Mexico City (UTC-6)
    expect(localDate('2026-06-12T01:00:00Z', 'America/Mexico_City')).toBe('2026-06-11');
    expect(localDate('2026-06-12T01:00:00Z', 'UTC')).toBe('2026-06-12');
  });
});
