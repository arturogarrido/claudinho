import { describe, expect, test } from 'claude-code/testing'
import { ARAUJO, finishedRecord, liveRecord, momentView, world } from './world'

/**
 * The mascot in the desktop app (plugin 0.12.1). The app draws the band's text in a proportional face: a space is
 * narrower than a block glyph and a line is taller than one, so the three rows of text art came apart there (seen on
 * a real goal, Mexico v Jamaica, Nov 17, 2026: the head left of the body's centre, a gap under it, the legs at the far
 * left). The app's monospaced face lines the rows up and draws the blocks as thin bars, so on `desktop` the same
 * three rows are drawn as ONE `Svg` of rectangles, one per lit quadrant of each glyph (a glyph is two quadrants
 * across and two down; a quadrant is 4 by 9 CSS pixels, so the nine columns and three rows are 72 by 54), in one
 * fixed colour, `#D97757` (an image cannot read the theme's `claude` key). The terminal keeps the text art.
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
/** The rectangles three rows of text art are, as sorted `x,y` corners. */
const corners = (rows: readonly string[]): string[] => {
  const out: string[] = []
  rows.forEach((row, r) => {
    Array.from(row).forEach((glyph, c) => {
      const lit = QUADRANTS[glyph]
      if (!lit) throw new Error(`no quadrants for ${JSON.stringify(glyph)}`)
      lit.forEach((on, i) => {
        if (on) out.push(`${(c * 2 + (i % 2)) * QUAD_W},${(r * 2 + Math.floor(i / 2)) * QUAD_H}`)
      })
    })
  })
  return out.sort()
}
const EXPECTED = LEGS.map((legs) => corners([HEAD, BODY, legs]).join(' '))
/** One attribute of a tag, or `null`. */
const attr = (tag: string, name: string): string | null => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null
/** An Svg source's rectangles as sorted `x,y` corners; every one must be a quadrant's size. */
const drawn = (source: string): string => {
  const rects = source.match(/<rect\b[^>]*>/g) ?? []
  for (const r of rects) {
    expect(attr(r, 'width')).toBe(String(QUAD_W))
    expect(attr(r, 'height')).toBe(String(QUAD_H))
  }
  return rects
    .map((r) => `${attr(r, 'x')},${attr(r, 'y')}`)
    .sort()
    .join(' ')
}

type W = Awaited<ReturnType<typeof world>>
const next = async (w: W) => {
  await w.clock.advance(15_000)
}
const svgs = async (w: W, props: Record<string, unknown> = {}) => (await w.mount(props, 'desktop')).findAll({ type: 'Svg' })
const texts = async (w: W, surface: 'terminal' | 'desktop', props: Record<string, unknown> = {}) =>
  (await (await w.mount(props, surface)).findAll({ type: 'Text' })).map((t) => t.text)
const hasGlyphs = (t: string[]) => t.some((x) => /[█▐▌▛▜▝▘]/.test(x))

const before = momentView([liveRecord([0, 0])])
const goal = momentView([liveRecord([0, 1], { lastGoal: ARAUJO })])

describe('a goal for the pinned side in the desktop app, three spare rows', () => {
  test('the mascot is one Svg of the three rows, quadrant by quadrant, 72 by 54, in the fixed colour', async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await next(w)
    const s = await svgs(w)
    expect(s).toHaveLength(1)
    const source = String(s[0]?.props.source)
    const root = /<svg\b[^>]*>/.exec(source)?.[0] ?? ''
    expect(attr(root, 'viewBox')).toBe(`0 0 ${WIDTH} ${HEIGHT}`)
    expect(attr(root, 'width')).toBe(String(WIDTH))
    expect(attr(root, 'height')).toBe(String(HEIGHT))
    expect(attr(root, 'fill')).toBe(COLOR)
    expect(EXPECTED).toContain(drawn(source))
    // One colour: nothing in the source paints in another.
    expect(source.match(/fill=/g)).toHaveLength(1)
    expect(source.includes('stroke')).toBe(false)
  })

  test('the Svg says what it is to a reader that cannot see it', async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await next(w)
    const s = await svgs(w)
    expect(s).toHaveLength(1)
    const alt = s[0]?.props.alt
    expect(typeof alt === 'string' && alt.trim().length > 0).toBe(true)
  })

  test('no text art beside it: no Text holds a block glyph, and the words are the terminal\'s', async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await next(w)
    const t = await texts(w, 'desktop')
    expect(hasGlyphs(t)).toBe(false)
    expect(t.some((x) => x.includes('⚽'))).toBe(true)
    expect(t.some((x) => x.trim() === 'GOAL!')).toBe(true)
    expect(t.some((x) => x.includes('Liverpool'))).toBe(true)
    expect(t.some((x) => x.includes("Ronald Araújo 22'"))).toBe(true)
  })

  test('the legs alternate from frame to frame: each frame is one of the two drawings, never the last one', { timeoutMs: 20_000 }, async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await next(w)
    let last = ''
    for (let f = 0; f < 5; f++) {
      const s = await svgs(w)
      expect(s).toHaveLength(1)
      const now = drawn(String(s[0]?.props.source))
      expect(EXPECTED).toContain(now)
      if (f > 0) expect(now).not.toBe(last)
      last = now
      await w.clock.advance(500)
    }
  })

  test('two spare rows: the words alone, no Svg', async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await next(w)
    expect(await svgs(w, { maxRows: 4 })).toHaveLength(0)
    expect(hasGlyphs(await texts(w, 'desktop', { maxRows: 4 }))).toBe(false)
  })
})

describe('full time for the pinned side in the desktop app', () => {
  test('the mascot is the Svg there too, beside `Full time · Liverpool win`', async ($, on) => {
    const w = await world($, on, [momentView([liveRecord([3, 6])]), momentView([], [finishedRecord([3, 6])], { line: 'LAS vs LIV in 6d' })])
    await next(w)
    const s = await svgs(w)
    expect(s).toHaveLength(1)
    expect(EXPECTED).toContain(drawn(String(s[0]?.props.source)))
    const t = await texts(w, 'desktop')
    expect(hasGlyphs(t)).toBe(false)
    expect(t.some((x) => x.includes('Full time · Liverpool win'))).toBe(true)
  })
})

describe('the terminal keeps the text art', () => {
  test('a goal on the terminal: the three rows as text, no Svg', async ($, on) => {
    const w = await world($, on, [before, goal, goal])
    await next(w)
    const m = await w.mount()
    expect(await m.findAll({ type: 'Svg' })).toHaveLength(0)
    const t = (await m.findAll({ type: 'Text' })).map((x) => x.text)
    expect(t.some((x) => x.includes(HEAD.trim()))).toBe(true)
    expect(t.some((x) => x.includes(BODY))).toBe(true)
  })
})
