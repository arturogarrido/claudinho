import { describe, expect, test } from 'claude-code/testing'
import { ARAUJO, drawnRows, finishedRecord, liveRecord, momentLine, momentView, toastsWithTimeout, world } from './world'

/**
 * No team pinned (plugin 0.7.0), under `toasts: pinned` (the default), with the view stating `pick: null` (no saved
 * pin and no `CLAUDINHO_TEAM`) and no `pickUnreadable`: the session's FIRST score change of a live record toasts as
 * itself (the first match in the view's order), with its celebration, then one toast says how to pin, for 10 seconds
 * (`Pin your team to get only its goals: claudinho follow <alias> --team <name>`, the alias from the view); then no goal
 * toast and no celebration for the rest of the session, while the band's bold score keeps changing. Never under `all`
 * or `off`; with a pin, nothing changes.
 */
const HEAD = '▐▛███▜▌'
const HINT = 'Pin your team to get only its goals: claudinho follow europa-league --team <name>'
const GOAL_TOAST = "⚽ GOAL! Liverpool · Ronald Araújo 22' · LASK Linz 0–1 Liverpool"
const NO_PIN = { pinned: false, picked: false, pinnedSide: null }
const NONE = { pick: null }
const rec = (score: [number, number], over: Record<string, unknown> = {}) => liveRecord(score, { ...NO_PIN, ...over })
const before = momentView([rec([0, 0])], [], NONE)
const goal1 = momentView([rec([0, 1], { lastGoal: ARAUJO })], [], NONE)
const SECOND = { type: 'GOAL', minute: 63, side: 'home', teamCode: 'LAS', player: 'Robert Ljubicic' }
const goal2 = momentView([rec([1, 1], { lastGoal: SECOND, minute: 63 })], [], {
  ...NONE,
  line: momentLine([1, 1]),
  lineParts: [{ text: '⚽ ' }, { text: 'LAS 1–1 LIV', style: 'strong' }, { text: " 23'" }],
})
type W = Awaited<ReturnType<typeof world>>
const next = (w: W) => w.clock.advance(15_000)
const rows = async (w: W) => (await drawnRows(await w.mount())).map((r) => r.trim())
const mascot = (r: string[]) => r.some((x) => x.includes(HEAD))

describe('no pin, toasts: pinned', () => {
  test('the first goal toasts as itself, then the pin hint for 10 seconds', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    const w = await world($, on, [before, goal1, goal1])
    await next(w)
    expect(toasts).toEqual([
      { text: GOAL_TOAST, timeoutMs: undefined },
      { text: HINT, timeoutMs: 10_000 },
    ])
  })

  test('the first goal plays the celebration', async ($, on) => {
    const w = await world($, on, [before, goal1, goal1])
    await next(w)
    expect(mascot(await rows(w))).toBe(true)
  })

  test('the second goal: no toast and no celebration; the band shows the new score, bold', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    const w = await world($, on, [before, goal1, goal2, goal2])
    await next(w)
    await w.clock.advance(10_000)
    await next(w)
    expect(toasts.map((t) => t.text)).toEqual([GOAL_TOAST, HINT])
    const r = await rows(w)
    expect(mascot(r)).toBe(false)
    expect(r).toEqual([momentLine([1, 1])])
    const bold = (await (await w.mount()).findAll({ type: 'Text' })).filter((t) => t.props.bold === true).map((t) => t.text)
    expect(bold).toContain('LAS 1–1 LIV')
  })

  test('two matches scoring in the same read: one goal toast (the first in the view\'s order), then the hint', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    const other = (score: [number, number]) => rec(score, { id: '702002', names: { home: 'Roma', away: 'Lazio' }, home: { code: 'ROM', name: 'Roma' }, away: { code: 'LAZ', name: 'Lazio' }, lastGoal: null })
    const w = await world($, on, [
      momentView([rec([0, 0]), other([0, 0])], [], NONE),
      momentView([rec([0, 1], { lastGoal: ARAUJO }), other([1, 0])], [], NONE),
    ])
    await next(w)
    expect(toasts.map((t) => t.text)).toEqual([GOAL_TOAST, HINT])
  })

  test('a correction is not the taste and is not said; the next goal is the taste', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    const w = await world($, on, [goal1, before, goal1])
    await next(w)
    expect(toasts).toEqual([])
    await next(w)
    expect(toasts.map((t) => t.text)).toEqual([GOAL_TOAST, HINT])
  })

  test('a jump of two goals is not the taste and is not said; the next single goal is', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    const two = momentView([rec([0, 2])], [], NONE)
    const third = momentView([rec([1, 2], { lastGoal: SECOND, minute: 63 })], [], NONE)
    const w = await world($, on, [before, two, third])
    await next(w)
    expect(toasts).toEqual([])
    await next(w)
    expect(toasts.map((t) => t.text)).toEqual(["⚽ GOAL! LASK Linz · Robert Ljubicic 63' · LASK Linz 1–2 Liverpool", HINT])
  })

  test('a full time is never the taste: nothing toasts, and the next live goal is the taste', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    const ft = (score: [number, number]) => finishedRecord(score, { ...NO_PIN })
    const w = await world($, on, [before, momentView([], [ft([0, 0])], NONE), before, goal1])
    await next(w)
    expect(toasts).toEqual([])
    await next(w)
    await next(w)
    expect(toasts.map((t) => t.text)).toEqual([GOAL_TOAST, HINT])
  })

  test('an experimental competition (no alias): the hint names its slug', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    const comp = { competition: { slug: 'fifa.friendly', name: 'Friendlies', chosenBy: 'saved', experimental: true } }
    const w = await world($, on, [momentView([rec([0, 0])], [], { ...NONE, ...comp }), momentView([rec([0, 1], { lastGoal: ARAUJO })], [], { ...NONE, ...comp })])
    await next(w)
    expect(toasts.at(-1)?.text).toBe('Pin your team to get only its goals: claudinho follow fifa.friendly --team <name>')
  })

  test('an alias that is no alias: the hint says `<alias>`', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    const comp = { competition: { slug: 'Bad Slug!', alias: 'x y', name: 'X', chosenBy: 'saved' } }
    const w = await world($, on, [momentView([rec([0, 0])], [], { ...NONE, ...comp }), momentView([rec([0, 1], { lastGoal: ARAUJO })], [], { ...NONE, ...comp })])
    await next(w)
    expect(toasts.at(-1)?.text).toBe('Pin your team to get only its goals: claudinho follow <alias> --team <name>')
  })

  test('a new session (a second start): the taste and the hint once more', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    const w = await world($, on, [before, goal1, before, goal1])
    await next(w)
    await $.session.start({ cwd: '/tmp/claudinho-test', surface: 'terminal', isInteractive: true })
    await next(w)
    await next(w)
    expect(toasts.map((t) => t.text)).toEqual([GOAL_TOAST, HINT, GOAL_TOAST, HINT])
  })
})

describe('where nothing changes', () => {
  test('toasts: all: every goal toasts, no hint', { options: { toasts: 'all' } }, async ($, on) => {
    const toasts = toastsWithTimeout(on)
    const w = await world($, on, [before, goal1, goal2])
    await next(w)
    await next(w)
    expect(toasts.map((t) => t.text)).not.toContain(HINT)
    expect(toasts).toHaveLength(2)
  })

  test('toasts: off: nothing', { options: { toasts: 'off' } }, async ($, on) => {
    const toasts = toastsWithTimeout(on)
    const w = await world($, on, [before, goal1])
    await next(w)
    expect(toasts).toEqual([])
  })

  test('a pin saved elsewhere (the view states a pick): an unpinned goal toasts nothing, no hint', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    const pin = { pick: { code: 'ROM', name: 'Roma' } }
    const w = await world($, on, [momentView([rec([0, 0])], [], pin), momentView([rec([0, 1], { lastGoal: ARAUJO })], [], pin)])
    await next(w)
    expect(toasts).toEqual([])
  })

  test('CLAUDINHO_TEAM unreadable (`pickUnreadable`): nothing, no hint', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    const u = { pick: null, pickUnreadable: true }
    const w = await world($, on, [momentView([rec([0, 0])], [], u), momentView([rec([0, 1], { lastGoal: ARAUJO })], [], u)])
    await next(w)
    expect(toasts).toEqual([])
  })

  test('a view stating no `pick` at all: nothing, no hint', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    const u = { pick: undefined }
    const w = await world($, on, [momentView([rec([0, 0])], [], u), momentView([rec([0, 1], { lastGoal: ARAUJO })], [], u)])
    await next(w)
    expect(toasts).toEqual([])
  })

  test('with a pin: the pinned goal toasts as before, no hint', async ($, on) => {
    const toasts = toastsWithTimeout(on)
    const w = await world($, on, [momentView([liveRecord([0, 0])]), momentView([liveRecord([0, 1], { lastGoal: ARAUJO })])])
    await next(w)
    expect(toasts.map((t) => t.text)).toEqual([GOAL_TOAST])
  })
})
