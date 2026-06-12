import { describe, expect, it } from 'vitest';
import {
  allFixtures,
  currentOrNextFixtureForTeam,
  fixturesInLiveWindow,
  getMatchById,
  LIVE_WINDOW_MS,
  marketFixtureForTeam,
  marketRelevant,
  type Match,
  type ProviderAdapter,
} from '../src/index';

function fx(id: string, kickoff: string, over: Partial<Match> = {}): Match {
  return {
    id,
    stage: 'GROUP',
    group: 'D',
    kickoff,
    venue: 'X',
    home: { code: 'USA', name: 'United States', flag: '🇺🇸' },
    away: { code: 'PAR', name: 'Paraguay', flag: '🇵🇾' },
    status: 'SCHEDULED',
    updatedAt: '2026-06-01T00:00Z',
    ...over,
  };
}

const a = fx('a', '2026-06-12T01:00Z');
const b = fx('b', '2026-06-19T19:00Z');
const fixtures = [b, a]; // out of order on purpose — helpers must sort

describe('currentOrNextFixtureForTeam', () => {
  it('returns the next fixture before kickoff', () => {
    const got = currentOrNextFixtureForTeam('USA', {
      from: new Date('2026-06-11T00:00:00Z'),
      fixtures,
    });
    expect(got?.id).toBe('a');
  });

  it('returns the IN-PLAY fixture during its live window (next would skip it)', () => {
    const during = new Date(Date.parse(a.kickoff) + 30 * 60_000);
    expect(currentOrNextFixtureForTeam('usa', { from: during, fixtures })?.id).toBe('a');
  });

  it('moves on to the next fixture once the window has passed', () => {
    const after = new Date(Date.parse(a.kickoff) + LIVE_WINDOW_MS + 60_000);
    expect(currentOrNextFixtureForTeam('USA', { from: after, fixtures })?.id).toBe('b');
  });
});

describe('fixturesInLiveWindow', () => {
  it('contains exactly the fixture whose window covers now', () => {
    const during = Date.parse(a.kickoff) + 60_000;
    expect(fixturesInLiveWindow(during, fixtures).map((m) => m.id)).toEqual(['a']);
    expect(fixturesInLiveWindow(Date.parse('2026-06-01T00:00:00Z'), fixtures)).toEqual([]);
  });
});

describe('marketRelevant', () => {
  it('is true before kickoff and during the live window', () => {
    expect(marketRelevant(a, new Date('2026-06-11T00:00:00Z'))).toBe(true);
    expect(marketRelevant(a, new Date(Date.parse(a.kickoff) + 60 * 60_000))).toBe(true);
  });

  it('is false for FT status and for long-past windows (static fixtures)', () => {
    expect(marketRelevant(fx('ft', a.kickoff, { status: 'FT' }), new Date(a.kickoff))).toBe(false);
    expect(marketRelevant(a, new Date(Date.parse(a.kickoff) + LIVE_WINDOW_MS + 60_000))).toBe(
      false,
    );
  });

  it('fails open on an unparseable kickoff (the reliability gate still applies)', () => {
    expect(marketRelevant(fx('bad', 'not-a-date'), new Date())).toBe(true);
  });

  it('stays relevant for a LIVE overlay past the window (extra time, knockouts)', () => {
    const et = fx('et', a.kickoff, { status: 'LIVE', minute: 117 });
    const deepIntoEt = new Date(Date.parse(a.kickoff) + LIVE_WINDOW_MS + 20 * 60_000);
    expect(marketRelevant(et, deepIntoEt)).toBe(true);
  });

  it('ends relevance on an EARLY live FT even inside the window', () => {
    const earlyFt = fx('eft', a.kickoff, { status: 'FT', score: { home: 1, away: 0 } });
    expect(marketRelevant(earlyFt, new Date(Date.parse(a.kickoff) + 100 * 60_000))).toBe(false);
  });
});

describe('getMatchById', () => {
  // The bundled schedule's first fixture; its UTC date may differ from the
  // provider's scoreboard day — getMatchById must fetch a ±1-day window.
  it('fetches a ±1-day window and overlays the live match', async () => {
    const windows: Array<[string, string]> = [];
    const adapter: ProviderAdapter = {
      name: 'fake',
      capabilities: { push: false, latencyHintSec: 0 },
      async fetchByDate() {
        throw new Error('should use fetchWindow when available');
      },
      async fetchWindow(start: string, end: string) {
        windows.push([start, end]);
        const { allFixtures } = await import('../src/index');
        const base = allFixtures()[0]!;
        return [{ ...base, status: 'FT' as const, score: { home: 2, away: 0 } }];
      },
      async fetchLive() {
        return [];
      },
    };
    const { allFixtures } = await import('../src/index');
    const id = allFixtures()[0]!.id;
    const day = allFixtures()[0]!.kickoff.slice(0, 10);
    const r = await getMatchById(adapter, id);
    expect(r.match?.status).toBe('FT');
    expect(r.source).toBe('fake');
    expect(windows.length).toBe(1);
    expect(windows[0]![0] < day && windows[0]![1] > day).toBe(true);
  });

  it('falls back to the static fixture on provider errors (degraded)', async () => {
    const adapter: ProviderAdapter = {
      name: 'boom',
      capabilities: { push: false, latencyHintSec: 0 },
      async fetchByDate() {
        throw new Error('down');
      },
      async fetchWindow() {
        throw new Error('down');
      },
      async fetchLive() {
        return [];
      },
    };
    const { allFixtures } = await import('../src/index');
    const id = allFixtures()[0]!.id;
    const r = await getMatchById(adapter, id);
    expect(r.match?.id).toBe(id);
    expect(r.degraded).toBe(true);
    expect(r.source).toBeUndefined();
  });

  it('returns no match for an unknown id without touching the provider', async () => {
    let called = false;
    const adapter: ProviderAdapter = {
      name: 'fake',
      capabilities: { push: false, latencyHintSec: 0 },
      async fetchByDate() {
        called = true;
        return [];
      },
      async fetchWindow() {
        called = true;
        return [];
      },
      async fetchLive() {
        return [];
      },
    };
    const r = await getMatchById(adapter, 'nope');
    expect(r.match).toBeUndefined();
    expect(called).toBe(false);
  });
});

describe('marketFixtureForTeam (live-confirmed selection)', () => {
  // Uses the real bundled schedule: the opener + the home team's later fixture.
  const opener = allFixtures()[0]!;
  const team = opener.home.code;

  function adapterReturning(overlay: Match[] | 'throw'): ProviderAdapter {
    return {
      name: 'fake',
      capabilities: { push: false, latencyHintSec: 0 },
      async fetchByDate() {
        if (overlay === 'throw') throw new Error('down');
        return overlay;
      },
      async fetchWindow() {
        if (overlay === 'throw') throw new Error('down');
        return overlay;
      },
      async fetchLive() {
        return [];
      },
    };
  }

  it('keeps an extra-time LIVE match even past the 140-minute window', async () => {
    const deepEt = new Date(Date.parse(opener.kickoff) + LIVE_WINDOW_MS + 20 * 60_000);
    const live = { ...opener, status: 'LIVE' as const, minute: 117, score: { home: 1, away: 1 } };
    const r = await marketFixtureForTeam(adapterReturning([live]), team, deepEt);
    expect(r.match?.id).toBe(opener.id);
    expect(r.match?.status).toBe('LIVE');
  });

  it('falls through to the NEXT fixture when the candidate is confirmed FT', async () => {
    const during = new Date(Date.parse(opener.kickoff) + 110 * 60_000);
    const ft = { ...opener, status: 'FT' as const, score: { home: 2, away: 0 } };
    const r = await marketFixtureForTeam(adapterReturning([ft]), team, during);
    expect(r.match?.id).not.toBe(opener.id);
    expect(r.match).toBeDefined(); // the team's next fixture
  });

  it('keeps the static candidate on a degraded fetch (fail closed downstream)', async () => {
    const during = new Date(Date.parse(opener.kickoff) + 30 * 60_000);
    const r = await marketFixtureForTeam(adapterReturning('throw'), team, during);
    expect(r.match?.id).toBe(opener.id);
    expect(r.degraded).toBe(true);
  });

  it('is simply the next fixture outside any window', async () => {
    const before = new Date(Date.parse(opener.kickoff) - 24 * 60 * 60_000);
    const r = await marketFixtureForTeam(adapterReturning([]), team, before);
    expect(r.match?.id).toBe(opener.id);
  });
});
