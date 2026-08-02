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
import { renderHook } from '../src/hook';
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

describe('a poisoned cache cannot make the statusline slow', () => {
  it('does not read the events field at all', () => {
    let touched = 0;
    const match = liveMatch(0, 0);
    Object.defineProperty(match, 'events', {
      enumerable: true,
      get() {
        touched += 1;
        return Array.from({ length: 128 }, () => ({ player: JUNK }));
      },
    });
    const state = { updatedAt: new Date().toISOString(), live: [match], degraded: false } as never;
    expect(renderPrompt(state, { now: new Date() })).toContain('1–0');
    expect(touched).toBe(0);
  });

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

describe('the "+N" marker counts matches, not junk that looks like one', () => {
  const NOW = new Date('2026-06-20T20:00:00Z');
  const real = {
    id: '700123', stage: 'GROUP', group: 'A', kickoff: '2026-06-20T19:00:00Z',
    venue: 'Estadio Azteca', home: { code: 'MEX', name: 'Mexico', flag: '🇲🇽' },
    away: { code: 'RSA', name: 'South Africa', flag: '🇿🇦' },
    score: { home: 1, away: 0 }, minute: 55, status: 'LIVE', updatedAt: '2026-06-20T19:59:00Z',
  };
  /** Passes the cheap shape test (LIVE + two codes) but cannot be sealed. */
  const junk = { status: 'LIVE', home: { code: 'AAA' }, away: { code: 'BBB' } };
  const cache = (live: unknown[]) =>
    ({ version: 2, updatedAt: '2026-06-20T19:59:30Z', live, degraded: false,
       source: 'espn', competition: 'fifa.world' }) as never;

  it('does not advertise rejected records as an exact number of hidden matches', () => {
    // 60 junk records: under the examine cap, so every one of them was read and
    // refused. None is a hidden match. Previously this rendered "+60".
    const line = renderPrompt(cache([real, ...Array.from({ length: 60 }, () => ({ ...junk }))]), {
      now: NOW,
    });
    expect(line).toContain('1–0');
    expect(line).not.toMatch(/\+\d+/);
    expect(line).toContain('+more');
  });

  it('DOES report records it never examined — without inventing an exact count', () => {
    // 600 records trips the EXAMINE cap (512). The unread suffix may contain
    // valid matches or junk, so the only honest marker is nonnumeric.
    //
    // This test used to pass 200 records and expect "+136", asserting the cap
    // that was wrong — it charged the 64-result cap against raw records, so
    // every junk entry we read AND REJECTED was advertised as a hidden match.
    // 200 records are now all examined, and the honest answer there is no "+N".
    const line = renderPrompt(cache([real, ...Array.from({ length: 599 }, () => ({ ...junk }))]), {
      now: NOW,
    });
    expect(line).toContain('+more');
    expect(line).not.toMatch(/\+\d+/);
  });

  it('states that a fully-scanned but malformed list is still incomplete', () => {
    const line = renderPrompt(cache([real, ...Array.from({ length: 199 }, () => ({ ...junk }))]), {
      now: NOW,
    });
    expect(line).toContain('1–0');
    expect(line).not.toMatch(/\+\d+/);
    expect(line).toContain('+more');
  });

  it('still reports overflow when there are genuinely more live matches', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ ...real, id: String(700200 + i) }));
    const line = renderPrompt(cache(many), { now: NOW });
    expect(line).toMatch(/\+\d+/); // more real matches than segments shown
  });
});

describe('the hook bounds the whole block it writes into model context', () => {
  const zalgo = `A${'​' + '́'.repeat(7)}`.repeat(400);
  const poisoned = (i: number) => ({
    id: String(700000 + i), stage: 'GROUP', kickoff: '2026-06-11T19:00:00.000Z',
    venue: zalgo, city: zalgo, country: zalgo,
    // Distinct labels per side: identical code AND name is one team playing
    // itself, which `sealMatch` now refuses outright — and this case is about
    // the SIZE of what survives, so it has to survive.
    home: { code: zalgo, name: `H${zalgo}` }, away: { code: zalgo, name: `A${zalgo}` },
    score: { home: 1, away: 0 }, minute: 55, status: 'LIVE',
    updatedAt: '2026-06-11T19:59:00Z',
  });
  const state = (live: unknown[]) =>
    ({ version: 2, updatedAt: '2026-06-11T19:59:30Z', live, degraded: false,
       source: 'espn', competition: 'fifa.world' }) as never;

  it('caps the SUM, not just each field and the record count', () => {
    // Every field bounded and the record count bounded still left their sum
    // unbounded: 12 records each sitting just under its own cap produced 19.5 KB
    // of context on every prompt submit.
    const out = renderHook(state(Array.from({ length: 12 }, (_, i) => poisoned(i))), {
      now: new Date('2026-06-11T20:00:00Z'),
    });
    expect([...out].length).toBeLessThanOrEqual(4096 + 32);
    expect(out).toContain('(context truncated)'); // stated, never silent
  });

  it('leaves a real matchday block untouched', () => {
    const real = {
      ...poisoned(0), venue: 'Estadio Azteca', city: 'Mexico City', country: 'Mexico',
      home: { code: 'MEX', name: 'Mexico' }, away: { code: 'RSA', name: 'South Africa' },
    };
    const out = renderHook(state([real]), { now: new Date('2026-06-11T20:00:00Z') });
    expect(out).toContain('Mexico');
    expect(out).not.toContain('(context truncated)');
  });
});
