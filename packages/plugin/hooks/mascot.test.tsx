import { describe, expect, test } from 'claude-code/testing'
import { ARAUJO, drawnRows, finishedRecord, liveRecord, momentLine, momentView, toastTexts, world } from './world'

/**
 * The goal moments' celebration (plugin 0.5.0, on CLI 0.12.0's view). It plays for a goal toast for the pinned side
 * (under `toasts: all` with no `pinnedSide`, for any goal toast), never for a goal against, a correction or penalties.
 * With three spare rows: the mascot's three rows of text art at the left (`color: 'claude'`), the ball crossing the
 * top row, `GOAL!` (bold, `color: 'success'`) and the team on the middle row, the scorer and minute (or the minute)
 * on the bottom row, the legs alternating between frames; about 3 s, then the one-line band. Two spare rows: `GOAL!
 * <team>` and the bottom row; one: `GOAL! <team> <minute>`; none: it waits. Full time for the pinned side: the mascot
 * once for 5 s beside `Full time · <team> win` (or `Draw`), queued after a goal celebration from the same read; the
 * hold while Claude works and the 60-second drop apply to both; `celebrate: off` plays neither. The coordinator's
 * decisions beside the design: `Goals` plays nothing; a proven own goal credited to the pinned side celebrates (its
 * bottom row `own goal <minute>`); full time plays only on a win or a draw of the pinned side; a correction (a tally
 * that fell, live or finished) drops a queued full-time play as it drops a waiting goal play; a view whose records
 * carry no `names` (an older CLI) keeps today's banner (celebration.test.tsx). The design is the PR's review packet,
 * revision 3 (rules 1, 5) and revision 3a (the colours).
 */
const HEAD = '▐▛███▜▌'
const BODY = '▝▜█████▛▘'
const LEGS = ['▘▘ ▝▝', '▝▝ ▘▘']
type W = Awaited<ReturnType<typeof world>>
type Mounted = Awaited<ReturnType<W['mount']>>
const next = async (w: W) => {
  await w.clock.advance(15_000)
}
/** The band's laid-out rows now (a mount is a draw), each trimmed of the padding a layout may add at its ends. */
const rows = async (w: W, props: Record<string, unknown> = {}) => (await drawnRows(await w.mount(props))).map((r) => r.trim())
/** The band's Text elements now. */
const texts = async (m: Mounted) => m.findAll({ type: 'Text' })

const before = momentView([liveRecord([0, 0])])
const goal = momentView([liveRecord([0, 1], { lastGoal: ARAUJO })])
const LINE = momentLine([0, 1])
const hasMascot = (r: string[]) => r.some((x) => x.includes(HEAD) || x.includes(BODY) || LEGS.some((l) => x.includes(l)))

describe('a goal for the pinned side, three spare rows', () => {
  test('the mascot at the left, the ball on its top row, `GOAL! Liverpool` in the middle, the scorer and minute at the bottom, then the line', async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await next(w)
    const r = await rows(w)
    expect(r).toHaveLength(4)
    expect(r[0]?.startsWith(HEAD)).toBe(true)
    expect(r[0]).toContain('⚽')
    expect(r[1]?.startsWith(BODY)).toBe(true)
    expect(r[1]).toContain('GOAL! Liverpool')
    expect(LEGS.some((l) => r[2]?.startsWith(l))).toBe(true)
    expect(r[2]).toContain("Ronald Araújo 22'")
    expect(r[3]).toBe(LINE)
  })

  test("the mascot is drawn in the theme's `claude` colour", async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await next(w)
    const t = await texts(await w.mount())
    for (const glyphs of [HEAD, BODY]) expect(t.some((x) => x.text.includes(glyphs) && x.props.color === 'claude')).toBe(true)
    expect(t.some((x) => LEGS.some((l) => x.text.includes(l)) && x.props.color === 'claude')).toBe(true)
  })

  test("`GOAL!` is bold in the theme's `success` colour", async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await next(w)
    const t = await texts(await w.mount())
    expect(t.some((x) => x.text.trim() === 'GOAL!' && x.props.bold === true && x.props.color === 'success')).toBe(true)
  })

  test('the ball moves right and the legs alternate from frame to frame', { timeoutMs: 20_000 }, async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await next(w)
    let ball = -1
    let legs = ''
    for (let f = 0; f < 5; f++) {
      const r = await rows(w)
      const at = r[0]?.indexOf('⚽') ?? -1
      expect(at).toBeGreaterThan(ball)
      const now = LEGS.find((l) => r[2]?.startsWith(l)) ?? ''
      expect(now).not.toBe('')
      if (f > 0) expect(now).not.toBe(legs)
      ball = at
      legs = now
      await w.clock.advance(500)
    }
  })

  test('about 3 s, then the band is its one line again', { timeoutMs: 20_000 }, async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await next(w)
    for (let t = 0; t < 2_500; t += 500) {
      expect(hasMascot(await rows(w))).toBe(true)
      await w.clock.advance(500)
    }
    await w.clock.advance(1_000)
    expect(await rows(w)).toEqual([LINE])
  })

  test('without a proven scorer: the bottom row is the clock minute alone', async ($, on) => {
    const plain = momentView([liveRecord([0, 1], { minute: 60 })], [], { line: LINE })
    const w = await world($, on, [momentView([liveRecord([0, 0], { minute: 60 })], [], { line: momentLine([0, 0]) }), plain, plain])
    await next(w)
    const r = await rows(w)
    expect(r[1]).toContain('GOAL! Liverpool')
    expect(r[2]?.endsWith("60'")).toBe(true)
    expect(r[2]).not.toContain('Araújo')
  })

  test('under toasts all, a match with no pinnedSide: any goal plays', { options: { toasts: 'all' } }, async ($, on) => {
    const unpinned = { pinned: false, picked: false, pinnedSide: null }
    const ljubicic = { type: 'GOAL', minute: 63, side: 'home', teamCode: 'LAS', player: 'Robert Ljubicic' }
    const after = momentView([liveRecord([1, 1], { ...unpinned, lastGoal: ljubicic })])
    const w = await world($, on, [momentView([liveRecord([0, 1], unpinned)]), after, after])
    await next(w)
    const r = await rows(w)
    expect(r[1]).toContain('GOAL! LASK Linz')
    expect(r[2]).toContain("Robert Ljubicic 63'")
  })
})

describe('an own goal credited to the pinned side', () => {
  test("it celebrates: `GOAL! Liverpool` in the middle, `own goal 63'` at the bottom", async ($, on) => {
    const og = { type: 'OWN_GOAL', minute: 63, side: 'away', teamCode: 'LIV', player: 'Philipp Ziereis' }
    const after = momentView([liveRecord([1, 2], { minute: 64, lastGoal: og })])
    const w = await world($, on, [momentView([liveRecord([1, 1], { minute: 64 })]), after, after])
    await next(w)
    const r = await rows(w)
    expect(r).toHaveLength(4)
    expect(r[1]?.startsWith(BODY)).toBe(true)
    expect(r[1]).toContain('GOAL! Liverpool')
    expect(LEGS.some((l) => r[2]?.startsWith(l))).toBe(true)
    expect(r[2]?.endsWith("own goal 63'")).toBe(true)
    expect(r.join('\n')).not.toContain('Ziereis')
  })
})

describe('less room', () => {
  test('two spare rows: `GOAL! Liverpool` and the bottom row, no mascot', async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await next(w)
    expect(await rows(w, { maxRows: 4 })).toEqual(['GOAL! Liverpool', "Ronald Araújo 22'", LINE])
  })

  test("one spare row: `GOAL! Liverpool 22'`", async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await next(w)
    expect(await rows(w, { maxRows: 3 })).toEqual(["GOAL! Liverpool 22'", LINE])
  })

  test('none: the line alone, and the celebration waits for room', async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await next(w)
    expect(await rows(w, { maxRows: 2 })).toEqual([LINE])
    await w.clock.advance(5_000)
    expect((await rows(w))[1]).toContain('GOAL! Liverpool')
  })
})

describe('what plays nothing', () => {
  test('a goal against (the side opposite pinnedSide): the toast, nothing plays', async ($, on) => {
    const after = momentView([liveRecord([1, 1])])
    const w = await world($, on, [momentView([liveRecord([0, 1])]), after, after])
    await next(w)
    expect(await rows(w)).toEqual([momentLine([1, 1])])
  })

  test('a correction: nothing plays', async ($, on) => {
    const after = momentView([liveRecord([0, 0])])
    const w = await world($, on, [goal, after, after])
    await next(w)
    expect(await rows(w)).toEqual([momentLine([0, 0])])
  })

  test('penalties: a shootout tally of the pinned side that rose plays nothing', async ($, on) => {
    const pens = (a: number) => momentView([liveRecord([1, 1], { minute: 120, shootout: { home: 3, away: a } })])
    const w = await world($, on, [pens(3), pens(4), pens(4)])
    await next(w)
    expect(await rows(w)).toEqual([momentLine([1, 1])])
  })

  test('more than one goal between two views (`Goals`): the toast, nothing plays', async ($, on) => {
    const toasts = toastTexts(on)
    const after = momentView([liveRecord([1, 2])])
    const w = await world($, on, [momentView([liveRecord([0, 1])]), after, after])
    await next(w)
    expect(toasts).toEqual(['Goals · LASK Linz 1–2 Liverpool'])
    expect(await rows(w)).toEqual([momentLine([1, 2])])
  })

  test('the pinned side scoring twice between two views (`Goals`): nothing plays', async ($, on) => {
    const after = momentView([liveRecord([0, 3])])
    const w = await world($, on, [momentView([liveRecord([0, 1])]), after, after])
    await next(w)
    expect(await rows(w)).toEqual([momentLine([0, 3])])
  })

  test('celebrate off: the goal toast, nothing plays', { options: { celebrate: 'off' } }, async ($, on) => {
    const toasts = toastTexts(on)
    const w = await world($, on, [before, goal, goal])
    await next(w)
    expect(toasts).toEqual(["⚽ GOAL! Liverpool · Ronald Araújo 22' · LASK Linz 0–1 Liverpool"])
    expect(await rows(w)).toEqual([LINE])
  })
})

describe('full time for the pinned side', () => {
  const live36 = momentView([liveRecord([3, 6], { minute: 90 })])
  const ft36 = momentView([], [finishedRecord([3, 6])], { line: 'LAS vs LIV in 6d' })
  const FT_LINE = 'LAS vs LIV in 6d'

  test('the mascot once, beside `Full time · Liverpool win`, for 5 s; then the one line', { timeoutMs: 20_000 }, async ($, on) => {
    const w = await world($, on, [live36, ft36, ft36])
    await next(w)
    for (let t = 0; t < 4_500; t += 500) {
      const r = await rows(w)
      expect(hasMascot(r)).toBe(true)
      expect(r.some((x) => x.includes('Full time · Liverpool win'))).toBe(true)
      await w.clock.advance(500)
    }
    await w.clock.advance(1_000)
    expect(await rows(w)).toEqual([FT_LINE])
  })

  test('a draw: `Full time · Draw`', async ($, on) => {
    const drawn = momentView([], [finishedRecord([2, 2])], { line: FT_LINE })
    const w = await world($, on, [momentView([liveRecord([2, 2], { minute: 90 })]), drawn, drawn])
    await next(w)
    expect((await rows(w)).some((x) => x.includes('Full time · Draw'))).toBe(true)
  })

  test('the mascot is in `claude` there too', async ($, on) => {
    const w = await world($, on, [live36, ft36, ft36])
    await next(w)
    const t = await texts(await w.mount())
    expect(t.some((x) => x.text.includes(HEAD) && x.props.color === 'claude')).toBe(true)
  })

  test('queued after a goal celebration from the same read: the goal plays first, then full time', { timeoutMs: 20_000 }, async ($, on) => {
    const w = await world($, on, [momentView([liveRecord([3, 5], { minute: 90 })]), ft36, ft36])
    await next(w)
    const first = await rows(w)
    expect(first.some((x) => x.includes('GOAL! Liverpool'))).toBe(true)
    expect(first.some((x) => x.includes('Full time'))).toBe(false)
    let sawFullTime = false
    for (let t = 0; t < 8_000; t += 500) {
      await w.clock.advance(500)
      if ((await rows(w)).some((x) => x.includes('Full time · Liverpool win'))) sawFullTime = true
    }
    expect(sawFullTime).toBe(true)
    await w.clock.advance(2_000)
    expect(await rows(w)).toEqual([FT_LINE])
  })

  test('the finished record carries no `pinned` key (the CLI\'s shape): a win of `pinnedSide` plays under pinned', async ($, on) => {
    const fin = finishedRecord([3, 6])
    expect(Object.hasOwn(fin, 'pinned')).toBe(false)
    const ft = momentView([], [fin], { line: FT_LINE })
    const w = await world($, on, [live36, ft, ft])
    await next(w)
    const r = await rows(w)
    expect(hasMascot(r)).toBe(true)
    expect(r.some((x) => x.includes('Full time · Liverpool win'))).toBe(true)
  })

  test('a finished record with `pinnedSide: null` and no `pinned` key: nothing plays under pinned', async ($, on) => {
    const ft = momentView([], [finishedRecord([3, 6], { pinnedSide: null })], { line: FT_LINE })
    const w = await world($, on, [live36, ft, ft])
    await next(w)
    expect(await rows(w)).toEqual([FT_LINE])
  })

  test('a queued full-time play is dropped when a later finished record gives another result at the same score (a winnerCode changed)', { options: { toasts: 'all' } }, async ($, on) => {
    const won = momentView([], [finishedRecord([1, 1], { winnerCode: 'LIV' })], { line: FT_LINE })
    const changed = momentView([], [finishedRecord([1, 1], { winnerCode: 'LAS' })], { line: FT_LINE })
    const w = await world($, on, [momentView([liveRecord([1, 1], { minute: 90 })]), won, changed, changed])
    await w.turnStart()
    await next(w) // full time, Liverpool win (by winnerCode): held
    await next(w) // the same 1-1, the winnerCode now LASK's
    await w.turnEnd()
    const r = await rows(w)
    expect(r.some((x) => x.includes('Full time'))).toBe(false)
    expect(hasMascot(r)).toBe(false)
  })

  test('a held full-time play is kept when the next views give the same result: it plays when the turn ends', { options: { toasts: 'all' } }, async ($, on) => {
    // Round 2 (the stand-in): with the result comparison removed, any later view of the finished record dropped the play.
    const won = momentView([], [finishedRecord([1, 1], { winnerCode: 'LIV' })], { line: FT_LINE })
    const w = await world($, on, [momentView([liveRecord([1, 1], { minute: 90 })]), won, won, won])
    await w.turnStart()
    await next(w) // full time, Liverpool win (by winnerCode): held
    await next(w) // the same result
    await w.turnEnd()
    expect(hasMascot(await rows(w))).toBe(true)
  })

  test('a held full-time play is dropped when the match is listed live again (the provider corrected full time)', { options: { toasts: 'all' } }, async ($, on) => {
    // Round 2 (Sol, Astra): a full-time play is kept only while each later current view still lists the match finished
    // with the same result.
    const won = momentView([], [finishedRecord([0, 1], { winnerCode: 'LIV' })], { line: FT_LINE })
    const again = momentView([liveRecord([0, 1], { minute: 90 })])
    const w = await world($, on, [momentView([liveRecord([0, 1], { minute: 90 })]), won, again, again])
    await w.turnStart()
    await next(w) // full time, Liverpool win: held
    await next(w) // the same 0-1, listed live again
    await w.turnEnd()
    const r = await rows(w)
    expect(r.some((x) => x.includes('Full time'))).toBe(false)
    expect(hasMascot(r)).toBe(false)
  })

  test('a held full-time play is dropped when a current view no longer lists the match at all', { options: { toasts: 'all' } }, async ($, on) => {
    const won = momentView([], [finishedRecord([0, 1], { winnerCode: 'LIV' })], { line: FT_LINE })
    const gone = momentView([], [], { line: FT_LINE })
    const w = await world($, on, [momentView([liveRecord([0, 1], { minute: 90 })]), won, gone, gone])
    await w.turnStart()
    await next(w)
    await next(w)
    await w.turnEnd()
    const r = await rows(w)
    expect(r.some((x) => x.includes('Full time'))).toBe(false)
    expect(hasMascot(r)).toBe(false)
  })

  test('a queued `Draw` play is dropped when a later finished record adds a shootout the pinned side lost', { options: { toasts: 'all' } }, async ($, on) => {
    const drew = momentView([], [finishedRecord([1, 1])], { line: FT_LINE })
    const lost = momentView([], [finishedRecord([1, 1], { shootout: { home: 4, away: 3 } })], { line: FT_LINE })
    const w = await world($, on, [momentView([liveRecord([1, 1], { minute: 90 })]), drew, lost, lost])
    await w.turnStart()
    await next(w) // full time, a draw: held
    await next(w) // a shootout appears, LASK Linz win it
    await w.turnEnd()
    const r = await rows(w)
    expect(r.some((x) => x.includes('Full time'))).toBe(false)
    expect(hasMascot(r)).toBe(false)
  })

  test('a loss: the toast says the result, nothing plays', async ($, on) => {
    const toasts = toastTexts(on)
    const lost = momentView([], [finishedRecord([2, 1])], { line: FT_LINE })
    const w = await world($, on, [momentView([liveRecord([2, 1], { minute: 90 })]), lost, lost])
    await next(w)
    expect(toasts).toEqual(['Full time · LASK Linz 2–1 Liverpool · LASK Linz win'])
    expect(await rows(w)).toEqual([FT_LINE])
  })

  test('a loss on penalties: the toast says the result, nothing plays', async ($, on) => {
    const toasts = toastTexts(on)
    const lost = momentView([], [finishedRecord([1, 1], { shootout: { home: 4, away: 3 } })], { line: FT_LINE })
    const w = await world($, on, [momentView([liveRecord([1, 1], { minute: 120, shootout: { home: 4, away: 3 } })]), lost, lost])
    await next(w)
    expect(toasts).toEqual(['Full time · LASK Linz 1(4)–1(3) Liverpool · LASK Linz win'])
    expect(await rows(w)).toEqual([FT_LINE])
  })

  test('a held full-time play is dropped by a correction of the finished record (a tally that fell)', async ($, on) => {
    const corrected = momentView([], [finishedRecord([3, 5])], { line: FT_LINE })
    const w = await world($, on, [live36, ft36, corrected, corrected])
    await w.turnStart()
    await next(w) // full time 3-6, held
    await next(w) // the finished record corrected to 3-5
    await w.turnEnd()
    expect(await rows(w)).toEqual([FT_LINE])
    await w.clock.advance(3_000)
    expect(await rows(w)).toEqual([FT_LINE])
  })

  test('a goal and full time from one read, both held: a correction of the finished record drops both plays', async ($, on) => {
    const corrected = momentView([], [finishedRecord([3, 5])], { line: FT_LINE })
    const w = await world($, on, [momentView([liveRecord([3, 5], { minute: 90 })]), ft36, corrected, corrected])
    await w.turnStart()
    await next(w) // the goal and full time, both held
    await next(w) // corrected back to 3-5
    await w.turnEnd()
    expect(await rows(w)).toEqual([FT_LINE])
    await w.clock.advance(6_000)
    expect(await rows(w)).toEqual([FT_LINE])
  })

  test('a correction while the goal plays drops the full-time play queued behind it', { timeoutMs: 20_000 }, async ($, on) => {
    const corrected = momentView([], [finishedRecord([3, 5])], { line: FT_LINE })
    const w = await world($, on, [momentView([liveRecord([3, 5], { minute: 90 })]), ft36, corrected, corrected])
    await w.turnStart()
    await next(w) // the goal and full time, held
    await w.clock.advance(13_800)
    await w.turnEnd() // the goal plays from 14 s
    expect((await rows(w)).some((x) => x.includes('GOAL! Liverpool'))).toBe(true)
    await w.clock.advance(1_200) // the run at 15 s: the finished record corrected to 3-5
    let fullTime = false
    for (let t = 0; t < 8_000; t += 500) {
      if ((await rows(w)).some((x) => x.includes('Full time'))) fullTime = true
      await w.clock.advance(500)
    }
    expect(fullTime).toBe(false)
    expect(await rows(w)).toEqual([FT_LINE])
  })

  test('celebrate off: the full-time toast, nothing plays', { options: { celebrate: 'off' } }, async ($, on) => {
    const toasts = toastTexts(on)
    const w = await world($, on, [live36, ft36, ft36])
    await next(w)
    expect(toasts).toEqual(['Full time · LASK Linz 3–6 Liverpool · Liverpool win'])
    expect(await rows(w)).toEqual([FT_LINE])
  })

  test('held while Claude works; played when the turn ends within 60 s', async ($, on) => {
    const w = await world($, on, [live36, ft36, ft36])
    await w.turnStart()
    await next(w)
    expect(await rows(w)).toEqual([FT_LINE])
    await w.clock.advance(10_000)
    await w.turnEnd()
    expect((await rows(w)).some((x) => x.includes('Full time · Liverpool win'))).toBe(true)
  })

  test('a turn ending more than 60 s after full time: nothing plays', async ($, on) => {
    const w = await world($, on, [live36, ft36, ft36, ft36, ft36, ft36, ft36])
    await w.turnStart()
    await next(w)
    await w.clock.advance(61_000)
    await w.turnEnd()
    expect(await rows(w)).toEqual([FT_LINE])
  })
})
