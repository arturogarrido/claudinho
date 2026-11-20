import { describe, expect, test } from 'claude-code/testing'
import { ARAUJO, finishedRecord, liveRecord, momentLine, momentView, world } from './world'

/**
 * The celebration's WHOLE tree, on the terminal: every element, every prop and every key the plugin hands the engine,
 * compared with one written here. mascot.test.tsx and mascot-desktop.test.tsx read texts, a colour and the Svg's
 * source; a row's `wrap`, the words column's padding or a `bold` on full time's caption could change under them.
 *
 * Two more rules of the drawing, which `packages/plugin/hooks/celebration.tsx` states and a source check cannot hold:
 * one frame drawn twice is one tree (the module keeps nothing between draws), and on the terminal the legs alternate
 * through all of full time's ten frames (the desktop's are pinned in mascot-desktop.test.tsx).
 */
const HEAD = ' ▐▛███▜▌'
const BODY = '▝▜█████▛▘'
const LEGS = ['  ▘▘ ▝▝', '  ▝▝ ▘▘'] as const

type Tree = { type: string; props?: Record<string, unknown>; children?: Array<Tree | string> }
/** A node as the plugin made it: its type, its props and its children; an engine node (the band beneath) by its type alone. */
const shape = (n: unknown): Tree | string => {
  if (typeof n === 'string') return n
  const o = n as { type: string; props?: Record<string, unknown>; children?: unknown[] }
  if (o.type === 'engine') return { type: 'engine' }
  return { type: o.type, props: o.props ?? {}, children: (o.children ?? []).map(shape) }
}
const text = (props: Record<string, unknown>, ...children: Array<Tree | string>): Tree => ({ type: 'Text', props, children })
const box = (props: Record<string, unknown>, ...children: Array<Tree | string>): Tree => ({ type: 'Box', props, children })
const row = (...children: Array<Tree | string>): Tree => text({ wrap: 'truncate-end' }, ...children)
/** The plugin's part of the band: the mascot's column and the words' column in one row, the line, the band beneath. */
const expected = (legs: string, words: [Tree, Tree, Tree], line: string): Tree =>
  box(
    { flexDirection: 'column' },
    box(
      { key: 'mascot' },
      box({ flexDirection: 'column' }, text({ color: 'claude' }, HEAD), text({ color: 'claude' }, BODY), text({ color: 'claude' }, legs)),
      box({ flexDirection: 'column', paddingLeft: 1 }, ...words),
    ),
    row(line),
    { type: 'engine' },
  )

type W = Awaited<ReturnType<typeof world>>
type Surface = 'terminal' | 'desktop'
/** The plugin's part of the band as drawn now. */
const drawn = async (w: W, surface: Surface = 'terminal'): Promise<Tree | string> => {
  const m = await w.mount({ bodyColumns: 40 }, surface)
  const [root] = await m.findAll({ type: 'Box' })
  const part = ((root?.children ?? []) as Array<{ part?: { plugin?: string } }>).find((c) => c?.part?.plugin === 'claudinho')
  return shape(part)
}

const before = momentView([liveRecord([0, 0])])
const goal = momentView([liveRecord([0, 1], { lastGoal: ARAUJO })])
const FT_LINE = 'LAS vs LIV in 6d'
const fullTime = momentView([], [finishedRecord([3, 6])], { line: FT_LINE })
const lastMinute = momentView([liveRecord([3, 6], { minute: 90 })])
const goalWorld = async ($: Parameters<typeof world>[0], on: Parameters<typeof world>[1]) => {
  const w = await world($, on, [before, goal, goal])
  await w.clock.advance(15_000)
  return w
}
const fullTimeWorld = async ($: Parameters<typeof world>[0], on: Parameters<typeof world>[1]) => {
  const w = await world($, on, [lastMinute, fullTime, fullTime])
  await w.clock.advance(15_000)
  return w
}

describe('the whole tree on the terminal', () => {
  test('a goal, first frame: three `claude` Texts, then a column one apart of the ball, the bold `success` word with the team, the scorer; each row truncating; the line; the band beneath', async ($, on) => {
    const w = await goalWorld($, on)
    expect(await drawn(w)).toEqual(expected(LEGS[0], [row('⚽'), row(text({ bold: true, color: 'success' }, 'GOAL!'), ' Liverpool'), row("Ronald Araújo 22'")], momentLine([0, 1])))
  })

  test('full time, first frame: the same two columns, the caption plain between two blank rows', async ($, on) => {
    const w = await fullTimeWorld($, on)
    expect(await drawn(w)).toEqual(expected(LEGS[0], [row(' '), row('Full time · Liverpool win'), row(' ')], FT_LINE))
  })

  test('full time: the legs alternate through all ten frames', { timeoutMs: 20_000 }, async ($, on) => {
    const w = await fullTimeWorld($, on)
    for (let f = 0; f < 10; f++) {
      expect(await drawn(w)).toEqual(expected(LEGS[f % 2] as string, [row(' '), row('Full time · Liverpool win'), row(' ')], FT_LINE))
      await w.clock.advance(500)
    }
  })
})

describe('one frame drawn again is the same tree', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`a goal on the ${surface}: four draws of the second frame`, async ($, on) => {
      const w = await goalWorld($, on)
      await w.clock.advance(500)
      const first = JSON.stringify(await drawn(w, surface))
      expect(first).toContain('GOAL!')
      for (let i = 0; i < 3; i++) expect(JSON.stringify(await drawn(w, surface))).toBe(first)
    })

    test(`full time on the ${surface}: four draws of the second frame`, async ($, on) => {
      const w = await fullTimeWorld($, on)
      await w.clock.advance(500)
      const first = JSON.stringify(await drawn(w, surface))
      expect(first).toContain('Full time · Liverpool win')
      for (let i = 0; i < 3; i++) expect(JSON.stringify(await drawn(w, surface))).toBe(first)
    })
  }
})
