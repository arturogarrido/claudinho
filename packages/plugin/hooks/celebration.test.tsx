import { describe, expect, test } from 'claude-code/testing'
import { held, view, world } from './world'

/**
 * The goal celebration: when the toasts' diff decides a GOAL (a tally that rose, none that fell, between two current
 * views, under the `toasts` option), the band plays 6 frames over 3 s above its line (a ball crossing a row, a "GOAL"
 * banner growing, then the toast's own line), at most min(3, maxRows - 2) rows, then the one-line band. Held while a
 * main-loop turn runs (`turn.start` to `turn.complete`, or the drawn `isWorking`), played when the turn ends within 60 s
 * of the goal; a paused celebration never resumes after 60 s; a stretch on screen finishes its 3 s. A survey or no room
 * yields as today. `celebrate: off` plays nothing. The band beneath ours is always kept under our line.
 */
const match = (id: string, score: [number, number], over: Record<string, unknown> = {}) => ({
  id,
  stage: 'REGULAR',
  kickoff: '2026-10-10T14:00:00.000Z',
  home: { code: 'ARS', name: 'Arsenal', id: 'espn:359' },
  away: { code: 'CHE', name: 'Chelsea', id: 'espn:363' },
  score: { home: score[0], away: score[1] },
  minute: 60,
  status: 'LIVE',
  picked: true,
  pinned: true,
  line: `Arsenal ${score[0]}–${score[1]} Chelsea (60')`,
  ...over,
})
const bandLine = (home: number, away: number) => `⚽ ARS ${home}–${away} CHE 60'`
const live = (items: Array<Record<string, unknown>>, line = "⚽ ARS 1–0 CHE 60'") =>
  view(line, {
    live: { items, total: items.length, shown: items.length, truncated: false, complete: true },
    current: true,
    updatedAt: '2026-10-10T15:00:00.000Z',
    staleAfter: '2026-10-10T15:05:00.000Z',
  })
const before = live([match('1', [1, 0])], bandLine(1, 0))
const goal = live([match('1', [2, 0])], bandLine(2, 0))
const TOAST = "⚽ Arsenal 2–0 Chelsea (60')"
const BANNER = ['G', 'GO', 'GOA', 'GOAL', 'GOAL!', 'GOAL!']

type W = Awaited<ReturnType<typeof world>>
/** The band's rows as drawn now (each mount is a draw). */
const rows = async (w: W, props: Record<string, unknown> = {}) => (await (await w.mount(props)).findAll({ type: 'Text' })).map((t) => t.text)
/** The run that sees the goal: the pace's next fire (15 s after the first run). */
const seeGoal = async (w: W) => {
  await w.clock.advance(15_000)
}

describe('a goal plays', () => {
  test('6 frames over 3 s: the ball row, the banner growing, then the toast line; then the one-line band', async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await seeGoal(w)
    for (let f = 0; f < 5; f++) {
      const r = await rows(w)
      expect(r).toHaveLength(3)
      expect(r[0]).toContain('⚽')
      expect(r[1]).toBe(BANNER[f])
      expect(r[2]).toBe(bandLine(2, 0))
      await w.clock.advance(500)
    }
    expect(await rows(w)).toEqual([expect.stringContaining('⚽'), 'GOAL!', TOAST, bandLine(2, 0)])
    await w.clock.advance(500)
    expect(await rows(w)).toEqual([bandLine(2, 0)])
  })

  test('the ball moves right frame by frame and its row never exceeds the band\'s columns', async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await seeGoal(w)
    let last = -1
    for (let f = 0; f < 6; f++) {
      const ball = (await rows(w, { bodyColumns: 40 }))[0] ?? ''
      const at = ball.indexOf('⚽')
      expect(at).toBeGreaterThan(last)
      expect([...ball].length).toBeLessThanOrEqual(40)
      last = at
      await w.clock.advance(500)
    }
  })

  test('a shootout tally that rises plays too', async ($, on) => {
    const pens = (h: number) => live([match('1', [1, 1], { shootout: { home: h, away: 0 }, line: `Arsenal 1–1 Chelsea (pens ${h}–0)` })])
    const w = await world($, on, [pens(1), pens(2), pens(2)])
    await seeGoal(w)
    expect((await rows(w))[1]).toBe('G')
  })

  test('a correction (a tally that fell) toasts as today and plays nothing', async ($, on) => {
    const toasts: string[] = []
    on('ui.toast', (_$, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    const w = await world($, on, [goal, before, before])
    await seeGoal(w)
    expect(toasts).toEqual(["⚽ Arsenal 1–0 Chelsea (60')"])
    expect(await rows(w)).toEqual([bandLine(1, 0)])
  })

  test('one tally up and the other down in one view is no goal: nothing plays', async ($, on) => {
    const a = live([match('1', [1, 1])])
    const b = live([match('1', [2, 0])])
    const w = await world($, on, [a, b, b])
    await seeGoal(w)
    expect(await rows(w)).toHaveLength(1)
  })

  test('two goals in one run (two matches): one celebration, its toast line the LAST goal the diff lists', async ($, on) => {
    const two = (a: number, b: number) => live([match('1', [a, 0]), match('2', [b, 0], { home: { code: 'LIV', name: 'Liverpool', id: 'espn:364' }, line: `Liverpool ${b}–0 Chelsea (60')` })])
    const w = await world($, on, [two(1, 1), two(2, 2), two(2, 2)])
    await seeGoal(w)
    await w.clock.advance(2_500)
    expect(await rows(w)).toContain("⚽ Liverpool 2–0 Chelsea (60')")
  })

  test('a goal during a celebration restarts it with the new line', async ($, on) => {
    const third = live([match('1', [3, 0])], bandLine(3, 0))
    const w = await world($, on, [before, goal, third, third])
    await seeGoal(w)
    await w.clock.advance(1_000)
    expect((await rows(w))[1]).toBe('GOA')
    await w.clock.advance(14_000) // the next run: the third goal
    expect((await rows(w))[1]).toBe('G')
    await w.clock.advance(2_500)
    expect(await rows(w)).toContain("⚽ Arsenal 3–0 Chelsea (60')")
  })
})

describe('what plays nothing', () => {
  test('celebrate off: the toast, no celebration', { options: { celebrate: 'off' } }, async ($, on) => {
    const toasts: string[] = []
    on('ui.toast', (_$, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    const w = await world($, on, [before, goal, goal])
    await seeGoal(w)
    expect(toasts).toEqual([TOAST])
    expect(await rows(w)).toEqual([bandLine(2, 0)])
  })

  test('toasts off: no goal news at all', { options: { toasts: 'off' } }, async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await seeGoal(w)
    expect(await rows(w)).toEqual([bandLine(2, 0)])
  })

  test('a goal across a view that is not current is said late as a toast, as today, and celebrated then', async ($, on) => {
    const notCurrent = view(bandLine(2, 0), { live: { items: [match('1', [2, 0])], total: 1, shown: 1, truncated: false, complete: true }, current: false })
    const w = await world($, on, [before, notCurrent, goal])
    await seeGoal(w)
    expect(await rows(w)).toEqual([bandLine(2, 0)]) // nothing from a view that is not current
    await w.clock.advance(15_000)
    expect((await rows(w))[1]).toBe('G')
  })
})

describe('around a turn', () => {
  test('a goal while a turn runs: the line alone; played from the start when the turn ends', async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await w.turnStart()
    await seeGoal(w)
    expect(await rows(w)).toEqual([bandLine(2, 0)])
    await w.clock.advance(10_000)
    expect(await rows(w)).toEqual([bandLine(2, 0)])
    await w.turnEnd()
    expect((await rows(w))[1]).toBe('G')
  })

  test("a subagent's turn ending does not release the main turn's hold", async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await w.turnStart()
    await seeGoal(w)
    await w.turnEnd('t2', 'agent-1')
    expect(await rows(w)).toEqual([bandLine(2, 0)])
  })

  test('the drawn isWorking holds too, without a turn event', async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await seeGoal(w)
    expect(await rows(w, { isWorking: true })).toEqual([bandLine(2, 0)])
    expect((await rows(w))[1]).toBe('G')
  })

  test('a turn ending more than 60 s after the goal: nothing plays (the toast already said it)', async ($, on) => {
    const w = await world($, on, [before, goal, goal, goal, goal, goal, goal])
    await w.turnStart()
    await seeGoal(w)
    await w.clock.advance(61_000)
    await w.turnEnd()
    expect(await rows(w)).toEqual([bandLine(2, 0)])
  })

  test('a turn starting mid-celebration pauses it at its frame; the rest plays when the turn ends', async ($, on) => {
    const w = await world($, on, [before, goal, goal, goal])
    await seeGoal(w)
    await rows(w) // frame 0 on screen
    await w.clock.advance(1_000)
    expect((await rows(w))[1]).toBe('GOA')
    await w.turnStart()
    expect(await rows(w)).toEqual([bandLine(2, 0)])
    await w.clock.advance(20_000)
    await w.turnEnd()
    expect((await rows(w))[1]).toBe('GOA')
    await w.clock.advance(500)
    expect((await rows(w))[1]).toBe('GOAL')
  })

  test('a turn starting mid-celebration keeps the frames already drawn (the ticker draws every half-second), with no draw while held', async ($, on) => {
    const w = await world($, on, [before, goal, goal, goal])
    await seeGoal(w)
    for (let i = 0; i < 3; i++) {
      await rows(w) // the ticker's draws: 0, 0.5 s, 1 s
      if (i < 2) await w.clock.advance(500)
    }
    await w.turnStart()
    await w.clock.advance(20_000)
    await w.turnEnd()
    expect((await rows(w))[1]).toBe('GOA') // 1 s played before the turn: frame 2
  })

  test('a celebration paused past 60 s never resumes, though some frames already showed', async ($, on) => {
    const w = await world($, on, [before, goal, goal, goal, goal, goal, goal])
    await seeGoal(w)
    await rows(w)
    await w.clock.advance(500)
    await rows(w)
    await w.turnStart()
    await w.clock.advance(61_000)
    await w.turnEnd()
    expect(await rows(w)).toEqual([bandLine(2, 0)])
  })

  test('a stretch already on screen when the 60 s pass finishes its 3 s', async ($, on) => {
    const w = await world($, on, [before, goal, goal, goal, goal, goal])
    await w.turnStart()
    await seeGoal(w)
    await w.clock.advance(58_500)
    await w.turnEnd()
    expect((await rows(w))[1]).toBe('G') // 58.5 s after the goal: plays
    await w.clock.advance(2_000) // now 60.5 s: the stretch is on screen and not paused
    expect((await rows(w))[1]).toBe('GOAL!')
  })
})

describe('room and the bands beside ours', () => {
  test('maxRows 4: two rows (the ball and the banner), the toast line in the banner row at frame 5', async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await seeGoal(w)
    const r = await rows(w, { maxRows: 4 })
    expect(r).toEqual([expect.stringContaining('⚽'), 'G', bandLine(2, 0)])
    await w.clock.advance(2_500)
    expect(await rows(w, { maxRows: 4 })).toEqual([expect.stringContaining('⚽'), TOAST, bandLine(2, 0)])
  })

  test('maxRows 3: the banner row alone, the toast line in it at frame 5', async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await seeGoal(w)
    expect(await rows(w, { maxRows: 3 })).toEqual(['G', bandLine(2, 0)])
    await w.clock.advance(2_500)
    expect(await rows(w, { maxRows: 3 })).toEqual([TOAST, bandLine(2, 0)])
  })

  test('maxRows 2: the line alone, and the celebration waits for room within its 60 s', async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await seeGoal(w)
    expect(await rows(w, { maxRows: 2 })).toEqual([bandLine(2, 0)])
    await w.clock.advance(5_000)
    expect((await rows(w))[1]).toBe('G')
  })

  test('a survey: nothing of ours, as today, and the celebration paused', async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await seeGoal(w)
    expect(await rows(w, { hasSurvey: true })).toEqual([])
    await w.clock.advance(5_000)
    expect((await rows(w))[1]).toBe('G')
  })

  test('the band beneath ours stays under our line, during the celebration and while it waits', async ($, on) => {
    const w = await world($, on, [before, goal, goal], { beneath: 'usage 42%' })
    await seeGoal(w)
    expect((await rows(w)).slice(-2)).toEqual([bandLine(2, 0), 'usage 42%'])
    expect(await rows(w, { isWorking: true })).toEqual([bandLine(2, 0), 'usage 42%'])
  })

  test('a failed run after the goal: the score line goes (never kept), the celebration rows still play', async ($, on) => {
    const w = await world($, on, [before, goal, new Error('timeout')])
    await w.turnStart() // held: the celebration waits
    await seeGoal(w)
    await w.clock.advance(15_000) // a failed run, inside the celebration's 60 s, before it was played
    await w.turnEnd()
    const r = await rows(w)
    expect(r).not.toContain(bandLine(2, 0))
    expect(r).toContain('G')
  })
})

describe('a waiting celebration whose news changed', () => {
  test('the celebrated goal corrected away before it played: nothing plays above the corrected band', async ($, on) => {
    const w = await world($, on, [before, goal, before, before])
    await w.turnStart()
    await seeGoal(w) // 2-0, held
    await w.clock.advance(15_000) // 1-0: the goal corrected away
    await w.turnEnd()
    expect(await rows(w)).toEqual([bandLine(1, 0)])
  })

  test("another match's correction leaves the waiting celebration", async ($, on) => {
    const other = (b: number) => match('2', [b, 0], { home: { code: 'LIV', name: 'Liverpool', id: 'espn:364' }, line: `Liverpool ${b}–0 Chelsea (60')` })
    const v = (a: number, b: number) => live([match('1', [a, 0]), other(b)], bandLine(a, 0))
    const w = await world($, on, [v(1, 1), v(2, 1), v(2, 0), v(2, 0)])
    await w.turnStart()
    await seeGoal(w) // match 1 scores
    await w.clock.advance(15_000) // match 2 corrected
    await w.turnEnd()
    expect((await rows(w))[1]).toBe('G')
  })

  test('the followed competition changed before it played: nothing plays above the new competition\'s band', async ($, on) => {
    const laliga = view('⚽ BAR 0–0 SEV 10\'', {
      live: { items: [{ ...match('9', [0, 0]), home: { code: 'BAR', name: 'Barcelona', id: 'espn:83' }, away: { code: 'SEV', name: 'Sevilla', id: 'espn:243' }, line: "Barcelona 0–0 Sevilla (10')" }], total: 1, shown: 1, truncated: false, complete: true },
      current: true,
      competition: { slug: 'esp.1', alias: 'laliga', name: 'LALIGA', chosenBy: 'saved' },
      updatedAt: '2026-10-10T15:00:00.000Z',
      staleAfter: '2026-10-10T15:05:00.000Z',
    })
    const w = await world($, on, [before, goal, laliga, laliga])
    await w.turnStart()
    await seeGoal(w) // an Arsenal goal, held
    await w.clock.advance(15_000) // the next run: LALIGA
    await w.turnEnd()
    expect(await rows(w)).toEqual(["⚽ BAR 0–0 SEV 10'"])
  })
})

describe('a window closing', () => {
  test('the last window closing during a celebration clears it: reopened, no celebration', async ($, on) => {
    const w = await world($, on, [before, goal, goal, goal])
    await seeGoal(w)
    await rows(w)
    await w.detach('terminal')
    await w.attach('terminal', 't2')
    expect(await rows(w)).toEqual([bandLine(2, 0)])
  })

  test('a run that a closing window superseded never starts a celebration', async ($, on) => {
    const w = await world($, on, [before, held(goal), goal])
    await w.clock.advance(15_000) // the goal's run, held at the CLI
    await w.detach('terminal')
    await w.release()
    await w.attach('terminal', 't2')
    expect((await rows(w)).filter((t) => t.startsWith('G'))).toEqual([])
  })
})

describe('the redraws it asks for', () => {
  test('the redraws start with the goal, with no draw needed', async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await seeGoal(w)
    await w.clock.advance(600)
    expect(w.invalidates.length).toBeGreaterThanOrEqual(1)
  })

  test('the redraws stop by themselves once the 3 s are played, with no draw needed', async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await seeGoal(w)
    await w.clock.advance(6_000)
    const played = w.invalidates.length
    expect(played).toBeLessThanOrEqual(8)
    await w.clock.advance(5_000)
    expect(w.invalidates.length).toBe(played)
  })

  test('a hold seen only in the drawn isWorking (no turn event): when it lifts, the redraws start again', async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await seeGoal(w)
    await rows(w, { isWorking: true })
    const atHold = w.invalidates.length
    await w.clock.advance(1_500)
    await rows(w, { isWorking: true })
    expect(w.invalidates.length).toBe(atHold) // held: no redraws asked
    expect((await rows(w))[1]).toBe('G')
    await w.clock.advance(2_000)
    expect(w.invalidates.length).toBeGreaterThan(atHold)
  })

  for (const [why, props] of [['a survey', { hasSurvey: true }], ['no room', { maxRows: 2 }]] as const) {
    test(`no redraws asked while ${why} pauses it; asked again once it can play`, async ($, on) => {
      const w = await world($, on, [before, goal, goal])
      await seeGoal(w)
      await rows(w, props)
      const atPause = w.invalidates.length
      await w.clock.advance(2_000)
      await rows(w, props)
      expect(w.invalidates.length).toBe(atPause)
      expect((await rows(w))[1]).toBe('G')
      await w.clock.advance(600)
      expect(w.invalidates.length).toBeGreaterThan(atPause)
    })
  }

  test('a turn starting mid-celebration stops the redraws; the turn ending starts them again', async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await seeGoal(w)
    await w.clock.advance(1_000)
    await w.turnStart()
    const atHold = w.invalidates.length
    await w.clock.advance(3_000)
    expect(w.invalidates.length).toBe(atHold)
    await w.turnEnd()
    await w.clock.advance(600)
    expect(w.invalidates.length).toBeGreaterThan(atHold)
  })


  test('about one invalidate per half-second while playing, none once played, none while held', async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await w.turnStart()
    await seeGoal(w)
    await w.clock.advance(5_000)
    expect(w.invalidates).toEqual([]) // held: no redraws asked
    await w.turnEnd()
    await rows(w)
    for (let i = 0; i < 7; i++) {
      await w.clock.advance(500)
      await rows(w)
    }
    const played = w.invalidates.length
    expect(played).toBeGreaterThanOrEqual(5)
    expect(played).toBeLessThanOrEqual(8)
    expect(w.invalidates.every((e) => e === 'ui.render')).toBe(true)
    await w.clock.advance(5_000)
    expect(w.invalidates.length).toBe(played)
  })
})
