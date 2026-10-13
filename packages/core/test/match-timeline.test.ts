/**
 * The match timeline: ESPN's `competitions[0].details` read into `Match.events` by one grammar, sealed by the one
 * event constructor on the feed path and the cache path alike, and rendered by one core function (`timelineRows`).
 *
 * Measured before the rule (Oct 13, 2026; 91 finished matches, 656 details across the Premier League, LALIGA, the
 * Champions League, the Liga AUF and the World Cup final): every detail carries the six flags as booleans; a goal,
 * an own goal, a penalty, a yellow card and a red card are told apart by the flags alone; `clock.displayValue` is
 * `N'` or `N'+M'`; `team.id` is the side the goal counted for (own goals included), and an own goal's one athlete
 * plays for the other side (11 of 11). Before this, the parser read a key ESPN never sends, so no surface had a
 * timeline: every case here is red on the base.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCachedMatch, timelineRows } from '../src/index';
import { parseEspnEvent } from '../src/trust/espn';
import type { Match, MatchEvent } from '../src/types';

const HOME = { id: '361', abbreviation: 'NEW', displayName: 'Newcastle United' };
const AWAY = { id: '349', abbreviation: 'BOU', displayName: 'AFC Bournemouth' };
const FLAGS = { scoringPlay: false, yellowCard: false, redCard: false, penaltyKick: false, ownGoal: false, shootout: false };
type Detail = Record<string, unknown>;

/** One detail as ESPN sends it: all six flags false, a minute, the credited side, one athlete of that side. */
const detail = (over: Detail = {}): Detail => ({
  type: { id: '70', text: 'Goal' },
  clock: { value: 540, displayValue: "9'" },
  team: { id: HOME.id },
  scoreValue: 1,
  ...FLAGS,
  scoringPlay: true,
  athletesInvolved: [{ id: '1001', displayName: 'Harvey Barnes', team: { id: HOME.id } }],
  ...over,
});

const STATUS = {
  FT: { type: { name: 'STATUS_FULL_TIME', state: 'post', completed: true } },
  LIVE: { type: { name: 'STATUS_IN_PROGRESS', state: 'in' }, displayClock: "67'", period: 2 },
  HT: { type: { name: 'STATUS_HALFTIME', state: 'in' }, period: 1 },
  SCHEDULED: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
  POSTPONED: { type: { name: 'STATUS_POSTPONED', state: 'post' } },
  CANCELLED: { type: { name: 'STATUS_CANCELED', state: 'post' } },
} as const;

/** A scoreboard event whose competition carries `details` (left out when undefined). */
const event = (details: unknown, status: keyof typeof STATUS = 'FT') => ({
  id: '401879286',
  date: '2026-09-05T11:30Z',
  season: { slug: '2026-27-english-premier-league' },
  status: STATUS[status],
  competitions: [
    {
      venue: { fullName: "St. James' Park", address: { city: 'Newcastle-upon-Tyne', country: 'England' } },
      competitors: [
        { id: HOME.id, homeAway: 'home', score: '2', team: HOME },
        { id: AWAY.id, homeAway: 'away', score: '2', team: AWAY },
      ],
      ...(details === undefined ? {} : { details }),
    },
  ],
});

/** The sealed match (the test fails if the match itself is refused: a refused detail never refuses its match). */
function seal(details: unknown, status: keyof typeof STATUS = 'FT'): Match {
  const r = parseEspnEvent(event(details, status), { competition: 'eng.1' });
  expect(r.kind).toBe('valid');
  if (r.kind !== 'valid') throw new Error('refused');
  return r.value;
}
const eventsOf = (details: unknown, status: keyof typeof STATUS = 'FT'): MatchEvent[] | undefined => seal(details, status).events;
const one = (over: Detail): MatchEvent | undefined => {
  const evs = eventsOf([detail(over)]);
  return evs?.[0];
};
/** A readable sibling: a yellow card at 80'. A refused detail beside it leaves exactly this one event (red on a parser
 *  that reads nothing, green only when the good detail is read AND the bad one refused). */
const SIBLING = { type: 'YELLOW', minute: 80, side: 'home', teamCode: 'NEW', player: 'Sibling Player' } as const;
const sibling = (): Detail =>
  detail({ scoringPlay: false, yellowCard: true, clock: { value: 4800, displayValue: "80'" }, athletesInvolved: [{ id: '9', displayName: 'Sibling Player', team: { id: HOME.id } }] });
/** The detail is left out: beside a readable sibling, the sibling alone is read. */
const leftOut = (bad: Detail) => expect(eventsOf([bad, sibling()])).toEqual([SIBLING]);

describe('the kind, from the flags alone', () => {
  it('scoringPlay alone is GOAL', () => {
    expect(one({})).toMatchObject({ type: 'GOAL', minute: 9, side: 'home', teamCode: 'NEW', player: 'Harvey Barnes' });
  });
  it('scoringPlay + ownGoal is OWN_GOAL', () => {
    expect(one({ ownGoal: true, athletesInvolved: [{ id: '2', displayName: 'Malick Thiaw', team: { id: AWAY.id } }] })?.type).toBe('OWN_GOAL');
  });
  it('scoringPlay + penaltyKick is PEN', () => {
    expect(one({ penaltyKick: true })?.type).toBe('PEN');
  });
  it('yellowCard alone is YELLOW', () => {
    expect(one({ scoringPlay: false, yellowCard: true })?.type).toBe('YELLOW');
  });
  it('redCard alone is RED', () => {
    expect(one({ scoringPlay: false, redCard: true })?.type).toBe('RED');
  });
  it('the type text is never read: a "Goal" text on a yellow card is a YELLOW', () => {
    expect(one({ type: { id: '70', text: 'Goal' }, scoringPlay: false, yellowCard: true })?.type).toBe('YELLOW');
  });
});

describe('the 32 combinations of the five kind flags (shootout false): five make an event, 27 are left out', () => {
  const names = ['scoringPlay', 'yellowCard', 'redCard', 'penaltyKick', 'ownGoal'] as const;
  const kinds: Record<string, MatchEvent['type']> = {
    scoringPlay: 'GOAL',
    'scoringPlay+ownGoal': 'OWN_GOAL',
    'scoringPlay+penaltyKick': 'PEN',
    yellowCard: 'YELLOW',
    redCard: 'RED',
  };
  const combos = Array.from({ length: 32 }, (_, bits) => names.filter((_, i) => bits & (1 << i)));
  it.each(combos.map((set) => [set.join('+') || '(none)', set] as const))('%s', (label, set) => {
    const flags = Object.fromEntries(names.map((n) => [n, set.includes(n)]));
    // An own goal's athlete plays for the other side; every other kind's for the credited side.
    const athlete = set.includes('ownGoal') ? AWAY.id : HOME.id;
    const d = detail({ ...flags, athletesInvolved: [{ id: '3', displayName: 'A Player', team: { id: athlete } }] });
    const want = kinds[label];
    if (want) expect(eventsOf([d])?.[0]?.type).toBe(want);
    else leftOut(d);
  });
});

describe('an unreadable flag is not false: the detail is left out', () => {
  const six = ['scoringPlay', 'yellowCard', 'redCard', 'penaltyKick', 'ownGoal', 'shootout'] as const;
  it.each(six)('%s absent', (flag) => {
    const d = detail();
    delete d[flag];
    leftOut(d);
  });
  it.each(six.flatMap((f) => [[f, 'true'], [f, 1], [f, null]] as const))('%s = %j', (flag, value) => {
    // Each malformed value on a detail that would otherwise be a readable goal (the scoring flag itself included).
    leftOut(detail({ [flag]: value }));
  });
  it('ownGoal "true" on a scoring detail is not read as an ordinary goal', () => {
    leftOut(detail({ ownGoal: 'true' }));
  });
  it('shootout true is left out (a shootout kick is the shootout tally, not the timeline)', () => {
    leftOut(detail({ shootout: true, penaltyKick: true }));
  });
});

describe('the minute', () => {
  it("N' is the minute, with no added time", () => {
    const e = one({ clock: { value: 5400, displayValue: "90'" } });
    expect(e?.minute).toBe(90);
    expect(e && 'added' in e).toBe(false);
  });
  it("N'+M' is the minute and its added time", () => {
    expect(one({ clock: { value: 5400, displayValue: "90'+3'" } })).toMatchObject({ minute: 90, added: 3 });
  });
  it("0' is a minute", () => {
    expect(one({ clock: { value: 0, displayValue: "0'" } })?.minute).toBe(0);
  });
  it("200' is the last minute read", () => {
    expect(one({ clock: { value: 0, displayValue: "200'" } })?.minute).toBe(200);
  });
  it("201' is left out", () => {
    leftOut(detail({ clock: { value: 0, displayValue: "201'" } }));
  });
  it("added time 30 is read", () => {
    expect(one({ clock: { value: 0, displayValue: "120'+30'" } })).toMatchObject({ minute: 120, added: 30 });
  });
  it.each(["90'+0'", "90'+31'", "45+2'", " 9'", '9', "9'x", "1234'", "9′", ''])('%j is left out', (dv) => {
    leftOut(detail({ clock: { value: 0, displayValue: dv } }));
  });
  it('no clock, or no displayValue, is left out', () => {
    leftOut(detail({ clock: undefined }));
    leftOut(detail({ clock: { value: 540 } }));
  });
});

describe('the side, by the raw ESPN id', () => {
  it("the home competitor's team id is the home side", () => {
    expect(one({})).toMatchObject({ side: 'home', teamCode: 'NEW' });
  });
  it("the away competitor's team id is the away side", () => {
    expect(one({ team: { id: AWAY.id }, athletesInvolved: [{ id: '4', displayName: 'Marcus Tavernier', team: { id: AWAY.id } }] })).toMatchObject({ side: 'away', teamCode: 'BOU' });
  });
  it.each([['another club', { id: '359' }], ['no id', {}], ['a number, not a string', { id: 361 }], ['a namespaced id', { id: 'espn:361' }], ['no team', undefined]])('%s is left out', (_label, team) => {
    leftOut(detail({ team }));
  });
});

describe('the player: one athlete, of the team the feed implies', () => {
  it('a goal names its one athlete of the credited side', () => {
    expect(one({})?.player).toBe('Harvey Barnes');
  });
  it("an own goal names its one athlete of the OTHER side, under the credited side", () => {
    const e = one({ ownGoal: true, team: { id: AWAY.id }, athletesInvolved: [{ id: '2', displayName: 'Malick Thiaw', team: { id: HOME.id } }] });
    expect(e).toMatchObject({ type: 'OWN_GOAL', side: 'away', teamCode: 'BOU', player: 'Malick Thiaw' });
  });
  it("a goal whose athlete plays for the other side names no one (the event stands)", () => {
    const e = one({ athletesInvolved: [{ id: '2', displayName: 'Malick Thiaw', team: { id: AWAY.id } }] });
    expect(e?.type).toBe('GOAL');
    expect(e && 'player' in e).toBe(false);
  });
  it("an own goal whose athlete plays for the credited side names no one", () => {
    const e = one({ ownGoal: true, athletesInvolved: [{ id: '2', displayName: 'Harvey Barnes', team: { id: HOME.id } }] });
    expect(e?.type).toBe('OWN_GOAL');
    expect(e && 'player' in e).toBe(false);
  });
  it('a card names its one athlete of the carded side', () => {
    expect(one({ scoringPlay: false, yellowCard: true })?.player).toBe('Harvey Barnes');
  });
  it('two athletes, both of the credited side, name no one', () => {
    const e = one({
      athletesInvolved: [
        { id: '1', displayName: 'Harvey Barnes', team: { id: HOME.id } },
        { id: '5', displayName: 'Jacob Ramsey', team: { id: HOME.id } },
      ],
    });
    expect(e?.type).toBe('GOAL');
    expect(e && 'player' in e).toBe(false);
  });
  it.each([
    ['no athletesInvolved', undefined],
    ['an empty list', []],
    ['an athlete with no team', [{ id: '1', displayName: 'Harvey Barnes' }]],
    ['an athlete with no name', [{ id: '1', team: { id: HOME.id } }]],
    ['a name that is no human label (a control character)', [{ id: '1', displayName: 'Harvey\u0007Barnes', team: { id: HOME.id } }]],
  ])('%s: the event stands, no player', (_label, athletes) => {
    const e = one({ athletesInvolved: athletes });
    expect(e?.type).toBe('GOAL');
    expect(e && 'player' in e).toBe(false);
  });
});

describe('which matches carry a timeline', () => {
  it.each(['FT', 'LIVE', 'HT'] as const)('%s carries its events', (status) => {
    expect(eventsOf([detail()], status)?.length).toBe(1);
  });
  // Preservation on the base (no events anywhere); after the change, the status gate's own case (the mutation pass
  // removes the gate and reads these red).
  it.each(['SCHEDULED', 'POSTPONED', 'CANCELLED'] as const)('%s carries none, whatever its details hold', (status) => {
    const m = seal([detail()], status);
    expect('events' in m).toBe(false);
  });
  it.each([['absent', undefined], ['an empty list', []], ['an object', {}], ['a string', 'nope']])('details %s: no events key', (_label, details) => {
    expect('events' in seal(details)).toBe(false);
  });
  it('a detail that is not an object is left out and its siblings stand', () => {
    expect(eventsOf([null, 'x', 7, sibling()])).toEqual([SIBLING]);
  });
  it('a match whose every detail is refused stands, with no events key', () => {
    const m = seal([detail({ scoringPlay: 'yes' }), detail({ clock: {} })]);
    expect(m.score).toEqual({ home: 2, away: 2 });
    expect('events' in m).toBe(false);
  });
});

describe('bounds and order', () => {
  it('the first 128 details are read', () => {
    const many = Array.from({ length: 130 }, () => detail());
    expect(eventsOf(many)?.length).toBe(128);
  });
  it('details past the 128th are never touched (slice before map)', () => {
    const list: unknown[] = Array.from({ length: 128 }, () => detail());
    const poisoned = new Proxy({}, { get: () => { throw new Error('read past the bound'); } });
    for (let i = 0; i < 10_000; i++) list.push(poisoned);
    expect(eventsOf(list)?.length).toBe(128);
  });
  it('a stable sort by minute, then added time (absent as 0)', () => {
    const evs = eventsOf([
      detail({ clock: { value: 0, displayValue: "90'+3'" }, athletesInvolved: [{ id: '1', displayName: 'C', team: { id: HOME.id } }] }),
      detail({ clock: { value: 0, displayValue: "50'" }, athletesInvolved: [{ id: '1', displayName: 'B', team: { id: HOME.id } }] }),
      detail({ clock: { value: 0, displayValue: "90'" }, athletesInvolved: [{ id: '1', displayName: 'D1', team: { id: HOME.id } }] }),
      detail({ clock: { value: 0, displayValue: "10'" }, athletesInvolved: [{ id: '1', displayName: 'A', team: { id: HOME.id } }] }),
      detail({ clock: { value: 0, displayValue: "90'" }, athletesInvolved: [{ id: '1', displayName: 'D2', team: { id: HOME.id } }] }),
    ]);
    expect(evs?.map((e) => e.player)).toEqual(['A', 'B', 'D1', 'D2', 'C']);
  });
});

describe('the recorded feed (eng.1, September 2026)', () => {
  const recorded = JSON.parse(readFileSync(new URL('./fixtures/details/eng1-202609.json', import.meta.url), 'utf8')) as { events: Array<{ id: string; competitions: Array<{ details: unknown[] }> }> };
  it.each(recorded.events.map((e) => [e.id, e] as const))('%s: every detail read, and the goals per side add up to the score', (_id, raw) => {
    const r = parseEspnEvent(raw, { competition: 'eng.1' });
    expect(r.kind).toBe('valid');
    if (r.kind !== 'valid') return;
    const m = r.value;
    expect(m.events?.length ?? 0).toBe(raw.competitions[0].details.length);
    const goals = (side: 'home' | 'away') => (m.events ?? []).filter((e) => e.side === side && e.type !== 'YELLOW' && e.type !== 'RED').length;
    expect({ home: goals('home'), away: goals('away') }).toEqual(m.score);
  });
  it("Newcastle 2–2 Bournemouth: the own goal is Bournemouth's, scored by Malick Thiaw; 90'+4' is read with its added time", () => {
    const raw = recorded.events.find((e) => e.id === '401879286');
    const r = parseEspnEvent(raw, { competition: 'eng.1' });
    if (r.kind !== 'valid') throw new Error('refused');
    expect(r.value.events?.find((e) => e.type === 'OWN_GOAL')).toEqual({ type: 'OWN_GOAL', minute: 35, side: 'away', teamCode: 'BOU', player: 'Malick Thiaw' });
    expect(r.value.events?.at(-1)).toMatchObject({ minute: 90, added: 4, type: 'YELLOW', side: 'away' });
  });
});

describe('the cache path seals events with the same constructor', () => {
  const sealed = () => seal([detail(), detail({ clock: { value: 0, displayValue: "90'+2'" }, scoringPlay: false, redCard: true })]);
  it('a sealed match round-trips through JSON to the same match', () => {
    const m = sealed();
    expect(m.events?.length).toBe(2);
    const back = parseCachedMatch(JSON.parse(JSON.stringify(m)), { teamKind: 'club' });
    expect(back.kind).toBe('valid');
    if (back.kind === 'valid') expect(back.value.events).toEqual(m.events);
  });
  const withEvent = (e: Record<string, unknown>) => {
    const m = JSON.parse(JSON.stringify(sealed())) as Record<string, unknown>;
    m.events = [e];
    return parseCachedMatch(m, { teamKind: 'club' });
  };
  it.each([
    ['no side', { type: 'GOAL', minute: 9, teamCode: 'NEW' }],
    ['a side that is neither', { type: 'GOAL', minute: 9, side: 'left', teamCode: 'NEW' }],
    ['added time 0', { type: 'GOAL', minute: 90, added: 0, side: 'home', teamCode: 'NEW' }],
    ['added time 31', { type: 'GOAL', minute: 90, added: 31, side: 'home', teamCode: 'NEW' }],
    ['added time not a number', { type: 'GOAL', minute: 90, added: '3', side: 'home', teamCode: 'NEW' }],
  ])('a cached event with %s is refused (the match stands)', (_label, e) => {
    const r = withEvent(e);
    expect(r.kind).toBe('valid');
    if (r.kind === 'valid') expect('events' in r.value).toBe(false);
  });
  it('a cached SCHEDULED match carries no events', () => {
    const m = JSON.parse(JSON.stringify(sealed())) as Record<string, unknown>;
    expect((m.events as unknown[] | undefined)?.length).toBe(2);
    m.status = 'SCHEDULED';
    delete m.score;
    const r = parseCachedMatch(m, { teamKind: 'club' });
    expect(r.kind).toBe('valid');
    if (r.kind === 'valid') expect('events' in r.value).toBe(false);
  });
});

describe('timelineRows: one row per event, aligned', () => {
  const base = (events: MatchEvent[], flags = { home: undefined as string | undefined, away: undefined as string | undefined }): Match => ({
    id: '1',
    stage: 'REGULAR',
    kickoff: '2026-09-05T11:30:00.000Z',
    venue: 'X',
    home: { code: 'NEW', name: 'Newcastle United', ...(flags.home ? { flag: flags.home } : {}) },
    away: { code: 'BOU', name: 'AFC Bournemouth', ...(flags.away ? { flag: flags.away } : {}) },
    score: { home: 2, away: 2 },
    status: 'FT',
    updatedAt: '2026-09-05T13:30:00.000Z',
    events,
  });
  const EVS: MatchEvent[] = [
    { type: 'GOAL', minute: 9, side: 'away', teamCode: 'BOU', player: 'Marcus Tavernier' },
    { type: 'YELLOW', minute: 28, side: 'home', teamCode: 'NEW', player: 'Anthony Elanga' },
    { type: 'OWN_GOAL', minute: 35, side: 'away', teamCode: 'BOU', player: 'Malick Thiaw' },
    { type: 'YELLOW', minute: 71, side: 'home', teamCode: 'NEW' },
    { type: 'YELLOW', minute: 90, added: 4, side: 'away', teamCode: 'BOU', player: 'Adam Smith' },
  ];
  it('English: the minute, the kind and the side padded to the widest; the player after; no trailing space', () => {
    expect(timelineRows(base(EVS), { lang: 'en', flags: true })).toEqual([
      "  9'     Goal         BOU  Marcus Tavernier",
      "  28'    Yellow card  NEW  Anthony Elanga",
      "  35'    Own goal     BOU  Malick Thiaw",
      "  71'    Yellow card  NEW",
      "  90+4'  Yellow card  BOU  Adam Smith",
    ]);
  });
  it('Spanish kind words', () => {
    expect(timelineRows(base(EVS), { lang: 'es', flags: true })[2]).toBe("  35'    Gol en contra     BOU  Malick Thiaw");
  });
  it.each([
    ['en', ['Goal', 'Own goal', 'Penalty', 'Yellow card', 'Red card']],
    ['es', ['Gol', 'Gol en contra', 'Penal', 'Tarjeta amarilla', 'Tarjeta roja']],
    ['pt', ['Gol', 'Gol contra', 'Pênalti', 'Cartão amarelo', 'Cartão vermelho']],
    ['fr', ['But', 'But contre son camp', 'Penalty', 'Carton jaune', 'Carton rouge']],
  ] as const)('%s: the five kind words', (lang, words) => {
    const kinds: MatchEvent['type'][] = ['GOAL', 'OWN_GOAL', 'PEN', 'YELLOW', 'RED'];
    const rows = timelineRows(base(kinds.map((type, i) => ({ type, minute: i, side: 'home', teamCode: 'NEW' }))), { lang, flags: true });
    rows.forEach((row, i) => expect(row.split(/ {2,}/)[2]).toBe(words[i]));
  });
  it('a nation side carries its flag on its outer side when flags are on, none when off', () => {
    const m = base([{ type: 'GOAL', minute: 9, side: 'home', teamCode: 'MEX' }, { type: 'GOAL', minute: 10, side: 'away', teamCode: 'RSA' }], { home: '🇲🇽', away: '🇿🇦' });
    m.home = { code: 'MEX', name: 'Mexico', flag: '🇲🇽' };
    m.away = { code: 'RSA', name: 'South Africa', flag: '🇿🇦' };
    const on = timelineRows(m, { lang: 'en', flags: true });
    expect(on[0]).toContain('🇲🇽 MEX');
    expect(on[1]).toContain('RSA 🇿🇦');
    const off = timelineRows(m, { lang: 'en', flags: false });
    expect(off.join('\n')).not.toMatch(/🇲🇽|🇿🇦/);
  });
  it('no events: no rows', () => {
    const m = base([]);
    delete m.events;
    expect(timelineRows(m, { lang: 'en', flags: true })).toEqual([]);
  });
});
