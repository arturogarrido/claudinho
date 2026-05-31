import { describe, expect, it } from 'vitest';
import { countdown, formatKickoff, localDate } from '../src/time';

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
});

describe('localDate', () => {
  it('returns the calendar date in the target zone', () => {
    // 01:00Z on the 12th is still the 11th in Mexico City (UTC-6)
    expect(localDate('2026-06-12T01:00:00Z', 'America/Mexico_City')).toBe('2026-06-11');
    expect(localDate('2026-06-12T01:00:00Z', 'UTC')).toBe('2026-06-12');
  });
});
