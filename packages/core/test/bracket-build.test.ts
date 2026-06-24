import { describe, expect, it } from 'vitest';
import { allFixtures } from '../src/schedule';
import { buildBracketTopology } from '../src/bracket/build';
import { loadBracketTopology } from '../src/bracket/topology';

describe('buildBracketTopology', () => {
  it('builds a valid graph from the bundled schedule', () => {
    const topology = buildBracketTopology(allFixtures(), '2026-06-01T00:00:00.000Z');
    expect(topology.matches).toHaveLength(32);
    expect(topology.stages).toEqual(['R32', 'R16', 'QF', 'SF', '3P', 'F']);
    const r32 = topology.matches.filter((m) => m.stage === 'R32');
    expect(r32).toHaveLength(16);
    expect(r32[0]?.index).toBe(1);
    expect(r32[15]?.index).toBe(16);
  });

  it('matches the checked-in bracket.2026.json artifact', () => {
    const built = buildBracketTopology(allFixtures(), 'snapshot');
    const bundled = loadBracketTopology();
    expect(built.matches.map((m) => m.matchId)).toEqual(bundled.matches.map((m) => m.matchId));
    expect(built.matches.map((m) => m.home)).toEqual(bundled.matches.map((m) => m.home));
    expect(built.matches.map((m) => m.away)).toEqual(bundled.matches.map((m) => m.away));
  });
});

describe('bundled schedule invariants (regression)', () => {
  it('keeps the knockout bundle resultless', () => {
    const ko = allFixtures().filter((m) => m.stage !== 'GROUP');
    expect(ko.every((m) => m.status === 'SCHEDULED' && m.score == null)).toBe(true);
  });
});
