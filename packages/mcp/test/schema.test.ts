import { describe, expect, it } from 'vitest';
import { dateArg, groupArg, teamArg, flavorArg } from '../src/server';

// P3: tightened tool input schemas — accept valid values, reject junk (no
// silent fallback to defaults for invalid flavor/date/group/team).
describe('MCP input schemas', () => {
  it('dateArg requires a real, zero-padded YYYY-MM-DD', () => {
    expect(dateArg.safeParse('2026-06-12').success).toBe(true);
    expect(dateArg.safeParse('2026-13-40').success).toBe(false); // impossible date
    expect(dateArg.safeParse('2026-6-12').success).toBe(false); // not zero-padded
    expect(dateArg.safeParse('June 12').success).toBe(false);
  });

  it('groupArg accepts a single letter A–L only', () => {
    expect(groupArg.safeParse('A').success).toBe(true);
    expect(groupArg.safeParse('l').success).toBe(true);
    expect(groupArg.safeParse('Z').success).toBe(false);
    expect(groupArg.safeParse('AA').success).toBe(false);
  });

  it('teamArg accepts a 3-letter code only', () => {
    expect(teamArg.safeParse('MEX').success).toBe(true);
    expect(teamArg.safeParse('bra').success).toBe(true);
    expect(teamArg.safeParse('MX').success).toBe(false);
    expect(teamArg.safeParse('MEXX').success).toBe(false);
    expect(teamArg.safeParse('M3X').success).toBe(false);
  });

  it('flavorArg is a closed enum', () => {
    for (const v of ['off', 'subtle', 'full']) {
      expect(flavorArg.safeParse(v).success).toBe(true);
    }
    expect(flavorArg.safeParse('loud').success).toBe(false);
    expect(flavorArg.safeParse('').success).toBe(false);
  });
});
