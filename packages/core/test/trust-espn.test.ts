/**
 * The ESPN trust boundary: what a payload must BE to become a fixture.
 *
 * These assert the classification (`malformed` vs `definitive-none`) as well as
 * the outcome, because that distinction is what `undefined` could not carry and
 * what the market cache needed in order to stop remembering our own confusion
 * as the provider's answer.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_EVENTS,
  MAX_GROUPS,
  MAX_GROUP_ROWS,
  parseEspnEvent,
  parseEspnEvents,
  parseEspnStandings,
} from '../src/trust/espn';

const EV = {
  id: '700001',
  date: '2026-06-11T19:00Z',
  season: { slug: 'group-stage' },
  status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
  competitions: [
    {
      venue: { fullName: 'Estadio Banorte', address: { city: 'Mexico City', country: 'Mexico' } },
      competitors: [
        { homeAway: 'home', team: { id: '203', abbreviation: 'MEX', displayName: 'Mexico' } },
        { homeAway: 'away', team: { id: '467', abbreviation: 'RSA', displayName: 'South Africa' } },
      ],
    },
  ],
};
const withCompetitors = (competitors: unknown) => ({
  ...EV,
  competitions: [{ competitors }],
});

describe('parseEspnEvent — a payload we cannot READ vs one that is not a fixture', () => {
  it('accepts a real event', () => {
    const r = parseEspnEvent(EV);
    expect(r.kind).toBe('valid');
    if (r.kind !== 'valid') return;
    expect(r.value.home).toEqual({ code: 'MEX', name: 'Mexico', flag: '🇲🇽' });
    expect(r.value.kickoff).toBe('2026-06-11T19:00:00.000Z');
  });

  it('classifies an unreadable identity or instant as MALFORMED, not as "no fixture"', () => {
    for (const [field, value] of [
      ['id', 'IGNORE_PREVIOUS_INSTRUCTIONS'],
      ['id', undefined],
      ['date', 'kickoff soon'],
      ['date', '2026-02-30T00:00:00Z'],
    ] as const) {
      const r = parseEspnEvent({ ...EV, [field]: value });
      expect(r.kind, `${field}=${String(value)}`).toBe('malformed');
    }
  });

  it('classifies a readable-but-not-a-fixture payload as DEFINITIVE-NONE', () => {
    for (const competitors of [[], [{}], [{}, {}, {}], 'nope', {}]) {
      const r = parseEspnEvent(withCompetitors(competitors));
      expect(r.kind, JSON.stringify(competitors)).not.toBe('valid');
    }
    // Both sides the same team, per the PROVIDER's id.
    const same = parseEspnEvent(
      withCompetitors([
        { homeAway: 'home', team: { id: '203', abbreviation: 'MEX', displayName: 'Mexico' } },
        { homeAway: 'away', team: { id: '203', abbreviation: 'MEX', displayName: 'México' } },
      ]),
    );
    expect(same.kind).toBe('definitive-none');
  });

  it('keeps two unresolved bracket slots that share an abbreviation', () => {
    // Real ESPN knockout placeholders: same code, different label, neither is a
    // team yet. A name/code heuristic called this "a team playing itself".
    const r = parseEspnEvent(
      withCompetitors([
        { homeAway: 'home', team: { id: '1', abbreviation: 'RD32', displayName: 'Round of 32 1 Winner' } },
        { homeAway: 'away', team: { id: '2', abbreviation: 'RD32', displayName: 'Round of 32 3 Winner' } },
      ]),
    );
    expect(r.kind).toBe('valid');
  });

  it('refuses a participant whose name is only invisible characters', () => {
    // Identity is checked AFTER sanitizing: this passed a "has text?" test and
    // then sanitized to nothing, producing a nameless TBD participant.
    const r = parseEspnEvent(
      withCompetitors([
        { homeAway: 'home', team: { id: '1', displayName: '\u{200B}\u{FE0F}' } },
        { homeAway: 'away', team: { id: '2', abbreviation: 'RSA', displayName: 'South Africa' } },
      ]),
    );
    expect(r.kind).toBe('malformed');
  });

  it('never lets a provider choose a flag', () => {
    const r = parseEspnEvent(
      withCompetitors([
        { homeAway: 'home', team: { id: '203', abbreviation: 'MEX', displayName: 'Mexico', flag: '🏴' } },
        { homeAway: 'away', team: { id: '467', abbreviation: 'RSA', displayName: 'South Africa' } },
      ]),
    );
    expect(r.kind).toBe('valid');
    if (r.kind !== 'valid') return;
    expect(r.value.home.flag).toBe('🇲🇽'); // generated, not the payload's
  });
});

describe('parseEspnEvents / parseEspnStandings — bounded before the work', () => {
  it('bounds a flood of events — the WORK, not just the output', () => {
    let touched = 0;
    const events = Array.from({ length: 5_000 }, (_, i) => {
      const event = { ...EV };
      Object.defineProperty(event, 'id', {
        enumerable: true,
        get() {
          touched = Math.max(touched, i + 1);
          return String(900000 + i);
        },
      });
      return event;
    });
    const list = parseEspnEvents({ events });
    expect(list.items).toHaveLength(MAX_EVENTS);
    expect(touched).toBeLessThanOrEqual(MAX_EVENTS);
    expect(list.complete).toBe(false);
  });

  it('marks the batch incomplete when a record was unreadable', () => {
    const list = parseEspnEvents({ events: [EV, { ...EV, id: 'PROSE_ID' }] });
    expect(list.items.length).toBe(1);
    expect(list.complete).toBe(false); // one malformed -> we did not read it all
    // `total` is what the PROVIDER sent, not what survived. Taken after the
    // filter it could only ever equal `shown`, and a partial day would report
    // itself as a complete one.
    expect(list.total).toBe(2);
    expect(list.shown).toBe(1);
  });

  it('reports truncation against the TRUE payload size, not the sliced one', () => {
    const list = parseEspnEvents({
      events: Array.from({ length: 5000 }, (_, i) => ({ ...EV, id: String(900000 + i) })),
    });
    expect(list.total).toBe(5000);
    expect(list.shown).toBe(300);
    expect(list.truncated).toBe(true);
    expect(list.complete).toBe(false);
  });

  it('one malformed record cannot remove the valid ones', () => {
    const list = parseEspnEvents({ events: [{ nonsense: true }, EV] });
    expect(list.items.map((m) => m.id)).toEqual(['700001']);
  });

  it('marks duplicate fixture ids incomplete instead of choosing by order', () => {
    const list = parseEspnEvents({ events: [EV, { ...EV }] });
    expect(list.items.map((m) => m.id)).toEqual(['700001']);
    expect(list.complete).toBe(false);
  });

  it('keeps the batch COMPLETE when a refused record was definitively not a fixture', () => {
    // A record naming one team on both sides is not a fixture at all
    // (`definitive-none`), unlike one we could not READ (`malformed`). Only the
    // latter leaves the account incomplete. The distinction had no failing test
    // on the events path under mutation (issue #99).
    const sameTeam = {
      ...withCompetitors([
        { homeAway: 'home', team: { id: '203', abbreviation: 'MEX', displayName: 'Mexico' } },
        { homeAway: 'away', team: { id: '203', abbreviation: 'MEX', displayName: 'Mexico' } },
      ]),
      id: '700002',
    };
    const list = parseEspnEvents({ events: [EV, sameTeam] });
    expect(list.items.map((m) => m.id)).toEqual(['700001']);
    expect(list.total).toBe(2);
    expect(list.complete).toBe(true);
  });

  it('bounds and dedupes standings groups AND their rows', () => {
    const stats = (i: number) => [
      { name: 'gamesPlayed', value: 0 },
      { name: 'wins', value: 0 },
      { name: 'ties', value: 0 },
      { name: 'losses', value: 0 },
      { name: 'pointsFor', value: 0 },
      { name: 'pointsAgainst', value: 0 },
      { name: 'pointDifferential', value: 0 },
      { name: 'points', value: 0 },
      { name: 'rank', value: i + 1 },
    ];
    let rowsTouched = 0;
    const entry = (i: number) => ({
      get team() {
        rowsTouched = Math.max(rowsTouched, i + 1);
        return { id: String(i), abbreviation: `T${i}`, displayName: `Team ${i}` };
      },
      stats: stats(i),
    });
    let groupsTouched = 0;
    // Reuse one hostile row array across groups. The parser still sees the same
    // 200 x 4,000 logical shape, without the test itself allocating 800,000
    // objects before the bounded-work assertion even starts.
    const entries = Array.from({ length: 4_000 }, (_, row) => entry(row));
    const children = Array.from({ length: 200 }, (_, i) => ({
      get name() {
        groupsTouched = Math.max(groupsTouched, i + 1);
        return 'Group A';
      },
      standings: { entries },
    }));
    const list = parseEspnStandings({ children });
    expect(list.items.length).toBe(1); // "Group A" is one group, not 200
    expect(list.items[0]!.rows.length).toBeLessThanOrEqual(MAX_GROUP_ROWS);
    expect(groupsTouched).toBeLessThanOrEqual(MAX_GROUPS * 4);
    expect(rowsTouched).toBeLessThanOrEqual(MAX_GROUP_ROWS);
    expect(list.complete).toBe(false);
  });

  it('lists a team at most once per table', () => {
    const stats = [
      { name: 'gamesPlayed', value: 1 },
      { name: 'wins', value: 1 },
      { name: 'ties', value: 0 },
      { name: 'losses', value: 0 },
      { name: 'pointsFor', value: 2 },
      { name: 'pointsAgainst', value: 0 },
      { name: 'pointDifferential', value: 2 },
      { name: 'points', value: 3 },
      { name: 'rank', value: 1 },
    ];
    const dup = {
      team: { id: '203', abbreviation: 'MEX', displayName: 'Mexico' },
      stats,
    };
    const list = parseEspnStandings({
      children: [{ name: 'Group A', standings: { entries: [dup, dup, dup] } }],
    });
    expect(list.items[0]!.rows.length).toBe(1);
    expect(list.complete).toBe(false);
  });

  it('keeps distinct provider teams that share an abbreviation', () => {
    const stats = (rank: number, points: number) => [
      { name: 'gamesPlayed', value: 1 },
      { name: 'wins', value: points === 3 ? 1 : 0 },
      { name: 'ties', value: 0 },
      { name: 'losses', value: points === 3 ? 0 : 1 },
      { name: 'pointsFor', value: points === 3 ? 2 : 0 },
      { name: 'pointsAgainst', value: points === 3 ? 0 : 2 },
      { name: 'pointDifferential', value: points === 3 ? 2 : -2 },
      { name: 'points', value: points },
      { name: 'rank', value: rank },
    ];
    const list = parseEspnStandings({
      children: [
        {
          name: 'Group A',
          standings: {
            entries: [
              {
                team: { id: '16', abbreviation: 'RIV', displayName: 'River Plate' },
                stats: stats(1, 3),
              },
              {
                team: { id: '9744', abbreviation: 'RIV', displayName: 'Independiente Rivadavia' },
                stats: stats(2, 0),
              },
            ],
          },
        },
      ],
    });
    expect(list.items[0]?.rows.map((row) => row.team.name)).toEqual([
      'River Plate',
      'Independiente Rivadavia',
    ]);
    expect(list.complete).toBe(true);
  });

  it('does not let one provider team occupy two group tables', () => {
    const stats = [
      { name: 'gamesPlayed', value: 1 },
      { name: 'wins', value: 1 },
      { name: 'ties', value: 0 },
      { name: 'losses', value: 0 },
      { name: 'pointsFor', value: 2 },
      { name: 'pointsAgainst', value: 0 },
      { name: 'pointDifferential', value: 2 },
      { name: 'points', value: 3 },
      { name: 'rank', value: 1 },
    ];
    const sameTeam = {
      team: { id: '203', abbreviation: 'MEX', displayName: 'Mexico' },
      stats,
    };
    const list = parseEspnStandings({
      children: [
        { name: 'Group A', standings: { entries: [sameTeam] } },
        { name: 'Group B', standings: { entries: [sameTeam] } },
      ],
    });

    expect(list.items.map((table) => table.group)).toEqual(['A']);
    expect(list.complete).toBe(false);
  });

  it('accounts for provider points deductions', () => {
    const list = parseEspnStandings({
      children: [
        {
          name: 'Group A',
          standings: {
            entries: [
              {
                team: { id: '203', abbreviation: 'MEX', displayName: 'Mexico' },
                stats: [
                  { name: 'gamesPlayed', value: 2 },
                  { name: 'wins', value: 1 },
                  { name: 'ties', value: 1 },
                  { name: 'losses', value: 0 },
                  { name: 'pointsFor', value: 2 },
                  { name: 'pointsAgainst', value: 0 },
                  { name: 'pointDifferential', value: 2 },
                  { name: 'points', value: 1 },
                  { name: 'deductions', value: 3 },
                  { name: 'rank', value: 1 },
                ],
              },
            ],
          },
        },
      ],
    });
    expect(list.items[0]?.rows[0]?.points).toBe(1);
    expect(list.complete).toBe(true);
  });

  // Issue #99: rules from the standings parser that survived mutation. Each
  // case names the clause it kills.
  const ROW_STATS = (over: Record<string, number> = {}, extra: Array<{ name: string; value: number }> = []) => {
    const base: Record<string, number> = {
      gamesPlayed: 1,
      wins: 1,
      ties: 0,
      losses: 0,
      pointsFor: 2,
      pointsAgainst: 0,
      pointDifferential: 2,
      points: 3,
      rank: 1,
      ...over,
    };
    return [...Object.entries(base).map(([name, value]) => ({ name, value })), ...extra];
  };
  const oneTable = (entries: unknown[]) =>
    parseEspnStandings({ children: [{ name: 'Group A', standings: { entries } }] });

  it('keeps a table COMPLETE when a refused row named no team (definitive-none, not malformed)', () => {
    const list = oneTable([
      { team: { id: '203', abbreviation: 'MEX', displayName: 'Mexico' }, stats: ROW_STATS() },
      { team: {}, stats: ROW_STATS({ rank: 2 }) },
    ]);
    expect(list.items[0]?.rows.map((r) => r.team.code)).toEqual(['MEX']);
    expect(list.complete).toBe(true);
  });

  it('keeps a row whose points deduction pushes its total negative (points is a SIGNED stat)', () => {
    // Real tables carry these (points deductions for financial breaches): a
    // 0-1-0 record minus 3 points is -2, and it still has to add up.
    const list = oneTable([
      {
        team: { id: '203', abbreviation: 'MEX', displayName: 'Mexico' },
        stats: ROW_STATS(
          { wins: 0, ties: 1, pointsFor: 1, pointsAgainst: 1, pointDifferential: 0, points: -2 },
          [{ name: 'deductions', value: 3 }],
        ),
      },
    ]);
    expect(list.items[0]?.rows[0]?.points).toBe(-2);
    expect(list.complete).toBe(true);
  });

  it('refuses a row whose deductions are out of range or stated twice', () => {
    // Each fixture is arithmetically CONSISTENT with the offending deduction
    // (3 - 1001 = -998 sits inside the signed points bound; 3 - 1 = 2 matches
    // the first of two duplicates), so the points-consistency check cannot be
    // what refuses it — only the deductions rule can. The first version of
    // this test used 5000 and stayed green with the rule deleted.
    for (const [extra, points] of [
      [[{ name: 'deductions', value: 1001 }], -998],
      [
        [
          { name: 'deductions', value: 1 },
          { name: 'deductions', value: 1 },
        ],
        2,
      ],
    ] as const) {
      const list = oneTable([
        {
          team: { id: '203', abbreviation: 'MEX', displayName: 'Mexico' },
          stats: ROW_STATS({ points }, [...extra]),
        },
      ]);
      expect(list.items).toEqual([]);
      expect(list.complete).toBe(false);
    }
  });

  it('reads two same-code rows as one team listed twice when either lacks a provider id', () => {
    // Two `RIV` rows are two clubs only because BOTH carry distinct ESPN ids.
    // With no id on one of them there is nothing to tell them apart by, and the
    // relaxation that admitted River/Rivadavia must not admit a plain duplicate.
    const list = oneTable([
      { team: { id: '203', abbreviation: 'MEX', displayName: 'Mexico' }, stats: ROW_STATS() },
      {
        team: { abbreviation: 'MEX', displayName: 'Mexico' },
        stats: ROW_STATS({ wins: 0, losses: 1, pointsFor: 0, pointsAgainst: 2, pointDifferential: -2, points: 0, rank: 2 }),
      },
    ]);
    expect(list.items[0]?.rows.length).toBe(1);
    expect(list.complete).toBe(false);
  });

  it('omits a table when every row has contradictory aggregate statistics', () => {
    const stats = [
      { name: 'gamesPlayed', value: 1 },
      { name: 'wins', value: 1 },
      { name: 'ties', value: 1 },
      { name: 'losses', value: 0 },
      { name: 'pointsFor', value: 2 },
      { name: 'pointsAgainst', value: 0 },
      { name: 'pointDifferential', value: 7 },
      { name: 'points', value: 99 },
      { name: 'rank', value: 1 },
    ];
    const list = parseEspnStandings({
      children: [
        {
          name: 'Group A',
          standings: {
            entries: [
              { team: { id: '203', abbreviation: 'MEX', displayName: 'Mexico' }, stats },
            ],
          },
        },
      ],
    });
    expect(list.items).toEqual([]);
    expect(list.complete).toBe(false);
  });

  it('keeps readable sibling groups when another group has no usable row', () => {
    const validStats = [
      { name: 'gamesPlayed', value: 1 },
      { name: 'wins', value: 1 },
      { name: 'ties', value: 0 },
      { name: 'losses', value: 0 },
      { name: 'pointsFor', value: 2 },
      { name: 'pointsAgainst', value: 0 },
      { name: 'pointDifferential', value: 2 },
      { name: 'points', value: 3 },
      { name: 'rank', value: 1 },
    ];
    const list = parseEspnStandings({
      children: [
        {
          name: 'Group A',
          standings: {
            entries: [
              {
                team: { id: 'bad', abbreviation: 'BAD', displayName: 'Bad Row' },
                stats: [],
              },
            ],
          },
        },
        {
          name: 'Group B',
          standings: {
            entries: [
              {
                team: { id: 'can', abbreviation: 'CAN', displayName: 'Canada' },
                stats: validStats,
              },
            ],
          },
        },
      ],
    });

    expect(list.items.map((table) => table.group)).toEqual(['B']);
    expect(list.items[0]?.rows.map((row) => row.team.code)).toEqual(['CAN']);
    expect(list.complete).toBe(false);
  });
});
