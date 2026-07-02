import { describe, expect, it } from 'vitest';
import { displayWidth, padVisible } from '../src/index';

const ENGLAND = '🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}'; // 14 UTF-16 units
const SCOTLAND = '🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}';

describe('displayWidth', () => {
  it('counts plain ASCII 1 column per char', () => {
    expect(displayWidth('Mexico')).toBe(6);
  });

  it('counts a regional-indicator flag as 2 columns (4 UTF-16 units)', () => {
    expect('🇲🇽').toHaveLength(4);
    expect(displayWidth('🇲🇽')).toBe(2);
  });

  it('counts a tag-sequence flag as 2 columns (14 UTF-16 units)', () => {
    expect(ENGLAND).toHaveLength(14);
    expect(displayWidth(ENGLAND)).toBe(2);
    expect(displayWidth(SCOTLAND)).toBe(2);
  });

  it('handles combining accents as part of their base cluster', () => {
    expect(displayWidth('Côte d’Ivoire'.normalize('NFD'))).toBe(13);
  });
});

describe('padVisible', () => {
  it('pads England and Mexico cells to the SAME display width', () => {
    const a = padVisible(`🇲🇽 Mexico`, 22);
    const b = padVisible(`${ENGLAND} England`, 22);
    expect(displayWidth(a)).toBe(22);
    expect(displayWidth(b)).toBe(22);
  });

  it('never truncates an overlong value', () => {
    const long = `${SCOTLAND} ` + 'Scotland the Brave and Then Some';
    expect(padVisible(long, 10)).toBe(long);
  });
});
