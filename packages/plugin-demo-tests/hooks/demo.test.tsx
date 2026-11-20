import { describe, expect, mock, test } from 'claude-code/testing'

/**
 * The plugin demo's celebration, RUN: `scripts/plugin-demo-test.sh` assembles the demo as `scripts/plugin-demo.sh`
 * does (the demo's module beside the plugin's drawing modules from this checkout) and runs this kit against it. A
 * module the demo imports and the script does not copy fails the load, so every case here fails with it.
 *
 * Covered: `/demo mascot` and `/demo fulltime` (what each replies, what the band draws frame by frame on the terminal
 * and in the desktop app, and that the band is empty again after the play's length), a play replaced by the next one,
 * and `/demo off`. Not run here: the scene commands (a team, `band`, `pitch`, `idle`, `live`, `goal`, `other`, `left`,
 * `right`), whose drawings the plugin's own kit pins (scenes.test.tsx); and what the app paints, which is a person's
 * look. The team is the demo's first, Spain, at home to Argentina; the word is English's.
 */
const NOW = Date.parse('2026-10-10T15:00:00.000Z')
const HEAD = ' ▐▛███▜▌'
const BODY = '▝▜█████▛▘'
const LEGS = ['  ▘▘ ▝▝', '  ▝▝ ▘▘'] as const
const GLYPHS = /[█▐▌▛▜▝▘]/
const GOAL_LINE = "⚽ ESP 1–0 ARG 36'  · demo"
const FT_LINE = '⚽ ESP 1–0 ARG FT  · demo'

type On = Parameters<Parameters<typeof test>[2]>[1]
type Engine = Parameters<Parameters<typeof test>[2]>[0]
type Surface = 'terminal' | 'desktop'

/** A session with the demo loaded: the engine's own answers stubbed, the clock in hand, a command run and a draw. */
const session = async ($: Engine, on: On) => {
  const clock = mock.clock(on, { now: NOW })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('command.run', (_$, e) => ({ text: `engine ran /${e.command}` }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('theme.clear', () => ({ value: undefined }))
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
    const texts = await m.findAll({ type: 'Text' })
    return { texts: texts.map((t) => t.text), claude: texts.filter((t) => t.props.color === 'claude').map((t) => t.text), svgs: await m.findAll({ type: 'Svg' }) }
  }
  return { clock, run, draw }
}
/** The band with no play: the band beneath alone. */
const EMPTY = ['beneath']

describe('/demo mascot: the goal celebration', () => {
  test('it answers at once with the team and the play\'s length', async ($, on) => {
    const s = await session($, on)
    expect(await s.run('mascot')).toBe('Spain, goal celebration: playing in the band (3 s)')
  })

  test('the terminal draws six frames: the mascot as text art, its legs alternating, the ball crossing its row, `GOAL! Spain`, the demo scorer, the line; then the band is empty', { timeoutMs: 20_000 }, async ($, on) => {
    const s = await session($, on)
    await s.run('mascot')
    // 40 columns: the mascot's nine and one apart leave the ball 30, itself two wide.
    const SPACES = [0, 5, 11, 16, 22, 28]
    for (let f = 0; f < 6; f++) {
      const d = await s.draw()
      expect(d.svgs).toHaveLength(0)
      expect(d.claude).toEqual([HEAD, BODY, LEGS[f % 2]])
      const ball = d.texts.filter((t) => /^ *⚽ *$/.test(t))
      expect(ball).toHaveLength(1)
      expect(ball[0]?.indexOf('⚽')).toBe(SPACES[f])
      expect(d.texts).toContain('GOAL! Spain')
      expect(d.texts).toContain("Demo scorer 35'")
      expect(d.texts).toContain(GOAL_LINE)
      expect(d.texts[d.texts.length - 1]).toBe('beneath')
      await s.clock.advance(500)
    }
    expect((await s.draw()).texts).toEqual(EMPTY)
  })

  test('the desktop app draws the mascot as one Svg for the six frames, no block glyph in any text; then the band is empty', { timeoutMs: 20_000 }, async ($, on) => {
    const s = await session($, on)
    await s.run('mascot')
    const sources: string[] = []
    for (let f = 0; f < 6; f++) {
      const d = await s.draw('desktop')
      expect(d.svgs).toHaveLength(1)
      expect(d.svgs[0]?.props.alt).toBe('Claude mascot')
      sources.push(String(d.svgs[0]?.props.source))
      expect(d.texts.some((t) => GLYPHS.test(t))).toBe(false)
      expect(d.texts).toContain('GOAL! Spain')
      await s.clock.advance(500)
    }
    // Two drawings, one per leg step, alternating from the first frame.
    expect(new Set(sources).size).toBe(2)
    expect(sources).toEqual([0, 1, 2, 3, 4, 5].map((f) => sources[f % 2]))
    const after = await s.draw('desktop')
    expect(after.svgs).toHaveLength(0)
    expect(after.texts).toEqual(EMPTY)
  })

  test('fewer than three spare rows: nothing of the demo is drawn', async ($, on) => {
    const s = await session($, on)
    await s.run('mascot')
    expect((await s.draw('terminal', { maxRows: 4 })).texts).toEqual(EMPTY)
  })
})

describe('/demo fulltime: the full-time celebration', () => {
  test('it answers at once with the team and the play\'s length', async ($, on) => {
    const s = await session($, on)
    expect(await s.run('fulltime')).toBe('Spain, full time: playing in the band (5 s)')
  })

  test('ten frames beside `Full time · Spain win`, the legs alternating to the end, no ball; then the band is empty', { timeoutMs: 20_000 }, async ($, on) => {
    const s = await session($, on)
    await s.run('fulltime')
    for (let f = 0; f < 10; f++) {
      const d = await s.draw()
      expect(d.claude).toEqual([HEAD, BODY, LEGS[f % 2]])
      expect(d.texts).toContain('Full time · Spain win')
      expect(d.texts.some((t) => t.includes('⚽') && t !== FT_LINE)).toBe(false)
      expect(d.texts).toContain(FT_LINE)
      const desktop = await s.draw('desktop')
      expect(desktop.svgs).toHaveLength(1)
      await s.clock.advance(500)
    }
    expect((await s.draw()).texts).toEqual(EMPTY)
    expect((await s.draw('desktop')).svgs).toHaveLength(0)
  })
})

describe('a play ends or is replaced', () => {
  test('`/demo off` ends a play at once', async ($, on) => {
    const s = await session($, on)
    await s.run('mascot')
    await s.clock.advance(500)
    expect((await s.draw()).claude).toHaveLength(3)
    expect(await s.run('off')).toBe('Demo look cleared.')
    expect((await s.draw()).texts).toEqual(EMPTY)
  })

  test('a second play replaces the first and runs its own whole length from its start', { timeoutMs: 20_000 }, async ($, on) => {
    const s = await session($, on)
    await s.run('mascot')
    await s.clock.advance(2_000)
    await s.run('fulltime')
    const first = await s.draw()
    expect(first.texts).toContain('Full time · Spain win')
    expect(first.texts).not.toContain('GOAL! Spain')
    expect(first.claude[2]).toBe(LEGS[0])
    await s.clock.advance(4_500)
    expect((await s.draw()).texts).toContain('Full time · Spain win')
    await s.clock.advance(500)
    expect((await s.draw()).texts).toEqual(EMPTY)
  })
})
