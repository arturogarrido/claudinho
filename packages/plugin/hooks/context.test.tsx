import { describe, expect, test } from 'claude-code/testing'
import { view, world } from './world'

/**
 * The prompt context: on submit, the last CURRENT view's `context` is attached beside the prompt while that view is
 * inside its own `staleAfter` and younger than two periods; no subprocess on submit; nothing otherwise.
 */
const CONTEXT = "[Claudinho — live football scores right now]\nArsenal 2–1 Chelsea (50')"
const current = (over: Record<string, unknown> = {}) =>
  view("⚽ ARS 2–1 CHE 50'", {
    context: CONTEXT,
    live: { items: [{ id: '1', status: 'LIVE' }], total: 1, shown: 1, truncated: false, complete: true },
    current: true,
    updatedAt: '2026-10-10T15:00:00.000Z',
    staleAfter: '2026-10-10T15:05:00.000Z',
    ...over,
  })

/** The bottom `prompt.submit` hook is registered by `world()`, before the test first calls `$` (the kit's rule). */
const submit = async ($: Parameters<Parameters<typeof test>[1]>[0]) => $.prompt.submit({ text: 'what changed?' })

describe('what a prompt carries', () => {
  test("the last current view's context, attached beside the prompt, with no run on submit", async ($, on) => {
    const { argvs } = await world($, on, [current()])
    const runs = argvs.length
    const r = await submit($)
    expect(r.text).toBe('what changed?')
    expect(r.context).toEqual([CONTEXT])
    expect(argvs.length).toBe(runs) // nothing ran on submit
  })

  for (const [why, answer] of [['no context', current({ context: null })], ['not current', current({ current: false })], ['nothing known', view('⚽ —')]] as const) {
    test(`nothing when the view carries ${why}`, async ($, on) => {
      await world($, on, [answer])
      const r = await submit($)
      expect(r.context ?? []).toEqual([])
    })
  }

  test("nothing when the view is already past its own deadline, however fresh its run (the deadline alone decides)", async ($, on) => {
    await world($, on, [current({ staleAfter: '2026-10-10T14:59:00.000Z' })]) // a minute before the clock's start
    const r = await submit($)
    expect(r.context ?? []).toEqual([])
  })

  test('a view that is not current clears a context a current view had set', async ($, on) => {
    const { clock } = await world($, on, [current(), current({ current: false })])
    await clock.advance(15_000)
    const r = await submit($)
    expect(r.context ?? []).toEqual([])
  })

  test('nothing once the view is older than two periods with no newer current view', async ($, on) => {
    const { clock } = await world($, on, [current(), new Error('timeout')])
    await clock.advance(31_000) // two periods and a bit, every fire failing since
    const r = await submit($)
    expect(r.context ?? []).toEqual([])
  })

  test('a newer current view replaces the context; a failed run between keeps the last one within its window', async ($, on) => {
    const { clock } = await world($, on, [current(), new Error('timeout'), current({ context: 'later' })])
    await clock.advance(15_000)
    let r = await submit($)
    expect(r.context).toEqual([CONTEXT])
    await clock.advance(15_000)
    r = await submit($)
    expect(r.context).toEqual(['later'])
  })
})
