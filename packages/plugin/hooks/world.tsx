import { mock, test } from 'claude-code/testing'

/** The world beneath the plugin, shared by the three test files (a helper module: a test file imported by another would run its tests again). */
export const START = { cwd: '/tmp/claudinho-test', surface: 'terminal', isInteractive: true } as const
export const PROPS = { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 80 } as const
const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
/** The clock's start: the views the tests build are stamped 15:00Z with a 15:05Z deadline. */
export const NOW = Date.parse('2026-10-10T15:00:00.000Z')
export const COMPLETE = '⚽ World Cup 2026 is complete · claudinho follow --list'

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
  // The clock starts at a fixed instant, five minutes before the views' `staleAfter` (15:05Z): the context's deadline
  // is then a property of the test, never of the wall clock the kit might start from.
  const clock = mock.clock(on, { now: NOW })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.render', { component: 'AbovePrompt' }, ($$, e) => {
    const { Box } = $$.ui.resolve(e)
    return <Box />
  })
  // The hooks beneath the plugin are registered before the test first calls `$`: the prompt's bottom answers as
  // the engine does (the text and the context that arrived).
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))
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
