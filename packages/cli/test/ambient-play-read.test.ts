/**
 * PR #183 round 1 (option A), F6: the ids of the record of play are read ONCE per render, through a reader in play.ts
 * that checks each entry's id and time by the record's own bounds WITHOUT sealing the finished records. The runner
 * measured `playedIds` adding about 10 ms to `prompt` and 17 ms to `ambient --json`: it sealed up to 64 finished
 * records only to read their ids, and `ambient --json` read it twice (once for the line, once for `next`).
 *
 * The rule: `ambientView` reads the ids once and hands them to the line and to `next`; `prompt` reads them once, and
 * only when it reaches the countdown (a live line reads none). Pinned by what a test can count, never by time: every
 * call into play.ts's exported functions handed the record of play (or the snapshot holding it), whatever the reader
 * is named, and every seal (`parseCachedMatch`) of a finished entry's record. The ambient view still seals each
 * finished record once, for its own `finished` list; the line seals none. (The bounds the reader keeps are pinned
 * by behaviour in statusline-kickoff-due.test.ts.)
 *
 * The scenario is statusline-kickoff-due.test.ts's: Real Betis v Barcelona (401), Barcelona pinned, a minute after a
 * kickoff every wall clock has passed, each render handed its request clock.
 */
import type { Match, Pin } from '@claudinho/core';
import * as core from '@claudinho/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ambientView } from '../src/ambient';
import type { CacheState, ScheduleSlice } from '../src/cache';
import * as play from '../src/play';
import { renderPrompt } from '../src/statusline';

vi.mock('../src/play', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(mod)) out[k] = typeof v === 'function' ? vi.fn(v as (...a: unknown[]) => unknown) : v;
  return out;
});
vi.mock('@claudinho/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@claudinho/core')>();
  return { ...mod, parseCachedMatch: vi.fn(mod.parseCachedMatch) };
});

const MIN = 60_000;
const HOUR = 60 * MIN;
const iso = (ms: number) => new Date(ms).toISOString();
const KICK = Date.parse('2026-10-03T16:30:00.000Z');
const NOW = KICK + MIN;

const BET = { id: 'espn:244', code: 'BET', name: 'Real Betis' };
const BAR = { id: 'espn:83', code: 'BAR', name: 'Barcelona' };
const RMA = { id: 'espn:86', code: 'RMA', name: 'Real Madrid' };
const SEV = { id: 'espn:243', code: 'SEV', name: 'Sevilla' };
const VAL = { id: 'espn:94', code: 'VAL', name: 'Valencia' };
const PIN: Pin = { id: BAR.id, code: BAR.code, name: BAR.name };

const club = (id: string, at: number, status: Match['status'] = 'SCHEDULED', home = BET, away = BAR): Match =>
  ({
    id,
    stage: 'REGULAR',
    kickoff: iso(at),
    venue: 'Estadio La Cartuja',
    home,
    away,
    status,
    ...(status === 'FT' || status === 'LIVE' ? { score: { home: 2, away: 1 } } : {}),
    ...(status === 'LIVE' ? { minute: 20 } : {}),
    updatedAt: iso(NOW - 2 * MIN),
  }) as Match;

/** Three finished records (inside their ten minutes), three seen ids, today's due match and next week's. */
const finishedRecords = [club('901', KICK - 2 * HOUR, 'FT'), club('902', KICK - 2 * HOUR, 'FT'), club('903', KICK - 2 * HOUR, 'FT')];
const fixtures = [club('401', KICK), club('402', KICK + 8 * 24 * HOUR, 'SCHEDULED', BAR, RMA)];
const schedule: ScheduleSlice = {
  index: fixtures.map((m) => ({ id: m.id, kickoff: m.kickoff, on: true })),
  fixtures,
  attemptedAt: iso(NOW - 10 * MIN),
  updatedAt: iso(NOW - 10 * MIN),
  failures: 0,
  complete: true,
};
const state = (over: Partial<CacheState> = {}): CacheState => ({
  updatedAt: iso(NOW - 20_000),
  live: [],
  degraded: false,
  source: 'espn',
  competition: 'esp.1',
  schedule,
  liveComplete: true,
  play: {
    seen: [{ id: '801', at: iso(NOW - 30_000) }, { id: '802', at: iso(NOW - 30_000) }, { id: '803', at: iso(NOW - 30_000) }],
    finished: finishedRecords.map((match) => ({ match, at: iso(NOW - 2 * MIN) })),
  },
  ...over,
});
/** Another match in play, by the snapshot's whole live read: the line is the live line, not the countdown. */
const sevVal = club('403', KICK - 20 * MIN, 'LIVE', SEV, VAL);
const opts = { defaultCompetition: false, teamKind: 'club' as const, now: new Date(NOW), pick: { team: PIN }, pin: PIN };
const noPick = { defaultCompetition: false, teamKind: 'club' as const, now: new Date(NOW) };

/**
 * The calls into play.ts's exported functions since the last reset that were handed the record of play: its `play`
 * value, or the snapshot that holds it (whatever the reader is named; a reader of another field is not counted).
 */
const playCalls = (s: CacheState) =>
  (Object.values(play) as unknown[])
    .filter((v): v is ReturnType<typeof vi.fn> => vi.isMockFunction(v))
    .reduce((n, f) => n + f.mock.calls.filter((args: unknown[]) => args.some((a: unknown) => a === s || a === s.play)).length, 0);
/** The seals of a finished entry's record (`parseCachedMatch` handed that very record) since the last reset. */
const finishedSeals = (s: CacheState) => {
  const records = new Set<unknown>((s.play?.finished ?? []).map((e) => e.match));
  return vi.mocked(core.parseCachedMatch).mock.calls.filter(([arg]) => records.has(arg)).length;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('one record-of-play read per render', () => {
  it('the mechanism: the mocks wrap the real modules (play.ts\'s functions and the seal are counted)', () => {
    expect(vi.isMockFunction(play.advancePlay)).toBe(true);
    expect(vi.isMockFunction(core.parseCachedMatch)).toBe(true);
  });

  it('one ambient render at the countdown calls into play.ts exactly once (the ids handed to the line and to `next`)', () => {
    const s = state();
    const v = ambientView(s, opts);
    expect(v.line).toBe('BET vs BAR now'); // the render did reach the countdown, where the ids are asked
    expect(v.next?.id).toBe('401');
    expect(playCalls(s)).toBe(1);
  });

  it('one ambient render with no pick, at the countdown: once', () => {
    const s = state();
    expect(ambientView(s, noPick).next?.id).toBe('401');
    expect(playCalls(s)).toBe(1);
  });

  it('one ambient render on a live line (its `next` still named): once', () => {
    const s = state({ live: [sevVal] });
    const v = ambientView(s, opts);
    expect(v.line).toBe("⚽ SEV 2–1 VAL 20'");
    expect(v.next?.id).toBe('401');
    expect(playCalls(s)).toBe(1);
  });

  it('one `prompt` render at the countdown calls into play.ts exactly once', () => {
    const s = state();
    expect(renderPrompt(s, opts)).toBe('BET vs BAR now');
    expect(playCalls(s)).toBe(1);
  });

  it('a `prompt` render on a live line reads no record of play (only the countdown asks it)', () => {
    const s = state({ live: [sevVal] });
    expect(renderPrompt(s, opts)).toBe("⚽ SEV 2–1 VAL 20'");
    expect(playCalls(s)).toBe(0);
  });

  it('the ids reader seals no finished record: an ambient render seals each once, for its own `finished` list', () => {
    const s = state();
    const v = ambientView(s, opts);
    expect(v.finished.map((m) => m.id)).toEqual(['901', '902', '903']); // the list still holds them
    expect(finishedSeals(s)).toBe(3);
  });

  it('a `prompt` render at the countdown seals no finished record', () => {
    const s = state();
    expect(renderPrompt(s, opts)).toBe('BET vs BAR now');
    expect(finishedSeals(s)).toBe(0);
  });

  it('the ids still exclude what the record of play saw: a finished id and a seen id are never due', () => {
    // The reader checks ids and times without sealing: the finished entry's id still counts.
    const s = state({
      schedule: { ...schedule, fixtures: [club('901', KICK), club('802', KICK, 'SCHEDULED', RMA, BET), fixtures[1] as Match] },
    });
    expect(renderPrompt(s, opts)).toBe('BAR vs RMA in 7d23h');
    expect(ambientView(s, opts).next?.id).toBe('402');
  });
});
