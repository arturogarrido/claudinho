import { mock, type test } from 'claude-code/testing'

/** The world beneath the plugin, shared by the test files (a helper module: a test file imported by another would run its tests again). */
export const START = { cwd: '/tmp/claudinho-test', surface: 'terminal', isInteractive: true } as const
export const PROPS = { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 80 } as const
const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
/** The clock's start: the views the tests build are stamped 15:00Z with a 15:05Z deadline. */
export const NOW = Date.parse('2026-10-10T15:00:00.000Z')
export const COMPLETE = '⚽ World Cup 2026 is complete · claudinho follow --list'
/** The host environment a test session starts with unless it says otherwise: a bare PATH, a home, no Windows. */
export const HOME = '/Users/fan'
export const BARE_PATH = '/usr/bin:/bin'
export const NVM = `${HOME}/.nvm/versions/node`

/** The view the CLI prints for a line, with nothing live: `idle` and `empty` SAY what the line is (the band never reads the text). */
export const view = (line: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    line,
    idle: false,
    empty: false,
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

type Surface = 'terminal' | 'desktop' | 'mobile' | 'vscode'

/**
 * How the session starts, as measured on the engine (Oct 11, 2026): `start` is what `session.start` reports;
 * `surfaces` is the roster `$.session.surfaces()` answers at that moment (by default the start's own surface, or none);
 * `attachFirst` attaches a client BEFORE `session.start` (a client attaches on its first ask to draw); `env` is the
 * host's environment as `$.env.get` reads it (a name absent from it is unset); `nvm` is what listing nvm's version
 * folder answers (an Error: no such folder); `beneath` draws another plugin's band under ours.
 */
export type WorldOptions = {
  start?: { surface: Surface | null; isInteractive: boolean }
  surfaces?: Surface[]
  attachFirst?: { surface: Surface; clientId: string }
  env?: Record<string, string>
  nvm?: Array<{ name: string; kind: 'file' | 'dir' | 'other' }> | Error
  beneath?: string
}

/** The world beneath the plugin: a mock clock, the session started, the engine's own (empty) band, the CLI's answers in order. */
export const world = async (
  $: Parameters<Parameters<typeof test>[1]>[0],
  on: Parameters<Parameters<typeof test>[1]>[1],
  answers: Array<string | Error | { stdout: string; truncated: true }>,
  options: WorldOptions = {},
) => {
  const start = options.start ?? { surface: START.surface, isInteractive: START.isInteractive }
  // The roster the engine holds: the session's own surface at start, plus every client attached, less every detached.
  const roster: Surface[] = [...(options.surfaces ?? (start.surface ? [start.surface] : []))]
  const env: Record<string, string> = options.env ?? { PATH: BARE_PATH, HOME }
  const nvm = options.nvm ?? new Error(`ENOENT: no such file or directory, scandir '${NVM}'`)
  // The clock starts at a fixed instant, five minutes before the views' `staleAfter` (15:05Z): the context's deadline
  // is then a property of the test, never of the wall clock the kit might start from.
  const clock = mock.clock(on, { now: NOW })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.attach', (_$, e) => ({ clientId: e.clientId }))
  on('session.detach', (_$, e) => ({ clientId: e.clientId }))
  let surfaceReads = 0
  on('session.surfaces', () => {
    surfaceReads += 1
    return { value: [...roster] }
  })
  const envReads: string[] = []
  on('env.get', (_$, e) => {
    envReads.push(e.name)
    return { value: Object.hasOwn(env, e.name) ? env[e.name] : undefined }
  })
  const lists: string[] = []
  on('fs.list', (_$, e) => {
    lists.push(e.path)
    if (e.path !== NVM) throw new Error(`ENOENT: no such file or directory, scandir '${e.path}'`)
    if (nvm instanceof Error) throw nvm
    return { value: nvm.map((d) => ({ ...d, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($$, e) => {
    const { Box, Text } = $$.ui.resolve(e)
    return options.beneath === undefined ? <Box /> : <Box><Text>{options.beneath}</Text></Box>
  })
  // The hooks beneath the plugin are registered before the test first calls `$`: the prompt's bottom answers as
  // the engine does (the text and the context that arrived).
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))
  const argvs: string[][] = []
  const stdins: Array<string | undefined> = []
  const envs: Array<Record<string, string> | undefined> = []
  on('process.run', (_$, e) => {
    argvs.push([...e.argv])
    stdins.push(e.init?.stdin)
    envs.push(e.init?.env ? { ...e.init.env } : undefined)
    const a = answers[Math.min(argvs.length - 1, answers.length - 1)]
    if (a instanceof Error) throw a
    if (typeof a === 'object') return { value: { ...ok(`${a.stdout}\n`).value, isStdoutTruncated: true } }
    return ok(`${a}\n`)
  })
  if (options.attachFirst) {
    roster.push(options.attachFirst.surface)
    await $.session.attach(options.attachFirst)
  }
  await $.session.start({ cwd: START.cwd, ...start })
  await clock.advance(1)
  /** A client attaches (the roster gains its surface), then the clock lets the run it starts resolve. */
  const attach = async (surface: Surface, clientId: string) => {
    roster.push(surface)
    await $.session.attach({ surface, clientId })
    await clock.advance(1)
  }
  /** A client leaves (the roster loses its surface). */
  const detach = async (surface: Surface, clientId: string) => {
    const i = roster.indexOf(surface)
    if (i >= 0) roster.splice(i, 1)
    await $.session.detach({ surface, clientId: `${surface}:${clientId}`, reason: 'detach' })
  }
  const mount = (props: Partial<typeof PROPS> = {}, surface: 'terminal' | 'desktop' = 'terminal') =>
    $.ui.mount({ plugin: 'claudinho', surface, component: 'AbovePrompt', props: { ...PROPS, ...props }, viewport: { columns: 100, rows: 30 } })
  /** How many times the plugin asked for the roster: what a timer ticking for nobody would show. */
  const rosterReads = () => surfaceReads
  return { clock, argvs, stdins, envs, envReads, lists, mount, attach, detach, rosterReads }
}

/** The first-run object the CLI prints with no competition chosen: no view, the one line, its own key. */
export const FIRST_RUN = JSON.stringify({ competition: null, noCompetition: true, line: '⚽ claudinho follow' })
