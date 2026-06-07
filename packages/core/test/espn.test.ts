import { describe, expect, it } from 'vitest';
import { mapEspnEvent } from '../src/adapters/espn';

// Minimal ESPN-shaped fixtures mirroring the real response structure.

// Group letters come from the standings map, keyed by team code — not headlines.
const GROUP_MAP: Record<string, string> = { MEX: 'A', RSA: 'A', BRA: 'C', MAR: 'C', NED: 'E', JPN: 'E' };

const scheduled = {
  id: '700001',
  date: '2026-06-11T19:00Z',
  name: 'South Africa at Mexico',
  season: { year: 2026, slug: 'group-stage' },
  status: { type: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false } },
  competitions: [
    {
      venue: { fullName: 'Estadio Banorte', address: { city: 'Mexico City', country: 'Mexico' } },
      competitors: [
        { homeAway: 'home', score: '', team: { abbreviation: 'MEX', displayName: 'Mexico' } },
        { homeAway: 'away', score: '', team: { abbreviation: 'RSA', displayName: 'South Africa' } },
      ],
    },
  ],
};

const live = {
  id: '700002',
  date: '2026-06-13T22:00Z',
  name: 'Morocco at Brazil',
  season: { year: 2026, slug: 'group-stage' },
  status: { type: { name: 'STATUS_IN_PROGRESS', state: 'in', completed: false }, displayClock: "67'", period: 2 },
  competitions: [
    {
      venue: { fullName: 'MetLife Stadium' },
      competitors: [
        { homeAway: 'home', score: '2', team: { abbreviation: 'BRA', displayName: 'Brazil' } },
        { homeAway: 'away', score: '1', team: { abbreviation: 'MAR', displayName: 'Morocco' } },
      ],
    },
  ],
};

const finished = {
  id: '700003',
  date: '2026-06-14T20:00Z',
  name: 'Japan at Netherlands',
  season: { year: 2026, slug: 'group-stage' },
  status: { type: { name: 'STATUS_FULL_TIME', state: 'post', completed: true } },
  competitions: [
    {
      venue: { fullName: 'AT&T Stadium' },
      competitors: [
        { homeAway: 'home', score: '3', team: { abbreviation: 'NED', displayName: 'Netherlands' } },
        { homeAway: 'away', score: '0', team: { abbreviation: 'JPN', displayName: 'Japan' } },
      ],
    },
  ],
};

// Knockout fixture: placeholder names, slug drives the stage, no group letter.
const knockout = {
  id: '700099',
  date: '2026-07-04T17:00Z',
  name: 'Round of 32 3 Winner at Round of 32 1 Winner',
  season: { year: 2026, slug: 'round-of-16' },
  status: { type: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false } },
  competitions: [
    {
      venue: { fullName: 'Mercedes-Benz Stadium' },
      competitors: [
        { homeAway: 'home', score: '', team: { abbreviation: 'RD32', displayName: 'Round of 32 1 Winner' } },
        { homeAway: 'away', score: '', team: { abbreviation: 'RD32', displayName: 'Round of 32 3 Winner' } },
      ],
    },
  ],
};

describe('mapEspnEvent', () => {
  it('maps a scheduled group fixture (stage from slug, group from map)', () => {
    const m = mapEspnEvent(scheduled as never, { groupByTeam: GROUP_MAP });
    expect(m.id).toBe('700001');
    expect(m.status).toBe('SCHEDULED');
    expect(m.kickoff).toBe('2026-06-11T19:00Z');
    expect(m.stage).toBe('GROUP');
    expect(m.group).toBe('A');
    expect(m.venue).toBe('Estadio Banorte');
    expect(m.city).toBe('Mexico City');
    expect(m.country).toBe('Mexico');
    expect(m.home).toEqual({ code: 'MEX', name: 'Mexico', flag: '🇲🇽' });
    expect(m.away).toEqual({ code: 'RSA', name: 'South Africa', flag: '🇿🇦' });
    expect(m.score).toBeUndefined();
    expect(m.minute).toBeUndefined();
  });

  it('maps a live fixture (score + minute + LIVE status)', () => {
    const m = mapEspnEvent(live as never, { groupByTeam: GROUP_MAP });
    expect(m.status).toBe('LIVE');
    expect(m.score).toEqual({ home: 2, away: 1 });
    expect(m.minute).toBe(67);
    expect(m.group).toBe('C');
    expect(m.home.flag).toBe('🇧🇷');
    expect(m.away.flag).toBe('🇲🇦');
    // This fixture's venue has no address block → city/country stay undefined.
    expect(m.city).toBeUndefined();
    expect(m.country).toBeUndefined();
  });

  it('maps a finished fixture (FT + final score, no minute)', () => {
    const m = mapEspnEvent(finished as never, { groupByTeam: GROUP_MAP });
    expect(m.status).toBe('FT');
    expect(m.score).toEqual({ home: 3, away: 0 });
    expect(m.minute).toBeUndefined();
    expect(m.group).toBe('E');
  });

  it('maps a knockout fixture from the slug, with no group letter', () => {
    const m = mapEspnEvent(knockout as never, { groupByTeam: GROUP_MAP });
    expect(m.stage).toBe('R16');
    expect(m.group).toBeUndefined();
    expect(m.home.name).toBe('Round of 32 1 Winner');
    expect(m.home.flag).toBe('🏳️'); // unresolved placeholder
  });

  it('does not assign a group when no map is provided', () => {
    const m = mapEspnEvent(scheduled as never);
    expect(m.stage).toBe('GROUP');
    expect(m.group).toBeUndefined();
  });
});
