import { describe, expect, mock, test } from 'claude-code/testing'

/**
 * The band: `claudinho ambient --json --columns <the band's columns>` every 15 s, the object's `line` shown as the
 * CLI fitted it. Hidden: the first-run line and `⚽ —`; shown: a score, a countdown, the complete line. The two
 * idle lines are read every five minutes; a failed run, a missing binary, a non-object or a headless session show
 * nothing and block nothing.
 */
const START = { cwd: '/tmp/claudinho-test', surface: 'terminal', isInteractive: true } as const
const PROPS = { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 80 } as const
const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const COMPLETE = '⚽ World Cup 2026 is complete · claudinho follow --list'

/** The view the CLI prints for a line, with nothing live (the band reads `line` alone). */
export const view = (line: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    line,
    context: null,
    live: { items: [], total: 0, shown: 0, truncated: false, complete: true },
    current: false,
    next: null,
    pick: null,
    competition: { slug: 'eng.1', alias: 'premier-league', name: 'Premier League', chosenBy: 'saved' },
    degraded: false,
    source: 'espn',
    updatedAt: null,
    staleAfter: null,
    disclaimer: 'Not affiliated with FIFA, any confederation, league or club, or Anthropic.',
    ...over,
  })

/** The world beneath the plugin: a mock clock, the session started, the engine's own (empty) band, the CLI's answers in order. */
export const world = async (
  $: Parameters<Parameters<typeof test>[1]>[0],
  on: Parameters<Parameters<typeof test>[1]>[1],
  answers: Array<string | Error>,
  start: { isInteractive: boolean } = START,
) => {
  const clock = mock.clock(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.render', { component: 'AbovePrompt' }, ($$, e) => {
    const { Box } = $$.ui.resolve(e)
    return <Box />
  })
  const argvs: string[][] = []
  const stdins: Array<string | undefined> = []
  on('process.run', (_$, e) => {
    argvs.push([...e.argv])
    stdins.push(e.init?.stdin)
    const a = answers[Math.min(argvs.length - 1, answers.length - 1)]
    if (a instanceof Error) throw a
    return ok(`${a}\n`)
  })
  await $.session.start({ ...START, ...start })
  await clock.advance(1)
  const mount = (props: Partial<typeof PROPS> = {}) =>
    $.ui.mount({ plugin: 'claudinho', surface: 'terminal', component: 'AbovePrompt', props: { ...PROPS, ...props }, viewport: { columns: 100, rows: 30 } })
  return { clock, argvs, stdins, mount }
}

describe('what the band runs', () => {
  test("the CLI once at the start, ambient --json fitted to the band's columns, with an empty stdin", async ($, on) => {
    const { argvs, stdins } = await world($, on, [view("⚽ ARS 2–1 CHE 50'")])
    expect(argvs).toEqual([['claudinho', 'ambient', '--json', '--columns', '80']])
    expect(stdins).toEqual([''])
  })

  test("the columns are the band's: a narrower band asks for a narrower line on the next run", async ($, on) => {
    const { argvs, clock, mount } = await world($, on, [view("⚽ ARS 2–1 CHE 50'")])
    await mount({ bodyColumns: 24 })
    await clock.advance(15_000)
    expect(argvs.at(-1)).toEqual(['claudinho', 'ambient', '--json', '--columns', '24'])
  })
})

describe('what the band shows', () => {
  for (const line of ["⚽ ARS 2–1 CHE 50'", '⚽ ARS 0–0 CHE LIVE', '⚽ ARS 0–0 CHE live · syncing…', 'ARS vs LEE in 7h13m', COMPLETE]) {
    test(`shows the line as the CLI fitted it: ${line}`, async ($, on) => {
      const { mount } = await world($, on, [view(line)])
      expect(await (await mount()).findAll({ type: 'Text', text: line })).toHaveLength(1)
    })
  }

  for (const [why, line] of [['the first-run line', '⚽ claudinho follow'], ['nothing known', '⚽ —']] as const) {
    test(`shows nothing on ${why}`, async ($, on) => {
      const { mount } = await world($, on, [view(line)])
      expect(await (await mount()).findAll({ type: 'Text' })).toHaveLength(0)
    })
  }

  for (const [why, answer] of [['a line that is not an object', "⚽ ARS 2–1 CHE 50'"], ['an empty answer', ''], ['an object with no line', '{"current":false}']] as const) {
    test(`shows nothing on ${why}`, async ($, on) => {
      const { mount } = await world($, on, [answer])
      expect(await (await mount()).findAll({ type: 'Text' })).toHaveLength(0)
    })
  }

  test('shows nothing when the binary cannot run, and runs again at the next fire', async ($, on) => {
    const { argvs, clock, mount } = await world($, on, [new Error('spawn claudinho ENOENT'), view("⚽ ARS 2–1 CHE 50'")])
    expect(await (await mount()).findAll({ type: 'Text' })).toHaveLength(0)
    await clock.advance(15_000)
    expect(argvs).toHaveLength(2)
    expect(await (await mount()).findAll({ type: 'Text', text: "⚽ ARS 2–1 CHE 50'" })).toHaveLength(1)
  })

  test('yields to a survey and to a band with no row', async ($, on) => {
    const { mount } = await world($, on, [view("⚽ ARS 2–1 CHE 50'")])
    expect(await (await mount({ hasSurvey: true })).findAll({ type: 'Text' })).toHaveLength(0)
    expect(await (await mount({ maxRows: 0 })).findAll({ type: 'Text' })).toHaveLength(0)
  })
})

describe('the pace', () => {
  for (const line of ["⚽ ARS 2–1 CHE 50'", 'ARS vs LEE in 7h13m', '⚽ ARS 0–0 CHE live · syncing…', '⚽ —']) {
    test(`runs at every 15-second fire on ${line}`, async ($, on) => {
      const { argvs, clock } = await world($, on, [view(line)])
      await clock.advance(15_000)
      await clock.advance(15_000)
      expect(argvs.length).toBe(3)
    })
  }

  for (const line of ['⚽ claudinho follow', COMPLETE]) {
    test(`runs once per five minutes on the idle line ${line}`, async ($, on) => {
      const { argvs, clock } = await world($, on, [view(line)])
      await clock.advance(15_000)
      await clock.advance(15_000)
      expect(argvs.length).toBe(1)
      await clock.advance(300_000)
      expect(argvs.length).toBe(2)
    })
  }

  test('a headless session starts no timer and runs no process', async ($, on) => {
    const { argvs, clock } = await world($, on, [view("⚽ ARS 2–1 CHE 50'")], { isInteractive: false })
    await clock.advance(15_000)
    expect(argvs).toHaveLength(0)
  })
})
