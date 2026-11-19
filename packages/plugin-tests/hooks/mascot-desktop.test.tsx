import { describe, expect, test } from 'claude-code/testing'
import { ARAUJO, drawnRows, finishedRecord, liveRecord, momentLine, momentView, world } from './world'

/**
 * The mascot in the desktop app (plugin 0.12.1). The app draws the band's text in a proportional face: a space is
 * narrower than a block glyph and a line is taller than one, so the three rows of text art came apart there (seen on
 * a real goal, Mexico v Jamaica, Nov 17, 2026: the head left of the body's centre, a gap under it, the legs at the far
 * left). The app's monospaced face lines the rows up and draws the blocks as thin bars, so on `desktop` the same
 * three rows are drawn as ONE `Svg` of rectangles, one per lit quadrant of each glyph (a glyph is two quadrants
 * across and two down; a quadrant is 4 by 9 CSS pixels, so the nine columns and three rows are 72 by 54), in one
 * fixed colour, `#D97757` (an image cannot read the theme's `claude` key). The terminal keeps the text art.
 *
 * The source carries `shape-rendering="crispEdges"`, which scenes.test.tsx refuses in a scene: there it freezes a
 * drawing's own CSS animation, and this drawing has none (its legs change by a new source per frame). It is kept
 * because it is the form the maintainer saw in the app, and the whole source is pinned here, that attribute included.
 *
 * What the app paints is not asserted here: these cases pin the element, its source and the text beside it.
 */
const HEAD = ' ▐▛███▜▌'
const BODY = '▝▜█████▛▘'
const LEGS = ['  ▘▘ ▝▝', '  ▝▝ ▘▘'] as const
/** The quadrants a glyph lights: upper left, upper right, lower left, lower right. */
const QUADRANTS: Record<string, readonly [boolean, boolean, boolean, boolean]> = {
  ' ': [false, false, false, false],
  '█': [true, true, true, true],
  '▐': [false, true, false, true],
  '▌': [true, false, true, false],
  '▛': [true, true, true, false],
  '▜': [true, true, false, true],
  '▝': [false, true, false, false],
  '▘': [true, false, false, false],
}
const QUAD_W = 4
const QUAD_H = 9
const WIDTH = 9 * 2 * QUAD_W
const HEIGHT = 3 * 2 * QUAD_H
const COLOR = '#D97757'
/** The whole source for three rows: the root as the app was shown it, one rectangle per lit quadrant, row by row. */
const sourceOf = (rows: readonly string[]): string => {
  let rects = ''
  rows.forEach((row, r) => {
    Array.from(row).forEach((glyph, c) => {
      const lit = QUADRANTS[glyph]
      if (!lit) throw new Error(`no quadrants for ${JSON.stringify(glyph)}`)
      lit.forEach((on, i) => {
        if (on) rects += `<rect x="${(c * 2 + (i % 2)) * QUAD_W}" y="${(r * 2 + Math.floor(i / 2)) * QUAD_H}" width="${QUAD_W}" height="${QUAD_H}"/>`
      })
    })
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" shape-rendering="crispEdges" fill="${COLOR}">${rects}</svg>`
}
/** The two drawings, one per leg step: a source is one of these, whole, or it is not the mascot. */
const EXPECTED = LEGS.map((legs) => sourceOf([HEAD, BODY, legs]))
const ALT = 'Claude mascot'

type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }
const kids = (n: unknown): Node[] => (n !== null && typeof n === 'object' && Array.isArray((n as Node).children) ? ((n as Node).children as unknown[]).filter((k): k is Node => k !== null && typeof k === 'object') : [])
const textOf = (n: unknown): string => (typeof n === 'string' ? n : n !== null && typeof n === 'object' && Array.isArray((n as Node).children) ? ((n as Node).children as unknown[]).map(textOf).join('') : '')
const find = (n: Node, hit: (n: Node) => boolean): Node | null => {
  if (hit(n)) return n
  for (const k of kids(n)) {
    const f = find(k, hit)
    if (f) return f
  }
  return null
}
/**
 * The celebration's row as drawn: the Box, laid out across (never a column, never reversed), whose FIRST child is a column holding one Svg and nothing else, and whose
 * second is the column of words (a column: three rows, never one line); its Svg's source and alt, and the words' rows. `null` when no such Box is drawn.
 */
const celebration = (root: Node): { source: string; alt: unknown; words: string[] } | null => {
  const row = find(root, (n) => {
    const [left, right, ...rest] = kids(n)
    const inLeft = left ? kids(left) : []
    return n.type === 'Box' && n.props?.flexDirection !== 'column' && n.props?.flexDirection !== 'column-reverse' && n.props?.flexDirection !== 'row-reverse' && rest.length === 0 && left?.type === 'Box' && right?.type === 'Box' && right.props?.flexDirection === 'column' && inLeft.length === 1 && inLeft[0]?.type === 'Svg'
  })
  if (!row) return null
  const [left, right] = kids(row)
  const svg = kids(left as Node)[0] as Node
  return { source: String(svg.props?.source), alt: svg.props?.alt, words: kids(right as Node).map(textOf) }
}

type W = Awaited<ReturnType<typeof world>>
const next = async (w: W) => {
  await w.clock.advance(15_000)
}
/** A desktop draw: the celebration's row (or `null`), every Svg and every Text's text. */
const desktop = async (w: W, props: Record<string, unknown> = {}) => {
  const m = await w.mount(props, 'desktop')
  const [root] = await m.findAll({ type: 'Box' })
  return {
    row: root ? celebration(root) : null,
    svgs: await m.findAll({ type: 'Svg' }),
    texts: (await m.findAll({ type: 'Text' })).map((t) => t.text),
    rows: await drawnRows(m),
  }
}
const hasGlyphs = (t: string[]) => t.some((x) => /[█▐▌▛▜▝▘]/.test(x))
/** The celebration's top row: the ball alone, spaces before it. */
const BALL_ROW = /^ *⚽ *$/

const before = momentView([liveRecord([0, 0])])
const goal = momentView([liveRecord([0, 1], { lastGoal: ARAUJO })])
const LINE = momentLine([0, 1])

describe('a goal for the pinned side in the desktop app, three spare rows', () => {
  test('the mascot is one Svg at the left of the words: the three rows quadrant by quadrant, 72 by 54, one fixed colour, nothing else in its source', async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await next(w)
    const d = await desktop(w)
    expect(d.svgs).toHaveLength(1)
    expect(d.row).not.toBeNull()
    // The whole source, not its rectangles alone: a shape, a style or a colour beside them is another drawing.
    expect(EXPECTED).toContain(d.row?.source)
    expect(d.row?.alt).toBe(ALT)
  })

  test('the words beside it are the terminal\'s: the ball alone on the top row, `GOAL! Liverpool`, the scorer and minute; no Text holds a block glyph', async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await next(w)
    const d = await desktop(w)
    expect(d.row?.words).toHaveLength(3)
    expect(BALL_ROW.test(d.row?.words[0] ?? '')).toBe(true)
    expect(d.row?.words[1]).toBe('GOAL! Liverpool')
    expect(d.row?.words[2]).toBe("Ronald Araújo 22'")
    expect(hasGlyphs(d.texts)).toBe(false)
    expect(d.rows[d.rows.length - 1]?.trim()).toBe(LINE)
  })

  test('the legs alternate from frame to frame: the first frame is the first leg step, each later frame the other one', { timeoutMs: 20_000 }, async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await next(w)
    for (let f = 0; f < 6; f++) {
      const now = (await desktop(w)).row?.source ?? ''
      // The play's first frame is the first leg step; each later frame the other one.
      expect(now).toBe(EXPECTED[f % 2])
      await w.clock.advance(500)
    }
  })

  test('two spare rows: `GOAL! Liverpool` and the bottom row, no Svg and no glyph', async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await next(w)
    const d = await desktop(w, { maxRows: 4 })
    expect(d.svgs).toHaveLength(0)
    expect(hasGlyphs(d.texts)).toBe(false)
    expect(d.rows.map((r) => r.trim())).toEqual(['GOAL! Liverpool', "Ronald Araújo 22'", LINE])
  })
})

describe('full time for the pinned side in the desktop app', () => {
  const FT_LINE = 'LAS vs LIV in 6d'
  test('a win: the Svg beside `Full time · Liverpool win` for its 5 s, the legs alternating to the end; then the one line', { timeoutMs: 20_000 }, async ($, on) => {
    const ft = momentView([], [finishedRecord([3, 6])], { line: FT_LINE })
    const w = await world($, on, [momentView([liveRecord([3, 6], { minute: 90 })]), ft, ft])
    await next(w)
    for (let t = 0; t < 5_000; t += 500) {
      const d = await desktop(w)
      const now = d.row?.source ?? ''
      expect(d.svgs).toHaveLength(1)
      expect(now).toBe(EXPECTED[(t / 500) % 2])
      expect(d.row?.alt).toBe(ALT)
      expect(d.row?.words[1]).toBe('Full time · Liverpool win')
      expect(hasGlyphs(d.texts)).toBe(false)
      await w.clock.advance(500)
    }
    await w.clock.advance(500)
    const after = await desktop(w)
    expect(after.svgs).toHaveLength(0)
    expect(after.rows.map((r) => r.trim())).toEqual([FT_LINE])
  })

  test('a draw: the Svg beside `Full time · Draw`', async ($, on) => {
    const w = await world($, on, [momentView([liveRecord([2, 2], { minute: 90 })]), momentView([], [finishedRecord([2, 2])], { line: FT_LINE })])
    await next(w)
    const d = await desktop(w)
    expect(d.svgs).toHaveLength(1)
    expect(EXPECTED).toContain(d.row?.source)
    expect(d.row?.words[1]).toBe('Full time · Draw')
  })
})

describe('the terminal keeps the text art', () => {
  test('a goal on the terminal: the three rows as three Texts in `claude`, each with its own spaces, the legs of the first frame; no Svg', async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await next(w)
    const m = await w.mount()
    expect(await m.findAll({ type: 'Svg' })).toHaveLength(0)
    const art = (await m.findAll({ type: 'Text' })).filter((x) => x.props.color === 'claude').map((x) => x.text)
    expect(art).toHaveLength(3)
    expect(art[0]).toBe(HEAD)
    expect(art[1]).toBe(BODY)
    // The play's first frame: the first leg step.
    expect(art[2]).toBe(LEGS[0])
  })
})
