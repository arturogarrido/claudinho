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

  it('groupArg accepts a table key: a group letter, or a key such as A1, A-B, LEAGUE', () => {
    // It accepted A to L only, so no agent could ask for a numbered group, a
    // group under a league, or a league's table.
    for (const key of ['A', 'l', 'Z', 'A1', 'a-b', 'LEAGUE', 'league']) {
      expect(groupArg.safeParse(key).success, key).toBe(true);
    }
    // Not a key: empty, too long, or anything but letters, digits and `-`.
    for (const junk of ['', 'A B', 'Group A', 'A/B', 'A_B', '../A', 'A\u200b', 'ABCDEFGHIJKLM', 'Á']) {
      expect(groupArg.safeParse(junk).success, JSON.stringify(junk)).toBe(false);
    }
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
