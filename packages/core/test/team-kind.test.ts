/**
 * A club has no flag, and the competition says which teams are clubs
 * (0.11 · 2.2, D4: "no flags for clubs", "nothing in the flag's place").
 *
 * The flag was generated from the NAME on every path, so a club named like a
 * region (`Monaco`) was flagged 🇲🇨 and every other club 🏳️, the bundle's
 * placeholder, which the knockout surfaces read as "not yet resolved". Now the
 * one constructor takes the team's KIND, a written fact of the competition:
 * a nation's flag is generated from its name as before; a club carries no
 * flag at all (the key is absent, not empty). The live path and the cache path
 * agree (trust-parity), a placeholder is a placeholder and a club side is
 * resolved, and Mexico's rally cry is Mexico's.
 */
import { describe, expect, it } from 'vitest';
import { isMexicoNationalTeam, isPlaceholderSide, productFlag } from '../src';
import type { Match, Team } from '../src/types';
import { parseCachedMatch, parseEspnEvent, parseEspnStandings, sealMatch, sealTeam } from '../src/trust';

const roundTrip = <T>(v: T): unknown => JSON.parse(JSON.stringify(v));

function espnEvent(home: [string, string, string], away: [string, string, string], over: Record<string, unknown> = {}) {
  return {
    id: '800000001',
    date: '2026-10-04T14:00Z',
    season: { slug: '2026-27-english-premier-league' },
    status: { type: { name: 'STATUS_IN_PROGRESS', state: 'in' }, displayClock: "50'" },
    competitions: [
      {
        venue: { fullName: 'Emirates Stadium', address: { city: 'London' } },
        competitors: [
          { homeAway: 'home', score: '2', team: { id: home[0], abbreviation: home[1], displayName: home[2] } },
          { homeAway: 'away', score: '1', team: { id: away[0], abbreviation: away[1], displayName: away[2] } },
        ],
      },
    ],
    ...over,
  };
}

const live = (competition: string, ev = espnEvent(['359', 'ARS', 'Arsenal'], ['363', 'CHE', 'Chelsea'])): Match => {
  const r = parseEspnEvent(ev, { competition });
  if (r.kind !== 'valid') throw new Error(JSON.stringify(r));
  return r.value;
};

describe('sealTeam takes the kind: a nation is flagged from its name, a club is not', () => {
  it('a nation', () => {
    const t = sealTeam({ code: 'MEX', name: 'Mexico', id: 'espn:203' }, 'nation');
    expect(t).toEqual({ code: 'MEX', name: 'Mexico', flag: '🇲🇽', id: 'espn:203' });
  });

  it('a club: no flag key, not an empty string, not a placeholder', () => {
    const t = sealTeam({ code: 'ARS', name: 'Arsenal', id: 'espn:359' }, 'club');
    expect(t).toEqual({ code: 'ARS', name: 'Arsenal', id: 'espn:359' });
    expect(t && 'flag' in t).toBe(false);
  });

  it('a club named like a region gets none (Monaco is 🇲🇨 by name; a nation competition would say so)', () => {
    expect(productFlag('Monaco')).toBe('🇲🇨');
    expect(sealTeam({ code: 'MON', name: 'Monaco', id: 'espn:1234' }, 'club')).toEqual({ code: 'MON', name: 'Monaco', id: 'espn:1234' });
    expect(sealTeam({ code: 'MON', name: 'Monaco' }, 'nation')).toEqual({ code: 'MON', name: 'Monaco', flag: '🇲🇨' });
  });

  it('a nation competition\'s side whose name is no nation is the placeholder, as before', () => {
    expect(sealTeam({ code: 'RD32', name: 'Round of 32 1 Winner', id: 'espn:1' }, 'nation')?.flag).toBe('🏳️');
  });

  it('a flag in the raw team is never read, whatever the kind', () => {
    expect(sealTeam({ code: 'ARS', name: 'Arsenal', flag: '🇬🇧' }, 'club')).toEqual({ code: 'ARS', name: 'Arsenal' });
    expect(sealTeam({ code: 'MEX', name: 'Mexico', flag: '🇺🇸' }, 'nation')?.flag).toBe('🇲🇽');
  });
});

describe('both paths, one rule: the live record and the cache file agree on the flag', () => {
  it('a club read live has no flag, and reads back from the cache with none', () => {
    const m = live('eng.1');
    expect('flag' in m.home).toBe(false);
    expect('flag' in m.away).toBe(false);
    const back = parseCachedMatch(roundTrip(m), { teamKind: 'club' });
    expect(back.kind === 'valid' && back.value).toEqual(m);
    expect(back.kind === 'valid' && 'flag' in back.value.home).toBe(false);
  });

  it('a nation off the bundle keeps its flag on both paths (Albania in the Nations League)', () => {
    const m = live('uefa.nations', espnEvent(['2654', 'ALB', 'Albania'], ['2578', 'LVA', 'Latvia'], { season: { slug: 'league-phase' } }));
    expect(m.home.flag).toBe('🇦🇱');
    expect(m.away.flag).toBe('🇱🇻');
    const back = parseCachedMatch(roundTrip(m), { teamKind: 'nation' });
    expect(back.kind === 'valid' && back.value).toEqual(m);
  });

  it('a cache file that carries a flag for a club: the cache path drops it like the live path never had it', () => {
    const m = live('eng.1');
    const poisoned = { ...roundTrip(m) as Record<string, unknown>, home: { code: 'ARS', name: 'Arsenal', id: 'espn:359', flag: '🏳️' } };
    const back = parseCachedMatch(poisoned, { teamKind: 'club' });
    expect(back.kind === 'valid' && back.value.home).toEqual({ code: 'ARS', name: 'Arsenal', id: 'espn:359' });
  });

  it('the kind is the reader\'s to state: with none stated a team is a club (nothing is vouched for)', () => {
    const m = live('uefa.nations', espnEvent(['2654', 'ALB', 'Albania'], ['2578', 'LVA', 'Latvia']));
    const back = parseCachedMatch(roundTrip(m));
    expect(back.kind === 'valid' && 'flag' in back.value.home).toBe(false);
    const bundle = live('fifa.world', espnEvent(['203', 'MEX', 'Mexico'], ['467', 'RSA', 'South Africa']));
    expect(bundle.home.flag).toBe('🇲🇽');
    const nothing = parseEspnEvent(espnEvent(['203', 'MEX', 'Mexico'], ['467', 'RSA', 'South Africa']), {});
    expect(nothing.kind === 'valid' && 'flag' in nothing.value.home).toBe(false);
  });

  it('sealMatch carries the kind to both sides', () => {
    const parts = roundTrip(live('eng.1')) as Record<string, unknown>;
    const asNation = sealMatch(parts as never, { teamKind: 'nation' });
    expect(asNation.kind === 'valid' && asNation.value.home.flag).toBe('🏳️');
    const asClub = sealMatch(parts as never, { teamKind: 'club' });
    expect(asClub.kind === 'valid' && 'flag' in asClub.value.home).toBe(false);
  });

  it('standings rows seal their team with the competition\'s kind', () => {
    const payload = {
      name: 'Premier League',
      children: [
        {
          name: 'Premier League',
          standings: {
            entries: [
              {
                team: { id: '359', abbreviation: 'ARS', displayName: 'Arsenal' },
                stats: [
                  { name: 'gamesPlayed', value: 1 }, { name: 'wins', value: 1 }, { name: 'ties', value: 0 },
                  { name: 'losses', value: 0 }, { name: 'pointsFor', value: 2 }, { name: 'pointsAgainst', value: 1 },
                  { name: 'pointDifferential', value: 1 }, { name: 'points', value: 3 }, { name: 'rank', value: 1 },
                ],
              },
            ],
          },
        },
      ],
    };
    const club = parseEspnStandings(payload, 'league', undefined, 'eng.1');
    const row = club.items[0]?.rows[0];
    expect(row?.team.name).toBe('Arsenal');
    expect(row && 'flag' in row.team).toBe(false);
    const nation = parseEspnStandings({ ...payload, children: [{ ...payload.children[0], standings: { entries: [{ ...payload.children[0]?.standings.entries[0], team: { id: '2654', abbreviation: 'ALB', displayName: 'Albania' } }] } }] }, 'league', undefined, 'uefa.nations');
    expect(nation.items[0]?.rows[0]?.team.flag).toBe('🇦🇱');
  });
});

describe('a placeholder is a placeholder; a club side is resolved', () => {
  const side = (over: Partial<Team>): Team => ({ code: 'TBD', name: 'TBD', ...over });

  it('the bundle\'s 🏳️ side is a placeholder', () => {
    expect(isPlaceholderSide(side({ code: 'RD32', name: 'Round of 32 1 Winner', flag: '🏳️' }))).toBe(true);
    expect(isPlaceholderSide(side({ flag: '🏳️' }))).toBe(true);
  });

  it('a nation is not', () => {
    expect(isPlaceholderSide(side({ code: 'MEX', name: 'Mexico', flag: '🇲🇽' }))).toBe(false);
  });

  it('a club side, which has no flag, is resolved', () => {
    expect(isPlaceholderSide(side({ code: 'ARS', name: 'Arsenal', id: 'espn:359' }))).toBe(false);
    expect(isPlaceholderSide(side({ code: 'ARS', name: 'Arsenal' }))).toBe(false);
  });
});

describe('"¿Y si sí?" is Mexico\'s national team\'s, by identity', () => {
  it('Mexico by its provider id, in a nation competition', () => {
    expect(isMexicoNationalTeam({ code: 'MEX', name: 'Mexico', flag: '🇲🇽', id: 'espn:203' }, 'nation')).toBe(true);
    expect(isMexicoNationalTeam({ code: 'MEX', name: 'México', flag: '🇲🇽', id: 'espn:203' }, 'nation')).toBe(true);
  });

  it('the bundle\'s Mexico, which carries no id: by its code AND its name', () => {
    expect(isMexicoNationalTeam({ code: 'MEX', name: 'Mexico', flag: '🇲🇽' }, 'nation')).toBe(true);
    expect(isMexicoNationalTeam({ code: 'MEX', name: 'Club Mexico' }, 'nation')).toBe(false);
    expect(isMexicoNationalTeam({ code: 'MEX', name: 'Melilla' }, 'nation')).toBe(false);
    expect(isMexicoNationalTeam({ code: 'MXC', name: 'Mexico' }, 'nation')).toBe(false);
  });

  it('never a club coded MEX, never another nation, never off a nation competition', () => {
    expect(isMexicoNationalTeam({ code: 'MEX', name: 'Club Mexico', id: 'espn:9999' }, 'club')).toBe(false);
    expect(isMexicoNationalTeam({ code: 'MEX', name: 'Mexico', id: 'espn:9999' }, 'nation')).toBe(false);
    expect(isMexicoNationalTeam({ code: 'MEX', name: 'Mexico', flag: '🇲🇽', id: 'espn:203' }, 'club')).toBe(false);
    expect(isMexicoNationalTeam({ code: 'MEX', name: 'Mexico' }, 'club')).toBe(false);
    expect(isMexicoNationalTeam({ code: 'USA', name: 'United States', flag: '🇺🇸', id: 'espn:660' }, 'nation')).toBe(false);
  });
});
