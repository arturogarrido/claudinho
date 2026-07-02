import { describe, expect, it } from 'vitest';
import { allTeams, lookupTeam } from '../src/teams';

describe('allTeams', () => {
  it('returns the full 48-team roster from the bundled group stage', () => {
    const teams = allTeams();
    expect(teams).toHaveLength(48);
    expect(teams.every((t) => /^[A-Z]{3}$/.test(t.code))).toBe(true);
    // No knockout placeholders (🏳️) leak in.
    expect(teams.some((t) => t.flag === '🏳️')).toBe(false);
    // Carries the group letter.
    expect(teams.find((t) => t.code === 'MEX')?.group).toBe('A');
  });
});

describe('lookupTeam', () => {
  const code = (q: string) => lookupTeam(q).team?.code ?? null;

  it('resolves an exact 3-letter code (any case)', () => {
    expect(code('MEX')).toBe('MEX');
    expect(code('mex')).toBe('MEX');
  });

  it('resolves an exact name (case + accent insensitive)', () => {
    expect(code('Mexico')).toBe('MEX');
    expect(code('mexico')).toBe('MEX');
    expect(code('Türkiye')).toBe('TUR');
    expect(code("Côte d'Ivoire")).toBe('CIV');
  });

  it('resolves common aliases (different word / order / exonym)', () => {
    expect(code('Turkey')).toBe('TUR');
    expect(code('Holland')).toBe('NED');
    expect(code('DR Congo')).toBe('COD');
    expect(code('Congo DR')).toBe('COD');
    expect(code('DRC')).toBe('COD');
    expect(code('Korea Republic')).toBe('KOR');
    expect(code('America')).toBe('USA');
    expect(code('US')).toBe('USA');
    expect(code('Cabo Verde')).toBe('CPV');
    expect(code('Czech Republic')).toBe('CZE');
    expect(code('Bosnia')).toBe('BIH');
  });

  it('resolves a unique fuzzy prefix/substring match', () => {
    expect(code('united')).toBe('USA');
    expect(code('ivory')).toBe('CIV');
    expect(code('portug')).toBe('POR');
  });

  it('returns candidates (team: null) when ambiguous', () => {
    const r = lookupTeam('south');
    expect(r.team).toBeNull();
    expect(r.matches.map((t) => t.code).sort()).toEqual(['KOR', 'RSA']);
  });

  it('returns no match for unknown, empty, or too-short queries', () => {
    for (const q of ['zzz', 'xyzzy', '', '  ', 'au']) {
      const r = lookupTeam(q);
      expect(r.team).toBeNull();
      expect(r.matches).toEqual([]);
    }
  });

  it('carries the group and flag on a resolved team', () => {
    const r = lookupTeam('Brazil');
    expect(r.team).toMatchObject({ code: 'BRA', flag: '🇧🇷', group: 'C' });
  });
});
