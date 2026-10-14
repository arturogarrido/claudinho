import { describe, expect, test } from 'claude-code/testing'
import { ARAUJO, drawnRows, finishedRecord, liveRecord, momentLine, momentView, toastTexts, view, world } from './world'

/**
 * The goal moments' toasts (plugin 0.5.0, on CLI 0.12.0's view: each record's `names`, `pinnedSide`, `lastGoal`, and
 * the view's `finished` list). Per match, between two current views, under the `toasts` option (off: none; pinned: a
 * record with `pinned: true`; all: every match):
 * - one side's regulation tally rose by exactly 1, none fell: `⚽ GOAL! <team>`, then `· <player> <minute>` only when
 *   `lastGoal` is a new identity on that side, else the record's clock minute; an own goal `⚽ Own goal · <team>
 *   <minute>`; for the side opposite `pinnedSide`, `Goal for <team> · ...`; the second line the scoreline;
 * - more than one goal between two views: `Goals · <scoreline>`;
 * - a tally that fell: `Score updated`, then the scoreline;
 * - a shootout tally that rose (from 0 where the previous view had none): `Penalties · <scoreline>`;
 * - priority: Score updated, Penalties, the single goal, Goals;
 * - full time (a record of the previous current view's `live` in this current view's `finished`): `Full time ·
 *   <scoreline>`, then the result (`winnerCode`, else the shootout, else the score; level: `Draw`), after the goal
 *   toast when the tally rose in the same read;
 * - a record without `names` (an older CLI): today's toast, `⚽` and its `line`; no full-time toast.
 * The design is the PR's review packet, revision 3, rules 1 to 5 and 11.
 */
type W = Awaited<ReturnType<typeof world>>
/** The run that compares: the pace's next fire, 15 s after the first run. */
const next = async (w: W) => {
  await w.clock.advance(15_000)
}
/** The band's rows now (a mount is a draw). */
const band = async (w: W) => drawnRows(await w.mount())

describe('a goal for the pinned side', () => {
  test("a new lastGoal on the side that rose by 1: the team, the scorer and the goal's minute, then the scoreline", async ($, on) => {
    const texts = toastTexts(on)
    const w = await world($, on, [momentView([liveRecord([0, 0])]), momentView([liveRecord([0, 1], { lastGoal: ARAUJO })])])
    await next(w)
    expect(texts).toEqual(["⚽ GOAL! Liverpool · Ronald Araújo 22' · LASK Linz 0–1 Liverpool"])
  })

  test("added time reads 90+3'", async ($, on) => {
    const texts = toastTexts(on)
    const late = { ...ARAUJO, minute: 90, added: 3 }
    const w = await world($, on, [momentView([liveRecord([1, 1], { minute: 90 })]), momentView([liveRecord([1, 2], { minute: 90, lastGoal: late })])])
    await next(w)
    expect(texts).toEqual(["⚽ GOAL! Liverpool · Ronald Araújo 90+3' · LASK Linz 1–2 Liverpool"])
  })

  test("lastGoal null: the team and the record's clock minute, no player", async ($, on) => {
    const texts = toastTexts(on)
    const w = await world($, on, [momentView([liveRecord([0, 0], { minute: 60 })]), momentView([liveRecord([0, 1], { minute: 60 })])])
    await next(w)
    expect(texts).toEqual(["⚽ GOAL! Liverpool 60' · LASK Linz 0–1 Liverpool"])
  })

  test("lastGoal the same identity as the previous view's: not this goal's, so the clock minute, no player", async ($, on) => {
    const texts = toastTexts(on)
    const w = await world($, on, [momentView([liveRecord([0, 1], { minute: 60, lastGoal: ARAUJO })]), momentView([liveRecord([0, 2], { minute: 60, lastGoal: ARAUJO })])])
    await next(w)
    expect(texts).toEqual(["⚽ GOAL! Liverpool 60' · LASK Linz 0–2 Liverpool"])
  })

  test("lastGoal on the other side than the one that rose: the clock minute, no player", async ($, on) => {
    const texts = toastTexts(on)
    const other = { type: 'GOAL', minute: 58, side: 'home', teamCode: 'LAS', player: 'Robert Ljubicic' }
    const w = await world($, on, [momentView([liveRecord([1, 0], { minute: 60 })]), momentView([liveRecord([1, 1], { minute: 60, lastGoal: other })])])
    await next(w)
    expect(texts).toEqual(["⚽ GOAL! Liverpool 60' · LASK Linz 1–1 Liverpool"])
  })

  test('an own goal proven: its own headline, the credited team, no player', async ($, on) => {
    const texts = toastTexts(on)
    const og = { type: 'OWN_GOAL', minute: 63, side: 'away', teamCode: 'LIV', player: 'Philipp Ziereis' }
    const w = await world($, on, [momentView([liveRecord([1, 1], { minute: 64 })]), momentView([liveRecord([1, 2], { minute: 64, lastGoal: og })])])
    await next(w)
    expect(texts).toEqual(["⚽ Own goal · Liverpool 63' · LASK Linz 1–2 Liverpool"])
  })
})

describe('a goal against', () => {
  test("for the side opposite pinnedSide: `Goal for` the team, the scorer when proven; no ⚽, and nothing plays", async ($, on) => {
    const texts = toastTexts(on)
    const ljubicic = { type: 'GOAL', minute: 63, side: 'home', teamCode: 'LAS', player: 'Robert Ljubicic' }
    const after = momentView([liveRecord([1, 1], { minute: 64, lastGoal: ljubicic })])
    const w = await world($, on, [momentView([liveRecord([0, 1], { minute: 64 })]), after, after])
    await next(w)
    expect(texts).toEqual(["Goal for LASK Linz · Robert Ljubicic 63' · LASK Linz 1–1 Liverpool"])
    expect(await band(w)).toEqual([momentLine([1, 1])])
  })

  test('without a proven scorer: `Goal for` the team and the clock minute', async ($, on) => {
    const texts = toastTexts(on)
    const w = await world($, on, [momentView([liveRecord([0, 1], { minute: 60 })]), momentView([liveRecord([1, 1], { minute: 60 })])])
    await next(w)
    expect(texts).toEqual(["Goal for LASK Linz 60' · LASK Linz 1–1 Liverpool"])
  })

  test('under all, a match with no pinnedSide: nothing is against, every goal reads GOAL!', { options: { toasts: 'all' } }, async ($, on) => {
    const texts = toastTexts(on)
    const ljubicic = { type: 'GOAL', minute: 63, side: 'home', teamCode: 'LAS', player: 'Robert Ljubicic' }
    const unpinned = { pinned: false, picked: false, pinnedSide: null }
    const w = await world($, on, [momentView([liveRecord([0, 1], { ...unpinned, minute: 64 })]), momentView([liveRecord([1, 1], { ...unpinned, minute: 64, lastGoal: ljubicic })])])
    await next(w)
    expect(texts).toEqual(["⚽ GOAL! LASK Linz · Robert Ljubicic 63' · LASK Linz 1–1 Liverpool"])
  })
})

describe('more than one goal, a correction, penalties', () => {
  test('both sides rose: one toast, `Goals ·` and the scoreline, no player', async ($, on) => {
    const texts = toastTexts(on)
    const w = await world($, on, [momentView([liveRecord([0, 1])]), momentView([liveRecord([1, 2], { lastGoal: { ...ARAUJO, minute: 30 } })])])
    await next(w)
    expect(texts).toEqual(['Goals · LASK Linz 1–2 Liverpool'])
  })

  test('one side rose by 2: one toast, `Goals ·` and the scoreline', async ($, on) => {
    const texts = toastTexts(on)
    const w = await world($, on, [momentView([liveRecord([0, 1])]), momentView([liveRecord([0, 3], { lastGoal: { ...ARAUJO, minute: 30 } })])])
    await next(w)
    expect(texts).toEqual(['Goals · LASK Linz 0–3 Liverpool'])
  })

  test('a tally that fell: `Score updated`, then the scoreline; nothing plays', async ($, on) => {
    const texts = toastTexts(on)
    const after = momentView([liveRecord([0, 0])])
    const w = await world($, on, [momentView([liveRecord([0, 1], { lastGoal: ARAUJO })]), after, after])
    await next(w)
    expect(texts).toEqual(['Score updated · LASK Linz 0–0 Liverpool'])
    expect(await band(w)).toEqual([momentLine([0, 0])])
  })

  test('a shootout tally that rose: `Penalties ·` and the scoreline with both tallies; nothing plays', async ($, on) => {
    const texts = toastTexts(on)
    const pens = (h: number, a: number) => liveRecord([1, 1], { minute: 120, shootout: { home: h, away: a } })
    const after = momentView([pens(3, 4)])
    const w = await world($, on, [momentView([pens(3, 3)]), after, after])
    await next(w)
    expect(texts).toEqual(['Penalties · LASK Linz 1(3)–1(4) Liverpool'])
    expect(await band(w)).toEqual([momentLine([1, 1])])
  })

  test('a shootout tally that appeared where the previous view had none counts from 0', async ($, on) => {
    const texts = toastTexts(on)
    const w = await world($, on, [momentView([liveRecord([1, 1], { minute: 120 })]), momentView([liveRecord([1, 1], { minute: 120, shootout: { home: 1, away: 0 } })])])
    await next(w)
    expect(texts).toEqual(['Penalties · LASK Linz 1(1)–1(0) Liverpool'])
  })
})

describe('which bullet fires when several match one change', () => {
  test('a tally that fell beside a shootout tally that rose: `Score updated`', async ($, on) => {
    const texts = toastTexts(on)
    const w = await world($, on, [momentView([liveRecord([2, 1], { minute: 120, shootout: { home: 2, away: 2 } })]), momentView([liveRecord([1, 1], { minute: 120, shootout: { home: 3, away: 2 } })])])
    await next(w)
    expect(texts).toEqual(['Score updated · LASK Linz 1(3)–1(2) Liverpool'])
  })

  test('one side down and the other up by 1: `Score updated`, never a goal', async ($, on) => {
    const texts = toastTexts(on)
    const w = await world($, on, [momentView([liveRecord([1, 0])]), momentView([liveRecord([0, 1], { lastGoal: ARAUJO })])])
    await next(w)
    expect(texts).toEqual(['Score updated · LASK Linz 0–1 Liverpool'])
  })

  test('a shootout tally that rose beside a regulation tally that rose by 1: `Penalties`', async ($, on) => {
    const texts = toastTexts(on)
    const w = await world($, on, [momentView([liveRecord([1, 1], { minute: 120, shootout: { home: 2, away: 2 } })]), momentView([liveRecord([1, 2], { minute: 120, shootout: { home: 2, away: 3 } })])])
    await next(w)
    expect(texts).toEqual(['Penalties · LASK Linz 1(2)–2(3) Liverpool'])
  })
})

describe('full time', () => {
  test('a record of the last current view\'s live list in this one\'s finished list: `Full time ·` the score, then the winner', async ($, on) => {
    const texts = toastTexts(on)
    const w = await world($, on, [momentView([liveRecord([3, 6], { minute: 90 })]), momentView([], [finishedRecord([3, 6])])])
    await next(w)
    expect(texts).toEqual(['Full time · LASK Linz 3–6 Liverpool · Liverpool win'])
  })

  test('the home side winning', async ($, on) => {
    const texts = toastTexts(on)
    const w = await world($, on, [momentView([liveRecord([2, 1], { minute: 90 })]), momentView([], [finishedRecord([2, 1])])])
    await next(w)
    expect(texts).toEqual(['Full time · LASK Linz 2–1 Liverpool · LASK Linz win'])
  })

  test('level with no shootout and no winnerCode: `Draw`', async ($, on) => {
    const texts = toastTexts(on)
    const w = await world($, on, [momentView([liveRecord([2, 2], { minute: 90 })]), momentView([], [finishedRecord([2, 2])])])
    await next(w)
    expect(texts).toEqual(['Full time · LASK Linz 2–2 Liverpool · Draw'])
  })

  test('a shootout decides a level score', async ($, on) => {
    const texts = toastTexts(on)
    const w = await world($, on, [
      momentView([liveRecord([1, 1], { minute: 120, shootout: { home: 4, away: 3 } })]),
      momentView([], [finishedRecord([1, 1], { shootout: { home: 4, away: 3 } })]),
    ])
    await next(w)
    expect(texts).toEqual(['Full time · LASK Linz 1(4)–1(3) Liverpool · LASK Linz win'])
  })

  test('a winnerCode comes first, over the score (an aggregate tie): the team whose code it is', async ($, on) => {
    const texts = toastTexts(on)
    const w = await world($, on, [momentView([liveRecord([2, 1], { minute: 90 })]), momentView([], [finishedRecord([2, 1], { winnerCode: 'LIV' })])])
    await next(w)
    expect(texts).toEqual(['Full time · LASK Linz 2–1 Liverpool · Liverpool win'])
  })

  test('a result that cannot be established (no score): `Full time ·` the two names, no result line', async ($, on) => {
    const texts = toastTexts(on)
    const w = await world($, on, [momentView([liveRecord([0, 0], { minute: 90 })]), momentView([], [finishedRecord(null)])])
    await next(w)
    expect(texts).toEqual(['Full time · LASK Linz vs Liverpool'])
  })

  test('a goal seen in the same read: the goal toast (the clock minute, no lastGoal on a finished record), then full time', async ($, on) => {
    const texts = toastTexts(on)
    const w = await world($, on, [momentView([liveRecord([3, 5], { minute: 90 })]), momentView([], [finishedRecord([3, 6])])])
    await next(w)
    expect(texts).toEqual(["⚽ GOAL! Liverpool 90' · LASK Linz 3–6 Liverpool", 'Full time · LASK Linz 3–6 Liverpool · Liverpool win'])
  })

  test('a finished record that was never in the last current view\'s live list: nothing', async ($, on) => {
    const texts = toastTexts(on)
    const w = await world($, on, [momentView([]), momentView([], [finishedRecord([3, 6])])])
    await next(w)
    expect(texts).toEqual([])
  })

  test('across a view that is not current: said at the next current view', async ($, on) => {
    const texts = toastTexts(on)
    const w = await world($, on, [momentView([liveRecord([3, 6], { minute: 90 })]), momentView([], [finishedRecord([3, 6])], { current: false }), momentView([], [finishedRecord([3, 6])])])
    await next(w)
    expect(texts).toEqual([])
    await next(w)
    expect(texts).toEqual(['Full time · LASK Linz 3–6 Liverpool · Liverpool win'])
  })

  test('toasts off: no full-time toast', { options: { toasts: 'off' } }, async ($, on) => {
    const texts = toastTexts(on)
    const w = await world($, on, [momentView([liveRecord([3, 6], { minute: 90 })]), momentView([], [finishedRecord([3, 6])])])
    await next(w)
    expect(texts).toEqual([])
  })

  test('toasts pinned: a match that is not pinned says no full time', async ($, on) => {
    const texts = toastTexts(on)
    const unpinned = { pinned: false, picked: false, pinnedSide: null }
    const w = await world($, on, [momentView([liveRecord([3, 6], { ...unpinned, minute: 90 })]), momentView([], [finishedRecord([3, 6], unpinned)])])
    await next(w)
    expect(texts).toEqual([])
  })

  test('toasts all: any match says its full time', { options: { toasts: 'all' } }, async ($, on) => {
    const texts = toastTexts(on)
    const unpinned = { pinned: false, picked: false, pinnedSide: null }
    const w = await world($, on, [momentView([liveRecord([3, 6], { ...unpinned, minute: 90 })]), momentView([], [finishedRecord([3, 6], unpinned)])])
    await next(w)
    expect(texts).toEqual(['Full time · LASK Linz 3–6 Liverpool · Liverpool win'])
  })
})

describe('the toasts option governs every moment', () => {
  test('off: no goal toast', { options: { toasts: 'off' } }, async ($, on) => {
    const texts = toastTexts(on)
    const w = await world($, on, [momentView([liveRecord([0, 0])]), momentView([liveRecord([0, 1], { lastGoal: ARAUJO })])])
    await next(w)
    expect(texts).toEqual([])
  })

  test('pinned: a goal in a match that is not pinned toasts nothing', async ($, on) => {
    const texts = toastTexts(on)
    const unpinned = { pinned: false, picked: false, pinnedSide: null }
    const w = await world($, on, [momentView([liveRecord([0, 0], unpinned)]), momentView([liveRecord([0, 1], { ...unpinned, lastGoal: ARAUJO })])])
    await next(w)
    expect(texts).toEqual([])
  })

  test('pinned: a correction in a match that is not pinned toasts nothing', async ($, on) => {
    const texts = toastTexts(on)
    const unpinned = { pinned: false, picked: false, pinnedSide: null }
    const w = await world($, on, [momentView([liveRecord([0, 1], unpinned)]), momentView([liveRecord([0, 0], unpinned)])])
    await next(w)
    expect(texts).toEqual([])
  })
})

describe('a toast is one line (a toast draws no line break: measured on Claude Code 2.1.299)', () => {
  test('no toast text holds a line break, across a goal, an own goal, a goal against, a correction, penalties and full time', async ($, on) => {
    const texts = toastTexts(on)
    const og = { type: 'OWN_GOAL', minute: 63, side: 'away', teamCode: 'LIV', player: 'Philipp Ziereis' }
    const ljubicic = { type: 'GOAL', minute: 70, side: 'home', teamCode: 'LAS', player: 'Robert Ljubicic' }
    const w = await world($, on, [
      momentView([liveRecord([0, 0])]),
      momentView([liveRecord([0, 1], { lastGoal: ARAUJO })]), // a goal
      momentView([liveRecord([0, 2], { minute: 64, lastGoal: og })]), // an own goal
      momentView([liveRecord([1, 2], { minute: 71, lastGoal: ljubicic })]), // a goal against
      momentView([liveRecord([1, 1], { minute: 72 })]), // a correction
      momentView([liveRecord([1, 1], { minute: 120, shootout: { home: 0, away: 1 } })]), // penalties
      momentView([], [finishedRecord([1, 1], { shootout: { home: 0, away: 1 } })]), // full time
    ])
    for (let i = 0; i < 6; i++) await next(w)
    expect(texts).toHaveLength(6)
    expect(texts.filter((t) => /[\n\r]/.test(t))).toEqual([])
  })
})

describe('an older CLI (no `names` on its records)', () => {
  /** A record as CLI 0.11.2 prints it: no `names`, no `pinnedSide`; a `lastGoal` here is never read. */
  const older = (score: [number, number], over: Record<string, unknown> = {}) => {
    const { names: _n, pinnedSide: _p, ...rest } = liveRecord(score, over)
    return rest
  }

  test("a goal: exactly today's toast, `⚽` and the record's line; a lastGoal beside it is not read", async ($, on) => {
    const texts = toastTexts(on)
    const w = await world($, on, [momentView([older([0, 0])]), momentView([older([0, 1], { lastGoal: ARAUJO })])])
    await next(w)
    expect(texts).toEqual(["⚽ LASK Linz 0–1 Liverpool (23')"])
  })

  test("a correction: exactly today's toast", async ($, on) => {
    const texts = toastTexts(on)
    const w = await world($, on, [momentView([older([0, 1])]), momentView([older([0, 0])])])
    await next(w)
    expect(texts).toEqual(["⚽ LASK Linz 0–0 Liverpool (23')"])
  })

  test('a match leaving the live list with no finished list (the old view): no full-time toast', async ($, on) => {
    const texts = toastTexts(on)
    const noFinished = view(momentLine([3, 6]), { live: { items: [], total: 0, shown: 0, truncated: false, complete: true }, current: true, updatedAt: '2026-10-10T15:00:00.000Z', staleAfter: '2026-10-10T15:05:00.000Z', competition: { slug: 'uefa.europa', alias: 'europa-league', name: 'UEFA Europa League', chosenBy: 'saved' } })
    const w = await world($, on, [momentView([older([3, 6], { minute: 90 })]), noFinished])
    await next(w)
    expect(texts).toEqual([])
  })

  test('a finished record without `names`: no full-time toast', async ($, on) => {
    const texts = toastTexts(on)
    const { names: _n, pinnedSide: _p, ...fin } = finishedRecord([3, 6])
    const w = await world($, on, [momentView([older([3, 6], { minute: 90 })]), momentView([], [fin])])
    await next(w)
    expect(texts).toEqual([])
  })
})
