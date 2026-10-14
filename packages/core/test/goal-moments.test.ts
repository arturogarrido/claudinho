/**
 * The goal moments, 4a-i, core: the scorer the ambient view may name is PROVEN (the record's scoring events, counted
 * per side, equal its regulation score, so the last one made this score), and the live read returns the window's
 * finished records beside the in-play list, chosen ids-first so a cap never decides that a match the refresher saw in
 * play is absent. The in-play list every reader uses is unchanged, and `getLiveMatches`' result carries no `finished`.
 */
import { describe, expect, it } from 'vitest';
import { attachFetchMeta } from '../src/adapters/meta';
import type { ProviderAdapter } from '../src/adapters/types';
import { getLiveMatches, getLiveRead } from '../src/live';
import { provenLastGoal } from '../src/timeline';
import { sealEvent } from '../src/trust/match';
import type { Match, MatchEvent } from '../src/types';

const NOW = new Date('2026-10-14T19:30:00Z');
const LAS = { code: 'LAS', name: 'LASK Linz', id: 'espn:2789' };
const LIV = { code: 'LIV', name: 'Liverpool', id: 'espn:364' };
const ev = (type: MatchEvent['type'], minute: number, side: 'home' | 'away', player?: string): MatchEvent => ({
  type,
  minute,
  side,
  teamCode: side === 'home' ? 'LAS' : 'LIV',
  ...(player ? { player } : {}),
});
const match = (id: string, status: Match['status'], score: [number, number] | null, events?: MatchEvent[]): Match => ({
  id,
  stage: 'LEAGUE',
  kickoff: '2026-10-14T16:45:00.000Z',
  venue: 'Raiffeisen Arena',
  home: LAS,
  away: LIV,
  status,
  ...(status === 'LIVE' ? { minute: 60 } : {}),
  ...(score ? { score: { home: score[0], away: score[1] } } : {}),
  ...(events ? { events } : {}),
  updatedAt: NOW.toISOString(),
});

describe('provenLastGoal: the scorer is proven, or absent', () => {
  it('the scoring events counted per side equal the score: the last one is the goal that made it', () => {
    const m = match('1', 'LIVE', [0, 2], [ev('GOAL', 22, 'away', 'Ronald Araújo'), ev('YELLOW', 30, 'home'), ev('GOAL', 24, 'away', 'Bradley Barcola')]);
    expect(provenLastGoal(m)).toEqual(ev('GOAL', 24, 'away', 'Bradley Barcola'));
  });

  it('a timeline that lags the score proves nothing: null (the first scorer is never named for the second goal)', () => {
    const m = match('1', 'LIVE', [0, 2], [ev('GOAL', 22, 'away', 'Ronald Araújo')]);
    expect(provenLastGoal(m)).toBeNull();
  });

  it('an own goal counts for the side it credited, and a penalty is a goal', () => {
    const m = match('1', 'LIVE', [1, 1], [ev('PEN', 10, 'away', 'Mohamed Salah'), ev('OWN_GOAL', 63, 'home', 'Virgil van Dijk')]);
    expect(provenLastGoal(m)).toEqual(ev('OWN_GOAL', 63, 'home', 'Virgil van Dijk'));
  });

  it('cards never count, and a goal with no score, or no events at all, proves nothing', () => {
    expect(provenLastGoal(match('1', 'LIVE', [0, 0], [ev('YELLOW', 5, 'home')]))).toBeNull();
    expect(provenLastGoal(match('1', 'LIVE', [0, 1]))).toBeNull();
    expect(provenLastGoal(match('1', 'SCHEDULED', null, [ev('GOAL', 5, 'home')]))).toBeNull();
  });

  it('more scoring events than the score (a disallowed goal still listed) proves nothing either', () => {
    expect(provenLastGoal(match('1', 'LIVE', [0, 1], [ev('GOAL', 5, 'away'), ev('GOAL', 9, 'away')]))).toBeNull();
  });
});

describe('sealEvent is the one event constructor, exported for the ambient reader', () => {
  it('seals a valid event and refuses a malformed one', () => {
    expect(sealEvent(ev('GOAL', 22, 'away', 'Ronald Araújo') as unknown)).toEqual(ev('GOAL', 22, 'away', 'Ronald Araújo'));
    expect(sealEvent({ type: 'GOAL', minute: -3, side: 'away', teamCode: 'LIV' } as unknown)).toBeNull();
    expect(sealEvent({ type: 'GOAL', minute: 5, side: 'middle', teamCode: 'LIV' } as unknown)).toBeNull();
  });
});

/** A fake adapter whose window answers the given records, whole. */
const adapterOf = (records: Match[], complete = true): ProviderAdapter =>
  ({
    name: 'espn',
    competition: 'uefa.champions',
    fetchLive: async () => attachFetchMeta([...records], { complete, seasons: [], omitted: 0 } as never),
    fetchWindow: async () => attachFetchMeta([...records], { complete, seasons: [], omitted: 0 } as never),
  }) as unknown as ProviderAdapter;

describe('getLiveRead returns the window\'s finished records beside the in-play list', () => {
  it('matches stays the in-play list; finished holds the FT records that hold a score', async () => {
    const r = await getLiveRead(adapterOf([match('1', 'LIVE', [0, 1]), match('2', 'FT', [3, 6]), match('3', 'FT', null), match('4', 'SCHEDULED', null)]), NOW);
    expect(r.matches.map((m) => m.id)).toEqual(['1']);
    expect(r.finished.map((m) => m.id)).toEqual(['2']);
    expect(r.finishedTruncated).toBe(false);
  });

  it('the ids the caller saw in play come first, so a cap of 64 never drops one of them', async () => {
    const many = Array.from({ length: 80 }, (_, i) => match(`f${i}`, 'FT', [1, 0]));
    const r = await getLiveRead(adapterOf(many), NOW, ['f79', 'f70']);
    expect(r.finished).toHaveLength(64);
    expect(r.finished.slice(0, 2).map((m) => m.id)).toEqual(['f70', 'f79']);
    expect(r.finishedTruncated).toBe(true);
  });

  it('a failed read returns no finished record and says so', async () => {
    const failing = { name: 'espn', competition: 'uefa.champions', fetchLive: async () => { throw new Error('down'); }, fetchWindow: async () => { throw new Error('down'); } } as unknown as ProviderAdapter;
    const r = await getLiveRead(failing, NOW, ['1']);
    expect(r.finished).toEqual([]);
    expect(r.degraded).toBe(true);
  });

  it("getLiveMatches' result, what every surface reads, carries no finished list", async () => {
    const r = await getLiveMatches(adapterOf([match('1', 'LIVE', [0, 1]), match('2', 'FT', [3, 6])]), NOW);
    expect('finished' in r).toBe(false);
    expect('finishedTruncated' in r).toBe(false);
    expect(r.matches.map((m) => m.id)).toEqual(['1']);
  });
});
