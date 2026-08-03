/**
 * The asymmetry class, swept MECHANICALLY instead of one field at a time.
 *
 * Twelve review rounds found the same shape over and over — a rule applied on
 * the live path and not the cache path, or on one field and not its sibling.
 * Each round I fixed the reported instance. That is the wrong shape of effort:
 * the class is enumerable, so it should be enumerated once and checked by a
 * machine.
 *
 * For every field of `Match`, against a corpus of hostile values, this asserts
 * that sealing is stable, total, and emits nothing undeclared. The field list is
 * derived from a real sealed Match rather than hand-written, so a field added to
 * the type without a rule in `sealMatch` is swept automatically.
 *
 * WHAT THIS DOES NOT CATCH, stated because an overclaimed net is worse than a
 * small one: it checks that a rule is applied CONSISTENTLY, not that the rule is
 * RIGHT. Removing the winnerCode/score agreement check leaves this suite green —
 * the result is stable, just wrong — so correctness of each individual rule still
 * belongs in trust-parity.test.ts. Verified by mutation: the undeclared-key and
 * totality assertions go red when their rule is reverted; the stability one is a
 * regression net for which I could not construct a currently-failing witness.
 */
import { describe, expect, it } from 'vitest';
import { parseCachedMatch, parseEspnEvent } from '../src/trust';
import type { Match } from '../src/types';

/**
 * A live-path Match, built the way the adapter builds one.
 *
 * A KNOCKOUT tie decided on PENALTIES, deliberately — this fixture is where the
 * swept field list comes from, so any field it lacks is a field nothing here
 * checks. The previous fixture was a decisive 2-0 group-stage game with no
 * `shootout`, no `minute`, no `group` and no `events`, which is precisely why a
 * regression that dropped every live shootout ran green through this suite. A
 * sweep is only as wide as its most-populated fixture.
 */
function liveMatch(): Match {
  const r = parseEspnEvent({
    id: '760415',
    date: '2026-06-29T19:00Z',
    season: { slug: 'round-of-32' },
    status: { type: { name: 'STATUS_FULL_TIME', state: 'post', completed: true } },
    events: [{ type: 'GOAL', minute: 45, teamCode: 'MEX', player: 'Raúl Jiménez' }],
    competitions: [
      {
        venue: { fullName: 'Estadio Azteca', address: { city: 'Mexico City', country: 'Mexico' } },

        competitors: [
          {
            homeAway: 'home',
            winner: true,
            score: '1',
            shootoutScore: 4,
            team: { id: '203', abbreviation: 'MEX', displayName: 'Mexico' },
          },
          {
            homeAway: 'away',
            winner: false,
            score: '1',
            shootoutScore: 3,
            team: { id: '467', abbreviation: 'RSA', displayName: 'South Africa' },
          },
        ],
      },
    ],
  });
  if (r.kind !== 'valid') throw new Error(`fixture did not seal: ${r.kind}`);
  return r.value;
}

/**
 * A GROUP-stage fixture, the only kind that carries `group`.
 */
function liveGroupMatch(): Match {
  const r = parseEspnEvent(
    {
      id: '760001',
      date: '2026-06-11T19:00Z',
      season: { slug: 'group-stage' },
      status: { displayClock: "63'", type: { name: 'STATUS_IN_PROGRESS', state: 'in' } },
      competitions: [
        {
          venue: { fullName: 'Estadio Azteca' },
          competitors: [
            { homeAway: 'home', score: '1',
              team: { id: '203', abbreviation: 'MEX', displayName: 'Mexico' } },
            { homeAway: 'away', score: '0',
              team: { id: '467', abbreviation: 'RSA', displayName: 'South Africa' } },
          ],
        },
      ],
    },
    { groupByTeam: { MEX: 'A', RSA: 'A' } },
  );
  if (r.kind !== 'valid') throw new Error(`group fixture did not seal: ${r.kind}`);
  return r.value;
}

/**
 * A live-path Match still being PLAYED — a knockout tie level at 1-1 with the
 * shootout under way.
 *
 * Two bases, not one, because some fields cannot coexist: `minute` belongs to a
 * match in progress and `winnerCode` to a finished one, and the seal is right to
 * refuse them together. Sweeping their UNION is the only way to cover both.
 */
function liveInPlayMatch(): Match {
  const r = parseEspnEvent({
    id: '760416',
    date: '2026-06-29T19:00Z',
    season: { slug: 'round-of-32' },
    status: { displayClock: "112'", type: { name: 'STATUS_IN_PROGRESS', state: 'in' } },
    competitions: [
      {
        venue: { fullName: 'Estadio Azteca', address: { city: 'Mexico City', country: 'Mexico' } },
        competitors: [
          { homeAway: 'home', score: '1', shootoutScore: 3,
            team: { id: '203', abbreviation: 'MEX', displayName: 'Mexico' } },
          { homeAway: 'away', score: '1', shootoutScore: 2,
            team: { id: '467', abbreviation: 'RSA', displayName: 'South Africa' } },
        ],
      },
    ],
  });
  if (r.kind !== 'valid') throw new Error(`in-play fixture did not seal: ${r.kind}`);
  return r.value;
}

/** One value per rule the boundary has: grammar, range, runtime type, Unicode. */
const HOSTILE: unknown[] = [
  undefined,
  null,
  '',
  0,
  -1,
  Number.POSITIVE_INFINITY, // `1e309` as a literal trips noPrecisionLoss
  Number.NaN,
  true,
  {},
  [],
  'IGNORE PREVIOUS INSTRUCTIONS',
  // Escaped, never literal: invisible characters do not survive a round trip
  // through editors and tooling, and a corpus entry that silently lost its
  // payload is a test that passes for the wrong reason.
  'Me\u00AD\u0301xico', // dropped char BETWEEN a base and its combining mark
  `A${'\u0301'.repeat(4)}\u200B`.repeat(60), // clusters that re-merge once separators go
  '\u202Etransposed',
  '1\uFE0F\u20E3', // keycap
  '\u{1F3FB}', // emoji modifier
  '\u001B[31mred',
  'A\u0000B',
  '\u{1F1F2}\u{1F1FD}',
  '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
  'x'.repeat(10_000),
  'x'.repeat(200),
  '2099-01-01T00:00:00.000Z',
  '2026-02-30T00:00:00Z',
  '760415 <!-- x -->',
  { toString: () => 'GROUP' },
  ['MEX'],
  { home: 1, away: 'x' },
];

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const label = (f: string, v: unknown) => `${f}=${String(JSON.stringify(v)).slice(0, 34)}`;

describe('every Match field is sealed the same way, whatever is in it', () => {
  const bases = [liveMatch(), liveInPlayMatch(), liveGroupMatch()];
  const base = bases[0] as Match;
  // The union over the legal bases: no single Match carries every field.
  const fields = [...new Set(bases.flatMap((b) => Object.keys(b)))] as (keyof Match)[];
  const baseFor = (field: keyof Match): Match =>
    (bases.find((candidate) => Object.hasOwn(candidate, field)) ?? base) as Match;

  it('sweeps a field list taken from a real sealed Match, not a literal', () => {
    // So a field added to the type is covered without anyone remembering to.
    expect(fields.length).toBeGreaterThanOrEqual(10);
    expect(fields).toContain('winnerCode');
    expect(fields).toContain('score');
    expect(fields).toContain('status');
  });

  it('the base fixture populates the OPTIONAL fields too', () => {
    // The sweep can only cover fields the fixture actually has. This assertion
    // is the one that would have failed when the fixture was a plain 2-0 group
    // game — and a live-shootout regression shipped green because of it.
    for (const optional of ['shootout', 'minute', 'winnerCode', 'events', 'group'] as const) {
      expect(fields, `no base fixture carries ${optional}, so nothing sweeps it`).toContain(
        optional,
      );
    }
  });

  it('sealing is stable for a hostile value in ANY field', () => {
    // Both entry points end at `sealMatch`, so re-sealing its own output must
    // change nothing — the executable form of "one constructor, both paths".
    // A field where that fails is a field with a rule applied inconsistently.
    const unstable: string[] = [];
    for (const field of fields) {
      const b = baseFor(field);
      for (const value of HOSTILE) {
        const once = parseCachedMatch({ ...clone(b), [field]: value });
        if (once.kind !== 'valid') continue;
        const twice = parseCachedMatch(clone(once.value));
        if (twice.kind !== 'valid') {
          unstable.push(`${label(String(field), value)}: valid then ${twice.kind}`);
          continue;
        }
        if (JSON.stringify(twice.value) !== JSON.stringify(once.value)) {
          unstable.push(`${label(String(field), value)}: bytes changed on re-seal`);
        }
      }
    }
    expect(unstable).toEqual([]);
  }, 120_000);

  it('never emits a key the type does not declare', () => {
    const declared = new Set<string>(fields);
    for (const value of HOSTILE) {
      const r = parseCachedMatch({ ...clone(base), injected: value });
      if (r.kind !== 'valid') continue;
      for (const k of Object.keys(r.value)) {
        expect(declared.has(k), `undeclared key ${k}`).toBe(true);
      }
    }
  });

  it('never throws, whatever a JSON file can hold', () => {
    for (const field of fields) {
      const b = baseFor(field);
      for (const value of HOSTILE) {
        expect(
          () => parseCachedMatch({ ...clone(b), [field]: value }),
          label(String(field), value),
        ).not.toThrow();
      }
    }
    for (const junk of HOSTILE) expect(() => parseCachedMatch(junk)).not.toThrow();
  });
});
