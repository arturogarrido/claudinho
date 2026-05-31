import { describe, expect, it } from 'vitest';
import { flagEmoji, nationToFlag, nationToRegion } from '../src/flags';

describe('flagEmoji', () => {
  it('maps alpha-2 codes to regional-indicator flags', () => {
    expect(flagEmoji('MX')).toBe('🇲🇽');
    expect(flagEmoji('BR')).toBe('🇧🇷');
    expect(flagEmoji('us')).toBe('🇺🇸'); // case-insensitive
  });

  it('maps home-nation subdivisions via tag sequences', () => {
    // Scotland: 🏴 + g,b,s,c,t tags + cancel
    const scotland = String.fromCodePoint(
      0x1f3f4, 0xe0067, 0xe0062, 0xe0073, 0xe0063, 0xe0074, 0xe007f,
    );
    expect(flagEmoji('GB-SCT')).toBe(scotland);
  });

  it('returns a neutral flag for junk', () => {
    expect(flagEmoji('zzz')).toBe('🏳️');
    expect(flagEmoji('1')).toBe('🏳️');
  });
});

describe('nationToFlag', () => {
  it('resolves by display name', () => {
    expect(nationToFlag('Mexico')).toBe('🇲🇽');
    expect(nationToFlag('South Korea')).toBe('🇰🇷');
    expect(nationToFlag('Netherlands')).toBe('🇳🇱');
  });

  it('handles diacritics and alternate spellings', () => {
    expect(nationToFlag('Türkiye')).toBe('🇹🇷');
    expect(nationToFlag('Turkey')).toBe('🇹🇷');
    expect(nationToFlag('Ivory Coast')).toBe('🇨🇮');
    expect(nationToFlag("Côte d’Ivoire")).toBe('🇨🇮');
    expect(nationToFlag('Bosnia-Herzegovina')).toBe('🇧🇦');
  });

  it('resolves by 3-letter code', () => {
    expect(nationToFlag('MEX')).toBe('🇲🇽');
    expect(nationToFlag('NED')).toBe('🇳🇱');
  });

  it('maps Scotland to its subdivision flag', () => {
    expect(nationToFlag('Scotland')).toBe(flagEmoji('GB-SCT'));
  });

  it('falls back to neutral for unknowns', () => {
    expect(nationToFlag('Wakanda')).toBe('🏳️');
    expect(nationToFlag(undefined)).toBe('🏳️');
  });
});

describe('nationToRegion', () => {
  it('returns region codes', () => {
    expect(nationToRegion('Brazil')).toBe('BR');
    expect(nationToRegion('Scotland')).toBe('GB-SCT');
    expect(nationToRegion('nope')).toBeUndefined();
  });
});
