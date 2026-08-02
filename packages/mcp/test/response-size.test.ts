/**
 * A tool response is bounded as a WHOLE, not only per record.
 *
 * The record count is capped at 40 and every field is bounded, but neither
 * bounds their product: 60 fixtures each carrying a full `events` list
 * serialized to ~767 KB — model context, on every call. The hook learned this
 * one commit earlier; bounding each field and the record count is not the same
 * as bounding the sum.
 *
 * Applied at the single place every tool's payload leaves the server, so a tool
 * added later cannot forget it.
 */
import { describe, expect, it } from 'vitest';
import { boundResponse, MAX_RESPONSE_CHARS, toContent } from '../src/server';

const events = Array.from({ length: 128 }, (_, i) => ({
  type: 'GOAL', minute: i % 90, teamCode: 'MEX', player: 'A'.repeat(90),
}));
const fixture = (i: number) => ({
  id: String(900000 + i), stage: 'GROUP', group: 'A',
  kickoff: '2026-06-11T19:00:00.000Z', venue: 'V'.repeat(90),
  home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
  away: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' },
  status: 'FT', score: { home: 1, away: 0 },
  updatedAt: '2026-06-01T00:00:00.000Z', events,
});

describe('one tool response cannot flood model context', () => {
  it('bounds a payload whose per-record caps all pass', () => {
    const huge = { date: '2026-06-11', degraded: false, source: 'espn',
      count: 60, truncated: false, matches: Array.from({ length: 60 }, (_, i) => fixture(i)) };
    expect(JSON.stringify(huge).length).toBeGreaterThan(MAX_RESPONSE_CHARS);
    const bounded = boundResponse(huge) as Record<string, unknown>;
    expect(JSON.stringify(bounded).length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
    // The fixtures themselves survive; only `events` is dropped. No new KEYS:
    // a field that appears solely on large payloads fails the strict output
    // schema of every tool that never declared it.
    expect((bounded.matches as unknown[]).length).toBeGreaterThan(0);
    expect(Object.keys(bounded).sort()).toEqual(Object.keys(huge).sort());
    expect((bounded.matches as Record<string, unknown>[])[0]).not.toHaveProperty('events');
  });

  it('bounds shapes that are not `matches` — bracket, standings, share', () => {
    // The first version special-cased a top-level `matches` array, so every
    // other tool's shape walked past it. A 300 KB share snippet came back whole.
    const share = { kind: 'date', target: '2026-06-11', snippet: 'X'.repeat(300_000) };
    expect(JSON.stringify(boundResponse(share)).length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
    const bracket = { stages: Array.from({ length: 8 }, (_, i) => ({ stage: `S${i}`,
      matches: Array.from({ length: 400 }, (_, k) => ({ id: String(k), note: 'Y'.repeat(400) })) })) };
    expect(JSON.stringify(boundResponse(bracket)).length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
  });

  it('bounds an object by WIDTH, not only arrays by length', () => {
    // A record with 3,000 keys is as much model context as a 3,000-element
    // array; slicing only arrays left it at 271 KB against a 128 KB cap.
    const wide: Record<string, string> = {};
    for (let i = 0; i < 3_000; i++) wide[`k${i}`] = 'V'.repeat(80);
    expect(JSON.stringify(boundResponse(wide)).length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
  });

  it('is WIRED into the payload every tool returns', () => {
    // Pinning the function is not pinning the call — the last round's routing
    // test made exactly this mistake and stayed green when the call was removed.
    const huge = { date: '2026-06-11', degraded: false, source: 'espn',
      count: 60, truncated: false, matches: Array.from({ length: 60 }, (_, i) => fixture(i)) };
    const out = toContent({ text: 'x', data: huge } as never);
    expect(JSON.stringify(out.structuredContent).length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
  });

  it('leaves a real response untouched', () => {
    const real = { date: '2026-06-11', degraded: false, source: 'espn',
      count: 2, truncated: false, matches: [fixture(0), fixture(1)].map(({ events: _e, ...m }) => m) };
    expect(boundResponse(real)).toBe(real); // same object, not a copy
  });
});
