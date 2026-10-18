/**
 * A kickoff the feed has not yet marked live stays the next match.
 *
 * Seen live (Oct 17, 2026, LALIGA, Barcelona pinned): Real Betis v Barcelona kicked off at 09:30 PDT and the feed
 * still listed it SCHEDULED until about 09:35. The statusline and the plugin's band went from "BET vs BAR in 0m" to
 * next week's "BAR vs RMA in 8d3h", and `claudinho ambient --json`'s `next` named next week's match, so the plugin's
 * `/claudinho match` opened its pane on it: the countdown chose only among fixtures whose kickoff was still ahead.
 *
 * The rule (the countdown's fixture, `countdownFixture`, which the line and the ambient view's `next` both use): a
 * DUE fixture is a candidate beside the upcoming ones: resolved, its kickoff passed by at most 30 minutes
 * (kickoff <= now <= kickoff + 30 min), its status exactly SCHEDULED, and not in the snapshot's record of play (an id
 * in `play.seen` or `play.finished` was seen in play). Candidates are ordered by kickoff, then by the pick's
 * preference. A fixture whose kickoff has passed (or is exactly now) reads "⚽ <home> vs <away> now", never "in now".
 * A live match and the syncing line keep priority as before.
 *
 * Every kickoff here is one every wall clock has already passed (the scenario is dated two weeks before the
 * incident), and every render is handed its request clock: a product reading the wall clock fails these cases.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Match, Pin } from '@claudinho/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ambientView } from '../src/ambient';
import { type CacheState, type ScheduleSlice, writeState } from '../src/cache';
import { cmdAmbient, cmdPrompt } from '../src/commands';
import type { CliConfig } from '../src/config';
import { makeT } from '../src/i18n';
import { type AmbientPick, renderPrompt } from '../src/statusline';
import { described } from './config-of';

vi.mock('node:child_process', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:child_process')>();
  return { ...mod, spawn: vi.fn(() => ({ unref() {} })) };
});

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

/** Real Betis v Barcelona's kickoff, two weeks before the incident (every wall clock has passed it). */
const KICK = Date.parse('2026-10-03T16:30:00.000Z');
/** Barcelona's next fixture, a week on: "in 8d3h" from a minute after KICK. */
const NEXT_WEEK = KICK + 8 * DAY + 3 * HOUR + 10 * MIN;

const BET = { id: 'espn:244', code: 'BET', name: 'Real Betis' };
const BAR = { id: 'espn:83', code: 'BAR', name: 'Barcelona' };
const RMA = { id: 'espn:86', code: 'RMA', name: 'Real Madrid' };
const SEV = { id: 'espn:243', code: 'SEV', name: 'Sevilla' };
const VAL = { id: 'espn:94', code: 'VAL', name: 'Valencia' };
const ATM = { id: 'espn:1068', code: 'ATM', name: 'Atlético Madrid' };
const GIR = { id: 'espn:9812', code: 'GIR', name: 'Girona' };
type Club = typeof BET;

const PIN: Pin = { id: BAR.id, code: BAR.code, name: BAR.name };
const PICK_BAR: AmbientPick = { team: PIN };

const club = (id: string, at: number, home: Club, away: Club, status: Match['status'] = 'SCHEDULED', over: Partial<Match> = {}): Match =>
  ({
    id,
    stage: 'REGULAR',
    kickoff: iso(at),
    venue: 'Estadio La Cartuja',
    home,
    away,
    status,
    ...(status === 'FT' || status === 'LIVE' || status === 'HT' ? { score: { home: 1, away: 1 } } : {}),
    ...(status === 'LIVE' ? { minute: 20 } : {}),
    updatedAt: iso(KICK - HOUR),
    ...over,
  }) as Match;

/** Today's match, as discovery last read it: SCHEDULED. */
const betBar = (status: Match['status'] = 'SCHEDULED') => club('401', KICK, BET, BAR, status);
/** Next week's. */
const barRma = () => club('402', NEXT_WEEK, BAR, RMA);

/** The schedule slice as the refresher writes it off the bundle (see statusline-off-bundle.test.ts). */
const sched = (fixtures: Match[], now: number): ScheduleSlice => ({
  index: fixtures.map((m) => ({ id: m.id, kickoff: m.kickoff, on: m.status === 'SCHEDULED' || m.status === 'LIVE' || m.status === 'HT' })),
  fixtures,
  attemptedAt: iso(now - 10 * MIN),
  updatedAt: iso(now - 10 * MIN),
  failures: 0,
  complete: true,
});

/**
 * A LALIGA snapshot at `now`: FRESH (its live slice read 20 seconds ago), not degraded, its live read WHOLE and
 * empty unless a case says otherwise: by the feed, nothing is in play. The line's countdown branch decides.
 */
const snapshot = (now: number, fixtures: Match[], over: Partial<CacheState> = {}): CacheState => ({
  updatedAt: iso(now - 20_000),
  live: [],
  degraded: false,
  source: 'espn',
  competition: 'esp.1',
  schedule: sched(fixtures, now),
  liveComplete: true,
  ...over,
});

/** No pick and no pin (a default parameter would turn an `undefined` back into Barcelona's pick). */
const NO_PICK = null;
const line = (state: CacheState, now: number, pick: AmbientPick | null = PICK_BAR) =>
  renderPrompt(state, { defaultCompetition: false, teamKind: 'club', now: new Date(now), pick: pick ?? undefined });
const view = (state: CacheState, now: number, pick: AmbientPick | null = PICK_BAR) =>
  ambientView(state, { defaultCompetition: false, teamKind: 'club', now: new Date(now), pick: pick ?? undefined, ...(pick === PICK_BAR ? { pin: PIN } : {}) });

describe('a kickoff the feed has not yet marked live (off the bundle, LALIGA, Barcelona pinned)', () => {
  const at = KICK + MIN;
  const state = () => snapshot(at, [betBar(), barRma()]);

  it('a minute after kickoff, nothing live: the line names today\'s match "now", not next week\'s countdown', () => {
    expect(line(state(), at)).toBe('⚽ BET vs BAR now');
  });

  it('the ambient view\'s `next` is today\'s match, the one the line names (the pane binds it)', () => {
    expect(view(state(), at).next?.id).toBe('401');
  });

  it('the ambient view\'s `line` and `lineParts` say "now"', () => {
    const v = view(state(), at);
    expect(v.line).toBe('⚽ BET vs BAR now');
    expect(v.lineParts).toEqual([{ text: '⚽ BET vs BAR now' }]);
    expect(v).toMatchObject({ empty: false, idle: false });
  });

  it('exactly at kickoff: "now", never "in now"', () => {
    const s = snapshot(KICK, [betBar(), barRma()]);
    expect(line(s, KICK)).toBe('⚽ BET vs BAR now');
    expect(view(s, KICK).next?.id).toBe('401');
  });

  it('29 minutes after kickoff: still due', () => {
    const t = KICK + 29 * MIN;
    expect(line(snapshot(t, [betBar(), barRma()]), t)).toBe('⚽ BET vs BAR now');
  });

  it('exactly 30 minutes after kickoff: still due (the bound is inclusive)', () => {
    const t = KICK + 30 * MIN;
    expect(line(snapshot(t, [betBar(), barRma()]), t)).toBe('⚽ BET vs BAR now');
  });

  it('31 minutes after kickoff, the feed still saying SCHEDULED: no longer due, next week\'s countdown', () => {
    const t = KICK + 31 * MIN;
    const s = snapshot(t, [betBar(), barRma()]);
    expect(line(s, t)).toBe('⚽ BAR vs RMA in 8d2h');
    expect(view(s, t).next?.id).toBe('402');
  });

  it('a fixture 10 minutes ahead still reads "in 10m"', () => {
    const t = KICK - 10 * MIN;
    const s = snapshot(t, [betBar(), barRma()]);
    expect(line(s, t)).toBe('⚽ BET vs BAR in 10m');
    expect(view(s, t).next?.id).toBe('401');
  });
});

describe('a fixture whose status is not SCHEDULED is never due', () => {
  const at = KICK + MIN;
  for (const status of ['POSTPONED', 'CANCELLED', 'FT', 'LIVE', 'HT'] as const) {
    it(`${status} a minute after kickoff (and nothing in the live list): next week's countdown`, () => {
      const s = snapshot(at, [betBar(status), barRma()]);
      expect(line(s, at)).toBe('⚽ BAR vs RMA in 8d3h');
      expect(view(s, at).next?.id).toBe('402');
    });
  }
});

describe('a fixture the record of play saw in play is never due', () => {
  const at = KICK + MIN;

  it('its id in `play.seen`: next week\'s countdown', () => {
    const s = snapshot(at, [betBar(), barRma()], { play: { seen: [{ id: '401', at: iso(at - 30_000) }], finished: [] } });
    expect(line(s, at)).toBe('⚽ BAR vs RMA in 8d3h');
    expect(view(s, at).next?.id).toBe('402');
  });

  it('its id in `play.finished`: next week\'s countdown', () => {
    const done = club('401', KICK, BET, BAR, 'FT', { updatedAt: iso(at - 30_000) });
    const s = snapshot(at, [betBar(), barRma()], { play: { seen: [], finished: [{ match: done, at: iso(at - 30_000) }] } });
    expect(line(s, at)).toBe('⚽ BAR vs RMA in 8d3h');
    expect(view(s, at).next?.id).toBe('402');
  });

  it('a malformed record of play is no record: the fixture is due, and nothing throws', () => {
    for (const play of ['x', 42, [], { seen: 'x' }, { finished: 'x' }, { seen: [null, 3, { id: 7 }], finished: [null, 3, { match: null }] }]) {
      const s = snapshot(at, [betBar(), barRma()], { play: play as never });
      expect(line(s, at), JSON.stringify(play)).toBe('⚽ BET vs BAR now');
      expect(view(s, at).next?.id, JSON.stringify(play)).toBe('401');
    }
  });
});

describe('a live match and the syncing line keep their priority', () => {
  const at = KICK + MIN;

  it('a live list holding another match in play: that match, not the due one', () => {
    const sevVal = club('403', KICK - 20 * MIN, SEV, VAL, 'LIVE', { score: { home: 0, away: 0 }, minute: 20 });
    const s = snapshot(at, [betBar(), barRma()], { live: [sevVal] });
    expect(line(s, at)).toBe("⚽ SEV 0–0 VAL 20'");
  });

  it('a degraded snapshot a minute after kickoff: "live · syncing…" as before, not "now"', () => {
    const s = snapshot(at, [betBar(), barRma()], { degraded: true });
    expect(line(s, at)).toBe('⚽ BET vs BAR live · syncing…');
  });
});

describe('the order: kickoff first, then the pick\'s preference', () => {
  const at = KICK + MIN;
  const sevVal = () => club('403', KICK + 15 * MIN, SEV, VAL);

  it('the picked team\'s due fixture before another team\'s upcoming one', () => {
    const s = snapshot(at, [betBar(), sevVal(), barRma()]);
    expect(line(s, at)).toBe('⚽ BET vs BAR now');
    expect(view(s, at).next?.id).toBe('401');
  });

  it('with no pick, the soonest kickoff wins: the due fixture before one 15 minutes ahead', () => {
    const s = snapshot(at, [sevVal(), betBar(), barRma()]);
    expect(line(s, at, NO_PICK)).toBe('⚽ BET vs BAR now');
    expect(view(s, at, NO_PICK).next?.id).toBe('401');
  });

  it('with no pick, two due fixtures: the earlier kickoff', () => {
    const atmGir = club('404', KICK - 10 * MIN, ATM, GIR);
    const s = snapshot(at, [betBar(), atmGir, barRma()]);
    expect(line(s, at, NO_PICK)).toBe('⚽ ATM vs GIR now');
    expect(view(s, at, NO_PICK).next?.id).toBe('404');
  });

  it('the pick still decides: the picked team\'s upcoming fixture before another team\'s due one', () => {
    const s = snapshot(at, [betBar(), barRma()]);
    const pickRma: AmbientPick = { team: { id: RMA.id, code: RMA.code, name: RMA.name } };
    expect(line(s, at, pickRma)).toBe('⚽ BAR vs RMA in 8d3h');
    expect(view(s, at, pickRma).next?.id).toBe('402');
  });
});

describe('on the bundled competition (the World Cup): the same rule over its schedule', () => {
  // The bundled opener, Mexico v South Africa (760415), kicks off 2026-06-11T19:00Z; the next bundled fixture is
  // South Korea v Czechia (760414) at 2026-06-12T02:00Z. The skeleton's status is SCHEDULED.
  const OPENER = Date.parse('2026-06-11T19:00:00.000Z');
  const at = OPENER + MIN;
  const wc = (over: Partial<CacheState> = {}): CacheState => ({
    updatedAt: iso(at - 20_000),
    live: [],
    degraded: false,
    source: 'espn',
    competition: 'fifa.world',
    liveComplete: true,
    ...over,
  });

  it('a minute after the opener\'s kickoff, a fresh whole snapshot with nothing live: the opener "now"', () => {
    expect(renderPrompt(wc(), { now: new Date(at) })).toBe('⚽ 🇲🇽 vs 🇿🇦 now');
    expect(ambientView(wc(), { now: new Date(at) }).next?.id).toBe('760415');
  });

  it('the opener\'s id in `play.seen`: the next bundled fixture\'s countdown', () => {
    const s = wc({ play: { seen: [{ id: '760415', at: iso(at - 30_000) }], finished: [] } });
    expect(renderPrompt(s, { now: new Date(at) })).toBe('⚽ 🇰🇷 vs 🇨🇿 in 6h59m');
    expect(ambientView(s, { now: new Date(at) }).next?.id).toBe('760414');
  });
});

describe('the commands: `prompt` and `ambient --json` off the bundle', () => {
  const at = new Date(KICK + MIN);
  let dir: string;
  let writes: string[] = [];
  const outSpy = vi.spyOn(process.stdout, 'write');
  const env = { cache: process.env.XDG_CACHE_HOME, team: process.env.CLAUDINHO_TEAM, flags: process.env.CLAUDINHO_FLAGS };
  const cfg = (): CliConfig =>
    described({ lang: 'en', tz: undefined, json: true, color: false, source: 'espn', competition: 'esp.1', flavor: 'off', markets: true, pin: PIN });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'claudinho-kickoff-due-'));
    process.env.XDG_CACHE_HOME = dir;
    delete process.env.CLAUDINHO_TEAM;
    process.env.CLAUDINHO_FLAGS = '0';
    writes = [];
    outSpy.mockImplementation((c: unknown) => {
      writes.push(String(c));
      return true;
    });
    writeState(snapshot(at.getTime(), [betBar(), barRma()]), at.getTime());
  });
  afterEach(() => {
    outSpy.mockReset();
    for (const [k, v] of [['XDG_CACHE_HOME', env.cache], ['CLAUDINHO_TEAM', env.team], ['CLAUDINHO_FLAGS', env.flags]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('`claudinho prompt` a minute after kickoff prints "⚽ BET vs BAR now"', () => {
    cmdPrompt({ cfg: cfg(), t: makeT('en'), now: at }, { cursor: undefined });
    expect(writes.join('').trim()).toBe('⚽ BET vs BAR now');
  });

  it('`claudinho ambient --json` a minute after kickoff: `next` is today\'s match, the line says "now"', () => {
    cmdAmbient({ cfg: cfg(), t: makeT('en'), now: at });
    const v = JSON.parse(writes.join('')) as { line: string; next: { id: string } | null; lineParts: unknown };
    expect(v.next?.id).toBe('401');
    expect(v.line).toBe('⚽ BET vs BAR now');
    expect(v.lineParts).toEqual([{ text: '⚽ BET vs BAR now' }]);
  });
});

/**
 * Round 1 of #183 (option A), F1: a fixture whose kickoff is at or before the request's clock is a candidate ONLY as
 * a due fixture, with every due check; an upcoming candidate's kickoff is strictly after the clock. Exactly at
 * kickoff, a record discovery read LIVE or HT, or one the record of play holds, is not due: the next fixture's
 * countdown. (A minute later those cases already hold; at the instant itself the upcoming test admitted them.)
 */
describe('exactly at kickoff, a fixture is a candidate only as a due one (off the bundle)', () => {
  const at = KICK;

  for (const status of ['LIVE', 'HT'] as const) {
    it(`discovery's record ${status} at exactly its kickoff (nothing in the live list): next week's countdown`, () => {
      const s = snapshot(at, [betBar(status), barRma()]);
      expect(line(s, at)).toBe('⚽ BAR vs RMA in 8d3h');
      expect(view(s, at).next?.id).toBe('402');
    });
  }

  it('its id in `play.seen` at exactly its kickoff: next week\'s countdown', () => {
    const s = snapshot(at, [betBar(), barRma()], { play: { seen: [{ id: '401', at: iso(at) }], finished: [] } });
    expect(line(s, at)).toBe('⚽ BAR vs RMA in 8d3h');
    expect(view(s, at).next?.id).toBe('402');
  });

  it('its id in `play.finished` at exactly its kickoff: next week\'s countdown', () => {
    const done = club('401', KICK, BET, BAR, 'FT', { updatedAt: iso(at) });
    const s = snapshot(at, [betBar(), barRma()], { play: { seen: [], finished: [{ match: done, at: iso(at) }] } });
    expect(line(s, at)).toBe('⚽ BAR vs RMA in 8d3h');
    expect(view(s, at).next?.id).toBe('402');
  });

  it('the control: SCHEDULED, nothing in the record of play, at exactly its kickoff: "now"', () => {
    const s = snapshot(at, [betBar(), barRma()]);
    expect(line(s, at)).toBe('⚽ BET vs BAR now');
    expect(view(s, at).next?.id).toBe('401');
  });
});

/**
 * Round 1 of #183, F5b: off the bundle the schedule slice drops a postponed, cancelled or finished record before the
 * due rule sees it, so the "never due" cases above pass whatever the due rule checks. On the bundled competition a
 * cached knockout record (`CacheState.fixtures`, the refresher's resolved overlay) reaches the due rule with its own
 * status, so only the due rule's status check decides there. And F1 over the same overlay: exactly at kickoff.
 */
describe('on the bundled competition, a cached knockout record\'s own status decides', () => {
  // The bundled R32 760486 kicks off 2026-06-28T19:00Z as a placeholder; the refresher's cached overlay resolves it
  // (Germany v Paraguay). A second cached resolved tie (760491, 2026-07-01T01:00Z: Mexico v Ecuador) is the next.
  const KO = Date.parse('2026-06-28T19:00:00.000Z');
  const ko = (id: string, kickoff: number, home: [string, string, string], away: [string, string, string], status: Match['status'], at: number): Match =>
    ({
      id,
      stage: 'R32',
      kickoff: iso(kickoff),
      venue: 'X',
      home: { code: home[0], name: home[1], flag: home[2] },
      away: { code: away[0], name: away[1], flag: away[2] },
      status,
      ...(status === 'FT' || status === 'LIVE' || status === 'HT' ? { score: { home: 2, away: 1 } } : {}),
      ...(status === 'LIVE' ? { minute: 1 } : {}),
      updatedAt: iso(at - MIN),
    }) as Match;
  const wc = (status: Match['status'], at: number): CacheState =>
    ({
      updatedAt: iso(at - 20_000),
      live: [],
      degraded: false,
      source: 'espn',
      competition: 'fifa.world',
      liveComplete: true,
      fixtures: [
        ko('760486', KO, ['GER', 'Germany', '🇩🇪'], ['PAR', 'Paraguay', '🇵🇾'], status, at),
        ko('760491', Date.parse('2026-07-01T01:00:00.000Z'), ['MEX', 'Mexico', '🇲🇽'], ['ECU', 'Ecuador', '🇪🇨'], 'SCHEDULED', at),
      ],
      fixturesUpdatedAt: iso(at - 5 * MIN),
    }) as CacheState;

  describe('a minute after its kickoff', () => {
    const at = KO + MIN;
    for (const status of ['POSTPONED', 'CANCELLED', 'FT'] as const) {
      it(`a cached knockout record ${status}: not due, the next resolved tie's countdown`, () => {
        expect(renderPrompt(wc(status, at), { now: new Date(at) })).toBe('⚽ 🇲🇽 vs 🇪🇨 in 2d5h');
        expect(ambientView(wc(status, at), { now: new Date(at) }).next?.id).toBe('760491');
      });
    }

    it('the control: the same record SCHEDULED is due, "now"', () => {
      expect(renderPrompt(wc('SCHEDULED', at), { now: new Date(at) })).toBe('⚽ 🇩🇪 vs 🇵🇾 now');
      expect(ambientView(wc('SCHEDULED', at), { now: new Date(at) }).next?.id).toBe('760486');
    });
  });

  describe('exactly at its kickoff (F1)', () => {
    const at = KO;
    for (const status of ['LIVE', 'HT', 'FT'] as const) {
      it(`a cached knockout record ${status}: not due, the next resolved tie's countdown`, () => {
        expect(renderPrompt(wc(status, at), { now: new Date(at) })).toBe('⚽ 🇲🇽 vs 🇪🇨 in 2d6h');
        expect(ambientView(wc(status, at), { now: new Date(at) }).next?.id).toBe('760491');
      });
    }

    it('the control: the same record SCHEDULED is due, "now"', () => {
      expect(renderPrompt(wc('SCHEDULED', at), { now: new Date(at) })).toBe('⚽ 🇩🇪 vs 🇵🇾 now');
      expect(ambientView(wc('SCHEDULED', at), { now: new Date(at) }).next?.id).toBe('760486');
    });
  });
});

/**
 * Round 1 of #183, F6 (the bounds; the count of reads is ambient-play-read.test.ts): the ids of the record of play
 * are read by the record's own bounds, whatever reader reads them: each list bounded at its first 64 entries before
 * any per-entry work, a `seen` entry believed for 6 hours from its own stamp and a `finished` one for 10 minutes
 * (expired AT the bound, as `play.ts` has it), a stamp ahead of the clock not believed. An entry outside them
 * excludes nothing: the fixture is due. One inside them, at the edge, still excludes it.
 */
describe('the record of play\'s bounds decide which ids exclude a due fixture', () => {
  const at = KICK + MIN;
  const others = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(5000 + i), at: iso(at - 30_000) }));
  const done = (id: string) => club(id, KICK - 2 * HOUR, SEV, VAL, 'FT', { updatedAt: iso(at - 2 * MIN) });
  const doneOthers = (n: number) => Array.from({ length: n }, (_, i) => ({ match: done(String(6000 + i)), at: iso(at - 2 * MIN) }));
  const today = (stamp: number) => ({ match: club('401', KICK, BET, BAR, 'FT', { updatedAt: iso(stamp) }), at: iso(stamp) });
  const withPlay = (play: CacheState['play']) => snapshot(at, [betBar(), barRma()], { play });
  const due = (s: CacheState) => {
    expect(line(s, at)).toBe('⚽ BET vs BAR now');
    expect(view(s, at).next?.id).toBe('401');
  };
  const notDue = (s: CacheState) => {
    expect(line(s, at)).toBe('⚽ BAR vs RMA in 8d3h');
    expect(view(s, at).next?.id).toBe('402');
  };

  it('its id as the 65th `seen` entry (past the bound): due', () => {
    due(withPlay({ seen: [...others(64), { id: '401', at: iso(at - 30_000) }], finished: [] }));
  });

  it('its id as the 64th `seen` entry (inside the bound): not due', () => {
    notDue(withPlay({ seen: [...others(63), { id: '401', at: iso(at - 30_000) }], finished: [] }));
  });

  it('its record as the 65th `finished` entry (past the bound): due', () => {
    due(withPlay({ seen: [], finished: [...doneOthers(64), today(at - 2 * MIN)] }));
  });

  it('its record as the 64th `finished` entry (inside the bound): not due', () => {
    notDue(withPlay({ seen: [], finished: [...doneOthers(63), today(at - 2 * MIN)] }));
  });

  it('a `seen` entry 7 hours old: due', () => {
    due(withPlay({ seen: [{ id: '401', at: iso(at - 7 * HOUR) }], finished: [] }));
  });

  it('a `seen` entry exactly 6 hours old (expired at the bound): due', () => {
    due(withPlay({ seen: [{ id: '401', at: iso(at - 6 * HOUR) }], finished: [] }));
  });

  it('a `seen` entry 5 h 59 min old: not due', () => {
    notDue(withPlay({ seen: [{ id: '401', at: iso(at - 6 * HOUR + MIN) }], finished: [] }));
  });

  it('a `finished` entry 11 minutes old: due', () => {
    due(withPlay({ seen: [], finished: [today(at - 11 * MIN)] }));
  });

  it('a `finished` entry exactly 10 minutes old (expired at the bound): due', () => {
    due(withPlay({ seen: [], finished: [today(at - 10 * MIN)] }));
  });

  it('a `finished` entry 9 minutes old: not due', () => {
    notDue(withPlay({ seen: [], finished: [today(at - 9 * MIN)] }));
  });

  it('a `seen` entry stamped ahead of the clock (not believed): due', () => {
    due(withPlay({ seen: [{ id: '401', at: iso(at + 2 * MIN) }], finished: [] }));
  });

  it('a `finished` entry stamped ahead of the clock (not believed): due', () => {
    due(withPlay({ seen: [], finished: [today(at + 2 * MIN)] }));
  });

  it('a fresh `seen` id and a fresh `finished` id: not due', () => {
    notDue(withPlay({ seen: [{ id: '401', at: iso(at - 30_000) }], finished: [] }));
    notDue(withPlay({ seen: [], finished: [today(at - 30_000)] }));
  });
});

/**
 * Round 2 of #186, M3 (part 2 of the reader's language): the due fixture, a minute after kickoff, still SCHEDULED,
 * nothing live, a fresh whole snapshot: `ambient --json` in each language names it with core's bare word for now
 * (`countdownPhrase`), and its `next` is that fixture; `claudinho prompt` reads the English `now` in every language.
 */
describe('the due fixture in the reader\'s language (ambient --json; prompt stays English)', () => {
  const at = new Date(KICK + MIN);
  const NOW_WORD = { en: 'now', es: 'ahora', pt: 'agora', fr: 'maintenant' } as const;
  let dir: string;
  let writes: string[] = [];
  const outSpy = vi.spyOn(process.stdout, 'write');
  const env = { cache: process.env.XDG_CACHE_HOME, team: process.env.CLAUDINHO_TEAM, flags: process.env.CLAUDINHO_FLAGS };
  const cfg = (lang: keyof typeof NOW_WORD): CliConfig =>
    described({ lang, tz: undefined, json: true, color: false, source: 'espn', competition: 'esp.1', flavor: 'off', markets: true, pin: PIN });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'claudinho-kickoff-due-lang-'));
    process.env.XDG_CACHE_HOME = dir;
    delete process.env.CLAUDINHO_TEAM;
    process.env.CLAUDINHO_FLAGS = '0';
    writes = [];
    outSpy.mockImplementation((c: unknown) => {
      writes.push(String(c));
      return true;
    });
    writeState(snapshot(at.getTime(), [betBar(), barRma()]), at.getTime());
  });
  afterEach(() => {
    outSpy.mockReset();
    for (const [k, v] of [['XDG_CACHE_HOME', env.cache], ['CLAUDINHO_TEAM', env.team], ['CLAUDINHO_FLAGS', env.flags]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  for (const lang of ['en', 'es', 'pt', 'fr'] as const) {
    it(`${lang}: the ambient line is \`⚽ BET vs BAR ${NOW_WORD[lang]}\`, one plain part, and \`next\` is today's match`, () => {
      cmdAmbient({ cfg: cfg(lang), t: makeT(lang), now: at });
      const v = JSON.parse(writes.join('')) as { line: string; lineParts: unknown; next: { id: string } | null; lang: string };
      expect(v.line).toBe(`⚽ BET vs BAR ${NOW_WORD[lang]}`);
      expect(v.lineParts).toEqual([{ text: `⚽ BET vs BAR ${NOW_WORD[lang]}` }]);
      expect(v.next?.id).toBe('401');
      expect(v.lang).toBe(lang);
    });

    it(`${lang}: \`claudinho prompt\` reads the English \`⚽ BET vs BAR now\``, () => {
      cmdPrompt({ cfg: cfg(lang), t: makeT(lang), now: at }, { cursor: undefined });
      expect(writes.join('').trim()).toBe('⚽ BET vs BAR now');
    });
  }
});
