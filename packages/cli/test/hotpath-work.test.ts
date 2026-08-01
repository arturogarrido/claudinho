/**
 * The hot path must not pay for fields it does not render.
 *
 * The statusline renders a scoreline, not a timeline: it never reads
 * `match.events`. Sealing them anyway made a poisoned cache of 64 live matches
 * carrying 128 events each cost 11.9 SECONDS against a 150 ms budget, because
 * every event's `player` is a label and a label is segmented grapheme by
 * grapheme. Bounding the COUNT (128 per match) was not enough when the surface
 * needs ZERO of them.
 *
 * The general rule this pins: bounding work is not only about how many records
 * you process, but about which FIELDS the surface actually reads. Cheapest work
 * is work not done.
 */
import { describe, expect, it } from 'vitest';
import { renderPrompt } from '../src/statusline';

/** Unassigned code points: every cluster is rejected, so none can short-circuit. */
const JUNK = '\u{FFF0}'.repeat(4096);

function liveMatch(i: number, events: number) {
  return {
    id: String(700000 + i),
    stage: 'GROUP',
    kickoff: '2026-06-11T19:00:00.000Z',
    venue: 'Estadio Azteca',
    home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
    away: { code: 'ECU', name: 'Ecuador', flag: '🇪🇨' },
    score: { home: 1, away: 0 },
    minute: 42,
    status: 'LIVE',
    updatedAt: new Date().toISOString(),
    events: Array.from({ length: events }, () => ({
      type: 'GOAL',
      minute: 10,
      teamCode: 'MEX',
      player: JUNK,
    })),
  };
}

function fastestRender(live: unknown[]): number {
  const state = { updatedAt: new Date().toISOString(), live, degraded: false } as never;
  renderPrompt(state, { now: new Date() }); // warm
  const runs: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    renderPrompt(state, { now: new Date() });
    runs.push(performance.now() - t0);
  }
  return Math.min(...runs);
}

describe('a poisoned cache cannot make the statusline slow', () => {
  it('costs the same whether or not every match carries 128 hostile events', () => {
    const clean = fastestRender(Array.from({ length: 64 }, (_, i) => liveMatch(i, 0)));
    const loaded = fastestRender(Array.from({ length: 64 }, (_, i) => liveMatch(i, 128)));
    // A RATIO, not a millisecond constant: an absolute budget here measures the
    // machine (see the calibration lesson in hotpath-latency). The property is
    // that 8,192 hostile event records cost essentially nothing, because the
    // surface never reads them. Before this, the same input took 11.9 s.
    expect(loaded).toBeLessThan(Math.max(clean * 6, 40));
  }, 120_000);

  it('still renders the score correctly with events present', () => {
    const state = {
      updatedAt: new Date().toISOString(),
      live: [liveMatch(0, 128)],
      degraded: false,
    } as never;
    const line = renderPrompt(state, { now: new Date() });
    expect(line).toContain('1–0');
    expect(line).toContain('🇲🇽');
    // Nothing from the hostile payload reaches the line.
    expect(line).not.toContain('\u{FFF0}');
  });
});
