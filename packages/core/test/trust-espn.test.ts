/**
 * The ESPN trust boundary: what a payload must BE to become a fixture.
 *
 * These assert the classification (`malformed` vs `definitive-none`) as well as
 * the outcome, because that distinction is what `undefined` could not carry and
 * what the market cache needed in order to stop remembering our own confusion
 * as the provider's answer.
 */
import { describe, expect, it } from 'vitest';
import { MAX_GROUP_ROWS, parseEspnEvent, parseEspnEvents, parseEspnStandings } from '../src/trust/espn';

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
  it('bounds a flood of events and reports it', () => {
    const events = Array.from({ length: 5000 }, (_, i) => ({ ...EV, id: String(900000 + i) }));
    const t = process.hrtime.bigint();
    const list = parseEspnEvents({ events });
    expect(Number(process.hrtime.bigint() - t) / 1e6).toBeLessThan(500);
    expect(list.items.length).toBeLessThanOrEqual(300);
  });

  it('marks the batch incomplete when a record was unreadable', () => {
    const list = parseEspnEvents({ events: [EV, { ...EV, id: 'PROSE_ID' }] });
    expect(list.items.length).toBe(1);
    expect(list.complete).toBe(false); // one malformed -> we did not read it all
  });

  it('one malformed record cannot remove the valid ones', () => {
    const list = parseEspnEvents({ events: [{ nonsense: true }, EV] });
    expect(list.items.map((m) => m.id)).toEqual(['700001']);
  });

  it('bounds and dedupes standings groups AND their rows', () => {
    const entry = (i: number) => ({
      team: { id: String(i), abbreviation: `T${i}`, displayName: `Team ${i}` },
      stats: [{ name: 'points', value: 3 }],
    });
    const children = Array.from({ length: 200 }, () => ({
      name: 'Group A',
      standings: { entries: Array.from({ length: 4000 }, (_, i) => entry(i)) },
    }));
    const t = process.hrtime.bigint();
    const list = parseEspnStandings({ children });
    expect(Number(process.hrtime.bigint() - t) / 1e6).toBeLessThan(200);
    expect(list.items.length).toBe(1); // "Group A" is one group, not 200
    expect(list.items[0]!.rows.length).toBeLessThanOrEqual(MAX_GROUP_ROWS);
  });

  it('lists a team at most once per table', () => {
    const dup = {
      team: { id: '203', abbreviation: 'MEX', displayName: 'Mexico' },
      stats: [{ name: 'points', value: 9 }],
    };
    const list = parseEspnStandings({
      children: [{ name: 'Group A', standings: { entries: [dup, dup, dup] } }],
    });
    expect(list.items[0]!.rows.length).toBe(1);
  });
});
