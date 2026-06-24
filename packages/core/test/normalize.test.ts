import { describe, expect, it } from 'vitest';
import { matchLocation, stageLabel, type Match } from '../src/index';

function match(over: Partial<Match> = {}): Match {
  return {
    id: '1',
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

describe('matchLocation', () => {
  it('joins venue, city, and country when all are present', () => {
    expect(matchLocation(match({ city: 'Mexico City', country: 'Mexico' }))).toBe(
      'Estadio Banorte, Mexico City, Mexico',
    );
  });

  it('keeps US "City, State" + country intact', () => {
    expect(
      matchLocation(match({ venue: 'AT&T Stadium', city: 'Arlington, Texas', country: 'USA' })),
    ).toBe('AT&T Stadium, Arlington, Texas, USA');
  });

  it('omits missing parts instead of leaving empty separators', () => {
    expect(matchLocation(match({ city: undefined, country: undefined }))).toBe('Estadio Banorte');
    expect(matchLocation(match({ city: 'Toronto', country: undefined }))).toBe(
      'Estadio Banorte, Toronto',
    );
  });
});

describe('stageLabel', () => {
  it('uses the group letter during the group stage', () => {
    expect(stageLabel(match())).toBe('Group A');
  });

  it('names knockout rounds without a group letter', () => {
    expect(stageLabel(match({ stage: 'R16', group: undefined }))).toBe('Round of 16');
    expect(stageLabel(match({ stage: 'F', group: undefined }))).toBe('Final');
  });

  it('returns an empty string for an unknown stage', () => {
    expect(stageLabel(match({ stage: 'UNKNOWN' as Match['stage'], group: undefined }))).toBe('');
  });
});
