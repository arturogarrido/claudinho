import { describe, expect, it } from 'vitest';
import { matchFlavor, asFlavorLevel, DEFAULT_FLAVOR, type Match } from '../src/index';

function match(over: Partial<Match> = {}): Match {
  return {
    id: '760415',
    stage: 'GROUP',
    group: 'A',
    kickoff: '2026-06-11T19:00Z',
    venue: 'Estadio Banorte',
    home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
    away: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' },
    status: 'SCHEDULED',
    updatedAt: '2026-06-01T00:00Z',
    ...over,
  };
}

const live = (over: Partial<Match> = {}) =>
  match({ status: 'LIVE', minute: 67, score: { home: 1, away: 0 }, ...over });

describe('asFlavorLevel', () => {
  it('defaults to full for missing/invalid input', () => {
    expect(DEFAULT_FLAVOR).toBe('full');
    expect(asFlavorLevel(undefined)).toBe('full');
    expect(asFlavorLevel('nonsense')).toBe('full');
    expect(asFlavorLevel('')).toBe('full');
  });
  it('accepts valid levels', () => {
    expect(asFlavorLevel('off')).toBe('off');
    expect(asFlavorLevel('subtle')).toBe('subtle');
    expect(asFlavorLevel('full')).toBe('full');
  });
});

describe('matchFlavor', () => {
  it('off → no flavor', () => {
    expect(matchFlavor(live(), { level: 'off' })).toBe('');
  });

  it('full narrates every moment; output is non-empty', () => {
    expect(matchFlavor(match({ status: 'SCHEDULED' }), { level: 'full' })).not.toBe('');
    expect(matchFlavor(live({ score: { home: 0, away: 0 } }), { level: 'full' })).not.toBe('');
    expect(matchFlavor(live(), { level: 'full' })).not.toBe(''); // goal moment
    expect(matchFlavor(match({ status: 'FT', score: { home: 2, away: 1 } }), { level: 'full' })).not.toBe('');
  });

  it('subtle only reacts to goals and full-time', () => {
    expect(matchFlavor(match({ status: 'SCHEDULED' }), { level: 'subtle' })).toBe('');
    expect(matchFlavor(live({ score: { home: 0, away: 0 } }), { level: 'subtle' })).toBe('');
    expect(matchFlavor(live(), { level: 'subtle' })).not.toBe(''); // goal
    expect(matchFlavor(match({ status: 'FT', score: { home: 2, away: 1 } }), { level: 'subtle' })).not.toBe('');
  });

  it('stays sober for postponed/cancelled', () => {
    expect(matchFlavor(match({ status: 'POSTPONED' }), { level: 'full' })).toBe('');
    expect(matchFlavor(match({ status: 'CANCELLED' }), { level: 'full' })).toBe('');
  });

  it('is deterministic per match id', () => {
    const a = matchFlavor(live(), { level: 'full', locale: 'es' });
    const b = matchFlavor(live(), { level: 'full', locale: 'es' });
    expect(a).toBe(b);
  });

  it('localizes (es differs from en for the same moment)', () => {
    const es = matchFlavor(live(), { level: 'full', locale: 'es' });
    const en = matchFlavor(live(), { level: 'full', locale: 'en' });
    expect(es).not.toBe(en);
  });

  it('falls back to en for an unknown locale', () => {
    const en = matchFlavor(live(), { level: 'full', locale: 'en' });
    expect(matchFlavor(live(), { level: 'full', locale: 'xx' })).toBe(en);
  });
});
