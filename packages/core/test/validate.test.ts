import { describe, expect, it } from 'vitest';
import { isValidDate, isValidTimeZone } from '../src/validate';
import { resolveTz } from '../src/time';

describe('isValidTimeZone', () => {
  it('accepts real IANA zones', () => {
    expect(isValidTimeZone('America/Mexico_City')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Asia/Tokyo')).toBe(true);
  });
  it('rejects junk and empties', () => {
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidTimeZone('not a zone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });
});

describe('isValidDate', () => {
  it('accepts real YYYY-MM-DD dates', () => {
    expect(isValidDate('2026-06-11')).toBe(true);
    expect(isValidDate('2026-07-19')).toBe(true);
  });
  it('rejects malformed strings', () => {
    expect(isValidDate('2026-6-11')).toBe(false); // not zero-padded
    expect(isValidDate('06-11-2026')).toBe(false);
    expect(isValidDate('abc')).toBe(false);
    expect(isValidDate('')).toBe(false);
    expect(isValidDate(undefined)).toBe(false);
  });
  it('rejects impossible (rollover) dates', () => {
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('2026-00-10')).toBe(false);
  });
});

describe('resolveTz hardening', () => {
  it('returns a valid explicit zone unchanged', () => {
    expect(resolveTz('America/Mexico_City')).toBe('America/Mexico_City');
  });
  it('never returns an invalid zone (falls back instead of propagating)', () => {
    const r = resolveTz('Totally/Bogus');
    expect(r).not.toBe('Totally/Bogus');
    // Whatever it falls back to must itself be valid (or undefined).
    if (r !== undefined) expect(isValidTimeZone(r)).toBe(true);
  });
});
