/**
 * A saved pin is a RESOLVED team (0.11 · 2.5b): `next` with no argument takes
 * it as it is, never re-resolving it through the roster. Off the bundle its
 * fixture is selected by `isTeam` over discovery's span (the id decides,
 * whatever the labels; no standings read); on the bundle, where the nations
 * carry no id, by code. The answer is a `NextFixtureResult` like any other
 * (its verdicts included).
 */
import { describe, expect, it, vi } from 'vitest';
import { attachFetchMeta, type Match, nextFixtureForPin, type ProviderAdapter } from '../src';

const NOW = new Date('2026-10-04T12:00:00Z');
const fixture = (over: Partial<Match> = {}): Match => ({
  id: '800000001',
  stage: 'REGULAR',
  kickoff: '2026-10-10T11:30:00.000Z',
  venue: 'Emirates Stadium',
  home: { code: 'AFC', name: 'Arsenal FC', id: 'espn:359' },
  away: { code: 'LEE', name: 'Leeds United', id: 'espn:357' },
  status: 'SCHEDULED',
  updatedAt: NOW.toISOString(),
  ...over,
});
const whole = (ms: Match[]) => attachFetchMeta(ms, { complete: true, omitted: 0, seasons: [] });

describe('off the bundle', () => {
  it('the pin\'s fixture by its id, whatever the labels, with no roster read', async () => {
    const fetchStandings = vi.fn(async () => ({ children: [] }));
    const adapter: ProviderAdapter = {
      name: 'espn',
      competition: 'eng.1',
      capabilities: { push: false, latencyHintSec: 0 },
      async fetchByDate() {
        return whole([fixture()]);
      },
      async fetchLive() {
        return [];
      },
      async fetchWindow() {
        return whole([fixture()]);
      },
      fetchStandings: fetchStandings as unknown as ProviderAdapter['fetchStandings'],
    };
    const r = await nextFixtureForPin(adapter, { id: 'espn:359', code: 'ARS', name: 'Arsenal' }, NOW);
    expect(r.fixture?.id).toBe('800000001');
    expect(r.team).toMatchObject({ id: 'espn:359' });
    expect(r.degraded).toBe(false);
    expect(fetchStandings).not.toHaveBeenCalled();
  });

  it('a side carrying another club\'s id is never the pin\'s fixture, whatever its code and name', async () => {
    const adapter: ProviderAdapter = {
      name: 'espn',
      competition: 'eng.1',
      capabilities: { push: false, latencyHintSec: 0 },
      async fetchByDate() {
        return whole([]);
      },
      async fetchLive() {
        return [];
      },
      async fetchWindow() {
        return whole([fixture({ home: { code: 'ARS', name: 'Arsenal', id: 'espn:999' } })]);
      },
    };
    const r = await nextFixtureForPin(adapter, { id: 'espn:359', code: 'ARS', name: 'Arsenal' }, NOW);
    expect(r.fixture).toBeUndefined();
    expect(r.horizon).toEqual({ days: 14 });
    expect(r.degraded).toBe(false);
  });

  it('a read that was not whole: partial, no horizon, the fixture if read', async () => {
    const adapter: ProviderAdapter = {
      name: 'espn',
      competition: 'eng.1',
      capabilities: { push: false, latencyHintSec: 0 },
      async fetchByDate() {
        return whole([]);
      },
      async fetchLive() {
        return [];
      },
      async fetchWindow() {
        return attachFetchMeta([], { complete: false, omitted: 2, seasons: [] });
      },
    };
    const r = await nextFixtureForPin(adapter, { id: 'espn:359', code: 'ARS', name: 'Arsenal' }, NOW);
    expect(r.fixture).toBeUndefined();
    expect(r.partial).toEqual({ omitted: 2 });
    expect(r.horizon).toBeUndefined();
  });
});

describe('the pinned team is built by the one constructor', () => {
  it('a pinned nation off the bundle carries its generated flag, as the same team asked by name does', async () => {
    const spainVsFrance = fixture({ home: { code: 'ESP', name: 'Spain', id: 'espn:164' }, away: { code: 'FRA', name: 'France', id: 'espn:478' } });
    const adapter: ProviderAdapter = {
      name: 'espn',
      competition: 'uefa.nations',
      capabilities: { push: false, latencyHintSec: 0 },
      async fetchByDate() {
        return whole([spainVsFrance]);
      },
      async fetchLive() {
        return [];
      },
      async fetchWindow() {
        return whole([spainVsFrance]);
      },
    };
    const r = await nextFixtureForPin(adapter, { id: 'espn:164', code: 'ESP', name: 'Spain' }, NOW);
    expect(r.team).toEqual({ code: 'ESP', name: 'Spain', id: 'espn:164', flag: '\u{1F1EA}\u{1F1F8}' });
    // A club's team has no flag key at all.
    const club: ProviderAdapter = { ...adapter, competition: 'eng.1' };
    const c = await nextFixtureForPin(club, { id: 'espn:359', code: 'ARS', name: 'Arsenal' }, NOW);
    expect(c.team).toEqual({ code: 'ARS', name: 'Arsenal', id: 'espn:359' });
    expect(c.team && 'flag' in c.team).toBe(false);
  });

  it('a pinned team on a read that answers between editions: the verdict, the team kept', async () => {
    const ended: ProviderAdapter = {
      name: 'espn',
      competition: 'fifa.cwc',
      capabilities: { push: false, latencyHintSec: 0 },
      async fetchByDate() {
        return attachFetchMeta([], { complete: true, omitted: 0, seasons: [{ year: 2025, label: '2025 Club World Cup', startDate: '2025-06-14', endDate: '2025-07-13' }], season: { year: 2025, label: '2025 Club World Cup', startDate: '2025-06-14', endDate: '2025-07-13' } });
      },
      async fetchLive() {
        return [];
      },
      async fetchWindow() {
        return attachFetchMeta([], { complete: true, omitted: 0, seasons: [{ year: 2025, label: '2025 Club World Cup', startDate: '2025-06-14', endDate: '2025-07-13' }], season: { year: 2025, label: '2025 Club World Cup', startDate: '2025-06-14', endDate: '2025-07-13' } });
      },
    };
    const r = await nextFixtureForPin(ended, { id: 'espn:363', code: 'CHE', name: 'Chelsea' }, NOW);
    expect(r.betweenEditions).toMatchObject({ ended: '2025-07-13' });
    expect(r.fixture).toBeUndefined();
    expect(r.team).toMatchObject({ id: 'espn:363' });
  });
});

describe('on the bundle', () => {
  it('an id-less pin (a nation) selects by code, as `next MEX` does', async () => {
    const adapter: ProviderAdapter = {
      name: 'espn',
      competition: 'fifa.world',
      capabilities: { push: false, latencyHintSec: 0 },
      async fetchByDate() {
        return [];
      },
      async fetchLive() {
        return [];
      },
    };
    const r = await nextFixtureForPin(adapter, { code: 'MEX', name: 'Mexico' }, new Date('2026-06-01T00:00:00Z'));
    expect(r.fixture?.home.code === 'MEX' || r.fixture?.away.code === 'MEX').toBe(true);
  });
});
