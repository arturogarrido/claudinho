import { describe, expect, mock, test } from 'claude-code/testing'

/**
 * The plugin demo's celebration, RUN: `scripts/plugin-demo-test.sh` assembles the demo as `scripts/plugin-demo.sh`
 * does (the demo's module beside the plugin's drawing modules from this checkout) and runs this kit against it. A
 * module the demo imports and the script does not copy fails the load, so every case here fails with it.
 *
 * Covered: `/demo mascot` and `/demo fulltime` (what each replies; the WHOLE tree the band draws on the terminal, frame
 * by frame; the desktop's Svg, by its whole source, frame by frame; the redraws the play asks the engine for, one a frame and
 * none after it; the band empty again after the play's length), a play replaced by the next one or started again, and
 * `/demo off` (the play ended, the look's clear asked); and the celebration after a language word (`es`) and after a
 * team word (`argentina`, the away side), before a play and during one. Not looked at here: the scenes a command sets as the look (a team's stadium,
 * `band`, `pitch`, `idle`, `live`, `goal`, `other`, `left`, `right`), whose drawings the plugin's own kit pins
 * (scenes.test.tsx); and what the app paints, which is a person's look. Unless a case says otherwise the team is the
 * demo's first, Spain, at home to Argentina, and the word is English's.
 */
const NOW = Date.parse('2026-10-10T15:00:00.000Z')
const HEAD = ' ▐▛███▜▌'
const BODY = '▝▜█████▛▘'
const LEGS = ['  ▘▘ ▝▝', '  ▝▝ ▘▘'] as const
const GLYPHS = /[█▐▌▛▜▝▘]/
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
/** The desktop's drawing of three rows, whole: one 4 by 9 rectangle per lit quadrant, 72 by 54, one colour. */
const sourceOf = (rows: readonly string[]): string => {
  let rects = ''
  rows.forEach((r, y) => {
    Array.from(r).forEach((glyph, x) => {
      const lit = QUADRANTS[glyph]
      if (!lit) throw new Error(`no quadrants for ${JSON.stringify(glyph)}`)
      lit.forEach((on, i) => {
        if (on) rects += `<rect x="${(x * 2 + (i % 2)) * 4}" y="${(y * 2 + Math.floor(i / 2)) * 9}" width="4" height="9"/>`
      })
    })
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 54" width="72" height="54" shape-rendering="crispEdges" fill="#D97757">${rects}</svg>`
}
/** The mascot's two drawings in the desktop app, one per leg step, the first frame's first. */
const POSES = LEGS.map((legs) => sourceOf([HEAD, BODY, legs]))
const GOAL_LINE = "⚽ ESP 1–0 ARG 36'  · demo"
const FT_LINE = '⚽ ESP 1–0 ARG FT  · demo'

type On = Parameters<Parameters<typeof test>[2]>[1]
type Engine = Parameters<Parameters<typeof test>[2]>[0]
type Surface = 'terminal' | 'desktop'

type Tree = { type: string; props?: Record<string, unknown>; children?: Array<Tree | string> }
/** A node as the demo made it: its type, its props and its children; an engine node (the band beneath) by its type alone. */
const shape = (n: unknown): Tree | string => {
  if (typeof n === 'string') return n
  const o = n as { type: string; props?: Record<string, unknown>; children?: unknown[] }
  if (o.type === 'engine') return { type: 'engine' }
  return { type: o.type, props: o.props ?? {}, children: (o.children ?? []).map(shape) }
}
const text = (props: Record<string, unknown>, ...children: Array<Tree | string>): Tree => ({ type: 'Text', props, children })
const box = (props: Record<string, unknown>, ...children: Array<Tree | string>): Tree => ({ type: 'Box', props, children })
const row = (...children: Array<Tree | string>): Tree => text({ wrap: 'truncate-end' }, ...children)
/**
 * The demo's part of the band on the terminal: the mascot's column and the words' column in one row (the top word
 * beside the head, the bottom one beside the legs), the demo's line, the band beneath. The keys a mount shows are the
 * ones on a Box (`mascot`); a Text's key is not in its props.
 */
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
/** The same tree in the desktop app: the mascot's column holds the one Svg (its source is read apart, frame by frame). */
const onDesktop = (t: Tree): Tree => {
  const [mascotRow, ...rest] = t.children as Tree[]
  const [, words] = (mascotRow as Tree).children as Tree[]
  return { ...t, children: [{ ...(mascotRow as Tree), children: [box({ flexDirection: 'column' }, { type: 'Svg' }), words as Tree] }, ...rest] }
}
/** A drawn tree with its Svg reduced to its type, and without the `weight` the desktop's own elements add to a bold Text. */
const svgless = (n: Tree | string | null): Tree | string | null => {
  if (n === null || typeof n === 'string' || n.type === 'engine') return n
  if (n.type === 'Svg') return { type: 'Svg' }
  const { weight: _weight, ...props } = n.props ?? {}
  return { ...n, props, children: (n.children ?? []).map((c) => svgless(c) as Tree | string) }
}
const goalWords = (spaces: number, word = 'GOAL!', team = 'Spain'): [Tree, Tree, Tree] => [row(`${' '.repeat(spaces)}⚽`), row(text({ bold: true, color: 'success' }, word), ` ${team}`), row("Demo scorer 35'")]
const FT_WORDS: [Tree, Tree, Tree] = [row(' '), row('Full time · Spain win'), row(' ')]
/** 40 columns: the mascot's nine and one apart leave the ball 30, itself two wide. */
const SPACES = [0, 5, 11, 16, 22, 28]

/** A session with the demo loaded: the engine's own answers stubbed and counted, the clock in hand, a command run and a draw. */
const session = async ($: Engine, on: On) => {
  const clock = mock.clock(on, { now: NOW })
  const asked = { redraws: 0, clears: 0 }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('command.run', (_$, e) => ({ text: `engine ran /${e.command}` }))
  on('ui.invalidate', (_$, e) => {
    if ((e as { event?: unknown }).event === 'ui.render') asked.redraws += 1
    return { value: undefined }
  })
  on('theme.clear', () => {
    asked.clears += 1
    return { value: undefined }
  })
  // A team word sets its stadium as the look: the engine's answer, a look that is drawn.
  on('theme.set', () => ({ value: { isDrawn: true } }))
  on('ui.render', { component: 'AbovePrompt' }, ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>beneath</Text>
  })
  await $.session.start({ cwd: '/tmp/claudinho-demo-test', surface: 'terminal', isInteractive: true })
  await clock.advance(1)
  const run = async (args: string): Promise<string> => {
    const r = (await $.command.run({ command: 'demo', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never)) as { text?: unknown }
    return String(r?.text)
  }
  const draw = async (surface: Surface = 'terminal', props: Record<string, unknown> = {}) => {
    const m = await $.ui.mount({ plugin: 'claudinho-demo', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 40, ...props }, viewport: { columns: 100, rows: 30 } } as never)
    const [root] = await m.findAll({})
    const part = ((root?.children ?? []) as Array<{ part?: { plugin?: string } }>).find((c) => c?.part?.plugin === 'claudinho-demo')
    return { tree: part === undefined ? null : shape(part), texts: (await m.findAll({ type: 'Text' })).map((t) => t.text), svgs: await m.findAll({ type: 'Svg' }) }
  }
  return { clock, run, draw, asked }
}
/** The band with no play: the band beneath alone, nothing of the demo. */
const EMPTY = { tree: null, texts: ['beneath'], svgs: [] }

describe('/demo mascot: the goal celebration', () => {
  test('it answers at once with the team and the play\'s length', async ($, on) => {
    const s = await session($, on)
    expect(await s.run('mascot')).toBe('Spain, goal celebration: playing in the band (3 s)')
  })

  test('the terminal draws six frames, each the whole tree: the mascot in `claude`, its legs alternating; beside its head the ball crossing, then `GOAL!` bold in `success` with the team, then the demo scorer; the line; the band beneath. Then the band is empty', { timeoutMs: 20_000 }, async ($, on) => {
    const s = await session($, on)
    await s.run('mascot')
    for (let f = 0; f < 6; f++) {
      const d = await s.draw()
      expect(d.svgs).toHaveLength(0)
      expect(d.tree).toEqual(expected(LEGS[f % 2] as string, goalWords(SPACES[f] as number), GOAL_LINE))
      await s.clock.advance(500)
    }
    expect(await s.draw()).toEqual(EMPTY)
  })

  test('the desktop app draws six frames, each the whole tree with the mascot as one Svg, its two drawings alternating, no block glyph in any text; then the band is empty', { timeoutMs: 20_000 }, async ($, on) => {
    const s = await session($, on)
    await s.run('mascot')
    for (let f = 0; f < 6; f++) {
      const d = await s.draw('desktop')
      expect(d.svgs).toHaveLength(1)
      expect(d.svgs[0]?.props.alt).toBe('Claude mascot')
      expect(d.svgs[0]?.props.source, `frame ${f}`).toBe(POSES[f % 2])
      expect(d.texts.some((t) => GLYPHS.test(t))).toBe(false)
      expect(svgless(d.tree)).toEqual(onDesktop(expected('', goalWords(SPACES[f] as number), GOAL_LINE)))
      await s.clock.advance(500)
    }
    expect(await s.draw('desktop')).toEqual(EMPTY)
  })

  test('it asks the engine for each frame itself: one redraw at the start, one every 500 ms, one more to empty the band, then none', { timeoutMs: 20_000 }, async ($, on) => {
    const s = await session($, on)
    await s.run('mascot')
    expect(s.asked.redraws).toBe(1)
    for (let f = 1; f < 6; f++) {
      await s.clock.advance(500)
      expect(s.asked.redraws).toBe(1 + f)
    }
    // The sixth tick ends the play: the frame's redraw and the one that empties the band.
    await s.clock.advance(500)
    expect(s.asked.redraws).toBe(8)
    await s.clock.advance(5_000)
    expect(s.asked.redraws).toBe(8)
  })

  test('fewer than three spare rows, or a survey in the band: nothing of the demo is drawn', async ($, on) => {
    const s = await session($, on)
    await s.run('mascot')
    for (const maxRows of [0, 1, 2, 3, 4]) expect(await s.draw('terminal', { maxRows }), String(maxRows)).toEqual(EMPTY)
    expect(await s.draw('terminal', { hasSurvey: true })).toEqual(EMPTY)
    expect((await s.draw('terminal', { maxRows: 5 })).tree).not.toBeNull()
  })
})

describe('the celebration is the chosen team\'s, in the chosen language', () => {
  test('after `/demo es` the goal word is Spanish\'s, on every frame', { timeoutMs: 20_000 }, async ($, on) => {
    const s = await session($, on)
    await s.run('es')
    await s.run('mascot')
    for (let f = 0; f < 6; f++) {
      expect((await s.draw()).tree).toEqual(expected(LEGS[f % 2] as string, goalWords(SPACES[f] as number, '¡GOL!'), GOAL_LINE))
      await s.clock.advance(500)
    }
  })

  test('after `/demo argentina` (the away side) the goal and the line are Argentina\'s, 0–1, and full time is its win', async ($, on) => {
    const s = await session($, on)
    await s.run('argentina')
    expect(await s.run('mascot')).toBe('Argentina, goal celebration: playing in the band (3 s)')
    expect((await s.draw()).tree).toEqual(expected(LEGS[0], goalWords(0, 'GOAL!', 'Argentina'), "⚽ ESP 0–1 ARG 36'  · demo"))
    expect(await s.run('fulltime')).toBe('Argentina, full time: playing in the band (5 s)')
    expect((await s.draw()).tree).toEqual(expected(LEGS[0], [row(' '), row('Full time · Argentina win'), row(' ')], '⚽ ESP 0–1 ARG FT  · demo'))
  })
})

describe('a play keeps the team and the word it was asked with', () => {
  test('a team word and a language word typed during a goal\'s play change nothing of it: the third frame is still Spain\'s, in English, 1–0', { timeoutMs: 20_000 }, async ($, on) => {
    const s = await session($, on)
    await s.run('mascot')
    await s.clock.advance(1_000)
    await s.run('argentina')
    await s.run('es')
    for (let f = 2; f < 6; f++) {
      expect((await s.draw()).tree, `frame ${f}`).toEqual(expected(LEGS[f % 2] as string, goalWords(SPACES[f] as number), GOAL_LINE))
      await s.clock.advance(500)
    }
    expect(await s.draw()).toEqual(EMPTY)
    // The next play is the new team's, in the new language.
    await s.run('mascot')
    expect((await s.draw()).tree).toEqual(expected(LEGS[0], goalWords(0, '¡GOL!', 'Argentina'), "⚽ ESP 0–1 ARG 36'  · demo"))
  })

  test('the same during full time: the caption and the line stay Spain\'s', async ($, on) => {
    const s = await session($, on)
    await s.run('fulltime')
    await s.clock.advance(1_000)
    await s.run('argentina')
    expect((await s.draw()).tree).toEqual(expected(LEGS[0], FT_WORDS, FT_LINE))
  })
})

describe('/demo fulltime: the full-time celebration', () => {
  test('it answers at once with the team and the play\'s length', async ($, on) => {
    const s = await session($, on)
    expect(await s.run('fulltime')).toBe('Spain, full time: playing in the band (5 s)')
  })

  test('ten frames, each the whole tree on the terminal (the caption plain between two blank rows, the legs alternating to the end) and in the desktop app (one Svg, its two drawings alternating to the end); then the band is empty', { timeoutMs: 20_000 }, async ($, on) => {
    const s = await session($, on)
    await s.run('fulltime')
    for (let f = 0; f < 10; f++) {
      expect((await s.draw()).tree).toEqual(expected(LEGS[f % 2] as string, FT_WORDS, FT_LINE))
      const desktop = await s.draw('desktop')
      expect(desktop.svgs).toHaveLength(1)
      expect(desktop.svgs[0]?.props.source, `frame ${f}`).toBe(POSES[f % 2])
      expect(svgless(desktop.tree)).toEqual(onDesktop(expected('', FT_WORDS, FT_LINE)))
      await s.clock.advance(500)
    }
    expect(await s.draw()).toEqual(EMPTY)
    expect(await s.draw('desktop')).toEqual(EMPTY)
  })

  test('it asks for a redraw every 500 ms of its 5 s, then none', { timeoutMs: 20_000 }, async ($, on) => {
    const s = await session($, on)
    await s.run('fulltime')
    for (let f = 1; f < 10; f++) {
      await s.clock.advance(500)
      expect(s.asked.redraws).toBe(1 + f)
    }
    await s.clock.advance(500)
    expect(s.asked.redraws).toBe(12)
    await s.clock.advance(5_000)
    expect(s.asked.redraws).toBe(12)
  })
})

describe('a play ends, is replaced or starts again', () => {
  test('`/demo off` ends a play at once, asks the redraw that empties the band and asks the look\'s clear', async ($, on) => {
    const s = await session($, on)
    await s.run('mascot')
    await s.clock.advance(500)
    expect((await s.draw()).tree).not.toBeNull()
    const before = s.asked.redraws
    expect(s.asked.clears).toBe(0)
    expect(await s.run('off')).toBe('Demo look cleared.')
    expect(s.asked.clears).toBe(1)
    expect(s.asked.redraws).toBe(before + 1)
    expect(await s.draw()).toEqual(EMPTY)
    // Its timer is stopped: no later redraw is asked.
    await s.clock.advance(5_000)
    expect(s.asked.redraws).toBe(before + 1)
  })

  test('a second play replaces the first and runs its own whole length from its start', { timeoutMs: 20_000 }, async ($, on) => {
    const s = await session($, on)
    await s.run('mascot')
    await s.clock.advance(2_000)
    const before = s.asked.redraws
    await s.run('fulltime')
    expect(s.asked.redraws).toBe(before + 1)
    expect((await s.draw()).tree).toEqual(expected(LEGS[0], FT_WORDS, FT_LINE))
    // The new play asks for its own frames: one each 500 ms, the first play's timer asking none.
    for (let f = 1; f < 10; f++) {
      await s.clock.advance(500)
      expect(s.asked.redraws, `frame ${f}`).toBe(before + 1 + f)
    }
    expect((await s.draw()).tree).toEqual(expected(LEGS[1], FT_WORDS, FT_LINE))
    await s.clock.advance(500)
    expect(s.asked.redraws).toBe(before + 12)
    expect(await s.draw()).toEqual(EMPTY)
    await s.clock.advance(5_000)
    expect(s.asked.redraws).toBe(before + 12)
  })

  test('the same command again starts the play again from its first frame', { timeoutMs: 20_000 }, async ($, on) => {
    const s = await session($, on)
    await s.run('mascot')
    await s.clock.advance(2_000)
    const before = s.asked.redraws
    expect(await s.run('mascot')).toBe('Spain, goal celebration: playing in the band (3 s)')
    expect(s.asked.redraws).toBe(before + 1)
    expect((await s.draw()).tree).toEqual(expected(LEGS[0], goalWords(0), GOAL_LINE))
    for (let f = 1; f < 6; f++) {
      await s.clock.advance(500)
      expect(s.asked.redraws, `frame ${f}`).toBe(before + 1 + f)
    }
    expect((await s.draw()).tree).toEqual(expected(LEGS[1], goalWords(28), GOAL_LINE))
    await s.clock.advance(500)
    expect(s.asked.redraws).toBe(before + 8)
    expect(await s.draw()).toEqual(EMPTY)
    await s.clock.advance(5_000)
    expect(s.asked.redraws).toBe(before + 8)
  })
})
